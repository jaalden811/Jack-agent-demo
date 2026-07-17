/**
 * Evidence quality gate. A cited customer quote must be a complete, self-
 * contained statement a seller can act on — never a context-free fragment
 * ("So not zero.", "Then skills.", "Also internal politics.", "There are
 * diagrams."). This keeps the analysis credible: every surfaced quote reads as
 * a real point, not noise. Generic — no company/product/transcript wording.
 */

// A line that is ONLY a connective / bare agreement carries no standalone
// meaning out of context.
const CONNECTIVE_ONLY_RE =
  /^(so|and|also|then|or|but|well|yes|no|right|exactly|very|maybe|fair|fair enough|correct|understood|agreed|definitely|good answer|good|possibly|sure|okay|ok|true|indeed)[\s.,!?'"—-]*$/i;

/** True when the statement is a complete, substantive point (>= 4 words and
 * not a bare connective/agreement). */
export function isSubstantiveStatement(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (CONNECTIVE_ONLY_RE.test(t)) return false;
  return t.split(/\s+/).filter(Boolean).length >= 4;
}

/**
 * Keeps only substantive, de-duplicated items — capped per category and in
 * original order — so a category never surfaces fragments or near-duplicates.
 * A category whose only matches are fragments is dropped entirely (its signal
 * almost always appears as a substantive statement elsewhere).
 */
export function refineEvidenceItems<T>(items: T[], opts: { text: (i: T) => string; category: (i: T) => string; cap?: number }): T[] {
  const cap = opts.cap ?? 4;
  const perCategoryKept = new Map<string, number>();
  const seen = new Set<string>();
  const survivors = new Set<T>();
  for (const item of items) {
    if (!isSubstantiveStatement(opts.text(item))) continue;
    const category = opts.category(item);
    const key = `${category}::${opts.text(item).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60)}`;
    if (seen.has(key)) continue;
    const count = perCategoryKept.get(category) ?? 0;
    if (count >= cap) continue;
    seen.add(key);
    perCategoryKept.set(category, count + 1);
    survivors.add(item);
  }
  return items.filter((item) => survivors.has(item));
}
