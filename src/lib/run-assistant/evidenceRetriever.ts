import type { AssistantEvidenceItem, RunAssistantContext } from "@/lib/run-assistant/types";

/**
 * Deterministic evidence retrieval over a single run's evidence. Ranks the
 * run's evidence items by keyword overlap with the question. Only returns
 * items that actually exist in the run context (so citations are always valid
 * evidence IDs and nothing is invented).
 */

const STOPWORDS = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "was", "were", "did", "do", "does", "what", "who", "when", "where", "why", "how", "should", "i", "we", "they", "this", "that", "it", "about", "with", "have", "has", "mention", "mentioned", "say", "said", "me", "my", "our", "their", "any", "there", "be", "been"]);

export function keywords(question: string): string[] {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    )
  );
}

export function retrieveEvidence(question: string, context: RunAssistantContext, limit = 3): Array<{ item: AssistantEvidenceItem; score: number }> {
  const kws = keywords(question);
  if (kws.length === 0) return [];
  const scored = context.evidence_items
    .map((item) => {
      const text = item.text.toLowerCase();
      let score = 0;
      for (const kw of kws) if (text.includes(kw)) score += 1;
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Validates that every cited id exists in the run context (rejects unknown
 * evidence IDs — the assistant must never cite an id it wasn't given). */
export function validateCitedIds(citedIds: string[], context: RunAssistantContext): { valid: boolean; unknown: string[] } {
  const known = new Set(context.evidence_items.map((e) => e.evidence_id));
  const unknown = citedIds.filter((id) => !known.has(id));
  return { valid: unknown.length === 0, unknown };
}
