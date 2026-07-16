import type { CatalogEntry, IngestedTranscript, MatchedSemanticCue, ParsedMatchingConfig, SemanticMode } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";

/**
 * Semantic similarity between transcript chunks and each entry's
 * `semanticCues`, computed deterministically (local token/phrase overlap).
 *
 * There is no external embedding provider: Circuit exposes no embedding
 * endpoint, so the Signal-to-Action taxonomy match uses this deterministic
 * engine exclusively. It requires no network, never throws, and is the sole
 * scoring path (the previous OpenAI-embeddings mode has been removed).
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were",
  "we", "our", "us", "you", "your", "it", "this", "that", "these", "those", "at", "as", "be", "have", "has",
  "do", "does", "did", "not", "no", "so", "just", "very", "can", "could", "would", "should", "will", "i"
]);

/** Very small suffix-stripping stemmer (not a full Porter stemmer) so that
 * e.g. "centralized"/"centralize"/"centralizing" or "collaboration"/
 * "collaborate" collapse to a shared token for overlap purposes, per the
 * deterministic fallback requirement to include "simple stemming". */
function stem(token: string): string {
  return token
    .replace(/(ational|ization|izing|isation|ising)$/, "iz")
    .replace(/(ations|ation)$/, "at")
    .replace(/(ingly|edly)$/, "")
    .replace(/(ies)$/, "y")
    .replace(/(ing|ers|edness)$/, "")
    .replace(/(ed|es)$/, "")
    .replace(/(s)$/, "");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .map(stem);
}

/** Deterministic text-similarity: token coverage, phrase overlap (shared
 * bigrams), and normalized keyword density — combined into a single 0..1
 * similarity score. No network, no external dependency, never fails.
 *
 * Coverage uses the overlap coefficient (intersection / smaller-set-size)
 * rather than Jaccard (intersection / union): transcript chunks are naturally
 * longer, more verbose utterances than the short, dense semantic_cues phrases
 * they are compared against, and Jaccard's union-sized denominator structurally
 * under-scores a short reference phrase that is nonetheless fully covered by a
 * longer sentence. */
function deterministicSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter((token) => setB.has(token));
  const smallerSetSize = Math.max(1, Math.min(setA.size, setB.size));
  const coverage = intersection.length / smallerSetSize;

  const bigramsOf = (tokens: string[]) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i += 1) {
      bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return bigrams;
  };
  const bigramsA = bigramsOf(tokensA);
  const bigramsB = bigramsOf(tokensB);
  const bigramIntersection = [...bigramsA].filter((bigram) => bigramsB.has(bigram));
  const smallerBigramSetSize = Math.max(1, Math.min(bigramsA.size, bigramsB.size));
  const phraseOverlap = bigramsA.size > 0 && bigramsB.size > 0 ? bigramIntersection.length / smallerBigramSetSize : 0;

  const density = intersection.length / Math.max(tokensB.length, 1);

  return Math.min(1, coverage * 0.5 + phraseOverlap * 0.35 + density * 0.15);
}

export type EmbeddingBundle = {
  mode: SemanticMode;
  chunkTexts: string[];
  chunkEmbeddings: number[][] | null;
  warning: string | null;
};

/** Selects the transcript chunks to compare against catalog cues. No external
 * embedding call is made; the deterministic engine is always used. */
export async function embedTranscript(transcript: IngestedTranscript): Promise<EmbeddingBundle> {
  const chunkTexts = selectRelevantChunks(transcript).map((chunk) => chunk.text);
  return { mode: "deterministic", chunkTexts, chunkEmbeddings: null, warning: null };
}

export type SemanticScoreResult = {
  score: number;
  matchedCues: MatchedSemanticCue[];
};

/** Scores one entry's semantic_cues against the transcript chunks using the
 * deterministic similarity engine and the max + mean(top-N) formula parsed from
 * the catalog's own matching_configuration. */
export async function scoreSemanticMatch(
  entry: CatalogEntry,
  bundle: EmbeddingBundle,
  config: ParsedMatchingConfig
): Promise<SemanticScoreResult> {
  if (entry.semanticCues.length === 0 || bundle.chunkTexts.length === 0) {
    return { score: 0, matchedCues: [] };
  }

  const similarities = entry.semanticCues.map((cue) => Math.max(...bundle.chunkTexts.map((chunk) => deterministicSimilarity(chunk, cue))));

  const matchedCues: MatchedSemanticCue[] = entry.semanticCues
    .map((cue, index) => ({ cue, similarity: Math.round(similarities[index] * 1000) / 1000 }))
    .filter((item) => item.similarity >= config.semanticThresholds.candidate)
    .sort((a, b) => b.similarity - a.similarity);

  const sorted = [...similarities].sort((a, b) => b - a);
  const maxSimilarity = sorted[0] ?? 0;
  const topN = sorted.slice(0, config.semanticFormula.topN);
  const meanTopN = topN.length > 0 ? topN.reduce((sum, value) => sum + value, 0) / topN.length : 0;

  const score = config.semanticFormula.maxWeight * maxSimilarity + config.semanticFormula.meanTopWeight * meanTopN;

  return { score: Math.max(0, Math.min(1, score)), matchedCues };
}
