import { describe, expect, it } from "vitest";
import { buildDeterministicMeddpicc, mergePublicEvidenceIntoMeddpicc } from "@/lib/qualification/meddpiccMerge";
import { buildDefaultMeddpicc } from "@/lib/qualification/defaults";
import type { ClassifiedPublicResult } from "@/lib/qualification/types";

function classifiedResult(overrides: Partial<ClassifiedPublicResult>): ClassifiedPublicResult {
  return {
    source_id: "serp_1",
    entity_match: "confirmed",
    signal_type: "public_initiative",
    summary: "The company announced a cloud modernization program.",
    supported_claims: [],
    unsupported_or_ambiguous_claims: [],
    meddpicc_relevance: [],
    confidence: 0.8,
    ...overrides
  };
}

describe("mergePublicEvidenceIntoMeddpicc — public evidence must never confirm a private commercial fact", () => {
  it("never touches economic_buyer, even when meddpicc_relevance claims it", () => {
    const base = buildDefaultMeddpicc();
    const merged = mergePublicEvidenceIntoMeddpicc(base, [classifiedResult({ meddpicc_relevance: ["economic_buyer"] })]);
    expect(merged.economic_buyer).toEqual(base.economic_buyer);
    expect(merged.economic_buyer.status).toBe("MISSING");
  });

  it("never touches champion, even when meddpicc_relevance claims it", () => {
    const base = buildDefaultMeddpicc();
    const merged = mergePublicEvidenceIntoMeddpicc(base, [classifiedResult({ meddpicc_relevance: ["champion"] })]);
    expect(merged.champion.status).toBe("MISSING");
  });

  it("never touches metrics, decision_process, or paper_process", () => {
    const base = buildDefaultMeddpicc();
    const merged = mergePublicEvidenceIntoMeddpicc(base, [classifiedResult({ meddpicc_relevance: ["metrics", "decision_process", "paper_process"] })]);
    expect(merged.metrics.status).toBe("MISSING");
    expect(merged.decision_process.status).toBe("MISSING");
    expect(merged.paper_process.status).toBe("MISSING");
  });

  it("may upgrade identify_pain from MISSING to PARTIAL (never to CONFIRMED)", () => {
    const base = buildDefaultMeddpicc();
    const merged = mergePublicEvidenceIntoMeddpicc(base, [classifiedResult({ meddpicc_relevance: ["identify_pain"] })]);
    expect(merged.identify_pain.status).toBe("PARTIAL");
    expect(merged.identify_pain.evidence_ids).toContain("serp_1");
  });

  it("may upgrade decision_criteria and competition similarly", () => {
    const base = buildDefaultMeddpicc();
    const merged = mergePublicEvidenceIntoMeddpicc(base, [classifiedResult({ meddpicc_relevance: ["decision_criteria", "competition"] })]);
    expect(merged.decision_criteria.status).toBe("PARTIAL");
    expect(merged.competition.status).toBe("PARTIAL");
  });

  it("never downgrades an already-CONFIRMED field", () => {
    const base = buildDefaultMeddpicc();
    base.identify_pain = { status: "CONFIRMED", summary: "Transcript-confirmed pain.", confidence: 0.9, evidence_ids: ["tr_1"], gaps: [], next_question: "" };
    const merged = mergePublicEvidenceIntoMeddpicc(base, [classifiedResult({ meddpicc_relevance: ["identify_pain"] })]);
    expect(merged.identify_pain.status).toBe("CONFIRMED");
    expect(merged.identify_pain.evidence_ids).toEqual(["tr_1"]);
  });

  it("ignores no_match / weak entity matches entirely", () => {
    const base = buildDefaultMeddpicc();
    const merged = mergePublicEvidenceIntoMeddpicc(base, [classifiedResult({ meddpicc_relevance: ["identify_pain"], entity_match: "no_match" })]);
    expect(merged.identify_pain.status).toBe("MISSING");
  });
});

describe("buildDeterministicMeddpicc — safe fallback when OpenAI Stage A did not run", () => {
  it("confirms Metrics from quantified impact evidence", () => {
    const meddpicc = buildDeterministicMeddpicc({
      intentEvidence: [{ type: "impact", text: "$1.8 million in lost revenue", normalized_value: null, score_contribution: 0.3 }],
      quantifiedImpact: ["$1.8 million in lost revenue"],
      namedStakeholders: [],
      businessProblem: "Fragmented tooling causes delayed root cause.",
      renewalEvents: [],
      purchaseLanguage: []
    });
    expect(meddpicc.metrics.status).toBe("CONFIRMED");
  });

  it("never confirms Economic Buyer from a title alone", () => {
    const meddpicc = buildDeterministicMeddpicc({
      intentEvidence: [],
      quantifiedImpact: [],
      namedStakeholders: [{ name: "Alex Kim", role: "VP of Engineering", ownership_type: "executive" }],
      businessProblem: "",
      renewalEvents: [],
      purchaseLanguage: []
    });
    expect(meddpicc.economic_buyer.status).not.toBe("CONFIRMED");
    expect(meddpicc.economic_buyer.status).toBe("HYPOTHESIS");
  });

  it("never confirms Champion from participation alone", () => {
    const meddpicc = buildDeterministicMeddpicc({
      intentEvidence: [],
      quantifiedImpact: [],
      namedStakeholders: [{ name: "Priya Nair", role: "Applications Engineering Lead", ownership_type: "application" }],
      businessProblem: "",
      renewalEvents: [],
      purchaseLanguage: []
    });
    expect(meddpicc.champion.status).not.toBe("CONFIRMED");
  });
});
