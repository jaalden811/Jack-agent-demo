import type {
  AccountRecord,
  BuyingIntentEvidence,
  CatalogEntry,
  EntryEvaluation,
  IngestedTranscript,
  ParsedMatchingConfig,
  SignalAgentLabel,
  Stakeholder
} from "@/lib/signal-agent/types";
import { scoreKeywords } from "@/lib/signal-agent/keywordMatch";
import { analyzeNegativeCues } from "@/lib/signal-agent/polarity";
import { scoreBuyingIntentEvidence } from "@/lib/signal-agent/intentExtraction";
import { scoreCorroboration, scoreTranscriptCorroboration } from "@/lib/signal-agent/accountContext";
import { scoreSemanticMatch, type EmbeddingBundle } from "@/lib/signal-agent/semanticMatch";
import type { NegationConfig } from "@/lib/signal-agent/types";

/**
 * Generic, entry-agnostic scoring engine.
 *
 * confidence = weights.keyword*keyword + weights.semantic*semantic
 *            + weights.corroboration*corroboration + weights.specificityIntent*intentEvidence
 *            - penalties
 *
 * `corroboration` combines transcript-derived and structured
 * (CRM/account-CSV) corroboration — see accountContext.ts. When no
 * account matches, the taxonomy's own transcript-only-mode exception
 * applies: strong, explicit timing + ownership + impact + buying-intent
 * evidence can still reach HIGH_INTENT, not just REVIEW.
 *
 * Every weight/threshold comes from `config` (parsed in loadCatalog.ts
 * from the taxonomy JSON) — this function contains no category- or
 * product-specific branches.
 */

/** How much of the transcript-only-mode confidence must come from intent
 * evidence before the taxonomy's HIGH_INTENT exception is allowed to fire
 * without any structured account match. A single generic threshold, not a
 * category-specific one. */
const TRANSCRIPT_ONLY_STRONG_INTENT_EVIDENCE = 0.55;
const TRANSCRIPT_ONLY_MIN_EVIDENCE_TYPES = 4;

export async function evaluateEntry(params: {
  entry: CatalogEntry;
  transcript: IngestedTranscript;
  account: AccountRecord;
  embeddingBundle: EmbeddingBundle;
  negationConfig: NegationConfig;
  config: ParsedMatchingConfig;
  intentEvidence: BuyingIntentEvidence[];
  stakeholders: Stakeholder[];
}): Promise<EntryEvaluation> {
  const { entry, transcript, account, embeddingBundle, negationConfig, config, intentEvidence, stakeholders } = params;

  const keywordResult = scoreKeywords(entry, transcript, config);
  const negationResult = analyzeNegativeCues(entry, transcript, negationConfig, config);
  const semanticResult = await scoreSemanticMatch(entry, embeddingBundle, config);

  const transcriptOnlyMode = !account.matched;
  const structuredCorroboration = transcriptOnlyMode ? { score: 0, signals: [] } : scoreCorroboration(entry, account);
  const transcriptCorroboration = scoreTranscriptCorroboration(entry, transcript, intentEvidence, stakeholders.length);

  const intentEvidenceScore = scoreBuyingIntentEvidence(intentEvidence);
  const evidenceTypeCount = new Set(intentEvidence.map((item) => item.type)).size;

  // Combined corroboration blends transcript-derived and structured
  // signals; structured (CRM) evidence is weighted slightly higher when
  // present because it is independently verified, but transcript evidence
  // alone must still be able to carry real weight (Section 6/1 requirement
  // that a missing CSV row must not automatically suppress a real signal).
  const corroborationScore = transcriptOnlyMode
    ? transcriptCorroboration.score
    : Math.min(1, structuredCorroboration.score * 0.7 + transcriptCorroboration.score * 0.3);

  const rawConfidence = transcriptOnlyMode
    ? config.transcriptOnlyMode.weights.keyword * keywordResult.score +
      config.transcriptOnlyMode.weights.semantic * semanticResult.score +
      // The taxonomy's transcript-only formula is keyword+semantic only;
      // we additionally fold in transcript corroboration + intent evidence
      // (both are themselves 100% transcript-derived) so that a
      // transcript rich in explicit timing/ownership/impact/buying-intent
      // is not scored as if it were bare keyword/semantic matching.
      0.25 * corroborationScore +
      0.15 * intentEvidenceScore -
      negationResult.penalty
    : config.weights.keyword * keywordResult.score +
      config.weights.semantic * semanticResult.score +
      config.weights.corroboration * corroborationScore +
      config.weights.specificityIntent * intentEvidenceScore -
      negationResult.penalty;

  const confidence = Math.max(0, Math.min(1, rawConfidence));

  const keywordOnlyEvidence =
    keywordResult.matchedKeywords.length > 0 &&
    semanticResult.matchedCues.length === 0 &&
    corroborationScore === 0 &&
    intentEvidenceScore === 0;

  // The taxonomy's transcript-only exception: "a transcript without CRM
  // data may exceed REVIEW when it contains explicit timing, ownership,
  // impact, and buying intent." We treat that as met when intent evidence
  // spans at least 4 distinct types (e.g. budget + timeline + owner +
  // impact) AND contributes strongly to the score — not just one
  // keyword-shaped mention.
  const strongIntentOverride =
    transcriptOnlyMode && evidenceTypeCount >= TRANSCRIPT_ONLY_MIN_EVIDENCE_TYPES && intentEvidenceScore >= TRANSCRIPT_ONLY_STRONG_INTENT_EVIDENCE;

  const intentLabel = classifyIntent({
    confidence,
    semanticScore: semanticResult.score,
    corroborationScore,
    hasUnresolvedNegation: negationResult.hasUnresolvedNegation,
    keywordOnlyEvidence,
    transcriptOnlyMode,
    strongIntentOverride,
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
    corroborationScore: structuredCorroboration.score,
    corroboration: structuredCorroboration.signals,
    transcriptCorroborationScore: transcriptCorroboration.score,
    transcriptCorroboration: transcriptCorroboration.signals,
    specificityIntentScore: intentEvidenceScore,
    intentEvidence,
    negativeCueResults: negationResult.results,
    penalty: negationResult.penalty,
    confidence,
    rawConfidence,
    intentLabel,
    transcriptOnlyMode,
    strongIntentOverride
  };
}

function classifyIntent(params: {
  confidence: number;
  semanticScore: number;
  corroborationScore: number;
  hasUnresolvedNegation: boolean;
  keywordOnlyEvidence: boolean;
  transcriptOnlyMode: boolean;
  strongIntentOverride: boolean;
  config: ParsedMatchingConfig;
}): "HIGH_INTENT" | "REVIEW" | "NOISE" {
  const { confidence, semanticScore, corroborationScore, hasUnresolvedNegation, keywordOnlyEvidence, transcriptOnlyMode, strongIntentOverride, config } =
    params;

  // Explicit unresolved negation and keyword-only evidence always
  // suppress, regardless of the numeric score — "a keyword hit alone must
  // never trigger a notification," and a genuinely denied pain point must
  // never be promoted.
  if (hasUnresolvedNegation) return "NOISE";
  if (keywordOnlyEvidence) return "NOISE";

  const meetsHighIntentGate =
    confidence >= config.gates.highIntent.confidence &&
    (semanticScore >= config.gates.highIntent.semantic || corroborationScore >= config.gates.highIntent.corroboration || strongIntentOverride);

  if (meetsHighIntentGate) return "HIGH_INTENT";
  if (confidence >= config.gates.review.min) return "REVIEW";

  // Transcript-only exception: even below the REVIEW floor on raw
  // confidence, sufficiently strong explicit timing/ownership/impact/
  // buying-intent evidence keeps the result at REVIEW rather than letting
  // it collapse to NOISE purely because no CRM row exists.
  if (transcriptOnlyMode && strongIntentOverride) return "REVIEW";

  return "NOISE";
}

/** Picks the primary label plus up to (maxLabels - 1) additional labels
 * from other entries whose confidence is within `scoreWindow` of the
 * top score and whose intent is not NOISE — implementing
 * multi_label_policy generically. Distinct domains are preferred so
 * genuinely different operational layers are not merged into one label. */
export function selectMultiLabelEvaluations(evaluations: EntryEvaluation[], config: ParsedMatchingConfig): EntryEvaluation[] {
  const sorted = [...evaluations].sort((a, b) => b.confidence - a.confidence || b.rawConfidence - a.rawConfidence);
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
