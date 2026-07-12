import type { CatalogEntry, IngestedTranscript, ParsedMatchingConfig } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";

/**
 * Generic keyword/phrase scoring.
 *
 * Nothing here references a specific entry id or product name — every
 * phrase compared is read off `entry.keywords`, so this module behaves
 * identically no matter which — or how many — entries the taxonomy JSON
 * contains. Negation/polarity analysis lives in polarity.ts; buying-intent
 * extraction lives in intentExtraction.ts.
 */

export type KeywordMatchResult = {
  score: number;
  matchedKeywords: string[];
  matchedText: string[];
};

/** Lowercases and normalizes hyphens to spaces so phrase matching is not
 * sensitive to writing e.g. "hybrid-work" vs "hybrid work". Applied to both
 * the transcript haystack and every phrase compared against it. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/-/g, " ");
}

export function customerHaystack(transcript: IngestedTranscript) {
  const pool = selectRelevantChunks(transcript);
  return {
    text: normalize(pool.map((chunk) => chunk.text).join(" \n ")),
    chunks: pool
  };
}

/** Longer, more specific phrases contribute more weight than single
 * generic words — mirrors keyword_pass.description in the mapping JSON
 * ("Longer phrases ... score more than isolated generic words"). */
export function phraseWeight(phrase: string): number {
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
