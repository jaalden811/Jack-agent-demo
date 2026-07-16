import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Pre-delivery message-quality validator. The delivered Webex/Outlook message
 * is a CONCISE, action-first nudge — not a full brief. The rich MEDDPICC /
 * decision-packet detail lives in the app; the push message only has to be
 * clear, complete, within a tight budget, and grounded (no invented URLs /
 * secrets). This gate now REWARDS conciseness (and rejects over-budget "wall
 * of text" messages) so Circuit Stage D's concise drafts are the delivered
 * message. Every check is generic — structure/provenance, never a specific
 * company/product/score. Budgets/vague-action lexicon are config-driven
 * (signal-agent-poc/config/message_quality_policy.json).
 */

export type MessageQualityContext = {
  verdict: "HIGH_INTENT" | "REVIEW" | "NOISE";
  /** URLs that are legitimately allowed to appear (the validated public
   * analysis link + any real SerpAPI-returned source URLs). Any other URL is
   * treated as invented. */
  allowedUrls: string[];
  /** Absolute hard channel character ceiling (provider limit). */
  charCeiling: number;
  /** Absolute hard channel byte ceiling (provider limit is 7,439 bytes). */
  byteCeiling: number;
  /** Canonical account name — when provided, the message must reference it by
   * name (stronger than merely containing the word "account"). */
  account?: string | null;
};

export type MessageQualityResult = { valid: boolean; failures: string[] };

type DeliveryMessagePolicy = {
  min_chars: number;
  max_chars: number;
  max_bytes: number;
  required_sections: string[];
  require_why_now: boolean;
};

type MessageQualityPolicy = { delivery_message: DeliveryMessagePolicy; vague_actions: string[] };

let cachedPolicy: MessageQualityPolicy | null = null;

export function clearMessageQualityPolicyCache(): void {
  cachedPolicy = null;
}

function loadPolicy(): MessageQualityPolicy {
  if (cachedPolicy) return cachedPolicy;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "message_quality_policy.json");
  cachedPolicy = JSON.parse(readFileSync(filePath, "utf8")) as MessageQualityPolicy;
  return cachedPolicy;
}

const URL_RE = /https?:\/\/[^\s)]+/gi;
const SECRET_RES = [/sk-[A-Za-z0-9_-]{16,}/, /\bBearer\s+[A-Za-z0-9._-]{16,}/i, /api[_-]?key\s*[=:]\s*\S{12,}/i];

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function normalizeForCompare(markdown: string): string {
  return markdown
    .replace(/you received this because[\s\S]*$/i, "")
    .replace(/\*\*analysis reference[\s\S]*$/i, "")
    .replace(/\[open full analysis\]\([^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Jaccard token overlap of the two lane bodies — a high overlap means the
 * sales and technical messages are not materially different. */
function bodyOverlap(a: string, b: string): number {
  const tokensA = new Set(normalizeForCompare(a).split(" ").filter((t) => t.length > 3));
  const tokensB = new Set(normalizeForCompare(b).split(" ").filter((t) => t.length > 3));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

const ACTION_HEADING_RE = /\b(recommended action|recommended next action|do next|do this|next action|next step|you own)\b/i;

function validateOneMessage(label: string, markdown: string, context: MessageQualityContext, policy: DeliveryMessagePolicy, vagueActions: string[]): string[] {
  const failures: string[] = [];
  const body = (markdown ?? "").trim();
  if (body.length === 0) {
    failures.push(`${label}: empty message`);
    return failures;
  }
  if (body.length < policy.min_chars) failures.push(`${label}: too short to be actionable (${body.length} < ${policy.min_chars})`);
  // Complete messages only — a mid-content ellipsis means a field was cut.
  if (body.includes("…")) failures.push(`${label}: contains a truncation ellipsis (message field was cut)`);

  // Tight, action-first budget: reject "wall of text". The effective cap is
  // the tighter of the config budget and the absolute channel ceiling.
  const charCap = Math.min(policy.max_chars, context.charCeiling);
  const byteCap = Math.min(policy.max_bytes, context.byteCeiling);
  if (body.length > charCap) failures.push(`${label}: too detailed — exceeds the concise budget (${body.length} > ${charCap} chars)`);
  if (byteLength(body) > byteCap) failures.push(`${label}: exceeds the byte budget (${byteLength(body)} > ${byteCap})`);

  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(body)) failures.push(`${label}: contains a localhost/loopback link`);
  for (const secretRe of SECRET_RES) {
    if (secretRe.test(body)) failures.push(`${label}: contains a secret-shaped token`);
  }
  const urls = body.match(URL_RE) ?? [];
  const allowed = new Set(context.allowedUrls.map((u) => u.replace(/[).,]+$/, "")));
  for (const url of urls) {
    const cleaned = url.replace(/[).,]+$/, "");
    if (!allowed.has(cleaned)) failures.push(`${label}: contains a URL not in the allowed set (${cleaned})`);
  }

  // Essentials for an action-first message: the account and a clear action.
  if (policy.required_sections.includes("account")) {
    const accountShown = context.account ? body.toLowerCase().includes(context.account.toLowerCase()) : /account/i.test(body);
    if (!accountShown) failures.push(`${label}: account is not referenced`);
  }
  if (policy.required_sections.includes("recommended action") && !ACTION_HEADING_RE.test(body)) failures.push(`${label}: no clear recommended action`);
  // A vague action ("follow up", "touch base") is not an action — checked ONLY
  // on the recommended-action line, so a noun such as "a confirmed follow-up"
  // elsewhere is not a false positive.
  const actionLine = body.split(/\n/).find((l) => ACTION_HEADING_RE.test(l)) ?? "";
  const vague = vagueActions.find((phrase) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(actionLine));
  if (vague) failures.push(`${label}: vague action ("${vague}") — state a specific next step`);
  return failures;
}

export function validateMessageQuality(params: { salesMarkdown: string; technicalMarkdown: string; context: MessageQualityContext }): MessageQualityResult {
  const { delivery_message: policy, vague_actions: vagueActions } = loadPolicy();
  const failures: string[] = [];
  failures.push(...validateOneMessage("sales", params.salesMarkdown, params.context, policy, vagueActions ?? []));
  failures.push(...validateOneMessage("technical", params.technicalMarkdown, params.context, policy, vagueActions ?? []));

  // Both messages must explain why now (timeliness) unless a NOISE route.
  if (policy.require_why_now && params.context.verdict !== "NOISE") {
    if (!/why now/i.test(params.salesMarkdown)) failures.push("sales: missing why-now");
    if (!/why now/i.test(params.technicalMarkdown)) failures.push("technical: missing why-now");
  }

  // Sales and technical must be materially different (role-specific).
  if (bodyOverlap(params.salesMarkdown, params.technicalMarkdown) > 0.7) failures.push("sales and technical messages are not materially different");

  return { valid: failures.length === 0, failures };
}
