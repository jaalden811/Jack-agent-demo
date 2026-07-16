import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/signal-agent/run/route";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";
import { writeTokenRecord as writeWebexTokenRecord } from "@/lib/webex/store";
import { writeTokenRecord as writeOutlookTokenRecord } from "@/lib/outlook/store";

vi.mock("@/lib/webex/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webex/client")>("@/lib/webex/client");
  return { ...actual, sendDirectMessage: vi.fn().mockResolvedValue({ id: "msg-1", toPersonEmail: "x" }) };
});
vi.mock("@/lib/outlook/send", () => ({
  sendOutlookEmail: vi.fn().mockResolvedValue({ accepted: true, status_code: 202, error: null, error_code: null, sent_at: new Date().toISOString() })
}));

let isolate: { cleanup: () => void };

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  clearCatalogCache();
  clearAccountsCache();
  isolate = useIsolatedDataDir();
});

afterEach(() => {
  isolate.cleanup();
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
    const response = await post({ transcriptId: "high_intent", options: {} });
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
    const response = await post({ transcriptId: "noise", options: {} });
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
      options: {}
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.transcript_meta.account).toBe("Acme Retail");
  });

  it("computes a Peachtree routing preview (without delivering) by default, and marks webex_source null when not provided", async () => {
    const response = await post({ transcriptId: "high_intent", options: {} });
    const json = await response.json();
    expect(json.peachtree).toBeDefined();
    expect(json.peachtree.delivery.every((item: { attempted: boolean }) => item.attempted === false)).toBe(true);
    expect(json.webex_source).toBeNull();
  });

  it("auto-send fires after analysis once both messaging channels are ready (no explicit deliverToWebex flag needed)", async () => {
    await writeWebexTokenRecord({
      accessToken: "webex-token",
      refreshToken: "RT",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshExpiresAt: null,
      scope: "spark:messages_write",
      obtainedAt: new Date().toISOString(),
      lastRefreshedAt: null,
      lastRefreshError: null
    });
    await writeOutlookTokenRecord({
      accessToken: "outlook-token",
      refreshToken: "RT",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scope: "openid profile offline_access User.Read Mail.Send",
      obtainedAt: new Date().toISOString(),
      lastRefreshedAt: null,
      lastRefreshError: null
    });

    const response = await post({ transcriptId: "high_intent", options: {} });
    const json = await response.json();
    if (json.peachtree.routing.length > 0) {
      expect(json.peachtree.auto_send_enabled).toBe(true);
      expect(json.peachtree.delivery.some((item: { attempted: boolean }) => item.attempted)).toBe(true);
    }
  });

  it("auto-send can be explicitly disabled via options.deliverToWebex:false even when channels are ready", async () => {
    await writeWebexTokenRecord({
      accessToken: "webex-token",
      refreshToken: "RT",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshExpiresAt: null,
      scope: "spark:messages_write",
      obtainedAt: new Date().toISOString(),
      lastRefreshedAt: null,
      lastRefreshError: null
    });

    const response = await post({ transcriptId: "high_intent", options: { deliverToWebex: false } });
    const json = await response.json();
    expect(json.peachtree.delivery.every((item: { attempted: boolean }) => item.attempted === false)).toBe(true);
  });

  it("never returns an API key or key-shaped value anywhere in the JSON payload", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key-0123456789";
    try {
      const response = await post({ transcriptId: "high_intent", options: {} });
      const text = await response.text();
      expect(text).not.toContain("sk-test-not-a-real-key");
      expect(text).not.toContain(process.env.OPENAI_API_KEY);
      expect(text.toLowerCase()).not.toContain("openai_api_key");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
