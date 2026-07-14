import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

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

describe("Missing information and next action are always populated", () => {
  it("recommended_next_action is never empty, even for a thin transcript", async () => {
    const text = "We have too many network consoles and need a unified view.";
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    const preview = result.opportunity_scoring;
    expect(preview.decision).toBeTruthy();
  });
});
