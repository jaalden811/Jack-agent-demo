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

/** Per-lane recipient context: who the message is for and why. Role-based and
 * deterministic (never a fabricated person); the delivery layer adds the
 * attendance/delivery-state banner and the concrete collaborator name. */
export type StageDLane = {
  role_label: string;
  why_selected: string;
  collaborator: string;
  actions: string[];
  remaining_questions: string[];
  expected_output: string;
};

/** Real, evidence-derived material for the messages (the deterministic
 * opportunity brief). Circuit rewrites this into polished prose using the
 * required section skeleton — it must NOT add signals, actions, metrics,
 * names, or URLs that are not present here. */
export type StageDBrief = {
  opportunity_thesis: string;
  why_now: string[];
  meddpicc_lines: string[];
  stakeholder_lines: string[];
  top_risks: string[];
  do_not_reask: string[];
  timing: string;
  sales_lane: StageDLane;
  technical_lane: StageDLane;
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
 * Each recipient message answers the full set of questions: why THEY were
 * selected, what happened, what the customer already answered (do-not-re-ask),
 * what remains unknown, the action they own + its expected output, their
 * collaborator, and timing. The delivery quality gate
 * (@/lib/webex/messageQuality) also requires specific heading tokens, so those
 * are kept verbatim in the skeleton.
 */
const SALES_SKELETON = [
  "**Account:** <canonical account>",
  "",
  "**Why you're receiving this** — <sales_lane.role_label>: <sales_lane.why_selected>",
  "",
  "**Opportunity thesis** (what happened)",
  "<1-2 sentences from opportunity_thesis>",
  "",
  "**Why now**",
  "- <one bullet per provided why_now signal>",
  "",
  "**MEDDPICC**",
  "- <compact lines from meddpicc_lines; name the economic buyer / decision criteria state>",
  "",
  "**Customer already told us — do not re-ask**",
  "- <one bullet per provided do_not_reask item>",
  "",
  "**Still unknown**",
  "- <one bullet per provided sales_lane.remaining_questions item>",
  "",
  "**Recommended next actions (you own)**",
  "- <one bullet per provided sales_lane.actions item>",
  "",
  "**Expected output** — <sales_lane.expected_output>",
  "**Collaborator** — <sales_lane.collaborator>",
  "**Timing** — <timing>"
].join("\n");

const TECHNICAL_SKELETON = [
  "**Account:** <canonical account>",
  "",
  "**Why you're receiving this** — <technical_lane.role_label>: <technical_lane.why_selected>",
  "",
  "**Customer problem & environment**",
  "- <points from stakeholder_lines / top_risks that are technical>",
  "",
  "**Customer already told us — do not re-ask**",
  "- <one bullet per provided do_not_reask item>",
  "",
  "**Still unknown**",
  "- <one bullet per provided technical_lane.remaining_questions item>",
  "",
  "**Recommended next actions (you own)**",
  "- <one bullet per provided technical_lane.actions item>",
  "",
  "**Expected output** — <technical_lane.expected_output>",
  "**Collaborator** — <technical_lane.collaborator>",
  "**Timing** — <timing>"
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
        "STAGE D — write two DISTINCT, recipient-specific internal action messages by rewriting the provided `material` into polished Markdown. Each message tells ONE owner why they were selected, what happened, what the customer already answered (do not re-ask), what remains unknown, the action they own and its expected output, their collaborator, and the timing. " +
        "sales_webex is the commercial owner's message and MUST use exactly these headings in order: '**Account:**', \"**Why you're receiving this**\", '**Opportunity thesis**', '**Why now**', '**MEDDPICC**', '**Customer already told us — do not re-ask**', '**Still unknown**', '**Recommended next actions (you own)**', '**Expected output**', '**Collaborator**', '**Timing**'. " +
        "technical_webex is the technical owner's message and MUST use exactly these headings in order: '**Account:**', \"**Why you're receiving this**\", '**Customer problem & environment**', '**Customer already told us — do not re-ask**', '**Still unknown**', '**Recommended next actions (you own)**', '**Expected output**', '**Collaborator**', '**Timing**'. " +
        "Under bulleted sections write ONE bullet per provided material item; use material.sales_lane / material.technical_lane for that lane's role_label, why_selected, actions, remaining_questions, expected_output, collaborator, and material.timing for timing. " +
        "STRICT: use ONLY the provided material — do NOT invent signals, actions, metrics, names, dates, or URLs, and do NOT add a bullet not backed by the material. If a lane's material is too thin, include only what is provided (the system falls back to the deterministic message). " +
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
