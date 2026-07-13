import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/signal-agent/run/route";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  clearCatalogCache();
  clearAccountsCache();
});

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/signal-agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

describe("POST /api/signal-agent/run", () => {
  it("HIGH_INTENT demo transcript routes to a specialist with matches", async () => {
    const response = await post({ transcriptId: "high_intent", options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.use_case).toBe("secure_networking_deal_signal_triage");
    expect(["HIGH_INTENT", "REVIEW"]).toContain(json.executive_summary.verdict);
    expect(Array.isArray(json.matches)).toBe(true);
    expect(json.matches.length).toBeGreaterThan(0);
    expect(json.matches[0].recommended_solutions.length).toBeGreaterThan(0);
    expect(json.recommended_specialists.length).toBeGreaterThan(0);
    expect(json.internal_brief).toBeTruthy();
  });

  it("NOISE demo transcript suppresses recommendations", async () => {
    const response = await post({ transcriptId: "noise", options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.executive_summary.verdict).toBe("NOISE");
    expect(json.matches[0].recommended_specialist).toBeNull();
    expect(json.matches[0].recommended_solutions).toEqual([]);
  });

  it("rejects a request with neither transcriptId nor customTranscript", async () => {
    const response = await post({});
    expect(response.status).toBe(400);
  });

  it("still supports a pasted/custom transcript (existing input mode preserved)", async () => {
    const response = await post({
      customTranscript: "Account: Acme Retail\nParticipants: Jordan Lee (Customer, IT Director)\n\n[Jordan Lee]: We are just curious, nothing urgent.",
      options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false }
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.transcript_meta.account).toBe("Acme Retail");
  });

  it("computes a Peachtree routing preview (without delivering) by default, and marks webex_source null when not provided", async () => {
    const response = await post({ transcriptId: "high_intent", options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });
    const json = await response.json();
    expect(json.peachtree).toBeDefined();
    expect(json.peachtree.delivery.every((item: { attempted: boolean }) => item.attempted === false)).toBe(true);
    expect(json.webex_source).toBeNull();
  });

  it("never returns an API key or key-shaped value anywhere in the JSON payload", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key-0123456789";
    try {
      const response = await post({ transcriptId: "high_intent", options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });
      const text = await response.text();
      expect(text).not.toContain("sk-test-not-a-real-key");
      expect(text).not.toContain(process.env.OPENAI_API_KEY);
      expect(text.toLowerCase()).not.toContain("openai_api_key");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
