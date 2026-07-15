import { createHash } from "node:crypto";
import { ingestTranscript } from "@/lib/signal-agent/transcript";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { StageAInput, StageAOutput } from "@/lib/circuit/stages/stageA";

/**
 * Builds a Stage A input (and its deterministic-fallback output) from an
 * already-computed run result. Circuit enriches this; if Circuit is
 * unavailable or invalid, the deterministic extraction below is used
 * verbatim. Every deterministic evidence id it cites is drawn from the
 * generic-signal evidence ids, so the fallback always passes validation.
 */

const SIDE_MAP: Record<string, StageAOutput["speaker_classifications"][number]["side"]> = {
  customer: "customer",
  vendor: "internal_vendor",
  partner: "partner",
  internal: "internal_vendor",
  unknown: "unknown"
};

export function buildStageAInput(result: SecureNetworkingTriageResult): StageAInput {
  // Real transcript turns (re-parsed) give Circuit citable turn ids.
  const rawText = result.transcript_meta?.raw_text ?? "";
  const transcript_turns = rawText
    ? ingestTranscript(rawText).sentences.map((s) => ({
        id: `t${s.index}`,
        speaker: s.speaker,
        side_hint: s.isCustomer ? "customer" : "vendor_or_unknown",
        text: s.text
      }))
    : [];

  // Evidence = all deterministic generic signals (id + text + category).
  const buckets = result.generic_diagnostics?.signals;
  const evidence = buckets
    ? [...buckets.commercial, ...buckets.technical, ...buckets.ownership, ...buckets.next_steps].map((s) => ({ evidence_id: s.evidence_id, text: s.text, category: s.category }))
    : [];
  const evidenceIds = new Set(evidence.map((e) => e.evidence_id));

  // Deterministic Stage A output (the fallback), citing only real ids.
  const commitments = buckets ? buckets.next_steps.map((s) => ({ statement: s.text, evidence_ids: [s.evidence_id] })) : [];
  const pain = buckets ? buckets.technical.filter((s) => s.category === "risk" || s.category === "current_environment").map((s) => ({ statement: s.text, evidence_ids: [s.evidence_id] })) : [];
  const facts = buckets ? buckets.commercial.map((s) => ({ statement: s.text, evidence_ids: [s.evidence_id] })) : [];

  const deterministic: StageAOutput = {
    organization_candidates: result.account_resolution?.name
      ? [{ name: result.account_resolution.name, confidence: result.account_resolution.confidence ?? 0, evidence_ids: [] }]
      : [],
    speaker_classifications: (result.stakeholder_analysis?.participants ?? []).map((p) => ({
      speaker: p.name,
      side: SIDE_MAP[p.classification] ?? "unknown",
      rationale: "",
      evidence_ids: []
    })),
    customer_facts: facts,
    customer_pain: pain,
    customer_commitments: commitments,
    vendor_questions: [],
    vendor_recommendations: [],
    stakeholders: (result.stakeholders ?? []).map((s) => ({ name: s.name, role: s.role, side: "customer", evidence_ids: [] })),
    answered_questions: (result.question_index?.answered ?? []).map((a) => ({
      topic: a.topic,
      question: a.question,
      answer: a.answer,
      evidence_ids: a.evidence_ids.filter((id) => evidenceIds.has(id))
    })),
    open_questions: (result.question_index?.open ?? []).map((q) => ({ topic: q.purpose, question: q.question, answer: "", evidence_ids: q.evidence_ids.filter((id) => evidenceIds.has(id)) })),
    contradictions: (result.question_index?.contradictory ?? []).map((c) => ({ statement: c.resolution_question, evidence_ids: c.evidence_ids.filter((id) => evidenceIds.has(id)) }))
  };

  const transcriptHash = createHash("sha256").update(result.transcript_meta?.raw_text ?? "").digest("hex").slice(0, 16);

  return {
    run_id: result.run_id,
    transcript_hash: transcriptHash,
    transcript_turns,
    account_candidates: result.account_resolution?.name ? [{ name: result.account_resolution.name, confidence: result.account_resolution.confidence ?? 0 }] : [],
    evidence,
    deterministic
  };
}
