import type { EntryEvaluation } from "@/lib/signal-agent/types";
import type { GenericSignal } from "@/lib/qualification/genericSignalExtraction";

/**
 * Generic taxonomy-dominance scoring (Section 4). Never references a
 * specific product, category id, or transcript — operates purely over
 * each entry's own already-computed evaluation (keyword/semantic/
 * corroboration/intent scores, matched evidence, negative cues) plus
 * the transcript-wide generic signal set from genericSignalExtraction.
 *
 * A single incidental keyword hit is explicitly discounted so it can
 * never, on its own, outrank an entry genuinely supported by pain,
 * desired-state, evaluation-scope, funding/renewal alignment, and
 * next-step evidence.
 */

export type CategoryScoreDiagnostic = {
  entry_id: string;
  keyword_score: number;
  semantic_score: number;
  intent_score: number;
  corroboration_score: number;
  penalties: number;
  dominance_score: number;
  final_score: number;
};

const MIN_SUPPORTING_EVIDENCE_FOR_FULL_WEIGHT = 2;
const INCIDENTAL_MENTION_DISCOUNT = 0.15;
const SIGNAL_ALIGNMENT_BONUS_PER_CATEGORY = 0.02;
const MAX_SIGNAL_ALIGNMENT_BONUS = 0.1;

/** Counts how many distinct generic-signal categories are textually
 * grounded in sentences that ALSO matched this entry's own keywords/
 * semantic cues — i.e. the funding/renewal/proof-of-value/next-step
 * evidence is actually about this pain category, not merely present
 * somewhere else in the transcript. */
function countAlignedSignalCategories(evaluation: EntryEvaluation, genericSignals: GenericSignal[]): number {
  const matchedTextSet = new Set(evaluation.matchedText);
  const alignedCategories = new Set<string>();
  for (const signal of genericSignals) {
    if (matchedTextSet.has(signal.text)) alignedCategories.add(signal.category);
  }
  return alignedCategories.size;
}

export function computeDominanceScore(evaluation: EntryEvaluation, genericSignals: GenericSignal[]): number {
  let score = evaluation.confidence;

  // A single incidental keyword hit — with no corroborating semantic
  // match or transcript evidence — must never be enough on its own to
  // dominate the result.
  const supportingEvidenceCount = evaluation.matchedKeywords.length + evaluation.matchedText.length + evaluation.intentEvidence.length;
  if (supportingEvidenceCount < MIN_SUPPORTING_EVIDENCE_FOR_FULL_WEIGHT) {
    score -= INCIDENTAL_MENTION_DISCOUNT;
  }

  // Reward genuine alignment between generic commercial/technical
  // signals and this specific entry's own matched evidence.
  const alignedCategoryCount = countAlignedSignalCategories(evaluation, genericSignals);
  score += Math.min(alignedCategoryCount * SIGNAL_ALIGNMENT_BONUS_PER_CATEGORY, MAX_SIGNAL_ALIGNMENT_BONUS);

  // Explicit contradictory/negative evidence already reduces
  // `penalty`, which is reflected in `confidence` — apply it again
  // lightly here so a heavily-contradicted entry never dominates
  // purely on residual keyword/semantic overlap.
  if (evaluation.negativeCueResults.some((cue) => cue.polarity === "negative")) {
    score -= 0.05;
  }

  return Math.max(0, Math.min(1, score));
}

export function buildCategoryScores(evaluations: EntryEvaluation[], genericSignals: GenericSignal[]): CategoryScoreDiagnostic[] {
  return evaluations.map((evaluation) => ({
    entry_id: evaluation.entry.id,
    keyword_score: Math.round(evaluation.keywordScore * 1000) / 1000,
    semantic_score: Math.round(evaluation.semanticScore * 1000) / 1000,
    intent_score: Math.round(evaluation.specificityIntentScore * 1000) / 1000,
    corroboration_score: Math.round((evaluation.transcriptOnlyMode ? evaluation.transcriptCorroborationScore : evaluation.corroborationScore) * 1000) / 1000,
    penalties: Math.round(evaluation.penalty * 1000) / 1000,
    dominance_score: Math.round(computeDominanceScore(evaluation, genericSignals) * 1000) / 1000,
    final_score: Math.round(evaluation.confidence * 1000) / 1000
  }));
}
