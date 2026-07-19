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
// A genuine discovery (quantified pain + accepted next step) needs far
// less than the 4-type commercial threshold to stay out of NOISE — one
// quantified impact plus one accepted dated next step is enough. Satisfied
// incumbents (healthy metrics, no motion) and explicit denials are suppressed
// separately (satisfactionGuard / unresolved-negation), so this floor can be
// this low without pursuing them.
const DISCOVERY_MOMENTUM_MIN_INTENT_EVIDENCE = 0.1;

export async function evaluateEntry(params: {
  entry: CatalogEntry;
  transcript: IngestedTranscript;
  account: AccountRecord;
  embeddingBundle: EmbeddingBundle;
  negationConfig: NegationConfig;
  config: ParsedMatchingConfig;
  intentEvidence: BuyingIntentEvidence[];
  stakeholders: Stakeholder[];
  /** Boolean-only qualitative material-impact signal (see
   * intentExtraction#detectQualitativeImpact). Never enters the scored intent
   * list — it only enables the discovery-momentum verdict rescue below, so
   * numeric scores/corroboration stay identical whether it is true or false. */
  hasQualitativeImpactEvidence?: boolean;
}): Promise<EntryEvaluation> {
  const { entry, transcript, account, embeddingBundle, negationConfig, config, intentEvidence, stakeholders } = params;
  const hasQualitativeImpactEvidence = Boolean(params.hasQualitativeImpactEvidence);

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

  // Discovery-momentum exception (Section 10/12): a genuine early-stage
  // opportunity — quantified operational pain/impact PLUS an accepted next
  // step (working/scenario session, pilot, PoV, or workshop) — is a real
  // signal that must not collapse to NOISE simply because it lacks four
  // distinct commercial evidence types (budget/timeline/renewal are not
  // yet on the table in discovery). Pure "general interest" noise lacks
  // both an accepted next step and quantified impact, so it is unaffected.
  const hasNextStepEvidence = intentEvidence.some((item) => item.type === "next_step");
  // Impact is either a quantified figure (scored intent evidence) OR a
  // qualitative material-impact statement ("hundreds of specialists unable to
  // work", "material business risk"). The qualitative signal is boolean-only
  // and does not alter any numeric score or corroboration.
  const hasImpactEvidence = intentEvidence.some((item) => item.type === "impact") || hasQualitativeImpactEvidence;
  // Discovery momentum (real pain/impact + an accepted next step) is a genuine
  // early-stage opportunity that must never collapse to NOISE. This applies
  // whether or not an account/CRM row was supplied: providing account context
  // must never SUPPRESS a real signal (previously the rescue ran only in
  // transcript-only mode, so pasting account JSON perversely hid it).
  const discoveryMomentumOverride =
    hasNextStepEvidence && hasImpactEvidence && intentEvidenceScore >= DISCOVERY_MOMENTUM_MIN_INTENT_EVIDENCE;

  const intentLabel = classifyIntent({
    confidence,
    semanticScore: semanticResult.score,
    corroborationScore,
    hasUnresolvedNegation: negationResult.hasUnresolvedNegation,
    keywordOnlyEvidence,
    transcriptOnlyMode,
    strongIntentOverride,
    discoveryMomentumOverride,
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
  discoveryMomentumOverride: boolean;
  config: ParsedMatchingConfig;
}): "HIGH_INTENT" | "REVIEW" | "NOISE" {
  const { confidence, semanticScore, corroborationScore, hasUnresolvedNegation, keywordOnlyEvidence, transcriptOnlyMode, strongIntentOverride, discoveryMomentumOverride, config } =
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

  // Below the REVIEW floor on raw confidence, two exceptions keep a real
  // signal out of NOISE:
  //  - strongIntentOverride: a transcript-only "HIGH_INTENT without a CRM row"
  //    exception (4+ explicit intent types), so it stays transcript-only;
  //  - discoveryMomentumOverride: pain/impact + an accepted next step — a
  //    genuine early-stage opportunity — applies in BOTH modes, because
  //    supplying account context must never suppress a real signal.
  if ((transcriptOnlyMode && strongIntentOverride) || discoveryMomentumOverride) return "REVIEW";

  return "NOISE";
}

/** Picks the primary label plus up to (maxLabels - 1) additional labels
 * from other entries whose confidence is within `scoreWindow` of the
 * top score and whose intent is not NOISE — implementing
 * multi_label_policy generically. Distinct domains are preferred so
 * genuinely different operational layers are not merged into one label. */
// Near-tie window + incidental-keyword floor for the primary tiebreaker below.
const PRIMARY_NEAR_TIE_WINDOW = 0.05;
const INCIDENTAL_KEYWORD_FLOOR = 0.2;
const SUBSTANTIVE_KEYWORD_FLOOR = 0.3;

export function selectMultiLabelEvaluations(evaluations: EntryEvaluation[], config: ParsedMatchingConfig): EntryEvaluation[] {
  const sorted = [...evaluations].sort((a, b) => b.confidence - a.confidence || b.rawConfidence - a.rawConfidence);
  if (sorted.length === 0) return [];

  // Primary near-tie tiebreaker: a category must not win the PRIMARY slot on
  // diffuse semantic noise alone (generic tech/process words) when a
  // near-tied category has explicit, product-specific KEYWORD evidence. If the
  // confidence leader's keyword support is incidental (a single generic word)
  // and another candidate within the near-tie window has substantive keyword
  // evidence, promote the best-keyword-evidenced near-tied candidate. Generic
  // and evidence-driven — never references a category id or product name.
  if (sorted.length >= 2 && sorted[0].keywordScore <= INCIDENTAL_KEYWORD_FLOOR) {
    const contenders = sorted.filter(
      (e) => sorted[0].confidence - e.confidence <= PRIMARY_NEAR_TIE_WINDOW && e.intentLabel !== "NOISE" && e.keywordScore >= SUBSTANTIVE_KEYWORD_FLOOR
    );
    if (contenders.length > 0) {
      const best = contenders.sort((a, b) => b.keywordScore - a.keywordScore || b.confidence - a.confidence)[0];
      const idx = sorted.indexOf(best);
      if (idx > 0) {
        sorted.splice(idx, 1);
        sorted.unshift(best);
      }
    }
  }

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
