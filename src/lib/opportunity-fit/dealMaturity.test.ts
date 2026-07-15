import { describe, expect, it } from "vitest";
import { classifyDealMaturity, signalStrengthBand, detectMaturityLimitingEvidence } from "@/lib/opportunity-fit/dealMaturity";
import { buildDefaultMeddpicc, emptyMeddpiccField } from "@/lib/qualification/defaults";
import type { Meddpicc, MeddpiccField, MeddpiccStatus } from "@/lib/qualification/types";

function field(status: MeddpiccStatus): MeddpiccField {
  return { ...emptyMeddpiccField(), status, confidence: status === "MISSING" ? 0 : 0.7 };
}

function meddpicc(overrides: Partial<Record<keyof Meddpicc, MeddpiccStatus>>): Meddpicc {
  const base = buildDefaultMeddpicc();
  for (const [key, status] of Object.entries(overrides)) base[key as keyof Meddpicc] = field(status as MeddpiccStatus);
  return base;
}

describe("classifyDealMaturity — generic, evidence-driven (Section 5B)", () => {
  it("only pain established → PROBLEM_DISCOVERY", () => {
    const stage = classifyDealMaturity({ meddpicc: meddpicc({ identify_pain: "CONFIRMED" }), hasEvaluationOrPov: false, hasPurchaseOrRenewalMomentum: false });
    expect(stage).toBe("PROBLEM_DISCOVERY");
  });

  it("requirements/criteria stated → SOLUTION_DISCOVERY", () => {
    const stage = classifyDealMaturity({ meddpicc: meddpicc({ identify_pain: "CONFIRMED", decision_criteria: "CONFIRMED" }), hasEvaluationOrPov: false, hasPurchaseOrRenewalMomentum: false });
    expect(stage).toBe("SOLUTION_DISCOVERY");
  });

  it("evaluation/POV + criteria → VALIDATION", () => {
    const stage = classifyDealMaturity({ meddpicc: meddpicc({ decision_criteria: "CONFIRMED" }), hasEvaluationOrPov: true, hasPurchaseOrRenewalMomentum: false });
    expect(stage).toBe("VALIDATION");
  });

  it("purchase/renewal momentum + decision process → COMMERCIAL_EVALUATION", () => {
    const stage = classifyDealMaturity({ meddpicc: meddpicc({ decision_process: "PARTIAL" }), hasEvaluationOrPov: false, hasPurchaseOrRenewalMomentum: true });
    expect(stage).toBe("COMMERCIAL_EVALUATION");
  });

  it("paper process present → PROCUREMENT", () => {
    const stage = classifyDealMaturity({ meddpicc: meddpicc({ paper_process: "PARTIAL" }), hasEvaluationOrPov: true, hasPurchaseOrRenewalMomentum: true });
    expect(stage).toBe("PROCUREMENT");
  });

  it("paper process + decision process confirmed → COMMIT", () => {
    const stage = classifyDealMaturity({ meddpicc: meddpicc({ paper_process: "CONFIRMED", decision_process: "CONFIRMED" }), hasEvaluationOrPov: true, hasPurchaseOrRenewalMomentum: true });
    expect(stage).toBe("COMMIT");
  });

  it("no evidence at all → default PROBLEM_DISCOVERY", () => {
    expect(classifyDealMaturity({ meddpicc: buildDefaultMeddpicc(), hasEvaluationOrPov: false, hasPurchaseOrRenewalMomentum: false })).toBe("PROBLEM_DISCOVERY");
  });
});

describe("detectMaturityLimitingEvidence + negative-evidence cap (Section 9)", () => {
  it.each([
    "There is no approved replacement project.",
    "This is not a procurement timeline.",
    "It's not an evaluation yet.",
    "There is no dedicated product budget.",
    "Procurement does not need to join yet."
  ])("detects the limiting statement: %s", (sentence) => {
    expect(detectMaturityLimitingEvidence([sentence])).toBe(true);
  });

  it("caps an otherwise-advanced maturity at SOLUTION_DISCOVERY when limiting evidence is present", () => {
    // Evidence that would otherwise read as COMMERCIAL_EVALUATION.
    const advanced = classifyDealMaturity({ meddpicc: meddpicc({ decision_process: "PARTIAL" }), hasEvaluationOrPov: false, hasPurchaseOrRenewalMomentum: true, hasLimitingEvidence: false });
    const capped = classifyDealMaturity({ meddpicc: meddpicc({ decision_process: "PARTIAL" }), hasEvaluationOrPov: false, hasPurchaseOrRenewalMomentum: true, hasLimitingEvidence: true });
    expect(advanced).toBe("COMMERCIAL_EVALUATION");
    expect(capped).toBe("SOLUTION_DISCOVERY");
  });

  it("never raises maturity via the cap — an early stage stays early", () => {
    const early = classifyDealMaturity({ meddpicc: meddpicc({ identify_pain: "CONFIRMED" }), hasEvaluationOrPov: false, hasPurchaseOrRenewalMomentum: false, hasLimitingEvidence: true });
    expect(early).toBe("PROBLEM_DISCOVERY");
  });
});

describe("signalStrengthBand", () => {
  it("bands by the configured thresholds", () => {
    expect(signalStrengthBand(90)).toBe("HIGH");
    expect(signalStrengthBand(60)).toBe("MEDIUM");
    expect(signalStrengthBand(20)).toBe("LOW");
  });
});
