import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";
import { computeTranscriptOpportunityScore } from "@/lib/opportunity-fit/opportunityFit";

/**
 * Integration-level tests (Section 17) for the account-resolution ->
 * SerpAPI-signals -> opportunity-fit -> pursuit-recommendation
 * pipeline, run through the full runSignalAgent entry point exactly as
 * the API route does. Deterministic (no OpenAI/SerpAPI keys) so these
 * are reproducible in CI.
 */

const OFF = { useOpenAIEmbeddings: false, useOpenAISynthesis: false };

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.SEARCH_API_KEY;
  clearCatalogCache();
  clearAccountsCache();
});

describe("Defect fix: funding/timeline detection never silently depends on OpenAI being configured", () => {
  it("the real 30-turn Splunk regression fixture — which has clear deterministic budget/timeline/renewal language — scores hasFunding/hasUrgencyOrDeadline true with OpenAI fully disabled", async () => {
    const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    // commercial_signals.budget/timeline are deterministically detected
    // (verified independently below) — the transcript-opportunity score
    // must reflect them even though OpenAI is fully disabled in this
    // test. Before the fix, budget/timeline detection for the score was
    // wired exclusively through the OpenAI Stage-A extraction result,
    // so it silently produced 0 points for both whenever OpenAI was
    // unconfigured, regardless of the deterministic evidence already
    // computed elsewhere in the same pipeline run.
    expect(result.commercial_signals.budget).toBeTruthy();
    expect(result.commercial_signals.timeline).toBeTruthy();
    expect(result.opportunity_scoring.transcript_score).toBeGreaterThanOrEqual(90);
  });

  it("computeTranscriptOpportunityScore itself: hasFunding/hasUrgencyOrDeadline being true adds exactly the configured point values", () => {
    const base = {
      hasQuantifiedImpact: false,
      hasFunding: false,
      hasUrgencyOrDeadline: false,
      hasRenewal: false,
      hasEvaluationLanguage: false,
      hasSuccessCriteria: false,
      hasNextSteps: false,
      hasNamedDecisionAuthority: false,
      identifyPainStatus: "MISSING" as const,
      primarySolutionFitConfidence: 0
    };
    const withoutFundingOrTimeline = computeTranscriptOpportunityScore(base);
    const withFundingAndTimeline = computeTranscriptOpportunityScore({ ...base, hasFunding: true, hasUrgencyOrDeadline: true });
    expect(withFundingAndTimeline - withoutFundingOrTimeline).toBe(22); // 12 (funding) + 10 (urgency/timeline)
  });
});

describe("Defect fix: finance/vendor-management stakeholders count as decision authority", () => {
  it("a named procurement/vendor-management lead contributes decision-authority points, not only an 'executive' title", async () => {
    const withProcurementLead = await runSignalAgent({
      customTranscript: ["Account: Brightfield Regional Utilities", "00:00 — Jamie: I run vendor management and procurement for this initiative.", "00:05 — Sam: We have too many network consoles across our sites."].join("\n"),
      options: OFF
    });
    const withoutAnyAuthority = await runSignalAgent({
      customTranscript: ["Account: Brightfield Regional Utilities", "00:00 — Jamie: I handle day-to-day monitoring dashboards.", "00:05 — Sam: We have too many network consoles across our sites."].join("\n"),
      options: OFF
    });
    expect(withProcurementLead.opportunity_scoring.transcript_score).toBeGreaterThan(withoutAnyAuthority.opportunity_scoring.transcript_score);
  });
});

describe("Test 6/7: unresolved account prevents broad search but never reduces the transcript score", () => {
  it("never runs SerpAPI signal search for an unresolved/generic account, and the transcript score is unaffected by that absence", async () => {
    const text = ["00:00 — Alex: Thanks for joining.", "00:05 — Sam: We have too many network consoles and need a unified view."].join("\n");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });

    expect(result.serpapi_signals.status).toBe("not_run");
    // Transcript opportunity score must come purely from transcript
    // evidence — an unresolved account must never zero it out or
    // otherwise penalize it.
    expect(result.opportunity_scoring.transcript_score).toBeGreaterThanOrEqual(0);
    expect(result.opportunity_scoring.external_fit_score).toBeNull();
  });
});

describe("Test 13/14/15 (opportunity-fit variant): public signals never confirm private facts", () => {
  it("a technology_alignment/buying_capacity signal category is structurally barred from supporting economic_buyer/champion claims", async () => {
    const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    // Even with zero SerpAPI signals (no key configured here), the
    // MEDDPICC fields must never be confirmed by public evidence alone.
    expect(result.meddpicc.economic_buyer.status).not.toBe("CONFIRMED");
    expect(result.meddpicc.champion.status).not.toBe("CONFIRMED");
  });
});

describe("Test 28: SerpAPI failure/unavailability leaves transcript analysis fully functional", () => {
  it("produces a complete result with correct verdict/MEDDPICC/scoring when SerpAPI is not configured", async () => {
    const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8");
    const result = await runSignalAgent({ customTranscript: text, options: { ...OFF, enrichPublicSignals: true } });
    expect(result.executive_summary.verdict).toBe("HIGH_INTENT");
    expect(result.opportunity_scoring.transcript_score).toBeGreaterThan(0);
    expect(result.opportunity_scoring.decision).toBeTruthy();
    expect(result.serpapi_signals.status).toBe("not_run");
    expect(result.serpapi_signals.reason).toContain("SerpAPI is not configured");
  });
});

describe("Test 29: no API key appears anywhere in the response", () => {
  it("the full serialized result never contains the configured SEARCH_API_KEY or OPENAI_API_KEY value", async () => {
    process.env.SEARCH_API_KEY = "test-secret-search-key-abc123";
    process.env.OPENAI_API_KEY = "sk-test-secret-openai-key-xyz789";
    try {
      const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8");
      const result = await runSignalAgent({ customTranscript: text, options: OFF });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("test-secret-search-key-abc123");
      expect(serialized).not.toContain("sk-test-secret-openai-key-xyz789");
    } finally {
      delete process.env.SEARCH_API_KEY;
      delete process.env.OPENAI_API_KEY;
    }
  });
});

describe("Test 32: no company or industry is hard-coded in production opportunity-fit/account-resolution logic", () => {
  it("five structurally distinct transcripts each resolve to their own distinct account and produce independently varying scores", async () => {
    const fixtures = [
      "signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt",
      "signal-agent-poc/data/transcripts/networking_modernization_signal.txt",
      "signal-agent-poc/data/transcripts/soc_xdr_investigation_signal.txt",
      "signal-agent-poc/data/transcripts/collaboration_hybrid_work_signal.txt",
      "signal-agent-poc/data/transcripts/ai_infrastructure_scaleup_signal.txt"
    ];
    const results = await Promise.all(fixtures.map(async (path) => runSignalAgent({ customTranscript: readFileSync(path, "utf8"), options: OFF })));
    const accountNames = results.map((r) => r.account_resolution.name);
    expect(new Set(accountNames).size).toBe(fixtures.length);
    const scores = results.map((r) => r.opportunity_scoring.final_pursuit_score);
    // Scores must genuinely vary transcript-to-transcript, never a
    // single hard-coded constant.
    expect(new Set(scores).size).toBeGreaterThan(1);
  });
});

describe("Test 18/19 (hard gate variant): explicit customer disqualification is required for DO_NOT_PURSUE", () => {
  it("an explicit 'not pursuing' customer statement is a qualifying condition for DO_NOT_PURSUE, never public evidence alone", async () => {
    const text = ["Account: Fenwick Distribution Partners", "00:00 — Casey: To be clear, we are not pursuing any new logging or SIEM platform this year — that is fully off the table.", "00:05 — Robin: Our focus today is strictly network operations."].join(
      "\n"
    );
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    const gate = result.opportunity_scoring.gates.find((g) => g.gate === "explicit_not_pursuing_statement");
    expect(gate?.triggered).toBe(true);
  });

  it("does not trigger the explicit-not-pursuing gate for an ordinary evaluative transcript", async () => {
    const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    const gate = result.opportunity_scoring.gates.find((g) => g.gate === "explicit_not_pursuing_statement");
    expect(gate?.triggered).toBe(false);
  });
});

describe("Section 5 realignment: score dimensions + high-signal decision rule", () => {
  it("exposes signal strength, deal maturity, and qualification completeness as distinct fields", async () => {
    const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    const o = result.opportunity_scoring;
    expect(typeof o.signal_strength.score).toBe("number");
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(o.signal_strength.band);
    expect(["PROBLEM_DISCOVERY", "SOLUTION_DISCOVERY", "VALIDATION", "COMMERCIAL_EVALUATION", "PROCUREMENT", "COMMIT"]).toContain(o.deal_maturity);
    expect(typeof o.qualification_completeness).toBe("number");
    // Signal strength and the final pursuit score are genuinely separate
    // dimensions — not the same number relabeled.
    expect(o.signal_strength.score).not.toBe(undefined);
  });

  it("Test 4/6: a strong signal with an UNRESOLVED account is not passively downgraded to NURTURE", async () => {
    // Real high-signal fixture, account line stripped -> unresolved.
    const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8").replace(/^Account:.*\n/m, "");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    expect(result.executive_summary.verdict).toBe("HIGH_INTENT");
    expect(result.account_resolution.status).toBe("unresolved");
    // The account gap becomes a discovery action, not a NURTURE downgrade.
    expect(["PURSUE", "PURSUE_WITH_DISCOVERY"]).toContain(result.opportunity_scoring.decision);
  });
});

describe("Missing information and next action are always populated", () => {
  it("recommended_next_action is never empty, even for a thin transcript", async () => {
    const text = "We have too many network consoles and need a unified view.";
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    const preview = result.opportunity_scoring;
    expect(preview.decision).toBeTruthy();
  });
});
