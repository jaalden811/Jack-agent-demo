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
  /** The primary taxonomy match's own matched customer-language
   * snippets — genuinely evidence-grounded technical/requirement
   * language already computed deterministically, reused here (never
   * product-specific) to populate Decision Criteria without requiring
   * OpenAI. */
  primaryMatchedText?: string[];
  competitorMentions?: string[];
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

  // Decision Criteria: reuse the primary taxonomy match's own matched
  // customer-language snippets — already evidence-grounded, deterministic,
  // and product-agnostic (never invents a requirement that wasn't matched
  // against real transcript text).
  const criteriaSnippets = (params.primaryMatchedText ?? []).filter((text) => text.length > 0);
  if (criteriaSnippets.length >= 3) {
    meddpicc.decision_criteria = {
      status: "CONFIRMED",
      summary: `Multiple explicit technical/decision requirements were stated: ${criteriaSnippets.slice(0, 3).join(" ")}`,
      confidence: 0.75,
      evidence_ids: [],
      gaps: ["Requirements have not yet been weighted or ranked by the buying committee."],
      next_question: "Which of these stated requirements are must-have versus nice-to-have for the final decision?"
    };
  } else if (criteriaSnippets.length > 0) {
    meddpicc.decision_criteria = {
      status: "PARTIAL",
      summary: `Some technical/decision requirements were stated: ${criteriaSnippets[0]}`,
      confidence: 0.5,
      evidence_ids: [],
      gaps: ["The full set of decision criteria has not been confirmed."],
      next_question: "What additional decision criteria should we validate before a recommendation?"
    };
  }

  // Competition: only ever populated from an explicitly named competitor
  // or incumbent — never inferred from generic product-category language.
  if (params.competitorMentions && params.competitorMentions.length > 0) {
    meddpicc.competition = {
      status: "PARTIAL",
      summary: `A competitor or incumbent alternative was referenced: ${params.competitorMentions[0]}`,
      confidence: 0.5,
      evidence_ids: [],
      gaps: ["The competitive dynamic and evaluation criteria against this alternative are not yet confirmed."],
      next_question: "How is this alternative being evaluated relative to what we're proposing?"
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
