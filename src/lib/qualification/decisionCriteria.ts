/**
 * Generic detector for EXPLICITLY ENUMERATED decision criteria — a customer
 * stating a numbered/listed set of requirements the chosen vendor must satisfy
 * ("One, reduce median time ...", "Two, show evidence quality ...", ...). These
 * are Decision Criteria in MEDDPICC terms. Recognizing them lets qualification
 * mark Decision Criteria CONFIRMED (and ask the REAL gap — weighting, scoring
 * method, owner, pass/fail threshold — instead of "what criteria exist?").
 *
 * Purely linguistic: an ordinal lead ("one"/"first"/"1.") plus a requirement
 * verb, or an explicit "our decision criteria are ..." lead. Never references a
 * company, product, or a specific transcript's wording. A plain enumerated
 * metric/timing item ("First, our average time is 96 minutes") is excluded
 * because it carries no requirement verb.
 */

const ORDINAL_LEAD_RE =
  /^(?:one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b[\s,.:)-]/i;
const NUMERIC_LEAD_RE = /^\(?\d{1,2}[.):]\s/;
// Requirement / obligation verbs that make an enumerated item a CRITERION (what
// the solution must do), as opposed to a stated fact, metric, or date.
const CRITERION_VERB_RE =
  /\b(reduce|integrate|show|provide|preserve|produce|prove|support|ensure|maintain|deliver|require|must|separate|demonstrate|meet|achieve|correlate|detect|cover|enforce|isolate|minimi[sz]e|eliminate|comply|scale|handle)\b/i;
// A lead-in that introduces a criteria list ("our decision criteria are ...").
const CRITERIA_LIST_LEAD_RE = /\b(decision criteria|selection criteria|evaluation criteria|our criteria|written criteria|success criteria)\b[^.]{0,20}\b(are|include|is|:)/i;

/** Returns the distinct enumerated decision-criteria statements found in the
 * given CUSTOMER-side sentences. */
export function extractEnumeratedDecisionCriteria(customerSentences: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of customerSentences) {
    const t = (raw ?? "").trim();
    if (t.length < 20) continue;
    const isEnumerated = ORDINAL_LEAD_RE.test(t) || NUMERIC_LEAD_RE.test(t);
    const isCriterionList = CRITERIA_LIST_LEAD_RE.test(t);
    if ((isEnumerated && CRITERION_VERB_RE.test(t)) || isCriterionList) {
      const key = t.slice(0, 80).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}
