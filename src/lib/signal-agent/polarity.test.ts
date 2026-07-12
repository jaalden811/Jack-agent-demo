import { describe, expect, it } from "vitest";
import { analyzeNegativeCues } from "@/lib/signal-agent/polarity";
import { ingestTranscript } from "@/lib/signal-agent/transcript";
import type { CatalogEntry, NegationConfig, ParsedMatchingConfig } from "@/lib/signal-agent/types";

const negationConfig: NegationConfig = {
  phrases: ["not funded", "just curious", "future-year placeholder", "presenter showed"],
  hypotheticalMarkers: ["presenter showed"],
  externalNegators: ["not", "never", "isn't", "aren't", "doesn't", "don't", "won't", "cannot", "can't"],
  resolutionMarkers: ["but", "however"],
  resolutionEvidenceTerms: ["budget", "approved", "executive", "sponsor"],
  penaltyWeight: 0.35,
  hypotheticalPenaltyWeight: 0.2,
  negationWindowWords: 6
};

const matchingConfig = {
  penalties: { negation: 0.35, hypotheticalOrEducation: 0.2, wrongDomain: 0.25, competitorOnlyContext: 0.1 }
} as unknown as ParsedMatchingConfig;

const entry: CatalogEntry = {
  id: "test_entry",
  domain: "Test",
  painCategory: "Test category",
  customerLanguage: [],
  keywords: [],
  semanticCues: [],
  negativeCues: [],
  solutionSummary: "",
  primarySolutions: [],
  adjacentSolutions: [],
  chooseWhen: [],
  doNotChooseWhen: [],
  corroborationHints: [],
  installBaseSignals: [],
  buyingRoles: [],
  intentMarkers: [],
  recommendedSpecialist: null
};

function transcriptFor(sentence: string) {
  return ingestTranscript(["Account: Test Co", "Participants: Jamie Lee (Customer, IT Director)", "", `[Jamie Lee]: ${sentence}`].join("\n"));
}

describe("analyzeNegativeCues — clause-aware polarity", () => {
  it("'not funded ... but ... approved budget' resolves rather than penalizing", () => {
    const transcript = transcriptFor("This is not funded yet, but we already have executive sponsorship and approved budget for next quarter.");
    const result = analyzeNegativeCues(entry, transcript, negationConfig, matchingConfig);
    const fundedResult = result.results.find((r) => r.phrase === "not funded");
    expect(fundedResult?.polarity).toBe("resolved");
    expect(fundedResult?.penalty).toBe(0);
    expect(result.hasUnresolvedNegation).toBe(false);
  });

  it("a bare negative phrase with no negator or resolution stays 'negative'", () => {
    const transcript = transcriptFor("This is not funded this year and there is no plan to change that.");
    const result = analyzeNegativeCues(entry, transcript, negationConfig, matchingConfig);
    const fundedResult = result.results.find((r) => r.phrase === "not funded");
    expect(fundedResult?.polarity).toBe("negative");
    expect(fundedResult?.penalty).toBeGreaterThan(0);
    expect(result.hasUnresolvedNegation).toBe(true);
  });

  it("an externally negated phrase flips to negated_negative regardless of category", () => {
    const transcript = transcriptFor("This is not a future-year placeholder — it is funded now.");
    const result = analyzeNegativeCues(entry, transcript, negationConfig, matchingConfig);
    const placeholderResult = result.results.find((r) => r.phrase === "future-year placeholder");
    expect(placeholderResult?.polarity).toBe("negated_negative");
    expect(placeholderResult?.penalty).toBe(0);
  });

  it("a hypothetical marker is flagged 'hypothetical' with a partial penalty, not full negation", () => {
    const transcript = transcriptFor("The presenter showed an XDR slide during the keynote.");
    const result = analyzeNegativeCues(entry, transcript, negationConfig, matchingConfig);
    const presenterResult = result.results.find((r) => r.phrase === "presenter showed");
    expect(presenterResult?.polarity).toBe("hypothetical");
    expect(presenterResult?.penalty).toBe(negationConfig.hypotheticalPenaltyWeight);
    expect(presenterResult?.penalty).toBeLessThan(negationConfig.penaltyWeight);
  });
});
