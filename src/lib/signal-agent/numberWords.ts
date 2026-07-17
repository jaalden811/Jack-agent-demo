/**
 * Generic English spelled-out-number normalization. Speech-to-text and
 * human-typed transcripts frequently write quantities as words ("ninety-six
 * minutes", "thirty-one thousand sessions", "three hundred eighty to four
 * hundred twenty thousand dollars") rather than digits. The deterministic
 * metric/impact/timeline detectors are digit-based, so without this pass they
 * silently miss every worded metric.
 *
 * This converts runs of cardinal number-words into digits so the existing
 * digit patterns fire unchanged. It is pure English lexicon (not scenario,
 * company, or product data) and is only ever used to build a match-copy of the
 * text — the original quote shown to the user is never altered.
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};

const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };

const NUMBER_WORDS = new Set<string>([...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(SCALES)]);

function isNumberWord(token: string): boolean {
  return NUMBER_WORDS.has(token.toLowerCase());
}

/** Converts an ordered list of number-word tokens into a single integer using
 * the standard accumulate-current / apply-scale algorithm. */
function tokensToNumber(tokens: string[]): number {
  let total = 0;
  let current = 0;
  for (const raw of tokens) {
    const token = raw.toLowerCase();
    if (token in ONES) {
      current += ONES[token];
    } else if (token in TENS) {
      current += TENS[token];
    } else if (token === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
    } else {
      // thousand / million / billion — flush the current group at this scale.
      const scale = SCALES[token];
      total += (current === 0 ? 1 : current) * scale;
      current = 0;
    }
  }
  return total + current;
}

// A maximal run of number-words, allowing hyphen/space separators and an
// optional "and" connective ("one hundred and five"). Word-boundary anchored.
const WORD = Object.keys({ ...ONES, ...TENS, ...SCALES }).join("|");
const RUN_RE = new RegExp(`\\b(?:${WORD})(?:[\\s-]+(?:and[\\s-]+)?(?:${WORD}))*\\b`, "gi");

export function normalizeSpelledNumbers(text: string): string {
  return text.replace(RUN_RE, (run) => {
    const tokens = run
      .split(/[\s-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.toLowerCase() !== "and" && isNumberWord(t));
    if (tokens.length === 0) return run;
    // A single "one"/"a"-like token is usually an article-ish usage, not a
    // metric ("one mobile engineer"); converting it is harmless, but skip the
    // degenerate zero result so we never emit a bare "0" for stray words.
    const value = tokensToNumber(tokens);
    if (!Number.isFinite(value)) return run;
    return String(value);
  });
}
