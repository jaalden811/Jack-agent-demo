import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Next-step signal polarity (Slice 1a). A sentence can match a next-step
 * *shape* ("...workshop...", "...pilot...", "...working session...") while
 * actually being a customer OBJECTION, a skeptical recollection of a past
 * experience, or an explicit rejection of that activity — e.g. "we've seen
 * service maps that look impressive in a workshop and become fiction six
 * months later." Such a sentence must never be promoted as an accepted next
 * step, an agreed next step, a why-now driver, or a customer commitment.
 *
 * This module supplies the LOGIC; the lexicon of linguistic markers lives in
 * signal-agent-poc/config/next_step_signal_polarity.json and is editable
 * without code changes. Nothing here references a company, product, speaker,
 * or a specific transcript — it detects generic linguistic shapes only.
 */

type NextStepPolarityConfig = {
  past_recollection_frames: string[];
  skepticism_markers: string[];
  activity_nouns: string[];
  activity_negators: string[];
};

type CompiledPolarity = {
  recollection: RegExp;
  skepticism: RegExp;
  activityNoun: RegExp;
  activityNegation: RegExp;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function alternation(values: string[]): string {
  return values
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map(escapeRegex)
    .join("|");
}

let cachedConfig: NextStepPolarityConfig | null = null;
let cachedCompiled: CompiledPolarity | null = null;

export function loadNextStepPolarityConfig(): NextStepPolarityConfig {
  if (cachedConfig) return cachedConfig;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "next_step_signal_polarity.json");
  cachedConfig = JSON.parse(readFileSync(filePath, "utf8")) as NextStepPolarityConfig;
  return cachedConfig;
}

export function clearNextStepPolarityCache(): void {
  cachedConfig = null;
  cachedCompiled = null;
}

function compiled(): CompiledPolarity {
  if (cachedCompiled) return cachedCompiled;
  const cfg = loadNextStepPolarityConfig();
  const nouns = alternation(cfg.activity_nouns);
  const negators = alternation(cfg.activity_negators);
  cachedCompiled = {
    recollection: new RegExp(`\\b(?:${alternation(cfg.past_recollection_frames)})\\b`, "i"),
    skepticism: new RegExp(`\\b(?:${alternation(cfg.skepticism_markers)})\\b`, "i"),
    activityNoun: new RegExp(`\\b(?:${nouns})\\b`, "i"),
    // A negator followed within a few words by the activity noun — "not a
    // workshop", "do not want another workshop", "instead of a pilot". The
    // small (0-3 word) window keeps this from matching "a working session,
    // not a generic presentation" (the noun after the negator is
    // "presentation", not an activity noun).
    activityNegation: new RegExp(`\\b(?:${negators})(?:\\s+\\w+){0,3}?\\s+(?:${nouns})\\b`, "i")
  };
  return cachedCompiled;
}

/** True when a next-step-shaped sentence is really an objection or skeptical
 * dismissal ("...become fiction...", "...just shelfware...", "not a pilot"). */
export function isObjectionOrSkepticism(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const c = compiled();
  return c.skepticism.test(t) || c.activityNegation.test(t);
}

/** True when the sentence recalls a PAST activity ("we've seen ... in a
 * workshop") rather than proposing/accepting a future one. */
export function isPastRecollectionOfActivity(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const c = compiled();
  return c.recollection.test(t) && c.activityNoun.test(t);
}

/** True when a sentence that matched a next-step shape is a GENUINE
 * forward-looking / accepted next step — i.e. not an objection, skeptical
 * dismissal, or recollection of a past experience. */
export function isForwardNextStep(text: string): boolean {
  return !isObjectionOrSkepticism(text) && !isPastRecollectionOfActivity(text);
}
