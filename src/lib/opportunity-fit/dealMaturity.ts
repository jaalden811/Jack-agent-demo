import { loadOpportunityFitScoringConfig } from "@/lib/opportunity-fit/opportunityFit";
import type { Meddpicc } from "@/lib/qualification/types";

/**
 * Deterministic deal-maturity classification (Section 5B) and
 * signal-strength banding — both generic and evidence-driven, never
 * tied to a company/product/transcript. Deal maturity answers "how far
 * along is the deal" (distinct from signal strength "is the
 * conversation important" and qualification completeness "how much do
 * we understand"). Stages come from opportunity_fit_scoring.json.
 */

export type DealMaturityStage = "PROBLEM_DISCOVERY" | "SOLUTION_DISCOVERY" | "VALIDATION" | "COMMERCIAL_EVALUATION" | "PROCUREMENT" | "COMMIT";

export type SignalStrengthBand = "HIGH" | "MEDIUM" | "LOW";

export function signalStrengthBand(signalStrengthScore: number): SignalStrengthBand {
  const bands = loadOpportunityFitScoringConfig().signal_strength_bands;
  if (signalStrengthScore >= bands.high) return "HIGH";
  if (signalStrengthScore >= bands.medium) return "MEDIUM";
  return "LOW";
}

function isPresent(status: string): boolean {
  return status === "CONFIRMED" || status === "PARTIAL";
}

const STAGE_RANK: Record<DealMaturityStage, number> = {
  PROBLEM_DISCOVERY: 0,
  SOLUTION_DISCOVERY: 1,
  VALIDATION: 2,
  COMMERCIAL_EVALUATION: 3,
  PROCUREMENT: 4,
  COMMIT: 5
};

// Generic negative/limiting statements that cap how far a deal can be
// reported as having progressed — matched against customer dialogue,
// never a company/product-specific branch.
const MATURITY_LIMITING_PATTERNS: RegExp[] = [
  /\bnot (an|a|yet) (evaluation|formal evaluation|competition|selection|replacement)\b/i,
  /\bno approved (replacement )?(project|program|budget)\b/i,
  /\bnot a procurement timeline\b/i,
  /\bprocurement (does not|doesn'?t|won'?t) need to (join|be involved)\b/i,
  /\bnot (a )?dedicated (product |splunk )?budget\b/i,
  /\bno dedicated (product |splunk )?budget\b/i,
  /\bno formal (evaluation|competition|replacement)\b/i,
  /\bnot (replacing|an approved)\b/i
];

/** Detects explicit limiting statements that cap deal maturity (Section
 * 9). Generic and evidence-driven. */
export function detectMaturityLimitingEvidence(customerDialogue: string[]): boolean {
  return customerDialogue.some((sentence) => MATURITY_LIMITING_PATTERNS.some((re) => re.test(sentence)));
}

/**
 * Classifies deal maturity from generic evidence: MEDDPICC field
 * statuses plus whether evaluation/proof-of-value and purchase/renewal
 * momentum were detected. Ordered from most-advanced to least so the
 * first satisfied stage wins.
 */
export function classifyDealMaturity(params: {
  meddpicc: Meddpicc;
  hasEvaluationOrPov: boolean;
  hasPurchaseOrRenewalMomentum: boolean;
  /** Explicit limiting statements ("not an evaluation yet", "no approved
   * replacement project", "not a procurement timeline") cap how advanced
   * the reported maturity may be (Section 9). */
  hasLimitingEvidence?: boolean;
}): DealMaturityStage {
  const m = params.meddpicc;
  const paperConfirmed = m.paper_process.status === "CONFIRMED";
  const paperPresent = isPresent(m.paper_process.status);
  const processPresent = isPresent(m.decision_process.status);
  const criteriaPresent = isPresent(m.decision_criteria.status);
  const painPresent = isPresent(m.identify_pain.status);

  let stage: DealMaturityStage;
  if (paperConfirmed && processPresent) stage = "COMMIT";
  else if (paperPresent) stage = "PROCUREMENT";
  else if (params.hasPurchaseOrRenewalMomentum && processPresent) stage = "COMMERCIAL_EVALUATION";
  else if (params.hasEvaluationOrPov && criteriaPresent) stage = "VALIDATION";
  else if (criteriaPresent) stage = "SOLUTION_DISCOVERY";
  else if (painPresent) stage = "PROBLEM_DISCOVERY";
  else stage = loadOpportunityFitScoringConfig().deal_maturity.default_stage as DealMaturityStage;

  // Explicit limiting evidence caps the stage (config-driven).
  if (params.hasLimitingEvidence) {
    const cap = loadOpportunityFitScoringConfig().deal_maturity.negative_evidence_cap?.cap_stage as DealMaturityStage | undefined;
    if (cap && STAGE_RANK[stage] > STAGE_RANK[cap]) stage = cap;
  }
  return stage;
}
