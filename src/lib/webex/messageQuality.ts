/**
 * Pre-delivery message-quality validator (Section 15). Applies to BOTH
 * OpenAI-synthesized messages (a failure triggers one retry, then the
 * deterministic fallback) and — as a regression guard — the
 * deterministic messages themselves, so a shallow one-line notification
 * can never reach a recipient. Every check is generic: it inspects
 * structure and provenance, never a specific company/product/score.
 */

export type MessageQualityContext = {
  verdict: "HIGH_INTENT" | "REVIEW" | "NOISE";
  /** URLs that are legitimately allowed to appear (the validated public
   * analysis link + any real SerpAPI-returned source URLs). Any other
   * URL in a message is treated as invented. */
  allowedUrls: string[];
  charCeiling: number;
  /** Webex hard byte ceiling (provider limit is 7,439 bytes). */
  byteCeiling: number;
  /** Skip the "≥3 why-now / ≥3 actions" richness checks — used only for
   * NOISE/low-intent routes that intentionally carry less. */
  requireRichBrief: boolean;
};

export type MessageQualityResult = { valid: boolean; failures: string[] };

const URL_RE = /https?:\/\/[^\s)]+/gi;
// Conservative secret patterns — an outbound message must never contain
// a key-shaped token. (The app already never places secrets in messages;
// this is defense-in-depth.)
const SECRET_RES = [/sk-[A-Za-z0-9_-]{16,}/, /\bBearer\s+[A-Za-z0-9._-]{16,}/i, /api[_-]?key\s*[=:]\s*\S{12,}/i];

function countActionBullets(markdown: string): number {
  // Action bullets live under a "next" section (Bella next / Jack next).
  const lines = markdown.split(/\n/);
  let inAction = false;
  let count = 0;
  for (const line of lines) {
    const heading = line.trim().toLowerCase();
    if (/^\*\*.*(next|action).*\*\*$/.test(heading)) {
      inAction = true;
      continue;
    }
    if (inAction && /^\*\*.+\*\*$/.test(line.trim())) inAction = false;
    if (inAction && /^[-*]\s+\S/.test(line.trim())) count += 1;
  }
  return count;
}

function countWhyNowBullets(markdown: string): number {
  const lines = markdown.split(/\n/);
  let inWhy = false;
  let count = 0;
  for (const line of lines) {
    if (/^\*\*why now\*\*$/i.test(line.trim())) {
      inWhy = true;
      continue;
    }
    if (inWhy && /^\*\*.+\*\*$/.test(line.trim())) inWhy = false;
    if (inWhy && /^[-*]\s+\S/.test(line.trim())) count += 1;
  }
  return count;
}

function normalizeForCompare(markdown: string): string {
  // Strip the shared footer/link boilerplate and whitespace before
  // comparing the two lanes for material distinctness.
  return markdown
    .replace(/you received this because[\s\S]*$/i, "")
    .replace(/\*\*analysis reference[\s\S]*$/i, "")
    .replace(/\[open full analysis\]\([^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Jaccard token overlap of the two lane bodies — a high overlap means
 * the sales and technical messages are not materially different. */
function bodyOverlap(a: string, b: string): number {
  const tokensA = new Set(normalizeForCompare(a).split(" ").filter((t) => t.length > 3));
  const tokensB = new Set(normalizeForCompare(b).split(" ").filter((t) => t.length > 3));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

function validateOneMessage(label: string, markdown: string, context: MessageQualityContext): string[] {
  const failures: string[] = [];
  const body = markdown ?? "";
  if (body.trim().length === 0) {
    failures.push(`${label}: empty message`);
    return failures;
  }
  // Phase 13: a mid-content truncation ellipsis means a field was cut —
  // messages must be complete. (A literal "…" inside a real quote is
  // extremely rare and would also read as truncation, so it is rejected.)
  if (body.includes("…")) failures.push(`${label}: contains a truncation ellipsis (message field was cut)`);
  const byteLen = new TextEncoder().encode(body).length;
  if (byteLen > context.byteCeiling) failures.push(`${label}: exceeds channel byte ceiling (${byteLen} > ${context.byteCeiling})`);
  if (body.length > context.charCeiling) failures.push(`${label}: exceeds channel ceiling (${body.length} > ${context.charCeiling})`);
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(body)) failures.push(`${label}: contains a localhost/loopback link`);
  for (const secretRe of SECRET_RES) {
    if (secretRe.test(body)) failures.push(`${label}: contains a secret-shaped token`);
  }
  // Invented-URL check: every URL must be in the allow-list.
  const urls = body.match(URL_RE) ?? [];
  const allowed = new Set(context.allowedUrls.map((u) => u.replace(/[).,]+$/, "")));
  for (const url of urls) {
    const cleaned = url.replace(/[).,]+$/, "");
    if (!allowed.has(cleaned)) failures.push(`${label}: contains a URL not in the allowed set (${cleaned})`);
  }
  // Account state must be shown.
  if (!/\*\*account:?\*\*/i.test(body) && !/account/i.test(body)) failures.push(`${label}: account state is not shown`);
  return failures;
}

export function validateMessageQuality(params: { salesMarkdown: string; technicalMarkdown: string; context: MessageQualityContext }): MessageQualityResult {
  const failures: string[] = [];
  failures.push(...validateOneMessage("sales", params.salesMarkdown, params.context));
  failures.push(...validateOneMessage("technical", params.technicalMarkdown, params.context));

  // Sales-specific richness (only enforced for routes that should be rich).
  if (params.context.requireRichBrief) {
    if (!/opportunity thesis/i.test(params.salesMarkdown)) failures.push("sales: missing opportunity thesis");
    if (!/meddpicc|economic buyer|decision criteria/i.test(params.salesMarkdown)) failures.push("sales: missing MEDDPICC");
    if (countActionBullets(params.salesMarkdown) < 3) failures.push("sales: fewer than three specific next actions");
    if (params.context.verdict === "HIGH_INTENT" && countWhyNowBullets(params.salesMarkdown) < 3) failures.push("sales: fewer than three why-now signals for a HIGH_INTENT verdict");
    if (countActionBullets(params.technicalMarkdown) < 3) failures.push("technical: fewer than three specific next actions");
  }

  // Sales and technical must be materially different.
  if (bodyOverlap(params.salesMarkdown, params.technicalMarkdown) > 0.7) failures.push("sales and technical messages are not materially different");

  return { valid: failures.length === 0, failures };
}
