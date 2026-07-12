import type { CatalogEntry, IngestedTranscript, NegationConfig, NegativeCueResult, ParsedMatchingConfig } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";

/**
 * Clause-aware negation/polarity analysis.
 *
 * This deliberately replaces raw "does the sentence contain this negative
 * phrase" substring matching, which incorrectly penalizes sentences like
 * "We are not just curious." (the actual phrase is a *negated* negative —
 * i.e. positive intent) the same way it penalizes "We are just curious."
 * (genuinely low intent).
 *
 * Algorithm per matched phrase occurrence, within its own sentence/clause:
 *   1. Look up to `negationWindowWords` words immediately before the
 *      match for an external negator ("not", "isn't", "never", ...).
 *      Found -> polarity "negated_negative", penalty 0 (a double negative
 *      is a positive signal).
 *   2. Otherwise, if the phrase is one of the JSON's configured
 *      `hypothetical_markers` (e.g. "presenter showed", "tabletop only")
 *      -> polarity "hypothetical", partial penalty.
 *   3. Otherwise, if the same sentence contains one of the configured
 *      `resolution_markers` ("but", "however", ...) followed by text that
 *      itself contains configured `resolution_evidence_terms` (budget,
 *      executive, this quarter, ...) -> polarity "resolved", penalty 0
 *      (the concern is explicitly addressed later in the same sentence).
 *   4. Otherwise -> polarity "negative", full configured penalty.
 *
 * Every phrase and threshold here comes from
 * signal-agent-poc/config/generic_negation_phrases.json (`negationConfig`)
 * or the matched entry's own `negativeCues` — nothing is hard-coded.
 */

function normalize(text: string): string {
  return text.toLowerCase().replace(/-/g, " ");
}

function wordsBefore(text: string, index: number, wordCount: number): string {
  const before = text.slice(0, index);
  const words = before.trim().split(/\s+/);
  return words.slice(Math.max(0, words.length - wordCount)).join(" ");
}

function hasExternalNegator(precedingText: string, negators: string[]): boolean {
  const normalizedPreceding = normalize(precedingText);
  return negators.some((negator) => {
    const pattern = new RegExp(`\\b${negator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}\\b`, "i");
    return pattern.test(normalizedPreceding);
  });
}

function findResolution(sentenceNormalized: string, matchEnd: number, config: NegationConfig): boolean {
  const after = sentenceNormalized.slice(matchEnd);
  for (const marker of config.resolutionMarkers) {
    const markerIndex = after.indexOf(normalize(marker));
    if (markerIndex === -1) continue;
    const clauseAfterMarker = after.slice(markerIndex + marker.length);
    if (config.resolutionEvidenceTerms.some((term) => clauseAfterMarker.includes(normalize(term)))) {
      return true;
    }
  }
  return false;
}

function analyzePhraseInSentence(
  sentenceText: string,
  phrase: string,
  config: NegationConfig
): NegativeCueResult | null {
  const sentenceNormalized = normalize(sentenceText);
  const phraseNormalized = normalize(phrase);
  const matchIndex = sentenceNormalized.indexOf(phraseNormalized);
  if (matchIndex === -1) return null;

  const preceding = wordsBefore(sentenceNormalized, matchIndex, config.negationWindowWords);
  if (hasExternalNegator(preceding, config.externalNegators)) {
    return { phrase, polarity: "negated_negative", context: sentenceText, penalty: 0 };
  }

  if (config.hypotheticalMarkers.some((marker) => normalize(marker) === phraseNormalized)) {
    return { phrase, polarity: "hypothetical", context: sentenceText, penalty: config.hypotheticalPenaltyWeight };
  }

  if (findResolution(sentenceNormalized, matchIndex + phraseNormalized.length, config)) {
    return { phrase, polarity: "resolved", context: sentenceText, penalty: 0 };
  }

  return { phrase, polarity: "negative", context: sentenceText, penalty: config.penaltyWeight };
}

export type PolarityAnalysis = {
  results: NegativeCueResult[];
  penalty: number;
  hasUnresolvedNegation: boolean;
};

export function analyzeNegativeCues(
  entry: CatalogEntry,
  transcript: IngestedTranscript,
  negationConfig: NegationConfig,
  matchingConfig: ParsedMatchingConfig
): PolarityAnalysis {
  const sentences = selectRelevantChunks(transcript);
  const allPhrases = [...entry.negativeCues, ...negationConfig.phrases];
  const results: NegativeCueResult[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    for (const phrase of allPhrases) {
      if (!phrase) continue;
      const result = analyzePhraseInSentence(sentence.text, phrase, negationConfig);
      if (!result) continue;
      const dedupeKey = `${result.phrase}::${result.context}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push(result);
    }
  }

  const unresolvedResults = results.filter((result) => result.polarity === "negative");
  // Domain-specific negativeCues that stay "negative" carry the taxonomy's
  // wrong-domain penalty; the catalog-wide lexicon carries the generic
  // negation penalty. Both are already baked into each result's own
  // `penalty` field via negationConfig, except domain cues need the
  // wrong-domain weight substituted in.
  const penalty = unresolvedResults.reduce((sum, result) => {
    const isDomainCue = entry.negativeCues.some((cue) => normalize(cue) === normalize(result.phrase));
    return sum + (isDomainCue ? matchingConfig.penalties.wrongDomain : result.penalty);
  }, 0);

  return {
    results,
    penalty,
    hasUnresolvedNegation: unresolvedResults.length > 0
  };
}
