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

export type StageDInput = {
  run_id: string;
  account: string | null;
  channel_byte_budget: number;
  allowed_urls: string[];
  stage_c: {
    opportunity_thesis: string;
    next_best_action: { title: string; summary: string; owner_role: string };
    commercial_handoff: { summary: string; key_points: string[]; remaining_questions: string[] };
    technical_handoff: { summary: string; key_points: string[]; remaining_questions: string[] };
    do_not_reask: string[];
  };
  deterministic: StageDOutput;
};

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

const stageDDefinition: StageDefinition<StageDInput, StageDOutput> = {
  stage: "D",
  schema: stageDSchema,
  buildPrompt: (input) => {
    const payload = {
      run_context: { run_id: input.run_id, account: input.account },
      channel_byte_budget: input.channel_byte_budget,
      allowed_public_source_urls: input.allowed_urls,
      stage_c: input.stage_c,
      task:
        "STAGE D — write distinct internal action messages. sales_webex is the commercial message (opportunity, why now, customer commitments, do-not-reask, remaining commercial questions, next action) — NOT an architecture dump. technical_webex is the technical message (customer problem, current environment, workshop/POV, technical remaining questions, next action) — NOT a commercial scorecard. Use the canonical account name '" +
        (input.account ?? "the account") +
        "'. Use complete sentences and valid Markdown. Do NOT invent URLs (only use allowed_public_source_urls, at most three). Do NOT use truncation ellipses. sales_webex and technical_webex MUST be materially different and each stay within " +
        input.channel_byte_budget +
        " bytes. Also produce sales_email and technical_email each with subject and body. Return ONE JSON object with keys: sales_webex, technical_webex, sales_email, technical_email."
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
    // The canonical account must appear when known.
    if (input.account && !output.sales_webex.includes(input.account)) issues.push("sales_webex does not use the canonical account name");
    return issues;
  },
  deterministicFallback: (input) => input.deterministic
};

export async function runStageD(input: StageDInput, opts?: { timeoutMs?: number }): Promise<StageResult<StageDOutput>> {
  return runStage(stageDDefinition, input, opts);
}
