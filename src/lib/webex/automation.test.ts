import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";

vi.mock("@/lib/webex/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webex/client")>("@/lib/webex/client");
  return { ...actual, sendWebexMessage: vi.fn() };
});

vi.mock("@/lib/outlook/send", () => ({ sendOutlookEmail: vi.fn() }));

import { sendWebexMessage } from "@/lib/webex/client";
import { sendOutlookEmail } from "@/lib/outlook/send";
import { deliverPeachtreePipeline, computePeachtreePreview } from "@/lib/webex/automation";
import { getProcessedTranscript, readRecentWebexAudit, writeTokenRecord as writeWebexTokenRecord, writeIdentityRecord, writeSelectedSpace } from "@/lib/webex/store";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";

let isolate: { cleanup: () => void };

async function connectWebex() {
  await writeWebexTokenRecord({
    accessToken: "webex-connected-user-token",
    refreshToken: "RT-1",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshExpiresAt: null,
    scope: "meeting:transcripts_read spark:people_read spark:messages_write",
    obtainedAt: new Date().toISOString(),
    lastRefreshedAt: null,
    lastRefreshError: null
  });
}

beforeEach(() => {
  isolate = useIsolatedDataDir();
  vi.mocked(sendWebexMessage).mockReset();
  vi.mocked(sendOutlookEmail).mockReset();
  vi.mocked(sendOutlookEmail).mockResolvedValue({ accepted: true, status_code: 202, error: null, error_code: null, sent_at: new Date().toISOString() });
});

afterEach(() => {
  isolate.cleanup();
  delete process.env.WEBEX_BOT_ACCESS_TOKEN;
});

const HIGH_INTENT_TRANSCRIPT = [
  "Account: Acme Retail",
  "Participants: Dana Whitfield (Customer, Chief Information Officer), Marcus Cole (Customer, VP Network Operations)",
  "",
  "[Marcus Cole]: We have too many consoles across campus, branch, and cloud-managed sites — every team has a different single pane of glass. We need unified, cross-domain network operations instead of five disconnected dashboards, and a common operational experience across our existing footprint.",
  "[Dana Whitfield]: We already got board approval for a $1.4M budget for this. We need an architecture workshop this quarter, and we are prepared to purchase this quarter if the pilot metrics are met."
].join("\n");

describe("deliverPeachtreePipeline — dual-channel delivery, no bot required", () => {
  it("sends Webex DMs using the connected user's own OAuth token by default (no WEBEX_BOT_ACCESS_TOKEN needed)", async () => {
    await connectWebex();
    vi.mocked(sendWebexMessage).mockImplementation(async (token, params) => ({
      id: (params.toPersonEmail ?? "").includes("belrobin") ? "msg-sales-1" : "msg-technical-1",
      toPersonEmail: params.toPersonEmail
    }));

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    expect(sendWebexMessage).toHaveBeenCalledWith("webex-connected-user-token", expect.anything());
    const webexDelivered = peachtree.delivery.filter((item) => item.channel === "webex" && item.delivered);
    expect(webexDelivered.length).toBeGreaterThan(0);
  });

  it("delivers the technical lane to a selected Webex space when the recipient is the connected user (self-DM)", async () => {
    await connectWebex();
    // The connected user's identity email == the technical recipient -> a 1:1
    // self-DM, which Webex blocks. A selected space must be used instead.
    await writeIdentityRecord({ personId: "p1", displayName: "Jack Alden", email: "jaalden@cisco.com", cachedAt: new Date().toISOString() });
    await writeSelectedSpace("technical", { roomId: "ROOM-TECH-123", title: "AECOM Deal Room" });
    vi.mocked(sendWebexMessage).mockImplementation(async (_token, params) => ({ id: params.roomId ? "msg-room" : "msg-dm", toPersonEmail: params.toPersonEmail }));

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null, { idempotencyScope: "run" });

    const techWebex = peachtree.delivery.find((d) => d.lane === "technical" && d.channel === "webex");
    expect(techWebex?.error_code).not.toBe("self_direct_message_unsupported");
    const roomCall = vi.mocked(sendWebexMessage).mock.calls.find((c) => c[1].roomId === "ROOM-TECH-123");
    expect(roomCall).toBeTruthy();
  });

  it("also sends an email to each routed lane via Outlook, independent of Webex", async () => {
    await connectWebex();
    vi.mocked(sendWebexMessage).mockResolvedValue({ id: "msg-1", toPersonEmail: "belrobin@cisco.com" });

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    expect(sendOutlookEmail).toHaveBeenCalled();
    const emailDelivered = peachtree.delivery.filter((item) => item.channel === "email" && item.delivered);
    expect(emailDelivered.length).toBeGreaterThan(0);
  });

  it("loads Bella (sales) and Jack (technical) recipient emails from the routing JSON, not environment variables", async () => {
    await connectWebex();
    vi.mocked(sendWebexMessage).mockResolvedValue({ id: "msg-1", toPersonEmail: "x" });
    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    const salesDecision = peachtree.routing.find((item) => item.lane === "sales");
    const technicalDecision = peachtree.routing.find((item) => item.lane === "technical");
    expect(salesDecision?.recipient_email).toBe("belrobin@cisco.com");
    expect(technicalDecision?.recipient_email).toBe("jaalden@cisco.com");
  });

  it("a Webex delivery failure does not block the email for the same lane, or the other lane", async () => {
    await connectWebex();
    vi.mocked(sendWebexMessage).mockRejectedValue(new Error("Webex API rejected the request"));

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    const webexResults = peachtree.delivery.filter((item) => item.channel === "webex");
    const emailResults = peachtree.delivery.filter((item) => item.channel === "email");
    expect(webexResults.every((item) => !item.delivered)).toBe(true);
    expect(emailResults.some((item) => item.delivered)).toBe(true);
  });

  it("an email failure does not block the Webex message for the same lane, or the other lane", async () => {
    await connectWebex();
    vi.mocked(sendWebexMessage).mockResolvedValue({ id: "msg-1", toPersonEmail: "x" });
    vi.mocked(sendOutlookEmail).mockResolvedValue({ accepted: false, status_code: null, error: "Outlook is not connected", error_code: "token_exchange_failed", sent_at: null });

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    const webexResults = peachtree.delivery.filter((item) => item.channel === "webex");
    const emailResults = peachtree.delivery.filter((item) => item.channel === "email");
    expect(emailResults.every((item) => !item.delivered)).toBe(true);
    expect(webexResults.some((item) => item.delivered)).toBe(true);
  });

  it("Bella (sales) failing does not block Jack (technical), and vice versa", async () => {
    await connectWebex();
    vi.mocked(sendWebexMessage).mockImplementation(async (_token, params) => {
      if ((params.toPersonEmail ?? "").includes("belrobin")) throw new Error("Could not resolve recipient");
      return { id: "msg-technical-1", toPersonEmail: params.toPersonEmail };
    });

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    const salesWebex = peachtree.delivery.find((item) => item.lane === "sales" && item.channel === "webex");
    const technicalWebex = peachtree.delivery.find((item) => item.lane === "technical" && item.channel === "webex");
    expect(salesWebex?.delivered).toBe(false);
    expect(technicalWebex?.delivered).toBe(true);
  });
});

describe("deliverPeachtreePipeline — per-channel idempotency and audit", () => {
  it("persists a distinct delivery_key of <id>:lane:channel for every delivery result", async () => {
    await connectWebex();
    vi.mocked(sendWebexMessage).mockResolvedValue({ id: "msg-1", toPersonEmail: "x" });
    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    for (const item of peachtree.delivery) {
      expect(item.delivery_key).toMatch(/:(sales|technical):(webex|email)$/);
    }
  });

  it("never delivers to the same lane/channel twice for the same transcript (idempotency guard)", async () => {
    await connectWebex();
    let webexCalls = 0;
    vi.mocked(sendWebexMessage).mockImplementation(async (_token, params) => {
      webexCalls += 1;
      return { id: `msg-${webexCalls}`, toPersonEmail: params.toPersonEmail };
    });

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });

    const first = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);
    const firstDeliveredCount = first.delivery.filter((item) => item.delivered).length;
    expect(firstDeliveredCount).toBeGreaterThan(0);
    const webexCallsAfterFirst = webexCalls;
    const emailCallsAfterFirst = vi.mocked(sendOutlookEmail).mock.calls.length;

    // Re-running the exact same transcript must not send again to
    // lane/channel pairs that already succeeded.
    const second = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);
    expect(webexCalls).toBe(webexCallsAfterFirst);
    expect(vi.mocked(sendOutlookEmail).mock.calls.length).toBe(emailCallsAfterFirst);
    expect(second.delivery.every((item) => item.delivered)).toBe(true);
    expect(second.delivery.some((item) => item.error?.toLowerCase().includes("already delivered"))).toBe(true);
  });

  it("retrying only re-attempts previously failed lane/channel pairs, not already-succeeded ones", async () => {
    await connectWebex();
    let webexCalls = 0;
    vi.mocked(sendWebexMessage).mockImplementation(async (_token, params) => {
      webexCalls += 1;
      if ((params.toPersonEmail ?? "").includes("belrobin")) throw new Error("Temporary failure");
      return { id: `msg-${webexCalls}`, toPersonEmail: params.toPersonEmail };
    });

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const first = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);
    const salesWebexFirst = first.delivery.find((item) => item.lane === "sales" && item.channel === "webex");
    expect(salesWebexFirst?.delivered).toBe(false);
    const webexCallsAfterFirst = webexCalls;

    // Fix the transient failure, then retry.
    vi.mocked(sendWebexMessage).mockImplementation(async (_token, params) => {
      webexCalls += 1;
      return { id: "msg-retry", toPersonEmail: params.toPersonEmail };
    });
    const second = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    // Only the previously-failed sales:webex pair should have been retried.
    expect(webexCalls).toBe(webexCallsAfterFirst + 1);
    const salesWebexSecond = second.delivery.find((item) => item.lane === "sales" && item.channel === "webex");
    expect(salesWebexSecond?.delivered).toBe(true);
  });

  it("computeTranscriptId is stable for identical demo/pasted content and provides the dedupe anchor", async () => {
    await connectWebex();
    vi.mocked(sendWebexMessage).mockResolvedValue({ id: "msg-1", toPersonEmail: "x" });
    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    const audit = await readRecentWebexAudit(50);
    const processedEvent = audit.find((entry) => entry.event === "transcript_processed");
    expect(processedEvent?.transcriptId).toBeTruthy();
    const record = await getProcessedTranscript(String(processedEvent?.transcriptId));
    expect(record).not.toBeNull();
  });
});

describe("computePeachtreePreview — no delivery attempted", () => {
  it("returns delivery entries with attempted:false and auto_send_enabled:false", async () => {
    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} });
    const preview = await computePeachtreePreview(result);
    expect(preview.auto_send_enabled).toBe(false);
    expect(preview.delivery.every((item) => item.attempted === false)).toBe(true);
    expect(sendWebexMessage).not.toHaveBeenCalled();
    expect(sendOutlookEmail).not.toHaveBeenCalled();
  });
});

describe("Circuit Stage D message synthesis in delivery", () => {
  // A concise, quality-passing Stage D draft (distinct sales/technical,
  // canonical account, why-now + one recommended action + expected outcome).
  const salesWebex = [
    "**REVIEW · Acme Retail** — commercial",
    "**Why you:** Commercial owner for the cross-domain network operations opportunity at Acme Retail.",
    "**Why now:** The customer requested an architecture workshop this quarter.",
    "**Recommended action:** Book the architecture workshop and align on the pilot success metrics.",
    "**Expected outcome:** A confirmed workshop date and agreed pilot metrics."
  ].join("\n");
  const technicalWebex = [
    "**REVIEW · Acme Retail** — technical",
    "**Why you:** Technical owner — scope the workshop and validate the environment at Acme Retail.",
    "**Why now:** The team wants a scoped proof-of-value across the disconnected dashboards.",
    "**Recommended action:** Define the POV technical success criteria and map the console inventory.",
    "**Expected outcome:** Validated architecture and agreed POV success criteria."
  ].join("\n");

  function withStageD(result: Awaited<ReturnType<typeof runSignalAgent>>, sales: string, technical: string) {
    result.ai_trace = {
      provider: "circuit",
      enhanced: true,
      stages: [],
      stage_a: null,
      stage_b: null,
      stage_c: null,
      stage_d: {
        sales_webex: sales,
        technical_webex: technical,
        sales_email: { subject: "Commercial action — Acme Retail", body: sales },
        technical_email: { subject: "Technical action — Acme Retail", body: technical }
      }
    };
    return result;
  }

  it("prefers Circuit Stage D drafts (synthesized_by_ai) over the deterministic builder when they pass the quality gate", async () => {
    const result = withStageD(
      await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} }),
      salesWebex,
      technicalWebex
    );
    const preview = await computePeachtreePreview(result);

    const sales = preview.messages.find((m) => m.lane === "sales");
    const technical = preview.messages.find((m) => m.lane === "technical");
    // Stage D body is preserved (an attendance-mode header is prepended in 7b).
    expect(sales?.markdown).toContain(salesWebex);
    expect(sales?.synthesized_by_ai).toBe(true);
    expect(technical?.markdown).toContain(technicalWebex);
    expect(technical?.synthesized_by_ai).toBe(true);

    // Emails also come from Stage D, HTML-escaped (defense-in-depth).
    const salesEmail = preview.emails.find((e) => e.lane === "sales");
    expect(salesEmail?.subject).toBe("Commercial action — Acme Retail");
    expect(salesEmail?.text).toContain(salesWebex);
  });

  it("falls back to the deterministic builder when Stage D fails the quality gate (identical lanes)", async () => {
    const identical = salesWebex; // identical sales/technical -> not materially different
    const result = withStageD(
      await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} }),
      identical,
      identical
    );
    const preview = await computePeachtreePreview(result);

    const sales = preview.messages.find((m) => m.lane === "sales");
    // Circuit draft rejected -> deterministic content, not synthesized_by_ai.
    expect(sales?.synthesized_by_ai).toBe(false);
    expect(sales?.markdown).not.toBe(identical);
  });

  it("HTML-escapes Stage D email bodies (no raw HTML injection)", async () => {
    const injected = salesWebex + "\n\n<script>alert(1)</script>";
    const result = withStageD(
      await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: {} }),
      injected,
      technicalWebex
    );
    const preview = await computePeachtreePreview(result);
    const salesEmail = preview.emails.find((e) => e.lane === "sales");
    expect(salesEmail?.html).not.toContain("<script>");
    expect(salesEmail?.html).toContain("&lt;script&gt;");
  });
});
