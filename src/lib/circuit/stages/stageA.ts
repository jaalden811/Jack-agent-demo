import { z } from "zod";
import { runStage } from "@/lib/circuit/stages/stageRunner";
import { invalidEvidenceIds } from "@/lib/circuit/stages/evidenceValidator";
import type { StageDefinition, StageResult } from "@/lib/circuit/stages/types";

/**
 * Stage A — transcript / people / evidence extraction (Phase 2). Circuit
 * interprets who spoke, customer vs vendor, customer facts/pain/
 * commitments, seller questions, stakeholders, and answered/open
 * questions — every claim citing evidence IDs that MUST exist in the
 * input. A deterministic extraction (supplied on the input) is the
 * fallback, so the pipeline is complete without Circuit.
 */

// Models vary in the exact JSON they emit; coerce evidence_ids to a
// string[] (accepting a single string, a delimited string, or numbers)
// WITHOUT changing meaning. Invented ids are still rejected downstream.
const evidenceIdList = z.preprocess((v) => {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (v === null || v === undefined) return [];
  return v;
}, z.array(z.string()));

// Accept both the master-prompt vocabulary ("vendor") and the internal
// alias ("internal_vendor"); both denote the seller side.
const speakerSide = z.enum(["customer", "vendor", "internal_vendor", "partner", "unknown"]);

// A confidence that tolerates 0..1 or 0..100 and clamps to 0..1.
const confidence01 = z.preprocess((v) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? Math.min(1, n / 100) : Math.max(0, n);
}, z.number().min(0).max(1));

// Tolerant field aliasing: models vary in exact key names. These
// preprocessors map common synonyms to the canonical fields WITHOUT
// changing meaning, so a well-formed extraction isn't discarded over a
// key-name difference (e.g. name/type vs speaker/side).
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

const evidenceCited = z.preprocess((v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return { statement: pick(o, ["statement", "text", "fact", "claim", "value"]) ?? "", evidence_ids: pick(o, ["evidence_ids", "evidence", "evidence_id"]) ?? [] };
  }
  if (typeof v === "string") return { statement: v, evidence_ids: [] };
  return v;
}, z.object({ statement: z.string().min(1), evidence_ids: evidenceIdList }));

const orgCandidate = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { name: pick(o, ["name", "organization", "org", "company"]) ?? "", confidence: pick(o, ["confidence", "score"]) ?? 0, evidence_ids: pick(o, ["evidence_ids", "evidence", "evidence_id"]) ?? [] };
  }
  return v;
}, z.object({ name: z.string().min(1), confidence: confidence01, evidence_ids: evidenceIdList }));

const speakerClassification = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      speaker: pick(o, ["speaker", "name", "speaker_name", "person"]) ?? "",
      side: pick(o, ["side", "type", "classification", "speaker_side"]) ?? "unknown",
      rationale: pick(o, ["rationale", "reason", "evidence_summary"]) ?? "",
      evidence_ids: pick(o, ["evidence_ids", "evidence", "evidence_id"]) ?? []
    };
  }
  return v;
}, z.object({ speaker: z.string().min(1), side: speakerSide, rationale: z.string().optional().default(""), evidence_ids: evidenceIdList }));

const stakeholder = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      name: pick(o, ["name", "speaker", "person"]) ?? null,
      role: pick(o, ["role", "title", "function", "function_or_role"]) ?? "",
      side: pick(o, ["side", "type", "classification"]) ?? "unknown",
      evidence_ids: pick(o, ["evidence_ids", "evidence", "evidence_id"]) ?? []
    };
  }
  return v;
}, z.object({ name: z.string().nullable(), role: z.string().min(1), side: z.string().optional().default("unknown"), evidence_ids: evidenceIdList }));

const questionEntry = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      topic: pick(o, ["topic", "subject", "area", "question"]) ?? "",
      question: pick(o, ["question", "clarification", "follow_up"]) ?? "",
      answer: pick(o, ["answer", "response", "known"]) ?? "",
      evidence_ids: pick(o, ["evidence_ids", "evidence", "evidence_id"]) ?? []
    };
  }
  return v;
}, z.object({ topic: z.string().min(1), question: z.string().optional().default(""), answer: z.string().optional().default(""), evidence_ids: evidenceIdList }));

export const stageASchema = z.object({
  organization_candidates: z.array(orgCandidate),
  speaker_classifications: z.array(speakerClassification),
  customer_facts: z.array(evidenceCited),
  customer_pain: z.array(evidenceCited),
  customer_commitments: z.array(evidenceCited),
  vendor_questions: z.array(evidenceCited),
  vendor_recommendations: z.array(evidenceCited),
  stakeholders: z.array(stakeholder),
  answered_questions: z.array(questionEntry),
  open_questions: z.array(questionEntry),
  contradictions: z.array(evidenceCited)
});

export type StageAOutput = z.infer<typeof stageASchema>;

export type StageAInput = {
  run_id: string;
  transcript_hash: string;
  transcript_turns: Array<{ id: string; speaker: string | null; side_hint: string; text: string }>;
  account_candidates: Array<{ name: string; confidence: number }>;
  evidence: Array<{ evidence_id: string; text: string; category?: string }>;
  /** Deterministic Stage-A extraction — always valid; used as the fallback
   * and as a comparison baseline. */
  deterministic: StageAOutput;
};

/** The complete set of evidence identifiers Circuit is allowed to cite:
 * transcript turn ids + deterministic evidence ids. */
export function allowedStageAEvidenceIds(input: StageAInput): Set<string> {
  const ids = new Set<string>();
  for (const t of input.transcript_turns) ids.add(t.id);
  for (const e of input.evidence) ids.add(e.evidence_id);
  return ids;
}

const stageADefinition: StageDefinition<StageAInput, StageAOutput> = {
  stage: "A",
  schema: stageASchema,
  buildPrompt: (input) => {
    const payload = {
      run_context: { run_id: input.run_id, transcript_hash: input.transcript_hash },
      transcript_turns: input.transcript_turns,
      account_candidates: input.account_candidates,
      deterministic_evidence: input.evidence,
      task:
        "STAGE A — transcript, people, and evidence extraction. Classify each speaker's side as exactly one of: customer, vendor, partner, unknown (vendor = the internal selling side). " +
        "Decide side from SPEECH BEHAVIOR, not seniority or politeness: " +
        "SELLER/VENDOR signals — frames or opens the meeting; asks discovery or qualification questions (what prompted this, can you quantify impact, is there executive sponsorship, are you considering replacing/renewing, who else should participate, is there a target date); proposes a workshop/demo/next session; says 'we can show'; explains vendor/product capabilities; asks about budget, renewal, replacement, or sponsorship. A speaker who mostly ASKS these questions and never describes owning an internal environment is the seller — even with no explicit product pitch. " +
        "CUSTOMER signals — describes 'our' environment/systems/teams; states internal pain and constraints; owns budget/tools/decisions; accepts or rejects proposed actions; describes decision paths; commits to next steps. " +
        "A seller's question is NEVER customer evidence, and a seller's recommendation is NEVER customer acceptance — keep vendor_questions/vendor_recommendations strictly separate from customer_facts/customer_pain/customer_commitments. " +
        "A customer's skeptical or cautionary statement about a vendor capability (e.g. accuracy, maintainability, cost, data access) is customer_pain or a contradiction/constraint — it is NOT a customer_commitment or an agreed next step. " +
        "Only put a genuine customer-stated or customer-agreed action in customer_commitments. Extract organization candidates, stakeholders (customer-side people only in the buying committee — never the seller), and answered vs open questions. Every array item MUST include an evidence_ids array of strings drawn ONLY from the supplied transcript turn ids (t#) and deterministic_evidence ids (use [] when none). Do not invent evidence ids, people, or organizations. Return ONE JSON object with EXACTLY these keys and EXACTLY these item field names: " +
        JSON.stringify({
          organization_candidates: [{ name: "string", confidence: 0.0, evidence_ids: ["string"] }],
          speaker_classifications: [{ speaker: "string", side: "customer|vendor|partner|unknown", evidence_ids: ["string"] }],
          customer_facts: [{ statement: "string", evidence_ids: ["string"] }],
          customer_pain: [{ statement: "string", evidence_ids: ["string"] }],
          customer_commitments: [{ statement: "string", evidence_ids: ["string"] }],
          vendor_questions: [{ statement: "string", evidence_ids: ["string"] }],
          vendor_recommendations: [{ statement: "string", evidence_ids: ["string"] }],
          stakeholders: [{ name: "string", role: "string", side: "string", evidence_ids: ["string"] }],
          answered_questions: [{ topic: "string", question: "string", answer: "string", evidence_ids: ["string"] }],
          open_questions: [{ topic: "string", question: "string", answer: "string", evidence_ids: ["string"] }],
          contradictions: [{ statement: "string", evidence_ids: ["string"] }]
        })
    };
    return JSON.stringify(payload);
  },
  validate: (output, input) => {
    const issues: string[] = [];
    const bad = invalidEvidenceIds(output, allowedStageAEvidenceIds(input));
    if (bad.length > 0) issues.push(`cited evidence ids not present in input: ${bad.slice(0, 6).join(", ")}`);
    return issues;
  },
  deterministicFallback: (input) => input.deterministic
};

export async function runStageA(input: StageAInput, opts?: { timeoutMs?: number }): Promise<StageResult<StageAOutput>> {
  return runStage(stageADefinition, input, opts);
}
