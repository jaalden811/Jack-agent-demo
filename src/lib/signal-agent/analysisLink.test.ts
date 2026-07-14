import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";
import { buildAnalysisLink } from "@/lib/signal-agent/analysisLink";
import { readRunResult } from "@/lib/signal-agent/resultStore";

/**
 * Section 11/12 "link verification" tests — the exact checklist the
 * dead-link fix must satisfy: no localhost/private link is ever built,
 * a valid public link points at /signal-agent/results/[runId], the run
 * is persisted before the link is issued, and a persistence failure
 * (or missing config) always disables the link rather than sending a
 * broken one.
 */

let isolate: { cleanup: () => void };
const originalBaseUrl = process.env.APP_PUBLIC_BASE_URL;
const originalSecret = process.env.SIGNAL_SHARE_LINK_SECRET;

beforeEach(() => {
  isolate = useIsolatedDataDir();
  process.env.SIGNAL_SHARE_LINK_SECRET = "test-secret-value-not-a-real-secret";
});

afterEach(() => {
  isolate.cleanup();
  if (originalBaseUrl === undefined) delete process.env.APP_PUBLIC_BASE_URL;
  else process.env.APP_PUBLIC_BASE_URL = originalBaseUrl;
  if (originalSecret === undefined) delete process.env.SIGNAL_SHARE_LINK_SECRET;
  else process.env.SIGNAL_SHARE_LINK_SECRET = originalSecret;
});

function baseRecord(runId: string) {
  return {
    run_id: runId,
    created_at: new Date().toISOString(),
    account: "Test Account",
    verdict: "HIGH_INTENT",
    confidence: 0.8,
    qualification_json: {},
    sales_message: null,
    technical_message: null,
    source_summary: [],
    delivery_summary: {}
  };
}

describe("buildAnalysisLink — the exact Section 11 checklist", () => {
  it("omits the link when APP_PUBLIC_BASE_URL is not configured", async () => {
    delete process.env.APP_PUBLIC_BASE_URL;
    const link = await buildAnalysisLink(baseRecord("run-a"));
    expect(link.included).toBe(false);
    expect(link.url).toBeNull();
    expect(link.reason).toBe("no_public_base_url");
  });

  it("omits the link when APP_PUBLIC_BASE_URL is localhost", async () => {
    process.env.APP_PUBLIC_BASE_URL = "https://localhost:3010";
    const link = await buildAnalysisLink(baseRecord("run-b"));
    expect(link.included).toBe(false);
    expect(link.reason).toBe("validation_failed");
  });

  it("omits the link when APP_PUBLIC_BASE_URL is a private-LAN address", async () => {
    process.env.APP_PUBLIC_BASE_URL = "https://192.168.1.50";
    const link = await buildAnalysisLink(baseRecord("run-c"));
    expect(link.included).toBe(false);
    expect(link.reason).toBe("validation_failed");
  });

  it("omits the link when APP_PUBLIC_BASE_URL is not HTTPS", async () => {
    process.env.APP_PUBLIC_BASE_URL = "http://app.example.com";
    const link = await buildAnalysisLink(baseRecord("run-d"));
    expect(link.included).toBe(false);
  });

  it("builds a valid link pointing at /signal-agent/results/[runId] for a real HTTPS origin", async () => {
    process.env.APP_PUBLIC_BASE_URL = "https://app.example.com";
    const link = await buildAnalysisLink(baseRecord("run-e"));
    expect(link.included).toBe(true);
    expect(link.reason).toBe("public_url_ready");
    expect(link.url).toMatch(/^https:\/\/app\.example\.com\/signal-agent\/results\/run-e\?token=/);
    expect(link.expires_at).not.toBeNull();
  });

  it("persists the run before the link is issued — the result page can load it", async () => {
    process.env.APP_PUBLIC_BASE_URL = "https://app.example.com";
    await buildAnalysisLink(baseRecord("run-f"));
    const persisted = await readRunResult("run-f");
    expect(persisted).not.toBeNull();
    expect(persisted?.account).toBe("Test Account");
  });

  it("never includes localhost/127.0.0.1 anywhere in a generated link", async () => {
    process.env.APP_PUBLIC_BASE_URL = "https://app.example.com";
    const link = await buildAnalysisLink(baseRecord("run-g"));
    expect(link.url).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});
