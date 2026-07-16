import { z } from "zod";
import { runStage } from "@/lib/circuit/stages/stageRunner";
import { invalidUrls } from "@/lib/circuit/stages/evidenceValidator";
import type { StageDefinition, StageResult } from "@/lib/circuit/stages/types";

/**
 * Stage D — recipient-specific message synthesis (Phase 6). Circuit drafts
 * the distinct commercial (Bella) and technical (Jack) messages + emails
 * from the validated Stage C result. Message validation is enforced here:
 * canonical account, no invented URLs, no truncation ellipsis, complete
 * sentences, within the channel byte budget, and sales ≠ technical. The
 * deterministic message builder output is the fallback.
 */

const emailSchema = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { subject: String(o.subject ?? o.title ?? ""), body: String(o.body ?? o.text ?? o.content ?? "") };
  }
  return v;
}, z.object({ subject: z.string(), body: z.string() }));

export const stageDSchema = z.object({
  sales_webex: z.string().min(1),
  technical_webex: z.string().min(1),
  sales_email: emailSchema,
  technical_email: emailSchema
});

export type StageDOutput = z.infer<typeof stageDSchema>;

/** Real, evidence-derived material for the messages (the deterministic
 * opportunity brief). Circuit rewrites this into polished prose using the
 * required section skeleton — it must NOT add signals, actions, metrics,
 * names, or URLs that are not present here. */
export type StageDBrief = {
  opportunity_thesis: string;
  why_now: string[];
  meddpicc_lines: string[];
  stakeholder_lines: string[];
  sales_actions: string[];
  technical_actions: string[];
  top_risks: string[];
  do_not_reask: string[];
};

export type StageDInput = {
  run_id: string;
  account: string | null;
  channel_byte_budget: number;
  allowed_urls: string[];
  brief: StageDBrief;
  deterministic: StageDOutput;
};

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * The delivery quality gate (@/lib/webex/messageQuality) requires specific
 * section headings; Circuit must produce them so its drafts are actually
 * preferred over the deterministic builder. These are the exact heading tokens
 * the gate looks for.
 */
const SALES_SKELETON = [
  "**Account:** <canonical account>",
  "",
  "**Opportunity thesis**",
  "<1-2 sentences from opportunity_thesis>",
  "",
  "**Why now**",
  "- <one bullet per provided why_now signal>",
  "",
  "**MEDDPICC**",
  "- <compact lines from meddpicc_lines; name the economic buyer / decision criteria state>",
  "",
  "**Recommended next actions**",
  "- <one bullet per provided sales_actions item>"
].join("\n");

const TECHNICAL_SKELETON = [
  "**Account:** <canonical account>",
  "",
  "**Customer problem & environment**",
  "- <points from stakeholder_lines / top_risks that are technical>",
  "",
  "**Recommended next actions**",
  "- <one bullet per provided technical_actions item>"
].join("\n");

const stageDDefinition: StageDefinition<StageDInput, StageDOutput> = {
  stage: "D",
  schema: stageDSchema,
  buildPrompt: (input) => {
    const payload = {
      run_context: { run_id: input.run_id, account: input.account },
      channel_byte_budget: input.channel_byte_budget,
      allowed_public_source_urls: input.allowed_urls,
      material: input.brief,
      required_sales_skeleton: SALES_SKELETON,
      required_technical_skeleton: TECHNICAL_SKELETON,
      task:
        "STAGE D — write two DISTINCT internal action messages by rewriting the provided `material` into polished Markdown. " +
        "sales_webex is the commercial message and MUST use exactly these section headings in order: '**Account:**', '**Opportunity thesis**', '**Why now**', '**MEDDPICC**', '**Recommended next actions**'. " +
        "technical_webex is the technical message and MUST use exactly these headings in order: '**Account:**', '**Customer problem & environment**', '**Recommended next actions**'. " +
        "Under '**Why now**' write ONE bullet for EACH provided why_now signal; under each '**Recommended next actions**' write ONE bullet for EACH provided action for that lane. " +
        "STRICT: use ONLY the provided material — do NOT invent signals, actions, metrics, names, dates, or URLs. Do NOT add a bullet that is not backed by the material. If the material has fewer than three why-now signals or actions, include only those provided (the system will fall back to the deterministic message when a lane is too thin). " +
        "Use the canonical account name '" + (input.account ?? "the account") + "' in the '**Account:**' line of BOTH messages. " +
        "Use complete sentences and valid Markdown. Do NOT invent URLs (only use allowed_public_source_urls, at most three). Do NOT use truncation ellipses. sales_webex and technical_webex MUST be materially different and each stay within " +
        input.channel_byte_budget + " bytes. " +
        "Also produce sales_email and technical_email, each with a subject and a body that mirrors the matching Webex message. Return ONE JSON object with keys: sales_webex, technical_webex, sales_email, technical_email."
    };
    return JSON.stringify(payload);
  },
  validate: (output, input) => {
    const issues: string[] = [];
    if (output.sales_webex.trim() === output.technical_webex.trim()) issues.push("sales and technical messages are identical");
    for (const [label, msg] of [["sales_webex", output.sales_webex], ["technical_webex", output.technical_webex]] as const) {
      if (msg.includes("…")) issues.push(`${label} contains a truncation ellipsis`);
      if (byteLength(msg) > input.channel_byte_budget) issues.push(`${label} exceeds the byte budget (${byteLength(msg)} > ${input.channel_byte_budget})`);
    }
    const badUrls = invalidUrls(output, input.allowed_urls);
    if (badUrls.length > 0) issues.push(`invented URLs: ${badUrls.slice(0, 4).join(", ")}`);
    // The canonical account must appear in BOTH messages when known.
    if (input.account && !output.sales_webex.includes(input.account)) issues.push("sales_webex does not use the canonical account name");
    if (input.account && !output.technical_webex.includes(input.account)) issues.push("technical_webex does not use the canonical account name");
    // Structural headings the delivery gate requires (presence only — never a
    // bullet-count requirement here, so the model is never pushed to fabricate).
    const salesLc = output.sales_webex.toLowerCase();
    if (!salesLc.includes("opportunity thesis")) issues.push("sales_webex is missing the '**Opportunity thesis**' section");
    if (!/meddpicc|economic buyer|decision criteria/.test(salesLc)) issues.push("sales_webex is missing the MEDDPICC section");
    if (!/next action|recommended next/.test(salesLc)) issues.push("sales_webex is missing the '**Recommended next actions**' section");
    if (input.brief.why_now.length > 0 && !salesLc.includes("why now")) issues.push("sales_webex is missing the '**Why now**' section");
    if (!/next action|recommended next/.test(output.technical_webex.toLowerCase())) issues.push("technical_webex is missing the '**Recommended next actions**' section");
    return issues;
  },
  deterministicFallback: (input) => input.deterministic
};

export async function runStageD(input: StageDInput, opts?: { timeoutMs?: number }): Promise<StageResult<StageDOutput>> {
  return runStage(stageDDefinition, input, opts);
}
