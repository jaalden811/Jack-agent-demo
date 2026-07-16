import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import { buildDeterministicBrief } from "@/lib/webex/opportunityBrief";
import type { StageCOutput } from "@/lib/circuit/stages/stageC";
import type { StageDInput, StageDOutput, StageDBrief, StageDLane } from "@/lib/circuit/stages/stageD";

/**
 * Builds a Stage D input (+ deterministic-fallback messages) from a run result
 * and the Stage C output. The real, evidence-derived message material comes from
 * the deterministic opportunity brief (@/lib/webex/opportunityBrief) and the
 * Stage C handoffs — Circuit rewrites REAL content into the required per-recipient
 * skeleton and can never be pushed to fabricate. The deterministic assembly below
 * is the fallback; only narrative-eligible public-signal URLs are allowed.
 */

const DEFAULT_WEBEX_BYTE_BUDGET = 6400;
const SALES_ROLE_LABEL = "Commercial / Sales owner";
const TECHNICAL_ROLE_LABEL = "Technical / Specialist owner";

function bullets(items: string[], limit: number): string {
  return items.slice(0, limit).map((i) => `- ${i}`).join("\n");
}

function section(heading: string, body: string | null): string | null {
  if (!body || body.trim().length === 0) return null;
  return `${heading}\n${body}`;
}

function line(heading: string, value: string | null): string | null {
  if (!value || value.trim().length === 0) return null;
  return `${heading} — ${value}`;
}

function resolveTiming(result: SecureNetworkingTriageResult, stageC: StageCOutput): string {
  const nba = stageC.next_best_action as { timing_basis?: string } | undefined;
  if (nba?.timing_basis && nba.timing_basis.trim()) return nba.timing_basis;
  const c = result.commercial_signals;
  if (c?.timeline) return c.timeline;
  if (c?.renewal_events?.length) return `Renewal window: ${c.renewal_events[0]}`;
  return "Timing not explicitly stated — confirm the customer's decision/renewal timeline.";
}

export function buildStageDInput(result: SecureNetworkingTriageResult, stageC: StageCOutput, opts?: { byteBudget?: number }): StageDInput {
  const account = getCanonicalAccount(result);
  const accountLabel = account.name ?? "the account";
  const allowedUrls = (result.serpapi_signals?.signals ?? []).filter((s) => s.narrative_eligible).map((s) => s.source_url);

  const detBrief = buildDeterministicBrief(result);
  const thesis = stageC.opportunity_thesis?.trim() ? stageC.opportunity_thesis : detBrief.opportunity_thesis;
  const doNotReask = stageC.do_not_reask.length > 0 ? stageC.do_not_reask : (result.specialist_handoffs?.sales?.questions_not_to_reask ?? []);
  const timing = resolveTiming(result, stageC);
  const successCriteria = (stageC.next_best_action?.success_criteria ?? []).filter(Boolean);
  const successText = successCriteria.length > 0 ? successCriteria.join("; ") : null;
  const technicalEnvironment = stageC.technical_handoff.key_points.length > 0 ? stageC.technical_handoff.key_points : detBrief.stakeholder_lines;

  const sales_lane: StageDLane = {
    role_label: SALES_ROLE_LABEL,
    why_selected: `You own the commercial lane for ${accountLabel}: qualification, buying-committee engagement, and the commercial next step.`,
    collaborator: `${TECHNICAL_ROLE_LABEL} (paired technical lane)`,
    actions: detBrief.sales_actions,
    remaining_questions: stageC.commercial_handoff.remaining_questions,
    expected_output: successText ? `A commercial outcome: ${successText}.` : "A qualified commercial next step (confirmed budget owner + booked follow-up)."
  };

  const technical_lane: StageDLane = {
    role_label: TECHNICAL_ROLE_LABEL,
    why_selected: `You own the technical lane for ${accountLabel}: architecture fit, current environment, and proof-of-value.`,
    collaborator: `${SALES_ROLE_LABEL} (paired commercial lane)`,
    actions: detBrief.technical_actions,
    remaining_questions: stageC.technical_handoff.remaining_questions,
    expected_output: successText ? `A technical outcome: ${successText}.` : "A scoped technical validation (architecture workshop / POV with explicit success criteria)."
  };

  const brief: StageDBrief = {
    opportunity_thesis: thesis,
    why_now: detBrief.why_now,
    meddpicc_lines: detBrief.meddpicc_lines,
    stakeholder_lines: detBrief.stakeholder_lines,
    top_risks: detBrief.top_risks,
    do_not_reask: doNotReask,
    timing,
    sales_lane,
    technical_lane
  };

  // Deterministic fallback: the same recipient-specific skeleton Circuit is
  // asked to produce, filled with real brief content. When a lane is too thin
  // the delivery quality gate rejects it and the trusted message builder is used.
  const salesWebex = [
    `**Account:** ${accountLabel}`,
    "",
    line("**Why you're receiving this**", `${sales_lane.role_label}: ${sales_lane.why_selected}`),
    "",
    section("**Opportunity thesis** (what happened)", thesis),
    "",
    brief.why_now.length > 0 ? section("**Why now**", bullets(brief.why_now, 5)) : null,
    "",
    section("**MEDDPICC**", bullets(brief.meddpicc_lines, 6)),
    "",
    doNotReask.length > 0 ? section("**Customer already told us — do not re-ask**", bullets(doNotReask, 5)) : null,
    "",
    sales_lane.remaining_questions.length > 0 ? section("**Still unknown**", bullets(sales_lane.remaining_questions, 4)) : null,
    "",
    section("**Recommended next actions (you own)**", bullets(sales_lane.actions, 5)),
    "",
    line("**Expected output**", sales_lane.expected_output),
    line("**Collaborator**", sales_lane.collaborator),
    line("**Timing**", timing)
  ]
    .filter((s) => s !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const technicalWebex = [
    `**Account:** ${accountLabel}`,
    "",
    line("**Why you're receiving this**", `${technical_lane.role_label}: ${technical_lane.why_selected}`),
    "",
    section("**Customer problem & environment**", technicalEnvironment.length > 0 ? bullets(technicalEnvironment, 5) : null),
    "",
    doNotReask.length > 0 ? section("**Customer already told us — do not re-ask**", bullets(doNotReask, 5)) : null,
    "",
    technical_lane.remaining_questions.length > 0 ? section("**Still unknown**", bullets(technical_lane.remaining_questions, 4)) : null,
    "",
    section("**Recommended next actions (you own)**", bullets(technical_lane.actions, 5)),
    "",
    line("**Expected output**", technical_lane.expected_output),
    line("**Collaborator**", technical_lane.collaborator),
    line("**Timing**", timing)
  ]
    .filter((s) => s !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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
    deterministic
  };
}
