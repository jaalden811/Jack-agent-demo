import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";
import { TranscriptParseIncompleteError } from "@/lib/signal-agent/types";

/**
 * Section 3 guard: a substantial transcript that parses to implausibly
 * few sentences must be refused outright (never silently scored as a
 * confident-but-wrong result, never auto-sent).
 */

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  clearCatalogCache();
  clearAccountsCache();
});

describe("TRANSCRIPT_PARSE_INCOMPLETE guard", () => {
  it("refuses a long transcript that (hypothetically) parsed to almost nothing", async () => {
    // A transcript with no recognizable speaker turns at all falls back
    // to the "one unattributed block" path and is NOT expected to
    // trigger the guard (that path still produces many sentences from
    // ordinary prose). To exercise the guard itself, construct text
    // that is long but whose only "sentences" are below the length
    // floor (MIN_SENTENCE_CHARS) so almost nothing survives splitting.
    const shortFragment = "Hi. Ok. No. Go. Hm. ";
    const longButSparse = shortFragment.repeat(400); // > 5000 chars, but each "sentence" is far under MIN_SENTENCE_CHARS
    await expect(runSignalAgent({ customTranscript: longButSparse, options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } })).rejects.toThrow(
      TranscriptParseIncompleteError
    );
  });

  it("never rejects a genuinely short transcript (under the character floor)", async () => {
    const result = await runSignalAgent({ customTranscript: "We have too many consoles and need a unified view.", options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });
    expect(result.executive_summary).toBeTruthy();
  });

  it("never rejects a real, substantial transcript with normal sentence density", async () => {
    const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8");
    const result = await runSignalAgent({ customTranscript: text, options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });
    expect(result.transcript_diagnostics.sentences_parsed).toBeGreaterThan(100);
  });

  it("the API route maps the guard to HTTP 422 with the TRANSCRIPT_PARSE_INCOMPLETE error code", async () => {
    const { POST } = await import("@/app/api/signal-agent/run/route");
    const shortFragment = "Hi. Ok. No. Go. Hm. ";
    const request = new Request("http://localhost/api/signal-agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customTranscript: shortFragment.repeat(400), options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } })
    });
    const response = await POST(request);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("TRANSCRIPT_PARSE_INCOMPLETE");
    expect(body.transcript_diagnostics).toBeTruthy();
  });
});
