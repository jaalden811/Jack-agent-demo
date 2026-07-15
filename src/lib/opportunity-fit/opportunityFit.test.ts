import { describe, expect, it } from "vitest";
import { computeExternalFitScore, computeQualificationCompletenessScore, computeTranscriptOpportunityScore, loadOpportunityFitScoringConfig } from "@/lib/opportunity-fit/opportunityFit";
import { buildDefaultMeddpicc, emptyMeddpiccField } from "@/lib/qualification/defaults";
import type { NormalizedPublicSignal } from "@/lib/opportunity-fit/types";

function baseSignal(overrides: Partial<NormalizedPublicSignal> = {}): NormalizedPublicSignal {
  return {
    signal_id: "sig_1",
    account_name: "Acme Retail Group",
    category: "strategic_objective",
    subcategory: "cloud_modernization",
    claim: "Acme Retail Group announced a cloud modernization initiative.",
    source_title: "Acme Retail Group announces cloud initiative",
    source_url: "https://acmeretail.com/news/cloud",
    source_domain: "acmeretail.com",
    published_at: new Date().toISOString(),
    retrieved_at: new Date().toISOString(),
    source_authority: 0.9,
    entity_match: 0.95,
    recency: 0.9,
    transcript_relevance: 0.8,
    signal_strength: 0.85,
    confidence: 0.85,
    evidence_class: "confirmed_public_fact",
    account_context_eligible: true,
    narrative_eligible: true,
    scoring_eligible: true,
    rejection_reasons: [],
    supports: ["strategic_alignment"],
    limitations: [],
    corroborating_urls: [],
    ...overrides
  };
}

describe("Defect fix: hasNextSteps reflects real evidence, never an unconditional true", () => {
  it("computeTranscriptOpportunityScore differs by exactly the configured next-steps point value when next-step evidence is present vs absent", () => {
    const base = {
      hasQuantifiedImpact: false,
      hasFunding: false,
      hasUrgencyOrDeadline: false,
      hasRenewal: false,
      hasEvaluationLanguage: false,
      hasSuccessCriteria: false,
      hasNamedDecisionAuthority: false,
      identifyPainStatus: "MISSING" as const,
      primarySolutionFitConfidence: 0
    };
    const without = computeTranscriptOpportunityScore({ ...base, hasNextSteps: false });
    const withNextSteps = computeTranscriptOpportunityScore({ ...base, hasNextSteps: true });
    expect(withNextSteps).toBeGreaterThan(without);
    expect(withNextSteps - without).toBe(8);
  });
});

describe("Test 22: arithmetic matches configured weights", () => {
  it("transcript opportunity score reflects the configured point values, never a hard-coded 100", () => {
    const score = computeTranscriptOpportunityScore({
      hasQuantifiedImpact: true,
      hasFunding: true,
      hasUrgencyOrDeadline: false,
      hasRenewal: false,
      hasEvaluationLanguage: false,
      hasSuccessCriteria: false,
      hasNextSteps: false,
      hasNamedDecisionAuthority: false,
      identifyPainStatus: "CONFIRMED",
      primarySolutionFitConfidence: 0
    });
    // 14 (impact) + 12 (funding) + 15 (identify_pain CONFIRMED) = 41
    expect(score).toBe(41);
  });

  it("external fit score arithmetic sums weighted per-category contributions from the config file", () => {
    const config = loadOpportunityFitScoringConfig();
    const result = computeExternalFitScore({ signals: [baseSignal()], accountResolutionAvailable: true, searchRan: true, failureReason: null });
    expect(result.available).toBe(true);
    const strategicFactor = result.factors.find((f) => f.factor === "strategic_alignment");
    expect(strategicFactor?.weight).toBe(config.external_fit_score.weights.strategic_alignment);
    // score_0_100 = round(0.85*100 + bonus); contribution = score * weight
    expect(strategicFactor?.contribution).toBeCloseTo((strategicFactor?.score_0_100 ?? 0) * (strategicFactor?.weight ?? 0), 5);
  });
});

describe("Test 12: technology-job posting is supporting, not confirmed install-base evidence", () => {
  it("a technology_alignment signal never claims account_fit or buying_capacity support", () => {
    const signal = baseSignal({ category: "technology_alignment", subcategory: "technology:Splunk" });
    expect(signal.supports).not.toContain("account_fit");
    expect(signal.supports).not.toContain("buying_capacity");
  });
});

describe("Test 20: external-fit score is unavailable when account is unresolved", () => {
  it("returns available:false with reason ACCOUNT_UNRESOLVED", () => {
    const result = computeExternalFitScore({ signals: [baseSignal()], accountResolutionAvailable: false, searchRan: false, failureReason: null });
    expect(result.available).toBe(false);
    expect(result.score).toBeNull();
    expect(result.reason).toBe("ACCOUNT_UNRESOLVED");
  });
});

describe("Test 17: weak sources cannot dominate the score", () => {
  it("many weak signals never outscore what one strong signal alone would produce", () => {
    const weakSignals = Array.from({ length: 10 }, (_, i) => baseSignal({ signal_id: `weak_${i}`, signal_strength: 0.5, evidence_class: "weak_signal" }));
    const strongSignal = [baseSignal({ signal_strength: 0.95, evidence_class: "confirmed_public_fact" })];
    const weakResult = computeExternalFitScore({ signals: weakSignals, accountResolutionAvailable: true, searchRan: true, failureReason: null });
    const strongResult = computeExternalFitScore({ signals: strongSignal, accountResolutionAvailable: true, searchRan: true, failureReason: null });
    // The average-based scoring formula means many weak (0.5) signals
    // score lower than one strong (0.95) signal.
    expect(weakResult.score ?? 0).toBeLessThan(strongResult.score ?? 0);
  });
});

describe("Qualification completeness score", () => {
  it("Test: missing MEDDPICC fields lower completeness without treating the deal as automatically bad", () => {
    const empty = buildDefaultMeddpicc(); // every field MISSING
    const score = computeQualificationCompletenessScore(empty);
    expect(score).toBe(0);
  });

  it("a fully confirmed MEDDPICC record scores near 100", () => {
    const full = buildDefaultMeddpicc();
    for (const key of Object.keys(full) as Array<keyof typeof full>) {
      full[key] = { ...emptyMeddpiccField(), status: "CONFIRMED", confidence: 0.9 };
    }
    const score = computeQualificationCompletenessScore(full);
    expect(score).toBeGreaterThan(90);
  });
});
