import type { CatalogEntry, IngestedTranscript, ParsedMatchingConfig } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";

/**
 * Generic keyword/phrase scoring plus negation-penalty detection.
 *
 * Nothing here references a specific entry id or product name — every
 * phrase compared is read off `entry.keywords` / `entry.negativeCues` (or
 * the catalog-wide generic negation phrase list), so this module behaves
 * identically no matter which — or how many — entries the taxonomy JSON
 * contains.
 */

export type KeywordMatchResult = {
  score: number;
  matchedKeywords: string[];
  matchedText: string[];
};

export type NegationResult = {
  domainNegativeCuesHit: string[];
  genericNegationHit: string[];
  penalty: number;
  hasUnresolvedNegation: boolean;
};

/** Lowercases and normalizes hyphens to spaces so phrase matching is not
 * sensitive to writing e.g. "hybrid-work" vs "hybrid work". Applied to both
 * the transcript haystack and every phrase compared against it. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/-/g, " ");
}

function customerHaystack(transcript: IngestedTranscript) {
  const pool = selectRelevantChunks(transcript);
  return {
    text: normalize(pool.map((chunk) => chunk.text).join(" \n ")),
    chunks: pool
  };
}

/** Longer, more specific phrases contribute more weight than single
 * generic words — mirrors keyword_pass.description in the mapping JSON
 * ("Longer phrases ... score more than isolated generic words"). */
function phraseWeight(phrase: string): number {
  const wordCount = phrase.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(1, wordCount / 3);
}

export function scoreKeywords(entry: CatalogEntry, transcript: IngestedTranscript, config: ParsedMatchingConfig): KeywordMatchResult {
  const { text: haystack, chunks } = customerHaystack(transcript);
  const matchedKeywords: string[] = [];
  const matchedText = new Set<string>();
  let weightSum = 0;

  for (const phrase of entry.keywords) {
    const needle = normalize(phrase);
    if (!needle || !haystack.includes(needle)) continue;
    matchedKeywords.push(phrase);
    weightSum += phraseWeight(phrase);

    for (const chunk of chunks) {
      if (normalize(chunk.text).includes(needle)) {
        matchedText.add(chunk.text);
      }
    }
  }

  // Saturating curve so repeated/longer matches keep adding signal without
  // letting a single very long keyword list blow past the configured cap.
  const rawScore = matchedKeywords.length > 0 ? 1 - Math.exp(-weightSum / 2) : 0;
  const score = Math.min(config.keywordCap, rawScore);

  return { score, matchedKeywords, matchedText: Array.from(matchedText) };
}

export function scoreNegativeCues(
  entry: CatalogEntry,
  transcript: IngestedTranscript,
  genericNegationPhrases: string[],
  config: ParsedMatchingConfig
): NegationResult {
  const { text: haystack } = customerHaystack(transcript);

  const domainNegativeCuesHit = entry.negativeCues.filter((cue) => cue && haystack.includes(normalize(cue)));
  const genericNegationHit = genericNegationPhrases.filter((phrase) => phrase && haystack.includes(normalize(phrase)));

  let penalty = 0;
  if (domainNegativeCuesHit.length > 0) penalty += config.penalties.wrongDomain;
  if (genericNegationHit.length > 0) penalty += config.penalties.negation;

  return {
    domainNegativeCuesHit,
    genericNegationHit,
    penalty,
    hasUnresolvedNegation: domainNegativeCuesHit.length > 0 || genericNegationHit.length > 0
  };
}

/** Specificity/intent scoring: rewards concrete timing, ownership,
 * quantified impact, active projects, budget, evaluation, renewal, or
 * executive mandate — driven entirely by each entry's own
 * `intentMarkers`/`buyingRoles` arrays plus generic (product-agnostic)
 * patterns for numbers, dates, and money, never by a hard-coded phrase
 * tied to one category. */
const GENERIC_SPECIFICITY_PATTERNS: RegExp[] = [
  /\$\s?\d/, // dollar amounts
  /\b\d{1,3}(,\d{3})+\b/, // large numbers (e.g. affected user counts)
  /\b(q[1-4]|quarter|fy\d{2}|fiscal year|this year|next year|by (january|february|march|april|may|june|july|august|september|october|november|december))\b/i,
  /\b(renewal|rfp|evaluat(e|ing|ion)|budget|approved|deadline|mandate)\b/i
];

export function scoreSpecificityIntent(entry: CatalogEntry, transcript: IngestedTranscript): { score: number; matchedMarkers: string[] } {
  const { text: haystack } = customerHaystack(transcript);
  const matchedMarkers = entry.intentMarkers.filter((marker) => marker && haystack.includes(normalize(marker)));
  const matchedRoles = entry.buyingRoles.filter((role) => role && haystack.includes(normalize(role)));
  const genericHits = GENERIC_SPECIFICITY_PATTERNS.filter((pattern) => pattern.test(haystack)).length;

  const weightSum =
    matchedMarkers.reduce((sum, marker) => sum + phraseWeight(marker), 0) +
    matchedRoles.length * 0.5 +
    genericHits * 0.35;

  const score = weightSum > 0 ? Math.min(1, 1 - Math.exp(-weightSum / 2)) : 0;
  return { score, matchedMarkers };
}
