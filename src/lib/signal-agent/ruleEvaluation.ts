import type { RuleEvaluation } from "@/lib/signal-agent/types";

/**
 * Evaluates a taxonomy entry's own `choose_when` / `do_not_choose_when`
 * rule strings against transcript evidence — deterministically, and
 * without ever asserting a rule as a "customer fact" unless evidence
 * actually supports it (Section 7 requirement). Every rule is one of:
 *
 *   - "matched": transcript evidence supports the rule's premise.
 *   - "contradicted": transcript evidence explicitly says the opposite
 *     of the rule's premise (e.g. "our application code instrumentation
 *     is already solid" contradicts "code-level application diagnostics
 *     are central").
 *   - "not_evidenced": neither — the rule is simply not addressed by
 *     this transcript, and must not be stated as if it were true.
 *
 * This is intentionally a generic term-overlap + contradiction-marker
 * heuristic, not a hard-coded per-rule mapping — it works the same way
 * for any rule string in any taxonomy entry.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were",
  "this", "that", "these", "those", "at", "as", "be", "have", "has", "can", "only", "buyer", "customer",
  "central", "primarily", "issue", "need"
]);

function keyTerms(rule: string): string[] {
  return rule
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

/** Generic, product-agnostic markers that something already-satisfied,
 * out-of-scope, or explicitly deprioritized is being described — not
 * specific to any Cisco/Splunk product or taxonomy category. */
const CONTRADICTION_MARKERS = [
  "already solid",
  "already have",
  "already covered",
  "already fine",
  "already good",
  "already solved",
  "not asking for",
  "isn't the issue",
  "is not the issue",
  "isn't the problem",
  "is not the problem",
  "separate initiative",
  "different initiative",
  "not the gap",
  "the gap is",
  "gap is specifically",
  "is a separate",
  "on record that",
  "not primarily"
];

function containsContradictionMarker(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return CONTRADICTION_MARKERS.some((marker) => lower.includes(marker));
}

export function evaluateRule(rule: string, sentences: string[]): RuleEvaluation {
  const terms = keyTerms(rule);
  if (terms.length === 0) return { rule, status: "not_evidenced", evidence: null };

  let bestSentence: string | null = null;
  let bestHits = 0;
  let bestOverlap = 0;

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const hits = terms.filter((term) => lower.includes(term));
    const overlap = hits.length / terms.length;
    if (hits.length > bestHits || (hits.length === bestHits && overlap > bestOverlap)) {
      bestHits = hits.length;
      bestOverlap = overlap;
      bestSentence = sentence;
    }
  }

  const isEvidenced = bestSentence !== null && (bestHits >= 2 || bestOverlap >= 0.34);
  if (!isEvidenced || !bestSentence) {
    return { rule, status: "not_evidenced", evidence: null };
  }

  if (containsContradictionMarker(bestSentence)) {
    return { rule, status: "contradicted", evidence: bestSentence };
  }

  return { rule, status: "matched", evidence: bestSentence };
}

export function evaluateRules(rules: string[], sentences: string[]): RuleEvaluation[] {
  return rules.map((rule) => evaluateRule(rule, sentences));
}
