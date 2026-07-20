import { z } from "zod";
import { runStage } from "@/lib/circuit/stages/stageRunner";
import { invalidUrls } from "@/lib/circuit/stages/evidenceValidator";
import type { StageDefinition, StageResult } from "@/lib/circuit/stages/types";
import type { PersonalizationContext } from "@/lib/personalization/types";

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
  /** The internal next move for THIS owner (coordination/prep, not the customer
   * step) — Stage D must lead with it. Optional/additive. */
  internal_move?: string;
  /** Who to loop in internally, why, and what to prepare. Optional/additive. */
  coordinate_with?: Array<{ who: string; why: string; prepare: string[] }>;
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
  /** Deal Intelligence (honest, evidence-cited) — lets the message open with
   * the deal shape and respect the top landmine. Optional/additive. */
  deal_shape?: string;
  deal_momentum?: string[];
  deal_watch_outs?: string[];
  value_hypothesis?: string | null;
  /** The business champion + how to arm them (commercial lane). Optional. */
  champion?: string | null;
  /** Distilled public research facts (with source) — one punchy account line. */
  public_context?: string[];
  /** The single most compelling quantified metric in digits (baseline→target). */
  headline_metric?: string | null;
  /** The honest timing driver (decision boundary vs procurement). */
  timing_driver?: { label: string; is_procurement: boolean } | null;
};

export type StageDInput = {
  run_id: string;
  account: string | null;
  channel_byte_budget: number;
  allowed_urls: string[];
  brief: StageDBrief;
  /** Safe recipient personalization context — used ONLY for salience/tone;
   * never invents goal/quota impact and never exposes private compensation. */
  personalization_context?: PersonalizationContext | null;
  deterministic: StageDOutput;
};

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Concise, action-first recipient messages. The push message is a nudge to
 * act — the full MEDDPICC / decision-packet detail lives in the app, not the
 * notification. Each message: who + why you, why now, the ONE action you own,
 * and the expected outcome. Distinct per lane (commercial vs technical).
 */
const SALES_SKELETON = [
  "**<account>: <material.deal_shape> (<signal band> signal)** — commercial",
  "**Why this matters:** <material.sales_lane.why_selected — the synthesized commercial read, verbatim or lightly tightened>",
  "**Why now:** <material.timing_driver.label if provided (state it honestly — a decision boundary is NOT procurement timing), else material.why_now[0]>",
  "**Your move (internal):** <material.sales_lane.internal_move — what YOU do internally first: who to align with before the customer step>",
  "**Loop in <material.sales_lane.coordinate_with[].who>:** <its why> Ask them to prepare: <its prepare joined with '; '>  (one line per coordinate_with entry; omit if none)",
  "**Customer next step:** <material.sales_lane.actions[0] — the ONE canonical next best action the customer sees, as one clear sentence>",
  "**Expected outcome:** <material.sales_lane.expected_output>",
  "**Metric:** <material.headline_metric — omit this line if not provided>",
  "**Champion:** <material.champion — omit this line if not provided>",
  "**Watch-out:** <the single most important item from deal_watch_outs — omit this line if none>"
].join("\n");

const TECHNICAL_SKELETON = [
  "**<account>: <material.deal_shape> (<signal band> signal)** — technical",
  "**Why this matters:** <material.technical_lane.why_selected — the synthesized technical read (customer problem + environment), verbatim or lightly tightened>",
  "**Why now:** <material.timing_driver.label if provided (state it honestly — a decision boundary is NOT procurement timing), else material.why_now[0]>",
  "**Your move (internal):** <material.technical_lane.internal_move — what YOU do internally first: define the validation architecture and sync with the commercial owner>",
  "**Loop in <material.technical_lane.coordinate_with[].who>:** <its why> Ask them to prepare: <its prepare joined with '; '>  (one line per coordinate_with entry; omit if none)",
  "**Customer next step:** <material.technical_lane.actions[0] — the ONE canonical next best action the customer sees, as one clear sentence>",
  "**Expected outcome:** <material.technical_lane.expected_output>",
  "**Metric:** <material.headline_metric — omit this line if not provided>",
  "**Watch-out:** <the single most technical item from deal_watch_outs — omit this line if none>"
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
      personalization_context: input.personalization_context ?? null,
      required_sales_skeleton: SALES_SKELETON,
      required_technical_skeleton: TECHNICAL_SKELETON,
      task:
        "STAGE D — write two DISTINCT, CONCISE, action-first internal messages by rewriting the provided `material` into polished Markdown. The PRIMARY VALUE is INTERNAL COORDINATION: tell the ONE owner what to do INTERNALLY (who to align with and what they should prepare) BEFORE the customer step — this is not a meeting summary. Keep each message SHORT (aim for 6-8 short lines, well under " +
        input.channel_byte_budget + " bytes). Do NOT include a MEDDPICC dump, an opportunity-thesis paragraph, a do-not-re-ask list, a stakeholder list, or multiple action bullets — that detail lives in the app. " +
        "Each message opens with a hook line '**<account>: <deal_shape> (<signal> signal)** — commercial|technical', then uses these headings in order: '**Why this matters:**', '**Why now:**', '**Your move (internal):**', zero or more '**Loop in <who>:**' lines, '**Customer next step:**', '**Expected outcome:**', optional '**Metric:**', optional (sales only) '**Champion:**', optional '**Watch-out:**'. " +
        "For '**Why this matters:**' use material.<lane>.why_selected — it is ALREADY a synthesized, evidence-grounded read (the commercial account/expansion read for sales; the customer problem + environment for technical); render it verbatim or lightly tightened, never replace it with a generic 'you own the lane' sentence. " +
        "For '**Your move (internal):**' use material.<lane>.internal_move verbatim or lightly tightened — it is the internal coordination step the owner takes first. For each material.<lane>.coordinate_with entry add ONE '**Loop in <who>:**' line stating the why and, when present, 'Ask them to prepare: <prepare joined with ';'>'. These internal lines are the point of the message — never drop them when present. " +
        "For '**Customer next step:**' write material.<lane>.actions[0] — the ONE canonical Next Best Action the customer sees — as one clear sentence; never a bulleted list, never a generic MEDDPICC-gap action ('validate the executive sponsor/budget owner') unless that IS actions[0], never a vague action like 'follow up'. It must be clearly SEPARATE from the internal move. Use material.timing_driver.label else material.why_now[0] for '**Why now:**', and material.<lane>.expected_output for '**Expected outcome:**'. " +
        "If material.deal_shape is provided, add the '**Deal shape:**' line so the owner instantly sees what kind of deal this is. If material.headline_metric is provided, add ONE '**Metric:**' line with it verbatim (it is already in digits, e.g. '96 → under 30 minutes') — it is the crispest reason to act; never round, re-scale, or invent a number. If material.timing_driver is provided, use material.timing_driver.label for '**Why now:**' and state it HONESTLY: a decision/planning boundary is NOT procurement timing and must never be presented as an approved purchase date. If material.deal_watch_outs is non-empty, add ONE '**Watch-out:**' line with the single most important landmine (for technical, prefer a technical/feasibility/sovereignty item; for sales, prefer funding/authority/privacy). For sales_webex only, if material.champion is provided, add the '**Champion:**' line so the commercial owner knows who carries this internally, and if material.public_context is non-empty add ONE '**Account intel:**' line with the single strongest public fact. These sharpen the read — but use ONLY the provided material, never invent a shape, champion, public fact, metric, momentum, or risk. " +
        "The two lanes MUST be materially different: the commercial message emphasizes the account/commercial next step; the technical message emphasizes the environment/workshop scope. " +
        "STRICT: use ONLY the provided material — do NOT invent signals, actions, metrics, names, dates, or URLs. If personalization_context is present, use it ONLY to tune salience/tone (goals/lane/preferred tone) — never invent goal/quota impact, never expose private compensation. " +
        "Use the canonical account name '" + (input.account ?? "the account") + "' in the '**Account:**' line of BOTH messages. Complete sentences, valid Markdown, no truncation ellipses, at most one link (only from allowed_public_source_urls). " +
        "Also produce sales_email and technical_email, each with a subject and a body that mirrors the matching (concise) Webex message. Return ONE JSON object with keys: sales_webex, technical_webex, sales_email, technical_email."
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
    // Canonical account must appear in BOTH messages when known.
    if (input.account && !output.sales_webex.includes(input.account)) issues.push("sales_webex does not use the canonical account name");
    if (input.account && !output.technical_webex.includes(input.account)) issues.push("technical_webex does not use the canonical account name");
    // Essentials for an action-first message (presence only — never a
    // bullet-count requirement, so the model is never pushed to pad).
    for (const [label, msg] of [["sales_webex", output.sales_webex], ["technical_webex", output.technical_webex]] as const) {
      const lc = msg.toLowerCase();
      if (!/recommended action|next action|customer next step/.test(lc)) issues.push(`${label} is missing the '**Customer next step:**' line`);
      if (!lc.includes("why now")) issues.push(`${label} is missing the '**Why now:**' line`);
      if (!/your move|loop in/.test(lc)) issues.push(`${label} is missing the internal coordination ('**Your move (internal):**' / '**Loop in …:**') lines`);
    }
    return issues;
  },
  deterministicFallback: (input) => input.deterministic
};

export async function runStageD(input: StageDInput, opts?: { timeoutMs?: number }): Promise<StageResult<StageDOutput>> {
  return runStage(stageDDefinition, input, opts);
}
