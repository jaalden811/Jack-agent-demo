import { readFileSync } from "node:fs";
import path from "node:path";
import type { OpportunityTeaser } from "@/lib/personalization/types";

/**
 * Config-driven quality gate for the personalized opportunity teaser. Reads
 * signal-agent-poc/config/message_quality_policy.json. Distinct from the
 * delivery-time Circuit Stage D gate (webex/messageQuality). Rejects teasers
 * that lack a specific action / why-you / why-now, exceed the budget, contain
 * a vague action, an ellipsis, an incomplete sentence, more than the allowed
 * evidence points, or private compensation text.
 */

type TeaserPolicy = {
  teaser: { min_chars: number; max_chars: number; max_bytes: number; max_evidence_points: number; max_links: number; max_actions: number; density_char_budgets: Record<string, number> };
  required_elements: string[];
  vague_actions: string[];
  forbidden: { ellipsis: boolean; raw_search_snippets: boolean; debug_language: boolean; private_compensation: boolean; incomplete_sentence: boolean };
};

const CONFIG_RELATIVE_PATH = "signal-agent-poc/config/message_quality_policy.json";
let cached: TeaserPolicy | null = null;
export function clearTeaserPolicyCache(): void {
  cached = null;
}
export function loadTeaserPolicy(): TeaserPolicy {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(path.join(process.cwd(), CONFIG_RELATIVE_PATH), "utf8")) as TeaserPolicy;
  return cached;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

const PRIVATE_COMP_PATTERNS = [/\bquota\b/i, /\bannual target\b/i, /\battainment\b/i, /\bcompensation\b/i, /\bcommission\b/i];
const DEBUG_PATTERNS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bTODO\b/, /console\./];

export type TeaserQualityResult = { valid: boolean; failures: string[] };

/** density controls only which budget applies; concise is the default. */
export function validateTeaser(teaser: OpportunityTeaser, density: "concise" | "standard" | "detailed" = "concise", opts: { allowOwnerPrivate?: boolean } = {}): TeaserQualityResult {
  const policy = loadTeaserPolicy();
  const failures: string[] = [];
  const budget = policy.teaser.density_char_budgets[density] ?? policy.teaser.max_chars;

  const combined = [teaser.why_you, teaser.why_now, teaser.recommended_action, teaser.expected_output, teaser.goal_alignment ?? "", teaser.goal_impact ?? "", ...teaser.evidence_points.map((e) => e.text)].join(" ").trim();

  if (!teaser.why_you || teaser.why_you.trim().length < 8) failures.push("missing why_you");
  if (!teaser.why_now || teaser.why_now.trim().length < 8) failures.push("missing why_now");
  if (!teaser.recommended_action || teaser.recommended_action.trim().length < 8) failures.push("missing recommended_action");

  for (const vague of policy.vague_actions) {
    if (teaser.recommended_action.toLowerCase().trim() === vague.toLowerCase() || teaser.recommended_action.toLowerCase().includes(vague.toLowerCase())) {
      failures.push(`vague action: "${vague}"`);
      break;
    }
  }

  if (teaser.evidence_points.length > policy.teaser.max_evidence_points) failures.push(`more than ${policy.teaser.max_evidence_points} evidence points`);
  if (combined.length > Math.min(budget, policy.teaser.max_chars)) failures.push(`exceeds char budget (${combined.length} > ${Math.min(budget, policy.teaser.max_chars)})`);
  if (byteLength(combined) > policy.teaser.max_bytes) failures.push("exceeds byte budget");

  if (policy.forbidden.ellipsis && /(\.\.\.|…)/.test(combined)) failures.push("contains ellipsis / truncation");
  if (policy.forbidden.incomplete_sentence) {
    for (const [label, text] of [["why_you", teaser.why_you], ["why_now", teaser.why_now], ["recommended_action", teaser.recommended_action]] as const) {
      if (text && !/[.!?]"?$/.test(text.trim())) failures.push(`${label} ends mid-sentence`);
    }
  }
  if (policy.forbidden.debug_language && DEBUG_PATTERNS.some((re) => re.test(combined))) failures.push("contains debug language");
  if (policy.forbidden.private_compensation && !opts.allowOwnerPrivate && PRIVATE_COMP_PATTERNS.some((re) => re.test(combined))) failures.push("contains private compensation details");

  const links = combined.match(/https?:\/\//g)?.length ?? 0;
  if (links > policy.teaser.max_links) failures.push(`more than ${policy.teaser.max_links} links`);

  return { valid: failures.length === 0, failures };
}
