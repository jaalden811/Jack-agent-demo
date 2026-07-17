import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import { buildDeterministicBrief } from "@/lib/webex/opportunityBrief";
import type { StageCOutput } from "@/lib/circuit/stages/stageC";
import type { StageDInput, StageDOutput, StageDBrief, StageDLane } from "@/lib/circuit/stages/stageD";
import type { PersonalizationContext } from "@/lib/personalization/types";

/**
 * Builds a Stage D input (+ deterministic-fallback messages) from a run result
 * and the Stage C output. The real, evidence-derived message material comes from
 * the deterministic opportunity brief (@/lib/webex/opportunityBrief) and the
 * Stage C handoffs — Circuit rewrites REAL content into the required per-recipient
 * skeleton and can never be pushed to fabricate. The deterministic assembly below
 * is the fallback; only narrative-eligible public-signal URLs are allowed.
 */

// Concise, action-first push budget (bytes) — matches the delivery quality
// gate so Circuit Stage D's concise drafts are the delivered message.
const DEFAULT_WEBEX_BYTE_BUDGET = 1400;
const SALES_ROLE_LABEL = "Commercial / Sales owner";
const TECHNICAL_ROLE_LABEL = "Technical / Specialist owner";

function firstMeaningful(candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t && !/^(not stated|none|no quantified|no explicit|not yet|unknown|n\/a)\b/i.test(t)) return t;
  }
  return null;
}

function resolveTiming(result: SecureNetworkingTriageResult, stageC: StageCOutput): string {
  const nba = stageC.next_best_action as { timing_basis?: string } | undefined;
  if (nba?.timing_basis && nba.timing_basis.trim()) return nba.timing_basis;
  const c = result.commercial_signals;
  if (c?.timeline) return c.timeline;
  if (c?.renewal_events?.length) return `Renewal window: ${c.renewal_events[0]}`;
  return "Timing not explicitly stated — confirm the customer's decision/renewal timeline.";
}

export function buildStageDInput(result: SecureNetworkingTriageResult, stageC: StageCOutput, opts?: { byteBudget?: number; personalizationContext?: PersonalizationContext | null }): StageDInput {
  const account = getCanonicalAccount(result);
  const accountLabel = account.name ?? "the account";
  const allowedUrls = (result.serpapi_signals?.signals ?? []).filter((s) => s.narrative_eligible).map((s) => s.source_url);

  const detBrief = buildDeterministicBrief(result);
  const thesis = stageC.opportunity_thesis?.trim() ? stageC.opportunity_thesis : detBrief.opportunity_thesis;
  const doNotReask = stageC.do_not_reask.length > 0 ? stageC.do_not_reask : (result.specialist_handoffs?.sales?.questions_not_to_reask ?? []);
  const timing = resolveTiming(result, stageC);
  const successCriteria = (stageC.next_best_action?.success_criteria ?? []).filter(Boolean);
  const successText = successCriteria.length > 0 ? successCriteria.join("; ") : null;

  // The delivered message's recommended action MUST be the one canonical Next
  // Best Action (what the UI shows as "Recommended next action"), not a generic
  // MEDDPICC-gap action — otherwise the message contradicts the analysis. Both
  // lanes lead with the shared next step; each lane's own gap-actions follow as
  // supporting context. Null only when the run is suppress/hold (no action).
  const nba = result.next_best_action;
  const nbaTitle = nba && nba.action_type !== "suppress" && nba.action_type !== "hold" ? (nba.title?.trim() || null) : null;
  const salesActions = nbaTitle ? [nbaTitle, ...detBrief.sales_actions.filter((a) => a !== nbaTitle)] : detBrief.sales_actions;
  const technicalActions = nbaTitle ? [nbaTitle, ...detBrief.technical_actions.filter((a) => a !== nbaTitle)] : detBrief.technical_actions;

  const sales_lane: StageDLane = {
    role_label: SALES_ROLE_LABEL,
    why_selected: `You own the commercial lane for ${accountLabel}: qualification, buying-committee engagement, and the commercial next step.`,
    collaborator: `${TECHNICAL_ROLE_LABEL} (paired technical lane)`,
    actions: salesActions,
    remaining_questions: stageC.commercial_handoff.remaining_questions,
    expected_output: successText ? `A commercial outcome: ${successText}.` : "A qualified commercial next step (confirmed budget owner + booked follow-up)."
  };

  const technical_lane: StageDLane = {
    role_label: TECHNICAL_ROLE_LABEL,
    why_selected: `You own the technical lane for ${accountLabel}: architecture fit, current environment, and proof-of-value.`,
    collaborator: `${SALES_ROLE_LABEL} (paired commercial lane)`,
    actions: technicalActions,
    remaining_questions: stageC.technical_handoff.remaining_questions,
    expected_output: successText ? `A technical outcome: ${successText}.` : "A scoped technical validation (architecture workshop / POV with explicit success criteria)."
  };

  const di = result.deal_intelligence;
  const championPlay = di?.power_map.find((p) => p.role_id === "business_champion");
  const championLine = championPlay ? `${championPlay.name} — ${championPlay.play}` : null;
  const brief: StageDBrief = {
    opportunity_thesis: thesis,
    why_now: detBrief.why_now,
    meddpicc_lines: detBrief.meddpicc_lines,
    stakeholder_lines: detBrief.stakeholder_lines,
    top_risks: detBrief.top_risks,
    do_not_reask: doNotReask,
    timing,
    sales_lane,
    technical_lane,
    deal_shape: di?.deal_shape.label,
    deal_momentum: (di?.momentum ?? []).map((m) => m.label),
    deal_watch_outs: (di?.risks ?? []).map((r) => r.label),
    value_hypothesis: di?.value_hypothesis ?? null,
    champion: championLine,
    public_context: (di?.public_context ?? []).map((p) => `${p.label} — ${p.evidence}`),
    headline_metric: di?.headline_metric ?? null,
    timing_driver: di?.timing ? { label: di.timing.label, is_procurement: di.timing.is_procurement } : null
  };

  // Deterministic fallback: the same CONCISE, action-first skeleton Circuit is
  // asked to produce, filled with real brief content. When a lane is too thin
  // the delivery quality gate rejects it and the trusted message builder is used.
  // Prefer the honest timing driver (decision boundary vs procurement) over a
  // generic urgency clause for "why now".
  // "Why now" = a concrete timing driver, else the fact that the customer asked
  // for a next step — never a raw business-impact / data-retention quote ("it may
  // be ... a deadline becoming harder to meet", "information needed for ninety
  // days"), which reads as manufactured urgency. Impact belongs in the metric /
  // value hypothesis, not "why now".
  const HEDGED = /\b(?:it may be|may be|might be|could be|would be|may need|becoming harder|harder to meet|perhaps|possibly)\b/i;
  const hasRequestedStep = (di?.momentum ?? []).some((m) => m.id === "requested_next_step");
  const whyNow =
    di?.timing?.label && !HEDGED.test(di.timing.label)
      ? di.timing.label
      : hasRequestedStep
        ? "The customer asked for a concrete next step — engage while the conversation is warm."
        : "Early-stage discovery — engage while the conversation is warm to shape the evaluation.";
  const salesAction = firstMeaningful(sales_lane.actions) ?? "Confirm the next commercial step and owner with the customer.";
  const technicalAction = firstMeaningful(technical_lane.actions) ?? "Scope the technical validation and success criteria with the customer.";

  const dealShapeLine = di?.deal_shape.label ? `**Deal shape:** ${di.deal_shape.label}` : null;
  const metricLine = di?.headline_metric ? `**Metric:** ${di.headline_metric}` : null;
  const accountIntelLine = di?.public_context[0] ? `**Account intel:** ${di.public_context[0].label}` : null;
  // Commercial lane: funding/authority/privacy landmines first.
  const salesRisk = di?.risks.find((r) => ["budget_not_approved", "no_single_eb", "privacy_gate", "cost_governance"].includes(r.id)) ?? di?.risks[0] ?? null;
  const salesWatch = salesRisk?.label ? `**Watch-out:** ${salesRisk.label}` : null;
  const techRisk = di?.risks.find((r) => ["credibility", "sovereignty", "skills_gap", "cost_governance", "privacy_gate"].includes(r.id)) ?? di?.risks[0] ?? null;
  const techWatch = techRisk?.label ? `**Watch-out:** ${techRisk.label}` : null;

  const salesWebex = [
    `**Account:** ${accountLabel}`,
    dealShapeLine,
    `**Why you:** ${sales_lane.role_label} — own the commercial next step for ${accountLabel}.`,
    `**Why now:** ${whyNow}`,
    `**Recommended action:** ${salesAction}`,
    `**Expected outcome:** ${sales_lane.expected_output}`,
    metricLine,
    championLine ? `**Champion:** ${championLine}` : null,
    accountIntelLine,
    salesWatch
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const technicalWebex = [
    `**Account:** ${accountLabel}`,
    dealShapeLine,
    `**Why you:** ${technical_lane.role_label} — scope the workshop and validate the environment for ${accountLabel}.`,
    `**Why now:** ${whyNow}`,
    `**Recommended action:** ${technicalAction}`,
    `**Expected outcome:** ${technical_lane.expected_output}`,
    metricLine,
    techWatch
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const deterministic: StageDOutput = {
    sales_webex: salesWebex,
    technical_webex: technicalWebex,
    sales_email: { subject: `Commercial action — ${accountLabel}`, body: salesWebex },
    technical_email: { subject: `Technical action — ${accountLabel}`, body: technicalWebex }
  };

  return {
    run_id: result.run_id,
    account: account.name,
    channel_byte_budget: opts?.byteBudget ?? DEFAULT_WEBEX_BYTE_BUDGET,
    allowed_urls: allowedUrls,
    brief,
    personalization_context: opts?.personalizationContext ?? null,
    deterministic
  };
}
