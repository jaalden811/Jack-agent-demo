import { buildDefaultMeddpicc, emptyMeddpiccField } from "@/lib/qualification/defaults";
import type { ClassifiedPublicResult, Meddpicc, MeddpiccField, MeddpiccKey } from "@/lib/qualification/types";
import type { BuyingIntentEvidence, Stakeholder } from "@/lib/signal-agent/types";

/**
 * Stage C (deterministic, not a model call): merges Stage A's
 * transcript-grounded MEDDPICC with Stage B's public-evidence
 * classifications. Implemented in code — not trusted to a prompt —
 * because the single most important rule here ("public evidence must
 * never confirm a private commercial fact") is exactly the kind of
 * constraint that is more reliable to enforce mechanically than to
 * hope a model obeys.
 *
 * Only Identify Pain, Decision Criteria, and Competition may ever be
 * upgraded by public evidence (and only from MISSING/HYPOTHESIS to
 * PARTIAL — never to CONFIRMED). Metrics, Economic Buyer, Decision
 * Process, Paper Process, and Champion are transcript/CRM/manual-
 * context only, exactly as Stage A (or the deterministic fallback)
 * determined.
 */

const PUBLIC_EVIDENCE_ALLOWED_FIELDS: ReadonlySet<MeddpiccKey> = new Set(["identify_pain", "decision_criteria", "competition"]);

export function mergePublicEvidenceIntoMeddpicc(base: Meddpicc, classifiedResults: ClassifiedPublicResult[]): Meddpicc {
  const merged: Meddpicc = JSON.parse(JSON.stringify(base));

  for (const classified of classifiedResults) {
    if (classified.entity_match === "no_match" || classified.entity_match === "weak") continue;

    for (const relevance of classified.meddpicc_relevance) {
      if (!PUBLIC_EVIDENCE_ALLOWED_FIELDS.has(relevance)) continue; // never touch private-fact fields

      const field = merged[relevance];
      if (field.status === "CONFIRMED" || field.status === "CONFLICTING") continue; // never downgrade or overwrite a stronger existing status

      const nextStatus: MeddpiccField["status"] = "PARTIAL";
      merged[relevance] = {
        status: nextStatus,
        summary: field.summary && field.status !== "MISSING" ? `${field.summary} Public context: ${classified.summary}` : `Public context: ${classified.summary}`,
        confidence: Math.max(field.confidence, Math.min(0.6, classified.confidence)), // capped — public evidence alone is never high-confidence for these fields
        evidence_ids: Array.from(new Set([...field.evidence_ids, classified.source_id])),
        gaps: field.gaps,
        next_question: field.next_question || `Confirm internally whether ${classified.summary.toLowerCase()} is connected to this specific opportunity.`
      };
    }
  }

  return merged;
}

/** Deterministic MEDDPICC baseline used whenever Stage A did not run
 * (OpenAI disabled/unconfigured/failed) — built from the existing
 * deterministic commercial/technical signal extraction and stakeholder
 * analysis, per the "generate a simpler MEDDPICC result" fallback rule. */
export function buildDeterministicMeddpicc(params: {
  intentEvidence: BuyingIntentEvidence[];
  quantifiedImpact: string[];
  namedStakeholders: Stakeholder[];
  businessProblem: string;
  renewalEvents: string[];
  purchaseLanguage: string[];
}): Meddpicc {
  const meddpicc = buildDefaultMeddpicc();

  const metricsEvidence = params.intentEvidence.filter((e) => e.type === "impact");
  if (metricsEvidence.length > 0 || params.quantifiedImpact.length > 0) {
    meddpicc.metrics = confirmedField(
      (metricsEvidence[0]?.text ?? params.quantifiedImpact[0]) || "Quantified impact stated in the transcript.",
      metricsEvidence.length > 0 ? 0.9 : 0.75
    );
  }

  if (params.businessProblem && params.businessProblem !== "No dominant pain category was matched.") {
    meddpicc.identify_pain = confirmedField(params.businessProblem, 0.85);
  }

  const executiveOwner = params.namedStakeholders.find((s) => s.ownership_type === "executive");
  if (executiveOwner) {
    // A title alone is never enough — Economic Buyer stays a hypothesis
    // pending explicit approval-authority language.
    meddpicc.economic_buyer = {
      status: "HYPOTHESIS",
      summary: `${executiveOwner.name} (${executiveOwner.role}) is a plausible Economic Buyer based on title alone — not yet confirmed.`,
      confidence: 0.35,
      evidence_ids: [],
      gaps: ["Explicit budget/approval authority has not been stated."],
      next_question: `Does ${executiveOwner.name} hold final budget or approval authority for this initiative?`
    };
  }

  if (params.renewalEvents.length > 0) {
    meddpicc.decision_process = {
      status: "PARTIAL",
      summary: `Renewal timing was discussed: ${params.renewalEvents[0]}.`,
      confidence: 0.5,
      evidence_ids: [],
      gaps: ["Full evaluation sequence and decision committee are not confirmed."],
      next_question: "What is the full evaluation sequence and who sits on the decision committee?"
    };
  }

  if (params.purchaseLanguage.length > 0) {
    meddpicc.paper_process = {
      status: "PARTIAL",
      summary: `Purchase intent was stated: ${params.purchaseLanguage[0]}.`,
      confidence: 0.45,
      evidence_ids: [],
      gaps: ["Procurement, legal, and security review steps are not confirmed."],
      next_question: "What are the procurement, legal, and security review steps for this purchase?"
    };
  }

  // Champion requires active-advocacy behavior, which this deterministic
  // fallback cannot reliably detect from keyword rules alone — always
  // MISSING/HYPOTHESIS here (never CONFIRMED) unless a stakeholder both
  // committed to next steps AND shows repeated engagement.
  const activeAdvocate = params.namedStakeholders.find((s) => s.ownership_type !== "executive");
  if (activeAdvocate) {
    meddpicc.champion = {
      status: "HYPOTHESIS",
      summary: `${activeAdvocate.name} (${activeAdvocate.role}) engaged in discovery but champion behaviors are not yet confirmed.`,
      confidence: 0.3,
      evidence_ids: [],
      gaps: ["No confirmed advocacy, evidence-gathering, or internal coordination behavior yet."],
      next_question: `Has ${activeAdvocate.name} advocated for this internally or coordinated other stakeholders?`
    };
  }

  return meddpicc;
}

function confirmedField(summary: string, confidence: number): MeddpiccField {
  return { status: "CONFIRMED", summary, confidence, evidence_ids: [], gaps: [], next_question: "" };
}

export { emptyMeddpiccField };
