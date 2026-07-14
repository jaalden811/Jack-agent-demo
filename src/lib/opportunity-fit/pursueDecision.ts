import { loadOpportunityFitScoringConfig } from "@/lib/opportunity-fit/opportunityFit";
import type { HardGateResult, PursuitDecision, PursuitRecommendation, ScoreFactorContribution } from "@/lib/opportunity-fit/types";

/**
 * Deterministic pursuit-recommendation arithmetic (Sections 7D, 9, 10).
 * Every weight, decision band, and hard gate is read from
 * signal-agent-poc/config/opportunity_fit_scoring.json. OpenAI may
 * populate factor explanations elsewhere in the pipeline, but this
 * function's arithmetic never depends on an AI call and is fully
 * testable in isolation.
 */

export type GateConditionInputs = {
  transcriptVerdict: "HIGH_INTENT" | "REVIEW" | "NOISE";
  explicitNotPursuing: boolean;
  categoryOutOfScope: boolean;
  hasPainEvidence: boolean;
  accountUnresolved: boolean;
  crmClosedLostDuplicate: boolean;
};

const GATE_CONDITION_EVALUATORS: Record<string, (inputs: GateConditionInputs) => boolean> = {
  verdict_equals_noise: (inputs) => inputs.transcriptVerdict === "NOISE",
  explicit_not_pursuing: (inputs) => inputs.explicitNotPursuing,
  category_out_of_scope: (inputs) => inputs.categoryOutOfScope,
  no_pain_evidence: (inputs) => !inputs.hasPainEvidence,
  account_unresolved: (inputs) => inputs.accountUnresolved,
  crm_closed_lost_duplicate: (inputs) => inputs.crmClosedLostDuplicate
};

export function evaluateHardGates(inputs: GateConditionInputs, evidenceIdsByGate: Record<string, string[]> = {}): HardGateResult[] {
  const config = loadOpportunityFitScoringConfig();
  return config.hard_gates.map((gate) => {
    const evaluator = GATE_CONDITION_EVALUATORS[gate.condition];
    const triggered = evaluator ? evaluator(inputs) : false;
    return {
      gate: gate.gate,
      triggered,
      evidence_ids: triggered ? evidenceIdsByGate[gate.gate] ?? [] : [],
      effect: gate.effect as HardGateResult["effect"]
    };
  });
}

function decisionForScore(score: number): PursuitDecision {
  const config = loadOpportunityFitScoringConfig();
  // Decision bands are defined as inclusive integer ranges — round the
  // (otherwise fractional) weighted score before lookup so it can
  // never fall into a gap between two adjacent integer band boundaries.
  const rounded = Math.round(score);
  const band = config.pursuit_score.decision_bands.find((b) => rounded >= b.min && rounded <= b.max);
  return (band?.decision as PursuitDecision) ?? "HOLD";
}

/** DO_NOT_PURSUE may never result purely from public web evidence
 * (Section 9) — requires at least one of the listed strong
 * disqualification conditions. If none apply, DO_NOT_PURSUE is
 * downgraded to HOLD even if the raw score would otherwise fall in
 * that band. */
export function applyDoNotPursueGuard(params: {
  rawDecision: PursuitDecision;
  strongNegativeTranscriptEvidence: boolean;
  explicitCustomerDisqualification: boolean;
  confirmedNoFitTaxonomyCondition: boolean;
  strongCrmDisqualification: boolean;
  multipleHighAuthorityNegativeSignalsWithWeakTranscriptIntent: boolean;
}): PursuitDecision {
  if (params.rawDecision !== "DO_NOT_PURSUE") return params.rawDecision;
  const hasQualifyingCondition =
    params.strongNegativeTranscriptEvidence ||
    params.explicitCustomerDisqualification ||
    params.confirmedNoFitTaxonomyCondition ||
    params.strongCrmDisqualification ||
    params.multipleHighAuthorityNegativeSignalsWithWeakTranscriptIntent;
  return hasQualifyingCondition ? "DO_NOT_PURSUE" : "HOLD";
}

export function computePursuitScore(params: {
  transcriptScore: number;
  qualificationScore: number;
  externalFitScore: number | null;
  accountResolutionConfidence: number;
}): { score: number; weightsUsed: Record<string, number> } {
  const config = loadOpportunityFitScoringConfig();
  const weights = params.externalFitScore !== null ? config.pursuit_score.weights_with_external_fit : config.pursuit_score.weights_without_external_fit;

  const contributions: Record<string, number> = {
    transcript_opportunity_score: (weights.transcript_opportunity_score ?? 0) * params.transcriptScore,
    qualification_quality_score: (weights.qualification_quality_score ?? 0) * params.qualificationScore,
    account_resolution_confidence: (weights.account_resolution_confidence ?? 0) * (params.accountResolutionConfidence * 100)
  };
  if (params.externalFitScore !== null && weights.external_fit_score) {
    contributions.external_fit_score = weights.external_fit_score * params.externalFitScore;
  }

  const score = Object.values(contributions).reduce((sum, v) => sum + v, 0);
  return { score: Math.max(0, Math.min(100, Math.round(score * 100) / 100)), weightsUsed: weights };
}

/** Confidence is independent from the score itself — a high score
 * built on thin/missing evidence is not high confidence (Section 9). */
export function computeRecommendationConfidence(params: {
  accountResolutionConfidence: number;
  qualificationScore: number;
  externalFitAvailable: boolean;
  evidenceCount: number;
}): number {
  let confidence = 0.4;
  confidence += params.accountResolutionConfidence * 0.25;
  confidence += Math.min(1, params.qualificationScore / 100) * 0.2;
  if (params.externalFitAvailable) confidence += 0.1;
  confidence += Math.min(1, params.evidenceCount / 8) * 0.05;
  return Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000));
}

export function buildPursuitRecommendation(params: {
  transcriptScore: number;
  qualificationScore: number;
  externalFitScore: number | null;
  accountResolutionConfidence: number;
  positiveFactors: ScoreFactorContribution[];
  negativeFactors: ScoreFactorContribution[];
  missingInformation: string[];
  recommendedNextAction: string;
  gates: HardGateResult[];
  doNotPursueGuardInputs: Omit<Parameters<typeof applyDoNotPursueGuard>[0], "rawDecision">;
  evidenceCount: number;
}): PursuitRecommendation {
  const { score, weightsUsed } = computePursuitScore({
    transcriptScore: params.transcriptScore,
    qualificationScore: params.qualificationScore,
    externalFitScore: params.externalFitScore,
    accountResolutionConfidence: params.accountResolutionConfidence
  });

  let effectiveScore = score;
  const capGate = params.gates.find((g) => g.triggered && g.effect === "cap_score");
  if (capGate) {
    const config = loadOpportunityFitScoringConfig();
    const configuredGate = config.hard_gates.find((g) => g.gate === capGate.gate);
    if (configuredGate?.cap_value !== undefined) effectiveScore = Math.min(effectiveScore, configuredGate.cap_value);
  }

  let decision = decisionForScore(effectiveScore);
  if (params.gates.some((g) => g.triggered && g.effect === "do_not_pursue")) decision = "DO_NOT_PURSUE";
  else if (params.gates.some((g) => g.triggered && g.effect === "hold") && decision !== "DO_NOT_PURSUE") decision = "HOLD";

  decision = applyDoNotPursueGuard({ rawDecision: decision, ...params.doNotPursueGuardInputs });

  const confidence = computeRecommendationConfidence({
    accountResolutionConfidence: params.accountResolutionConfidence,
    qualificationScore: params.qualificationScore,
    externalFitAvailable: params.externalFitScore !== null,
    evidenceCount: params.evidenceCount
  });

  return {
    decision,
    score: effectiveScore,
    confidence,
    transcript_score: params.transcriptScore,
    qualification_score: params.qualificationScore,
    external_fit_score: params.externalFitScore,
    account_resolution_confidence: params.accountResolutionConfidence,
    positive_factors: params.positiveFactors,
    negative_factors: params.negativeFactors,
    missing_information: params.missingInformation,
    recommended_next_action: params.recommendedNextAction,
    score_version: loadOpportunityFitScoringConfig().metadata.version,
    gates: params.gates,
    weights: weightsUsed
  };
}
