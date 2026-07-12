import type {
  AccountRecord,
  CatalogEntry,
  EntryEvaluation,
  IngestedTranscript,
  ParsedMatchingConfig,
  SignalAgentLabel
} from "@/lib/signal-agent/types";
import { scoreKeywords, scoreNegativeCues, scoreSpecificityIntent } from "@/lib/signal-agent/keywordMatch";
import { scoreCorroboration } from "@/lib/signal-agent/accountContext";
import { scoreSemanticMatch, type EmbeddingBundle } from "@/lib/signal-agent/semanticMatch";

/**
 * Generic, entry-agnostic scoring engine.
 *
 * confidence = weights.keyword*keyword + weights.semantic*semantic
 *            + weights.corroboration*corroboration + weights.specificityIntent*specificity
 *            - penalties
 * (transcript-only mode uses the 2-term formula from
 * matching_configuration.transcript_only_mode instead.)
 *
 * Every weight/threshold above comes from `config` (parsed in
 * loadCatalog.ts from the taxonomy JSON) — this function contains no
 * category- or product-specific branches, and would behave identically
 * given a taxonomy JSON with 3 entries or 300.
 */

/** Strong-enough specificity/intent signal to let transcript-only mode
 * report HIGH_INTENT instead of capping at REVIEW, per
 * matching_configuration.transcript_only_mode: "REVIEW unless the
 * transcript contains explicit timing, ownership, impact, and buying
 * intent." A single generic threshold (not a category-specific one). */
const TRANSCRIPT_ONLY_STRONG_SPECIFICITY = 0.7;

export async function evaluateEntry(params: {
  entry: CatalogEntry;
  transcript: IngestedTranscript;
  account: AccountRecord;
  embeddingBundle: EmbeddingBundle;
  genericNegationPhrases: string[];
  config: ParsedMatchingConfig;
}): Promise<EntryEvaluation> {
  const { entry, transcript, account, embeddingBundle, genericNegationPhrases, config } = params;

  const keywordResult = scoreKeywords(entry, transcript, config);
  const negationResult = scoreNegativeCues(entry, transcript, genericNegationPhrases, config);
  const specificityResult = scoreSpecificityIntent(entry, transcript);
  const semanticResult = await scoreSemanticMatch(entry, embeddingBundle, config);
  const transcriptOnlyMode = !account.matched;
  const corroborationResult = transcriptOnlyMode ? { score: 0, signals: [] } : scoreCorroboration(entry, account);

  const rawConfidence = transcriptOnlyMode
    ? config.transcriptOnlyMode.weights.keyword * keywordResult.score +
      config.transcriptOnlyMode.weights.semantic * semanticResult.score -
      negationResult.penalty
    : config.weights.keyword * keywordResult.score +
      config.weights.semantic * semanticResult.score +
      config.weights.corroboration * corroborationResult.score +
      config.weights.specificityIntent * specificityResult.score -
      negationResult.penalty;

  const confidence = Math.max(0, Math.min(1, rawConfidence));

  const keywordOnlyEvidence =
    keywordResult.matchedKeywords.length > 0 &&
    semanticResult.matchedCues.length === 0 &&
    corroborationResult.score === 0 &&
    specificityResult.score === 0;

  const intentLabel = classifyIntent({
    confidence,
    semanticScore: semanticResult.score,
    corroborationScore: corroborationResult.score,
    hasUnresolvedNegation: negationResult.hasUnresolvedNegation,
    keywordOnlyEvidence,
    specificityScore: specificityResult.score,
    transcriptOnlyMode,
    config
  });

  return {
    entry,
    keywordScore: keywordResult.score,
    matchedKeywords: keywordResult.matchedKeywords,
    matchedText: keywordResult.matchedText,
    semanticScore: semanticResult.score,
    matchedSemanticCues: semanticResult.matchedCues,
    semanticMode: embeddingBundle.mode,
    corroborationScore: corroborationResult.score,
    corroboration: corroborationResult.signals,
    specificityIntentScore: specificityResult.score,
    domainNegativeCuesHit: negationResult.domainNegativeCuesHit,
    genericNegationHit: negationResult.genericNegationHit,
    penalty: negationResult.penalty,
    confidence,
    intentLabel,
    transcriptOnlyMode
  };
}

function classifyIntent(params: {
  confidence: number;
  semanticScore: number;
  corroborationScore: number;
  hasUnresolvedNegation: boolean;
  keywordOnlyEvidence: boolean;
  specificityScore: number;
  transcriptOnlyMode: boolean;
  config: ParsedMatchingConfig;
}): "HIGH_INTENT" | "REVIEW" | "NOISE" {
  const { confidence, semanticScore, corroborationScore, hasUnresolvedNegation, keywordOnlyEvidence, specificityScore, transcriptOnlyMode, config } =
    params;

  // Explicit negation and keyword-only evidence always suppress,
  // regardless of the numeric score — "a keyword hit alone must never
  // trigger a notification."
  if (hasUnresolvedNegation) return "NOISE";
  if (keywordOnlyEvidence) return "NOISE";

  const meetsHighIntentGate =
    confidence >= config.gates.highIntent.confidence &&
    (semanticScore >= config.gates.highIntent.semantic || corroborationScore >= config.gates.highIntent.corroboration);

  let label: "HIGH_INTENT" | "REVIEW" | "NOISE";
  if (meetsHighIntentGate) {
    label = "HIGH_INTENT";
  } else if (confidence >= config.gates.review.min) {
    label = "REVIEW";
  } else {
    label = "NOISE";
  }

  if (transcriptOnlyMode && label === "HIGH_INTENT" && specificityScore < TRANSCRIPT_ONLY_STRONG_SPECIFICITY) {
    return config.transcriptOnlyMode.maxLabelWithoutSignals === "NOISE" ? "NOISE" : "REVIEW";
  }

  return label;
}

/** Picks the primary label plus up to (maxLabels - 1) additional labels
 * from other entries whose confidence is within `scoreWindow` of the
 * top score and whose intent is not NOISE — implementing
 * multi_label_policy generically. */
export function selectMultiLabelEvaluations(evaluations: EntryEvaluation[], config: ParsedMatchingConfig): EntryEvaluation[] {
  const sorted = [...evaluations].sort((a, b) => b.confidence - a.confidence);
  if (sorted.length === 0) return [];

  const primary = sorted[0];
  if (!config.multiLabel.enabled) return [primary];

  const topConfidence = primary.confidence;
  const additional = sorted
    .slice(1)
    .filter((evaluation) => evaluation.intentLabel !== "NOISE")
    .filter((evaluation) => topConfidence - evaluation.confidence <= config.multiLabel.scoreWindow)
    .slice(0, Math.max(0, config.multiLabel.maxLabels - 1));

  return [primary, ...additional];
}

export function toSignalAgentLabel(evaluation: EntryEvaluation): SignalAgentLabel {
  return {
    pain_category: evaluation.entry.id,
    pain_category_label: evaluation.entry.painCategory,
    domain: evaluation.entry.domain || null,
    confidence: Math.round(evaluation.confidence * 1000) / 1000,
    intent_label: evaluation.intentLabel,
    recommended_solution: evaluation.entry.primarySolutions.map((solution) => solution.name)
  };
}
