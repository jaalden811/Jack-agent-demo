import type { CatalogEntry, IngestedTranscript, MatchedSemanticCue, ParsedMatchingConfig, SemanticMode } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";

/**
 * Semantic similarity between transcript chunks and each entry's
 * `semanticCues`.
 *
 * Mode A (OpenAI embeddings): server-side only, uses
 * process.env.OPENAI_API_KEY / process.env.OPENAI_EMBEDDING_MODEL. Never
 * hard-codes the key, never returns embeddings or raw key material to the
 * browser.
 *
 * Mode B (deterministic fallback): local token/phrase overlap. Used
 * automatically whenever OpenAI is not configured or a call fails for any
 * reason — this module never throws out to its caller.
 */

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
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

/** Deterministic text-similarity fallback: token coverage, phrase overlap
 * (shared bigrams), and normalized keyword density — combined into a
 * single 0..1 similarity score. No network, no external dependency, never
 * fails.
 *
 * Coverage uses the overlap coefficient (intersection / smaller-set-size)
 * rather than Jaccard (intersection / union): transcript chunks are
 * naturally longer, more verbose utterances than the short, dense
 * semantic_cues phrases they are compared against, and Jaccard's
 * union-sized denominator structurally under-scores a short reference
 * phrase that is nonetheless fully covered by a longer sentence. */
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Cache of cue-text -> embedding for the lifetime of the Node process.
 * Entry semantic_cues are static within a catalog load, so this avoids
 * re-embedding the same ~100 cue strings on every run. */
const cueEmbeddingCache = new Map<string, number[]>();

async function embedTexts(texts: string[], apiKey: string, model: string): Promise<number[][] | null> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, timeout: 8000, maxRetries: 0 });
  const response = await client.embeddings.create({ model, input: texts });
  return response.data.map((item) => item.embedding as number[]);
}

async function getCueEmbeddings(cues: string[], apiKey: string, model: string): Promise<number[][]> {
  const uncached = cues.filter((cue) => !cueEmbeddingCache.has(`${model}::${cue}`));
  if (uncached.length > 0) {
    const embeddings = await embedTexts(uncached, apiKey, model);
    if (embeddings) {
      uncached.forEach((cue, index) => cueEmbeddingCache.set(`${model}::${cue}`, embeddings[index]));
    }
  }
  return cues.map((cue) => cueEmbeddingCache.get(`${model}::${cue}`)).filter((value): value is number[] => Boolean(value));
}

export type EmbeddingBundle = {
  mode: SemanticMode;
  chunkTexts: string[];
  chunkEmbeddings: number[][] | null;
  warning: string | null;
};

/** Computes (or attempts to compute) transcript-chunk embeddings exactly
 * once per run, shared across every catalog entry evaluated. Never
 * throws — any OpenAI failure downgrades to the fallback mode and returns
 * a user-safe warning string. */
export async function embedTranscript(transcript: IngestedTranscript, useOpenAI: boolean): Promise<EmbeddingBundle> {
  const chunkTexts = selectRelevantChunks(transcript).map((chunk) => chunk.text);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;

  if (!useOpenAI || !apiKey || chunkTexts.length === 0) {
    return {
      mode: "fallback",
      chunkTexts,
      chunkEmbeddings: null,
      warning: !apiKey ? "Semantic matching unavailable; using deterministic fallback." : null
    };
  }

  try {
    const chunkEmbeddings = await embedTexts(chunkTexts, apiKey, model);
    if (!chunkEmbeddings) throw new Error("empty embedding response");
    return { mode: "openai_embeddings", chunkTexts, chunkEmbeddings, warning: null };
  } catch {
    // Never surface error internals (could contain request metadata); log
    // a sanitized, key-free warning only.
    console.warn("Signal agent: OpenAI embeddings unavailable, using deterministic fallback.");
    return {
      mode: "fallback",
      chunkTexts,
      chunkEmbeddings: null,
      warning: "Semantic matching unavailable; using deterministic fallback."
    };
  }
}

/** Batches every catalog entry's semantic_cues into as few OpenAI calls as
 * possible (ideally one) before the per-entry scoring loop runs, instead
 * of issuing one embeddings call per entry. Returns false if the batched
 * fetch fails outright, so the caller can downgrade the whole run to
 * fallback mode rather than silently mixing modes across entries. */
export async function prefetchCueEmbeddings(entries: CatalogEntry[], bundle: EmbeddingBundle): Promise<boolean> {
  if (bundle.mode !== "openai_embeddings") return true;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return true;
  const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;

  const allCues = Array.from(new Set(entries.flatMap((entry) => entry.semanticCues))).filter(Boolean);
  if (allCues.length === 0) return true;

  try {
    await getCueEmbeddings(allCues, apiKey, model);
    return true;
  } catch {
    console.warn("Signal agent: batched cue embedding prefetch failed, downgrading run to deterministic fallback.");
    return false;
  }
}

export type SemanticScoreResult = {
  score: number;
  matchedCues: MatchedSemanticCue[];
};

/** Scores one entry's semantic_cues against the already-embedded (or
 * fallback) transcript chunks, using the max + mean(top-N) formula parsed
 * from the catalog's own matching_configuration. */
export async function scoreSemanticMatch(
  entry: CatalogEntry,
  bundle: EmbeddingBundle,
  config: ParsedMatchingConfig
): Promise<SemanticScoreResult> {
  if (entry.semanticCues.length === 0 || bundle.chunkTexts.length === 0) {
    return { score: 0, matchedCues: [] };
  }

  let similarities: number[];

  if (bundle.mode === "openai_embeddings" && bundle.chunkEmbeddings) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
    let cueEmbeddings: number[][] = [];
    try {
      if (apiKey) cueEmbeddings = await getCueEmbeddings(entry.semanticCues, apiKey, model);
    } catch {
      cueEmbeddings = [];
    }

    if (cueEmbeddings.length === entry.semanticCues.length) {
      similarities = entry.semanticCues.map((_, cueIndex) => {
        let best = 0;
        for (const chunkEmbedding of bundle.chunkEmbeddings!) {
          best = Math.max(best, cosineSimilarity(chunkEmbedding, cueEmbeddings[cueIndex]));
        }
        return best;
      });
    } else {
      similarities = entry.semanticCues.map((cue) => Math.max(...bundle.chunkTexts.map((chunk) => deterministicSimilarity(chunk, cue))));
    }
  } else {
    similarities = entry.semanticCues.map((cue) => Math.max(...bundle.chunkTexts.map((chunk) => deterministicSimilarity(chunk, cue))));
  }

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
