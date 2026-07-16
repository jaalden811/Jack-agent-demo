import { readFileSync } from "node:fs";
import path from "node:path";
import type { NotificationDecision, PersonalRelevance, SellerProfile } from "@/lib/personalization/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Deterministic notification-fatigue policy. Decides immediate / digest /
 * in_app_only / suppress from verdict, signal strength, personal relevance,
 * action clarity, novelty, duplicate state, and the seller's preferences. All
 * thresholds/limits come from signal-agent-poc/config/notification_policy.json.
 */

type NotificationConfig = {
  never_notify_noise: boolean;
  thresholds: { immediate_personal_relevance: number; digest_personal_relevance: number; min_signal_strength: number; min_actionability: number };
  verdict_policy: Record<string, { decision?: string; allow_immediate?: boolean }>;
  limits: { max_immediate_per_day: number; per_account_cooldown_hours: number; per_motion_cooldown_hours: number };
  quiet_hours: { enabled: boolean; start: string; end: string };
  delta_only_repeat: boolean;
};

const CONFIG_RELATIVE_PATH = "signal-agent-poc/config/notification_policy.json";
let cached: NotificationConfig | null = null;
export function clearNotificationConfigCache(): void {
  cached = null;
}
function loadConfig(): NotificationConfig {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(path.join(process.cwd(), CONFIG_RELATIVE_PATH), "utf8")) as NotificationConfig;
  return cached;
}

export type NotificationExtras = {
  novelty?: number;
  duplicateOf?: string | null;
  materialChange?: boolean;
  cooldownUntil?: string | null;
  immediateSentToday?: number;
  inQuietHours?: boolean;
};

function cap(decision: NotificationDecision["decision"], ceiling: NotificationDecision["decision"]): NotificationDecision["decision"] {
  const order: NotificationDecision["decision"][] = ["suppress", "in_app_only", "digest", "immediate"];
  return order.indexOf(decision) <= order.indexOf(ceiling) ? decision : ceiling;
}

export function decideNotification(params: {
  result: SecureNetworkingTriageResult;
  relevance: PersonalRelevance;
  profile: SellerProfile | null;
  extras?: NotificationExtras;
}): NotificationDecision {
  const config = loadConfig();
  const { result, relevance, profile } = params;
  const extras = params.extras ?? {};
  const prefs = profile?.notification_preferences ?? null;
  const reasons: string[] = [];

  const verdict = result.executive_summary.verdict;
  const signal = result.executive_summary.confidence ?? 0;
  const nba = result.next_best_action;
  const actionable = Boolean(nba) && nba.action_type !== "hold" && nba.action_type !== "suppress";
  const density = prefs?.message_density ?? "concise";

  const base = (decision: NotificationDecision["decision"], reasonCodes: string[], extra?: Partial<NotificationDecision>): NotificationDecision => ({
    decision,
    reason_codes: reasonCodes,
    recipient_profile_id: profile?.profile_id ?? null,
    personal_relevance_score: relevance.score,
    novelty_score: Math.round((extras.novelty ?? 1) * 100),
    duplicate_of: extras.duplicateOf ?? null,
    cooldown_until: extras.cooldownUntil ?? null,
    message_density: density,
    ...extra
  });

  // Hard suppressions.
  if (verdict === "NOISE" && (config.never_notify_noise || prefs?.never_alert_on_noise !== false)) return base("suppress", ["noise_suppressed"]);
  if (!actionable) return base("suppress", ["no_valid_action"]);

  // Duplicate without material change.
  if (extras.duplicateOf && config.delta_only_repeat && !extras.materialChange) {
    return base("suppress", ["duplicate_no_change"]);
  }

  // Compute the "natural" decision from relevance + signal + actionability.
  let decision: NotificationDecision["decision"];
  const minRelevance = prefs?.min_personal_relevance ?? 0;
  const minSignal = prefs?.min_signal_strength ?? config.thresholds.min_signal_strength;
  if (signal < minSignal) {
    decision = "in_app_only";
    reasons.push("below_min_signal");
  } else if (relevance.score >= config.thresholds.immediate_personal_relevance && relevance.score >= minRelevance) {
    decision = "immediate";
    reasons.push(extras.duplicateOf ? "material_change_delta" : "high_relevance_immediate");
  } else if (relevance.score >= config.thresholds.digest_personal_relevance) {
    decision = "digest";
    reasons.push("low_personal_relevance_digest");
  } else {
    decision = "in_app_only";
    reasons.push("low_personal_relevance_in_app");
  }

  // Verdict gating for immediate.
  if (decision === "immediate") {
    if (verdict === "REVIEW" && (config.verdict_policy.REVIEW?.allow_immediate === false || prefs?.alert_on_review === false)) {
      decision = "digest";
      reasons.push("review_default");
    }
    if (verdict === "HIGH_INTENT" && prefs?.alert_on_high_intent === false) {
      decision = "digest";
    }
    if (extras.cooldownUntil) {
      decision = "digest";
      reasons.push("cooldown_active");
    }
    if (typeof extras.immediateSentToday === "number" && extras.immediateSentToday >= config.limits.max_immediate_per_day) {
      decision = "digest";
      reasons.push("daily_limit_reached");
    }
    if (extras.inQuietHours || (prefs?.quiet_hours.enabled && extras.inQuietHours)) {
      decision = "digest";
      reasons.push("quiet_hours");
    }
  }

  // Respect the seller's global mode ceiling.
  if (prefs?.mode === "in_app_only") decision = cap(decision, "in_app_only");
  if (prefs?.mode === "daily_digest") decision = cap(decision, "digest");

  return base(decision, reasons);
}
