/**
 * Generic speech-act detection (Section 9). A question is a request for
 * information — it never asserts a customer fact, commitment, budget,
 * renewal, timing, or evaluation. Seller discovery questions in
 * particular ("Compliance, detection gaps, analyst workload, or platform
 * renewal?") must never be scored as customer buying intent.
 *
 * Nothing here references a company, product, speaker, or transcript —
 * it detects a *linguistic* form (interrogative) that applies to any
 * transcript in any industry.
 */

// The sentence splitter retains terminal punctuation, so an interrogative
// sentence ends with "?". A statement whose only assertive-looking clause
// sits inside a trailing question ("... or platform renewal?") is a
// question, not an assertion.
const TRAILING_QUESTION_RE = /\?\s*$/;

// An interrogative lead is a secondary signal for transcripts/snippets
// whose terminal punctuation was stripped upstream.
const INTERROGATIVE_LEAD_RE =
  /^\s*(what|which|how|why|when|where|who|whom|whose|do|does|did|are|is|was|were|can|could|would|will|shall|should|have|has|had|may|might)\b/i;

/** True when the statement is interrogative (a question), and therefore
 * cannot stand as a customer assertion of intent. */
export function isInterrogative(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (TRAILING_QUESTION_RE.test(trimmed)) return true;
  // A lead interrogative that also lacks a terminal period is a question
  // whose "?" may have been lost in normalization.
  if (INTERROGATIVE_LEAD_RE.test(trimmed) && !/[.!]\s*$/.test(trimmed)) return true;
  return false;
}
