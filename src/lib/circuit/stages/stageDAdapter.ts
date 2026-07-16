import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import { buildDeterministicBrief } from "@/lib/webex/opportunityBrief";
import type { StageCOutput } from "@/lib/circuit/stages/stageC";
import type { StageDInput, StageDOutput, StageDBrief } from "@/lib/circuit/stages/stageD";

/**
 * Builds a Stage D input (+ deterministic-fallback messages) from a run
 * result and the Stage C output. The real, evidence-derived message material
 * comes from the deterministic opportunity brief (@/lib/webex/opportunityBrief)
 * — the same source the deterministic message builder uses — so Circuit
 * rewrites REAL content into the section skeleton the delivery quality gate
 * requires (and can never be pushed to fabricate signals/actions). The
 * deterministic assembly below is the fallback; only narrative-eligible
 * public-signal URLs are allowed in messages.
 */

const DEFAULT_WEBEX_BYTE_BUDGET = 6400;

function bullets(items: string[], limit: number): string {
  return items.slice(0, limit).map((i) => `- ${i}`).join("\n");
}

function section(heading: string, body: string | null): string | null {
  if (!body || body.trim().length === 0) return null;
  return `${heading}\n${body}`;
}

export function buildStageDInput(result: SecureNetworkingTriageResult, stageC: StageCOutput, opts?: { byteBudget?: number }): StageDInput {
  const account = getCanonicalAccount(result);
  const accountLabel = account.name ?? "the account";
  const allowedUrls = (result.serpapi_signals?.signals ?? []).filter((s) => s.narrative_eligible).map((s) => s.source_url);

  const detBrief = buildDeterministicBrief(result);
  // Prefer Circuit's Stage C thesis/handoff narrative when present; otherwise
  // the deterministic thesis. do-not-reask prefers Stage C, then the sales
  // handoff packet.
  const thesis = stageC.opportunity_thesis?.trim() ? stageC.opportunity_thesis : detBrief.opportunity_thesis;
  const doNotReask = stageC.do_not_reask.length > 0 ? stageC.do_not_reask : (result.specialist_handoffs?.sales?.questions_not_to_reask ?? []);
  const technicalEnvironment =
    stageC.technical_handoff.key_points.length > 0 ? stageC.technical_handoff.key_points : detBrief.stakeholder_lines;

  const brief: StageDBrief = {
    opportunity_thesis: thesis,
    why_now: detBrief.why_now,
    meddpicc_lines: detBrief.meddpicc_lines,
    stakeholder_lines: detBrief.stakeholder_lines,
    sales_actions: detBrief.sales_actions,
    technical_actions: detBrief.technical_actions,
    top_risks: detBrief.top_risks,
    do_not_reask: doNotReask
  };

  // Deterministic fallback: the same section skeleton Circuit is asked to
  // produce, filled with real brief content. When the brief supports it (rich
  // deals), this passes the delivery quality gate; when a lane is too thin, the
  // gate rejects it at delivery and the trusted message builder is used instead.
  const salesWebex = [
    `**Account:** ${accountLabel}`,
    "",
    section("**Opportunity thesis**", thesis),
    "",
    brief.why_now.length > 0 ? section("**Why now**", bullets(brief.why_now, 5)) : null,
    "",
    section("**MEDDPICC**", bullets(brief.meddpicc_lines, 6)),
    "",
    section("**Recommended next actions**", bullets(brief.sales_actions, 5)),
    "",
    doNotReask.length > 0 ? section("**Customer already told us — do not re-ask**", bullets(doNotReask, 4)) : null
  ]
    .filter((s) => s !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const technicalWebex = [
    `**Account:** ${accountLabel}`,
    "",
    section("**Customer problem & environment**", technicalEnvironment.length > 0 ? bullets(technicalEnvironment, 5) : null),
    "",
    section("**Recommended next actions**", bullets(brief.technical_actions, 5)),
    "",
    brief.top_risks.length > 0 ? section("**Top risks**", bullets(brief.top_risks, 3)) : null
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
