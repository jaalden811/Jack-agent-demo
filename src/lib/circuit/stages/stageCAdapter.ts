import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { StageCInput, StageCOutput } from "@/lib/circuit/stages/stageC";
import type { PersonalizationContext } from "@/lib/personalization/types";

/**
 * Builds a Stage C input (+ deterministic-fallback output) from an
 * already-computed run. Circuit synthesizes the narrative; the
 * deterministic MEDDPICC / Next Best Action / handoffs / do-not-reask
 * (already computed by the pipeline) are the fallback. The numeric scores
 * and decision are passed read-only — Circuit never changes them.
 */

export function buildStageCInput(result: SecureNetworkingTriageResult, stageASummary?: unknown, stageBSummary?: unknown, personalizationContext?: PersonalizationContext | null): StageCInput {
  const buckets = result.generic_diagnostics?.signals;
  const evidence = buckets
    ? [...buckets.commercial, ...buckets.technical, ...buckets.ownership, ...buckets.next_steps].map((s) => ({ evidence_id: s.evidence_id, text: s.text }))
    : [];
  // Include MEDDPICC evidence ids (a different namespace) so Circuit can
  // validly cite them; deduped against the generic-signal evidence.
  const seenEvidence = new Set(evidence.map((e) => e.evidence_id));
  if (result.meddpicc) {
    for (const field of Object.values(result.meddpicc)) {
      for (const id of field.evidence_ids) {
        if (!seenEvidence.has(id)) {
          seenEvidence.add(id);
          evidence.push({ evidence_id: id, text: field.summary });
        }
      }
    }
  }

  const meddpiccOut: StageCOutput["meddpicc"] = {};
  if (result.meddpicc) {
    for (const [key, field] of Object.entries(result.meddpicc)) {
      meddpiccOut[key] = { status: field.status, summary: field.summary, evidence_ids: field.evidence_ids, next_question: field.next_question };
    }
  }

  const nba = result.next_best_action;
  const salesHandoff = result.specialist_handoffs?.sales;
  const techHandoff = result.specialist_handoffs?.technical;

  const deterministic: StageCOutput = {
    facts: (result.question_index?.answered ?? []).map((a) => ({ statement: `${a.topic}: ${a.answer}`, evidence_ids: a.evidence_ids })),
    inferences: [],
    missing_information: (result.question_index?.open ?? []).map((q) => q.question),
    meddpicc: meddpiccOut,
    opportunity_thesis: salesHandoff?.ninety_second_brief ?? result.executive_summary.primary_opportunity ?? "",
    deal_maturity_interpretation: result.opportunity_scoring?.deal_maturity ?? "",
    product_role_narrative: (result.solution_architecture ?? []).map((r) => `${r.product}: ${r.role}`),
    risks: nba?.risks ?? [],
    next_best_action: {
      action_type: nba?.action_type ?? "hold",
      title: nba?.title ?? "",
      summary: nba?.summary ?? "No action.",
      owner_role: nba?.owner_lane ?? "shared",
      timing_basis: nba?.due_basis ?? "none",
      success_criteria: nba?.success_criteria ?? [],
      evidence_ids: (nba?.evidence_ids ?? []).filter((id) => evidence.some((e) => e.evidence_id === id))
    },
    commercial_handoff: {
      summary: salesHandoff?.ninety_second_brief ?? "",
      key_points: salesHandoff?.business_context ?? [],
      remaining_questions: (salesHandoff?.remaining_questions ?? []).map((q) => q.question),
      evidence_ids: []
    },
    technical_handoff: {
      summary: techHandoff?.ninety_second_brief ?? "",
      key_points: techHandoff?.current_environment ?? [],
      remaining_questions: (techHandoff?.remaining_questions ?? []).map((q) => q.question),
      evidence_ids: []
    },
    do_not_reask: salesHandoff?.questions_not_to_reask ?? [],
    remaining_questions: (result.question_index?.open ?? []).map((q) => q.question)
  };

  return {
    run_id: result.run_id,
    account: result.account_resolution?.name ?? null,
    existing_scores: {
      signal_strength: result.opportunity_scoring?.signal_strength?.score ?? 0,
      qualification: result.opportunity_scoring?.qualification_score ?? 0,
      external_fit: result.opportunity_scoring?.external_fit_score ?? null,
      pursuit_decision: result.opportunity_scoring?.decision ?? "HOLD",
      deal_maturity: result.opportunity_scoring?.deal_maturity ?? "PROBLEM_DISCOVERY"
    },
    stage_a_summary: stageASummary ?? null,
    stage_b_summary: stageBSummary ?? null,
    evidence,
    taxonomy_candidates: result.matches.slice(0, 5).map((m) => m.pain_category).filter(Boolean),
    personalization_context: personalizationContext ?? null,
    deterministic
  };
}
