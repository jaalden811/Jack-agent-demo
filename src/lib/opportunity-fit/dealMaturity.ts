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
}): DealMaturityStage {
  const m = params.meddpicc;
  const paperConfirmed = m.paper_process.status === "CONFIRMED";
  const paperPresent = isPresent(m.paper_process.status);
  const processPresent = isPresent(m.decision_process.status);
  const criteriaPresent = isPresent(m.decision_criteria.status);
  const painPresent = isPresent(m.identify_pain.status);

  if (paperConfirmed && processPresent) return "COMMIT";
  if (paperPresent) return "PROCUREMENT";
  if (params.hasPurchaseOrRenewalMomentum && processPresent) return "COMMERCIAL_EVALUATION";
  if (params.hasEvaluationOrPov && criteriaPresent) return "VALIDATION";
  if (criteriaPresent) return "SOLUTION_DISCOVERY";
  if (painPresent) return "PROBLEM_DISCOVERY";
  return loadOpportunityFitScoringConfig().deal_maturity.default_stage as DealMaturityStage;
}
