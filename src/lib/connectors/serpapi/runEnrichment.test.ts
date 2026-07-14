import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateSearchEnrichment } from "@/lib/connectors/serpapi/runEnrichment";

/** Section 2/6/20 gating tests: search must never run for NOISE, an
 * unresolved/generic account, or when SerpAPI is not configured — and
 * must run for a real HIGH_INTENT/REVIEW account when enabled. */

const originalProvider = process.env.SEARCH_PROVIDER;
const originalKey = process.env.SEARCH_API_KEY;

afterEach(() => {
  if (originalProvider === undefined) delete process.env.SEARCH_PROVIDER;
  else process.env.SEARCH_PROVIDER = originalProvider;
  if (originalKey === undefined) delete process.env.SEARCH_API_KEY;
  else process.env.SEARCH_API_KEY = originalKey;
});

describe("gateSearchEnrichment", () => {
  beforeEach(() => {
    process.env.SEARCH_PROVIDER = "serpapi";
    process.env.SEARCH_API_KEY = "test-key";
  });

  it("does not run for NOISE", () => {
    const result = gateSearchEnrichment({ enrichmentEnabled: true, verdict: "NOISE", accountCandidateName: "Meridian Health Systems", hasStakeholderCandidate: true });
    expect(result.allowed).toBe(false);
  });

  it("does not run when enrichment is disabled by the user", () => {
    const result = gateSearchEnrichment({ enrichmentEnabled: false, verdict: "HIGH_INTENT", accountCandidateName: "Meridian Health Systems", hasStakeholderCandidate: true });
    expect(result.allowed).toBe(false);
  });

  it("does not run for a generic/unresolved account with no stakeholder candidate", () => {
    const result = gateSearchEnrichment({ enrichmentEnabled: true, verdict: "HIGH_INTENT", accountCandidateName: "Unknown", hasStakeholderCandidate: false });
    expect(result.allowed).toBe(false);
  });

  it("does not run when SerpAPI is not configured", () => {
    delete process.env.SEARCH_API_KEY;
    const result = gateSearchEnrichment({ enrichmentEnabled: true, verdict: "HIGH_INTENT", accountCandidateName: "Meridian Health Systems", hasStakeholderCandidate: true });
    expect(result.allowed).toBe(false);
  });

  it("runs for a real account and HIGH_INTENT verdict when configured and enabled", () => {
    const result = gateSearchEnrichment({ enrichmentEnabled: true, verdict: "HIGH_INTENT", accountCandidateName: "Meridian Health Systems", hasStakeholderCandidate: false });
    expect(result.allowed).toBe(true);
  });

  it("runs for REVIEW verdict too", () => {
    const result = gateSearchEnrichment({ enrichmentEnabled: true, verdict: "REVIEW", accountCandidateName: "Meridian Health Systems", hasStakeholderCandidate: false });
    expect(result.allowed).toBe(true);
  });

  it("runs on a stakeholder candidate alone, even with a generic account name", () => {
    const result = gateSearchEnrichment({ enrichmentEnabled: true, verdict: "HIGH_INTENT", accountCandidateName: "Unknown", hasStakeholderCandidate: true });
    expect(result.allowed).toBe(true);
  });
});
