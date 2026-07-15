import { describe, expect, it } from "vitest";
import { applyDoNotPursueGuard, applyDecisionRules, buildPursuitRecommendation, computePursuitScore, evaluateHardGates, type DecisionRuleInputs } from "@/lib/opportunity-fit/pursueDecision";

const STRONG_SIGNAL_INPUTS: DecisionRuleInputs = {
  signalStrength: 90,
  hasPainOrImpact: true,
  momentum: { next_step: true, timing: true, funding: true, evaluation: true },
  nurtureEvidence: { weak_timing: false, no_next_step: false, low_commitment: false, future_interest_only: false, no_material_impact: false }
};

describe("applyDecisionRules — Section 5 (high signal ≠ passive nurture)", () => {
  it("Test 6: a NURTURE-band result with a strong signal + incomplete qualification is floored to PURSUE_WITH_DISCOVERY", () => {
    const result = applyDecisionRules({ decision: "NURTURE", gates: [], inputs: STRONG_SIGNAL_INPUTS });
    expect(result.decision).toBe("PURSUE_WITH_DISCOVERY");
  });

  it("floors even a HOLD-band result to PURSUE_WITH_DISCOVERY when the signal is strong and no hard gate fired", () => {
    const result = applyDecisionRules({ decision: "HOLD", gates: [], inputs: STRONG_SIGNAL_INPUTS });
    expect(result.decision).toBe("PURSUE_WITH_DISCOVERY");
  });

  it("never downgrades a stronger recommendation (PURSUE stays PURSUE)", () => {
    const result = applyDecisionRules({ decision: "PURSUE", gates: [], inputs: STRONG_SIGNAL_INPUTS });
    expect(result.decision).toBe("PURSUE");
  });

  it("Test 4: an unresolved-account gate (require_review) does NOT block the floor — the account becomes a discovery action, not a downgrade", () => {
    const gates = [{ gate: "no_credible_account", triggered: true, evidence_ids: [], effect: "require_review" as const }];
    const result = applyDecisionRules({ decision: "NURTURE", gates, inputs: STRONG_SIGNAL_INPUTS });
    expect(result.decision).toBe("PURSUE_WITH_DISCOVERY");
  });

  it("a triggered hard negative gate (hold/do_not_pursue) is authoritative and blocks the floor", () => {
    const holdGate = [{ gate: "explicit_not_pursuing_statement", triggered: true, evidence_ids: [], effect: "hold" as const }];
    expect(applyDecisionRules({ decision: "HOLD", gates: holdGate, inputs: STRONG_SIGNAL_INPUTS }).decision).toBe("HOLD");
    expect(applyDecisionRules({ decision: "DO_NOT_PURSUE", gates: [], inputs: STRONG_SIGNAL_INPUTS }).decision).toBe("DO_NOT_PURSUE");
  });

  it("Test 7: NURTURE is preserved when the signal itself is genuinely weak (no next step / weak timing / low commitment)", () => {
    const weak: DecisionRuleInputs = {
      signalStrength: 40,
      hasPainOrImpact: false,
      momentum: { next_step: false, timing: false, funding: false, evaluation: false },
      nurtureEvidence: { weak_timing: true, no_next_step: true, low_commitment: true, future_interest_only: true, no_material_impact: true }
    };
    expect(applyDecisionRules({ decision: "NURTURE", gates: [], inputs: weak }).decision).toBe("NURTURE");
  });

  it("does not floor when the signal is below the configured threshold, even with pain + momentum", () => {
    const midSignal: DecisionRuleInputs = { ...STRONG_SIGNAL_INPUTS, signalStrength: 60 };
    expect(applyDecisionRules({ decision: "NURTURE", gates: [], inputs: midSignal }).decision).toBe("NURTURE");
  });

  it("does not floor a strong signal that lacks any momentum (pain alone is not enough)", () => {
    const noMomentum: DecisionRuleInputs = {
      signalStrength: 90,
      hasPainOrImpact: true,
      momentum: { next_step: false, timing: false, funding: false, evaluation: false },
      nurtureEvidence: { weak_timing: true, no_next_step: true, low_commitment: true, future_interest_only: false, no_material_impact: false }
    };
    expect(applyDecisionRules({ decision: "NURTURE", gates: [], inputs: noMomentum }).decision).toBe("NURTURE");
  });
});

describe("Test 21: pursuit score renormalizes when external fit is unavailable", () => {
  it("uses weights_without_external_fit (which sum to 1.0 without an external_fit term) when externalFitScore is null", () => {
    const { weightsUsed } = computePursuitScore({ transcriptScore: 80, qualificationScore: 60, externalFitScore: null, accountResolutionConfidence: 0.9 });
    expect(weightsUsed.external_fit_score).toBeUndefined();
    const total = Object.values(weightsUsed).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("uses weights_with_external_fit (summing to 1.0 including external_fit) when externalFitScore is present", () => {
    const { weightsUsed } = computePursuitScore({ transcriptScore: 80, qualificationScore: 60, externalFitScore: 70, accountResolutionConfidence: 0.9 });
    expect(weightsUsed.external_fit_score).toBeDefined();
    const total = Object.values(weightsUsed).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("never substitutes zero for the missing external-fit component — the other weights are increased instead", () => {
    const withoutExternal = computePursuitScore({ transcriptScore: 80, qualificationScore: 60, externalFitScore: null, accountResolutionConfidence: 0.9 });
    const withExternalAtZero = computePursuitScore({ transcriptScore: 80, qualificationScore: 60, externalFitScore: 0, accountResolutionConfidence: 0.9 });
    // If externalFitScore were substituted with 0 under the "with
    // external fit" weights instead of renormalizing, these two would
    // be different (since the with-fit weights differ from the
    // without-fit weights) — confirming renormalization actually occurred.
    expect(withoutExternal.score).not.toBe(withExternalAtZero.score);
  });
});

describe("Test 23: hard gates are configuration-driven", () => {
  it("evaluates every gate declared in opportunity_fit_scoring.json, not a hard-coded subset", () => {
    const gates = evaluateHardGates({
      transcriptVerdict: "HIGH_INTENT",
      explicitNotPursuing: false,
      categoryOutOfScope: false,
      hasPainEvidence: true,
      accountUnresolved: false,
      crmClosedLostDuplicate: false
    });
    expect(gates.length).toBeGreaterThanOrEqual(6);
    expect(gates.every((g) => typeof g.gate === "string" && typeof g.triggered === "boolean")).toBe(true);
  });

  it("triggers the NOISE gate only when the transcript verdict is NOISE", () => {
    const gates = evaluateHardGates({
      transcriptVerdict: "NOISE",
      explicitNotPursuing: false,
      categoryOutOfScope: false,
      hasPainEvidence: false,
      accountUnresolved: false,
      crmClosedLostDuplicate: false
    });
    const noiseGate = gates.find((g) => g.gate === "transcript_verdict_noise");
    expect(noiseGate?.triggered).toBe(true);
    expect(noiseGate?.effect).toBe("do_not_pursue");
  });
});

describe("Test 9 (pursuit variant): DO_NOT_PURSUE never results from public web evidence alone", () => {
  it("downgrades DO_NOT_PURSUE to HOLD when no qualifying disqualification condition is present", () => {
    const decision = applyDoNotPursueGuard({
      rawDecision: "DO_NOT_PURSUE",
      strongNegativeTranscriptEvidence: false,
      explicitCustomerDisqualification: false,
      confirmedNoFitTaxonomyCondition: false,
      strongCrmDisqualification: false,
      multipleHighAuthorityNegativeSignalsWithWeakTranscriptIntent: false
    });
    expect(decision).toBe("HOLD");
  });

  it("keeps DO_NOT_PURSUE when a qualifying condition is present", () => {
    const decision = applyDoNotPursueGuard({
      rawDecision: "DO_NOT_PURSUE",
      strongNegativeTranscriptEvidence: true,
      explicitCustomerDisqualification: false,
      confirmedNoFitTaxonomyCondition: false,
      strongCrmDisqualification: false,
      multipleHighAuthorityNegativeSignalsWithWeakTranscriptIntent: false
    });
    expect(decision).toBe("DO_NOT_PURSUE");
  });

  it("never touches a decision that wasn't already DO_NOT_PURSUE", () => {
    const decision = applyDoNotPursueGuard({
      rawDecision: "NURTURE",
      strongNegativeTranscriptEvidence: false,
      explicitCustomerDisqualification: false,
      confirmedNoFitTaxonomyCondition: false,
      strongCrmDisqualification: false,
      multipleHighAuthorityNegativeSignalsWithWeakTranscriptIntent: false
    });
    expect(decision).toBe("NURTURE");
  });
});

describe("Confidence is independent from score (Section 9)", () => {
  it("a high score built on thin evidence does not automatically produce high confidence", () => {
    const recommendation = buildPursuitRecommendation({
      transcriptScore: 95,
      qualificationScore: 10,
      externalFitScore: null,
      accountResolutionConfidence: 0.3,
      positiveFactors: [],
      negativeFactors: [],
      missingInformation: ["Everything is missing"],
      recommendedNextAction: "Gather more evidence.",
      gates: [],
      doNotPursueGuardInputs: {
        strongNegativeTranscriptEvidence: false,
        explicitCustomerDisqualification: false,
        confirmedNoFitTaxonomyCondition: false,
        strongCrmDisqualification: false,
        multipleHighAuthorityNegativeSignalsWithWeakTranscriptIntent: false
      },
      evidenceCount: 0
    });
    expect(recommendation.score).toBeGreaterThan(70);
    expect(recommendation.confidence).toBeLessThan(0.6);
  });
});

describe("Test 26: score explanation includes evidence IDs", () => {
  it("positive/negative factors retain their evidence_ids through to the final recommendation", () => {
    const recommendation = buildPursuitRecommendation({
      transcriptScore: 80,
      qualificationScore: 70,
      externalFitScore: 75,
      accountResolutionConfidence: 0.9,
      positiveFactors: [{ factor: "Strong strategic alignment", score_contribution: 20, evidence_ids: ["pubsig_abc123"] }],
      negativeFactors: [],
      missingInformation: [],
      recommendedNextAction: "Proceed.",
      gates: [],
      doNotPursueGuardInputs: {
        strongNegativeTranscriptEvidence: false,
        explicitCustomerDisqualification: false,
        confirmedNoFitTaxonomyCondition: false,
        strongCrmDisqualification: false,
        multipleHighAuthorityNegativeSignalsWithWeakTranscriptIntent: false
      },
      evidenceCount: 1
    });
    expect(recommendation.positive_factors[0].evidence_ids).toContain("pubsig_abc123");
  });
});
