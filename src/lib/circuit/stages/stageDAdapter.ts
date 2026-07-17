import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import { buildDeterministicBrief } from "@/lib/webex/opportunityBrief";
import { buildIntelligencePacket } from "@/lib/intelligence/intelligencePacket";
import { generateRoleMessage, renderWebexMessage } from "@/lib/intelligence/roleMessage";
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

  // The Stage D brief is built FROM the one canonical RoleMessage (generated from
  // the IntelligencePacket), so Circuit refines the SAME content the deterministic
  // path renders: the synthesized "why this matters", the honest "why now", the
  // canonical Next Best Action as the ONE action, and the clean expected outcome.
  // A generic MEDDPICC-gap action or a fabricated urgency quote can no longer
  // enter the message, because they are not in the material Circuit is given.
  const packet = buildIntelligencePacket(result);
  const salesRM = generateRoleMessage(packet, "sales");
  const technicalRM = generateRoleMessage(packet, "technical");

  const sales_lane: StageDLane = {
    role_label: SALES_ROLE_LABEL,
    why_selected: salesRM.why_this_matters,
    collaborator: `${TECHNICAL_ROLE_LABEL} (paired technical lane)`,
    actions: [salesRM.action],
    remaining_questions: stageC.commercial_handoff.remaining_questions,
    expected_output: salesRM.expected_outcome
  };

  const technical_lane: StageDLane = {
    role_label: TECHNICAL_ROLE_LABEL,
    why_selected: technicalRM.why_this_matters,
    collaborator: `${SALES_ROLE_LABEL} (paired commercial lane)`,
    actions: [technicalRM.action],
    remaining_questions: stageC.technical_handoff.remaining_questions,
    expected_output: technicalRM.expected_outcome
  };

  const di = result.deal_intelligence;
  const championPlay = di?.power_map.find((p) => p.role_id === "business_champion");
  const championLine = championPlay ? `${championPlay.name} — ${championPlay.play}` : null;
  const brief: StageDBrief = {
    opportunity_thesis: thesis,
    // Honest "why now" from the RoleMessage (a real timing driver, else the
    // customer-requested step) — never a raw impact/retention quote.
    why_now: [salesRM.why_now],
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
    timing_driver: salesRM.why_now && /\bnot procurement\b|\bprocurement\b/i.test(salesRM.why_now) && di?.timing ? { label: salesRM.why_now, is_procurement: di.timing.is_procurement } : null
  };

  // Deterministic fallback renders from the SAME canonical RoleMessage that the
  // brief above was built from — so Circuit's fallback is byte-for-byte the one
  // canonical content decision, never a parallel interpretation.
  const salesWebex = renderWebexMessage(salesRM);
  const technicalWebex = renderWebexMessage(technicalRM);

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
