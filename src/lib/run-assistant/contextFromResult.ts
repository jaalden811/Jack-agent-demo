import type { AssistantEvidenceItem, RunAssistantContext } from "@/lib/run-assistant/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Derives the SAFE run-assistant context from a canonical result: the
 * transcript-derived signals + accepted public evidence (with their real
 * evidence IDs), plus a few already-evidenced summary fields. Never includes
 * private compensation values.
 */

export function buildRunAssistantContext(result: SecureNetworkingTriageResult): RunAssistantContext {
  const items: AssistantEvidenceItem[] = [];
  const seen = new Set<string>();
  const add = (evidence_id: string | undefined, source_type: AssistantEvidenceItem["source_type"], text: string) => {
    const id = (evidence_id ?? "").trim();
    if (!id || !text.trim() || seen.has(id)) return;
    seen.add(id);
    items.push({ evidence_id: id, source_type, text: text.trim() });
  };

  const signals = result.generic_diagnostics?.signals;
  if (signals) {
    for (const bucket of [signals.commercial, signals.technical, signals.ownership, signals.next_steps]) {
      for (const s of bucket ?? []) add(s.evidence_id, "transcript", s.text);
    }
  }
  for (const a of result.question_index?.answered ?? []) add(a.evidence_ids?.[0] ?? `answered:${a.topic}`, "transcript", `${a.topic}: ${a.answer}`);
  for (const ps of result.serpapi_signals?.signals ?? []) add(ps.signal_id ?? ps.source_url, "public", ps.claim || ps.source_title || "");

  const teaser = result.personalization?.opportunity_teaser ?? null;
  return {
    run_id: result.run_id,
    account: result.account_resolution?.name ?? result.executive_summary.account ?? null,
    transcript_text: result.transcript_meta?.raw_text ?? "",
    evidence_items: items,
    next_action_summary: result.next_best_action?.summary ?? null,
    open_questions: (result.question_index?.open ?? []).map((q) => q.question),
    do_not_reask: result.specialist_handoffs?.sales?.questions_not_to_reask ?? [],
    personal_relevance_summary: teaser ? `${teaser.why_you} (relevance band: ${result.personalization?.personal_relevance.band ?? "n/a"})` : null,
    goal_alignment_summary: teaser?.goal_alignment ?? null
  };
}
