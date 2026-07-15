import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import type { StageCOutput } from "@/lib/circuit/stages/stageC";
import type { StageDInput, StageDOutput } from "@/lib/circuit/stages/stageD";

/**
 * Builds a Stage D input (+ deterministic-fallback messages) from a run
 * result and the Stage C output. Circuit drafts the messages; the
 * deterministic assembly below is the fallback (distinct commercial vs
 * technical, canonical account, no invented URLs). Only narrative-eligible
 * public-signal URLs are allowed in messages.
 */

const DEFAULT_WEBEX_BYTE_BUDGET = 6400;

function bullets(items: string[], limit: number): string {
  return items.slice(0, limit).map((i) => `- ${i}`).join("\n");
}

export function buildStageDInput(result: SecureNetworkingTriageResult, stageC: StageCOutput, opts?: { byteBudget?: number }): StageDInput {
  const account = getCanonicalAccount(result);
  const accountLabel = account.name ?? "the account";
  const allowedUrls = (result.serpapi_signals?.signals ?? []).filter((s) => s.narrative_eligible).map((s) => s.source_url);

  const doNotReask = stageC.do_not_reask.length > 0 ? stageC.do_not_reask : (result.specialist_handoffs?.sales?.questions_not_to_reask ?? []);

  const sales = [
    `**Commercial action — ${accountLabel}**`,
    "",
    stageC.commercial_handoff.summary || stageC.opportunity_thesis,
    "",
    `**Recommended action:** ${stageC.next_best_action.summary}`,
    doNotReask.length > 0 ? "\n**Customer already told us — do not re-ask**" : "",
    doNotReask.length > 0 ? bullets(doNotReask, 5) : "",
    stageC.commercial_handoff.remaining_questions.length > 0 ? "\n**Still need to learn**" : "",
    stageC.commercial_handoff.remaining_questions.length > 0 ? bullets(stageC.commercial_handoff.remaining_questions, 3) : ""
  ].filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const technical = [
    `**Technical action — ${accountLabel}**`,
    "",
    stageC.technical_handoff.summary || stageC.opportunity_thesis,
    "",
    `**Recommended action:** ${stageC.next_best_action.summary}`,
    stageC.technical_handoff.key_points.length > 0 ? "\n**Current environment (already known)**" : "",
    stageC.technical_handoff.key_points.length > 0 ? bullets(stageC.technical_handoff.key_points, 5) : "",
    stageC.technical_handoff.remaining_questions.length > 0 ? "\n**Remaining technical decisions**" : "",
    stageC.technical_handoff.remaining_questions.length > 0 ? bullets(stageC.technical_handoff.remaining_questions, 4) : ""
  ].filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const deterministic: StageDOutput = {
    sales_webex: sales,
    technical_webex: technical,
    sales_email: { subject: `Commercial action — ${accountLabel}`, body: sales },
    technical_email: { subject: `Technical action — ${accountLabel}`, body: technical }
  };

  return {
    run_id: result.run_id,
    account: account.name,
    channel_byte_budget: opts?.byteBudget ?? DEFAULT_WEBEX_BYTE_BUDGET,
    allowed_urls: allowedUrls,
    stage_c: {
      opportunity_thesis: stageC.opportunity_thesis,
      next_best_action: { title: stageC.next_best_action.title, summary: stageC.next_best_action.summary, owner_role: stageC.next_best_action.owner_role },
      commercial_handoff: stageC.commercial_handoff,
      technical_handoff: stageC.technical_handoff,
      do_not_reask: doNotReask
    },
    deterministic
  };
}
