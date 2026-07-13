import { readFileSync } from "node:fs";
import path from "node:path";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { LaneRoutingDecision, LifecycleClassification, LifecycleStage, WebexLane } from "@/lib/webex/types";

/**
 * Data-driven role routing for the Peachtree Select pilot. Loads
 * signal-agent-poc/config/peachtree_pilot_routing.json at runtime; no
 * recipient email, role pattern, signal type, or lane is hard-coded here
 * — this module only implements the generic *mechanism* the JSON drives.
 */

export type RoutingConfig = {
  metadata: { team: string; version: string; purpose: string };
  recipients: Record<WebexLane, { name: string; email_env: string; assignment_label: string }>;
  lanes: Record<WebexLane, { role_patterns: string[]; signal_types: string[]; action_types: string[] }>;
  signal_routes: Record<string, WebexLane[]>;
  delivery_policy: {
    HIGH_INTENT: { automatic: boolean };
    REVIEW: { automatic: boolean; default_lanes?: WebexLane[]; message_prefix?: string };
    NOISE: { automatic: boolean };
    one_message_per_lane_per_transcript: boolean;
    dedupe_key: string;
  };
};

const ROUTING_CONFIG_RELATIVE_PATH = "signal-agent-poc/config/peachtree_pilot_routing.json";

let cachedConfig: RoutingConfig | null = null;

export function getRoutingConfigPath(): string {
  return path.join(process.cwd(), ROUTING_CONFIG_RELATIVE_PATH);
}

export function loadRoutingConfig(): RoutingConfig {
  if (cachedConfig) return cachedConfig;
  const text = readFileSync(getRoutingConfigPath(), "utf8");
  cachedConfig = JSON.parse(text) as RoutingConfig;
  return cachedConfig;
}

export function clearRoutingConfigCache() {
  cachedConfig = null;
}

export function getRecipientEmail(lane: WebexLane, config: RoutingConfig): string | null {
  const envVarName = config.recipients[lane].email_env;
  const value = (process.env as Record<string, string | undefined>)[envVarName];
  return value?.trim() || null;
}

// ─── Signal-type detection ──────────────────────────────────────────────────
// Generic evidence-text matching — every phrase list below detects a
// *linguistic* signal, not a specific product; the JSON config decides
// which lane(s) each detected signal type routes to.

function evidenceHaystack(result: SecureNetworkingTriageResult): string {
  return [
    result.executive_summary.business_problem,
    result.executive_summary.business_impact,
    result.executive_summary.urgency,
    ...result.matches.flatMap((match) => match.matched_keywords),
    ...result.matches.flatMap((match) => match.matched_text),
    ...result.matches.flatMap((match) => match.intent_evidence.map((item) => item.text)),
    ...result.matches.flatMap((match) => match.recommended_solutions)
  ]
    .join(" \n ")
    .toLowerCase();
}

const SIGNAL_PATTERNS: Record<string, string[]> = {
  network_refresh: ["refresh", "end of life", "end-of-life", "eol", "end of sale", "aging", "hardware refresh", "lifecycle refresh"],
  splunk_opportunity: ["splunk"],
  software_buying: [
    "licensing",
    "subscription renewal",
    "enterprise agreement",
    "true-up",
    "true forward",
    "software buying",
    "consumption model",
    "smart account",
    "buying program"
  ],
  security_initiative: ["security", "soc", "xdr", "firewall", "zero trust", "sase", "threat", "identity"],
  ai_initiative: ["ai factory", "gpu", "ai infrastructure", "ai pod", "artificial intelligence"],
  expansion: ["expand", "expansion", "additional sites", "additional site", "more users", "new use case", "adjacent", "broader rollout"],
  competitor_displacement: ["competitor", "displace", "rip and replace", "incumbent", "replace our current", "switching from"],
  technical_validation: ["proof of concept", "poc", "pilot", "technical validation", "validate the architecture", "evaluate the solution"],
  architecture_workshop: ["architecture workshop", "discovery workshop", "technical workshop", "design workshop"]
};

export function detectSignalTypes(result: SecureNetworkingTriageResult): string[] {
  const haystack = evidenceHaystack(result);
  const detected = new Set<string>();

  for (const [signalType, patterns] of Object.entries(SIGNAL_PATTERNS)) {
    if (patterns.some((pattern) => haystack.includes(pattern))) detected.add(signalType);
  }

  if (result.commercial_signals.budget) detected.add("budget");
  if (result.commercial_signals.timeline) detected.add("timeline");
  if (result.commercial_signals.renewal_events.length > 0) detected.add("renewal");

  return Array.from(detected);
}

// ─── Lifecycle (LAND/ADOPT/EXPAND/RENEW) classification ───────────────────

const LIFECYCLE_PATTERNS: Record<LifecycleStage, string[]> = {
  LAND: ["new opportunity", "competitor", "displace", "first solution", "initial discovery", "evaluating", "evaluation", "rfp", "greenfield"],
  ADOPT: ["implementation", "onboarding", "low usage", "deployment", "enablement", "rollout blocked", "adoption barrier", "not fully deployed"],
  EXPAND: ["additional sites", "additional site", "new use case", "adjacent", "more users", "broader architecture", "expand", "expansion", "business unit"],
  RENEW: ["renewal", "renew", "contract expiration", "retention", "subscription continuation", "license renewal", "up for renewal"]
};

export function classifyLifecycle(result: SecureNetworkingTriageResult): LifecycleClassification {
  const haystack = evidenceHaystack(result);

  if (result.commercial_signals.renewal_events.length > 0) {
    return {
      lifecycle_stage: "RENEW",
      lifecycle_reason: `Renewal event(s) explicitly stated in transcript: ${result.commercial_signals.renewal_events[0]}`
    };
  }

  const scores: Record<LifecycleStage, { count: number; matched: string[] }> = {
    LAND: { count: 0, matched: [] },
    ADOPT: { count: 0, matched: [] },
    EXPAND: { count: 0, matched: [] },
    RENEW: { count: 0, matched: [] }
  };

  for (const [stage, patterns] of Object.entries(LIFECYCLE_PATTERNS) as Array<[LifecycleStage, string[]]>) {
    for (const pattern of patterns) {
      if (haystack.includes(pattern)) {
        scores[stage].count += 1;
        scores[stage].matched.push(pattern);
      }
    }
  }

  const ranked = (Object.entries(scores) as Array<[LifecycleStage, { count: number; matched: string[] }]>).sort(
    (a, b) => b[1].count - a[1].count
  );
  const [topStage, topResult] = ranked[0];

  if (topResult.count === 0) {
    return {
      lifecycle_stage: "LAND",
      lifecycle_reason: "No explicit adoption, expansion, or renewal language detected; treated as a new/initial-discovery opportunity by default."
    };
  }

  return {
    lifecycle_stage: topStage,
    lifecycle_reason: `Matched ${topStage.toLowerCase()}-stage language: ${topResult.matched.slice(0, 3).join(", ")}.`
  };
}

// ─── Lane routing decisions ─────────────────────────────────────────────────

const SIGNAL_TO_ACTION: Record<string, string> = {
  network_refresh: "Scope network refresh timing and commercial motion",
  splunk_opportunity: "Progress Splunk commercial motion",
  software_buying: "Structure software buying program / licensing motion",
  security_initiative: "Advance security initiative commercially",
  ai_initiative: "Fund and scope AI infrastructure initiative",
  expansion: "Pursue expansion opportunity",
  competitor_displacement: "Develop competitive displacement strategy",
  budget: "Confirm and track budget/funding status",
  timeline: "Align on commercial timeline",
  renewal: "Drive renewal motion",
  technical_validation: "Run technical validation / proof of concept",
  architecture_workshop: "Schedule architecture/discovery workshop"
};

const TECHNICAL_REQUEST_SIGNALS = new Set(["architecture_workshop", "technical_validation"]);

function determineLanesForSignal(signalType: string, config: RoutingConfig): WebexLane[] {
  return config.signal_routes[signalType] ?? [];
}

export function buildLaneRouting(
  result: SecureNetworkingTriageResult,
  config: RoutingConfig,
  lifecycle: LifecycleClassification
): LaneRoutingDecision[] {
  const verdict = result.executive_summary.verdict;
  if (verdict === "NOISE" || !config.delivery_policy.NOISE) {
    if (verdict === "NOISE") return [];
  }

  const detectedSignals = detectSignalTypes(result);
  const laneSignals: Record<WebexLane, Set<string>> = { sales: new Set(), technical: new Set() };

  for (const signalType of detectedSignals) {
    for (const lane of determineLanesForSignal(signalType, config)) {
      laneSignals[lane].add(signalType);
    }
  }

  // "Software buying without a technical request routes to sales.
  //  Software buying with architecture/POC/demo/migration/integration
  //  requirements routes to both."
  if (detectedSignals.includes("software_buying") && detectedSignals.some((signal) => TECHNICAL_REQUEST_SIGNALS.has(signal))) {
    laneSignals.technical.add("software_buying");
  }

  // REVIEW defaults to the taxonomy's configured default lane(s) (technical
  // review) so a genuinely uncertain signal still reaches a human reviewer
  // instead of vanishing silently.
  if (verdict === "REVIEW" && config.delivery_policy.REVIEW.automatic) {
    for (const lane of config.delivery_policy.REVIEW.default_lanes ?? []) {
      laneSignals[lane].add("review_default");
    }
  }

  const decisions: LaneRoutingDecision[] = [];
  for (const lane of ["sales", "technical"] as WebexLane[]) {
    const signals = Array.from(laneSignals[lane]);
    if (signals.length === 0) continue;

    const recipient = config.recipients[lane];
    const recipientEmail = getRecipientEmail(lane, config);
    const actions = Array.from(new Set(signals.map((signal) => SIGNAL_TO_ACTION[signal] ?? `Review ${signal.replace(/_/g, " ")}`)));
    const reason = signals.map((signal) => (signal === "review_default" ? "Confidence in the REVIEW band defaults to technical review" : `Detected signal: ${signal.replace(/_/g, " ")}`));

    decisions.push({
      lane,
      recipient_name: recipient.name,
      recipient_email: recipientEmail,
      assigned_role: recipient.assignment_label,
      reason,
      actions,
      signal_types: signals.filter((signal) => signal !== "review_default"),
      lifecycle_stage: lifecycle.lifecycle_stage,
      automatic_delivery: verdict === "HIGH_INTENT" ? config.delivery_policy.HIGH_INTENT.automatic : config.delivery_policy.REVIEW.automatic
    });
  }

  return decisions;
}
