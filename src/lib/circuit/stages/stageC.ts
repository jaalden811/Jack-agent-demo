import { z } from "zod";
import { runStage } from "@/lib/circuit/stages/stageRunner";
import { invalidEvidenceIds } from "@/lib/circuit/stages/evidenceValidator";
import type { StageDefinition, StageResult } from "@/lib/circuit/stages/types";

/**
 * Stage C — qualification, authority, action, and handoff synthesis
 * (Phase 4). Circuit produces the evidence-backed NARRATIVE: facts /
 * inferences / MEDDPICC interpretation / opportunity thesis / risks /
 * Next Best Action / commercial + technical handoffs / do-not-reask /
 * remaining questions.
 *
 * NUMERIC SAFETY: the deterministic signal/qualification/external-fit/
 * pursuit scores and the decision/deal-maturity STAGE are supplied as
 * read-only context and are deliberately NOT part of Circuit's output
 * schema — so Circuit can explain them but can never change the
 * arithmetic. Evidence IDs are validated against the input.
 */

const strList = z.preprocess((v) => {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
  if (v === null || v === undefined) return [];
  return v;
}, z.array(z.string()));

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

const evidenceCited = z.preprocess((v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return { statement: pick(o, ["statement", "text", "fact", "claim"]) ?? "", evidence_ids: pick(o, ["evidence_ids", "evidence", "evidence_id"]) ?? [] };
  }
  if (typeof v === "string") return { statement: v, evidence_ids: [] };
  return v;
}, z.object({ statement: z.string().min(1), evidence_ids: strList }));

const meddpiccDim = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      status: String(pick(o, ["status"]) ?? "MISSING"),
      summary: String(pick(o, ["summary", "text"]) ?? ""),
      evidence_ids: pick(o, ["evidence_ids", "evidence"]) ?? [],
      next_question: String(pick(o, ["next_question", "question"]) ?? "")
    };
  }
  return v;
}, z.object({ status: z.string(), summary: z.string(), evidence_ids: strList, next_question: z.string().optional().default("") }));

const nextBestAction = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      action_type: String(pick(o, ["action_type", "type"]) ?? ""),
      title: String(pick(o, ["title"]) ?? ""),
      summary: String(pick(o, ["summary", "description"]) ?? ""),
      owner_role: String(pick(o, ["owner_role", "owner", "owner_lane"]) ?? ""),
      timing_basis: String(pick(o, ["timing_basis", "due_basis", "timing"]) ?? ""),
      success_criteria: pick(o, ["success_criteria"]) ?? [],
      evidence_ids: pick(o, ["evidence_ids", "evidence"]) ?? []
    };
  }
  return v;
}, z.object({ action_type: z.string(), title: z.string(), summary: z.string().min(1), owner_role: z.string(), timing_basis: z.string().optional().default(""), success_criteria: strList, evidence_ids: strList }));

const handoff = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      summary: String(pick(o, ["summary", "brief", "ninety_second_brief"]) ?? ""),
      key_points: pick(o, ["key_points", "points", "already_known"]) ?? [],
      remaining_questions: pick(o, ["remaining_questions", "open_questions"]) ?? [],
      evidence_ids: pick(o, ["evidence_ids", "evidence"]) ?? []
    };
  }
  return v;
}, z.object({ summary: z.string().min(1), key_points: strList, remaining_questions: strList, evidence_ids: strList }));

export const stageCSchema = z.object({
  facts: z.array(evidenceCited),
  inferences: z.array(evidenceCited),
  missing_information: strList,
  meddpicc: z.record(z.string(), meddpiccDim),
  opportunity_thesis: z.string(),
  deal_maturity_interpretation: z.string().optional().default(""),
  product_role_narrative: strList,
  risks: strList,
  next_best_action: nextBestAction,
  commercial_handoff: handoff,
  technical_handoff: handoff,
  do_not_reask: strList,
  remaining_questions: strList
});

export type StageCOutput = z.infer<typeof stageCSchema>;

export type StageCInput = {
  run_id: string;
  account: string | null;
  /** Read-only deterministic scores/decision — Circuit explains, never changes. */
  existing_scores: { signal_strength: number; qualification: number; external_fit: number | null; pursuit_decision: string; deal_maturity: string };
  stage_a_summary: unknown;
  stage_b_summary: unknown;
  evidence: Array<{ evidence_id: string; text: string }>;
  taxonomy_candidates: string[];
  deterministic: StageCOutput;
};

export function allowedStageCEvidenceIds(input: StageCInput): Set<string> {
  return new Set(input.evidence.map((e) => e.evidence_id));
}

const stageCDefinition: StageDefinition<StageCInput, StageCOutput> = {
  stage: "C",
  schema: stageCSchema,
  buildPrompt: (input) => {
    const payload = {
      run_context: { run_id: input.run_id, account: input.account },
      existing_scores: input.existing_scores,
      stage_a: input.stage_a_summary,
      stage_b: input.stage_b_summary,
      deterministic_evidence: input.evidence,
      taxonomy_candidates: input.taxonomy_candidates,
      task:
        "STAGE C — qualification, authority, action, and handoff synthesis. Explain (do NOT change) the supplied existing_scores and deal_maturity. Produce evidence-backed output. " +
        "MEDDPICC RULES: qualify from CUSTOMER evidence only. A seller's question NEVER confirms a dimension — do not treat a seller asking about renewal, budget, replacement, competition, or the economic buyer as evidence those exist. Use MISSING when only the seller raised it; DISTRIBUTED when authority is spread with no single named buyer; HYPOTHESIS for a plausible-but-unconfirmed read; PARTIAL when some customer evidence exists but it is incomplete; CONFIRMED only with clear customer evidence. " +
        "NEXT BEST ACTION: derive it from what the CUSTOMER actually requested or agreed. A customer's cautionary/skeptical statement about a vendor capability (accuracy, maintainability, cost, data access, sovereignty) is a risk/objection — it is NOT the agreed next step, the due basis, or a why-now event. timing_basis must reflect a real customer-stated timing driver. " +
        "do_not_reask MUST list the specific topics the customer already answered (so the specialist does not re-ask them). remaining_questions MUST list the genuinely unresolved questions. Both must be non-empty when the transcript supports them. " +
        "Every evidence_ids array must reference ONLY the supplied deterministic_evidence ids (use [] when none). Reject vague actions like 'follow up'. commercial_handoff and technical_handoff MUST differ materially. Do NOT invent evidence, people, or scores. Return ONE JSON object with EXACTLY these keys and item shapes: " +
        JSON.stringify({
          facts: [{ statement: "string", evidence_ids: ["string"] }],
          inferences: [{ statement: "string", evidence_ids: ["string"] }],
          missing_information: ["string"],
          meddpicc: { metrics: { status: "CONFIRMED|PARTIAL|DISTRIBUTED|HYPOTHESIS|MISSING|CONFLICTING", summary: "string", evidence_ids: ["string"], next_question: "string" }, economic_buyer: {}, decision_criteria: {}, decision_process: {}, paper_process: {}, identify_pain: {}, champion: {}, competition: {} },
          opportunity_thesis: "string",
          deal_maturity_interpretation: "string",
          product_role_narrative: ["string"],
          risks: ["string"],
          next_best_action: { action_type: "string", title: "string", summary: "string", owner_role: "string", timing_basis: "string", success_criteria: ["string"], evidence_ids: ["string"] },
          commercial_handoff: { summary: "string", key_points: ["string"], remaining_questions: ["string"], evidence_ids: ["string"] },
          technical_handoff: { summary: "string", key_points: ["string"], remaining_questions: ["string"], evidence_ids: ["string"] },
          do_not_reask: ["string"],
          remaining_questions: ["string"]
        })
    };
    return JSON.stringify(payload);
  },
  validate: (output, input) => {
    const issues: string[] = [];
    const bad = invalidEvidenceIds(output, allowedStageCEvidenceIds(input));
    if (bad.length > 0) issues.push(`cited evidence ids not present in input: ${bad.slice(0, 6).join(", ")}`);
    // Commercial and technical handoffs must differ materially.
    if (output.commercial_handoff.summary && output.commercial_handoff.summary === output.technical_handoff.summary) {
      issues.push("commercial and technical handoffs are identical");
    }
    return issues;
  },
  deterministicFallback: (input) => input.deterministic
};

export async function runStageC(input: StageCInput, opts?: { timeoutMs?: number }): Promise<StageResult<StageCOutput>> {
  return runStage(stageCDefinition, input, opts);
}
