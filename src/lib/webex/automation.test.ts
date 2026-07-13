import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";

vi.mock("@/lib/webex/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webex/client")>("@/lib/webex/client");
  return { ...actual, sendDirectMessage: vi.fn() };
});

import { sendDirectMessage } from "@/lib/webex/client";
import { deliverPeachtreePipeline, computeTranscriptId } from "@/lib/webex/automation";
import { getProcessedTranscript, readRecentWebexAudit } from "@/lib/webex/store";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";

let isolate: { cleanup: () => void };

beforeEach(() => {
  isolate = useIsolatedDataDir();
  process.env.WEBEX_BOT_ACCESS_TOKEN = "bot-token";
  vi.mocked(sendDirectMessage).mockReset();
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

describe("deliverPeachtreePipeline — idempotency and audit", () => {
  it("persists the returned Webex message IDs", async () => {
    vi.mocked(sendDirectMessage).mockImplementation(async (_token, params) => ({
      id: params.toPersonEmail.includes("belrobin") ? "msg-sales-1" : "msg-technical-1",
      toPersonEmail: params.toPersonEmail
    }));
    process.env.WEBEX_SALES_RECIPIENT_EMAIL = "belrobin@cisco.com";
    process.env.WEBEX_TECHNICAL_RECIPIENT_EMAIL = "jaalden@cisco.com";

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });
    const peachtree = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);

    const delivered = peachtree.delivery.filter((item) => item.delivered);
    expect(delivered.length).toBeGreaterThan(0);
    for (const item of delivered) {
      expect(item.message_id).toBeTruthy();
    }

    const transcriptId = computeTranscriptId(HIGH_INTENT_TRANSCRIPT, null);
    const record = await getProcessedTranscript(transcriptId);
    expect(record).not.toBeNull();

    const audit = await readRecentWebexAudit(20);
    const messageSentEvents = audit.filter((entry) => entry.event === "message_sent");
    expect(messageSentEvents.length).toBeGreaterThan(0);
    expect(messageSentEvents.every((entry) => Boolean(entry.message_id))).toBe(true);
  });

  it("never delivers to the same lane twice for the same transcript (idempotency guard)", async () => {
    let callCount = 0;
    vi.mocked(sendDirectMessage).mockImplementation(async (_token, params) => {
      callCount += 1;
      return { id: `msg-${callCount}`, toPersonEmail: params.toPersonEmail };
    });
    process.env.WEBEX_SALES_RECIPIENT_EMAIL = "belrobin@cisco.com";
    process.env.WEBEX_TECHNICAL_RECIPIENT_EMAIL = "jaalden@cisco.com";

    const result = await runSignalAgent({ customTranscript: HIGH_INTENT_TRANSCRIPT, options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });

    const first = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);
    const firstDeliveredCount = first.delivery.filter((item) => item.delivered).length;
    expect(firstDeliveredCount).toBeGreaterThan(0);
    const callsAfterFirst = callCount;

    // Re-running the exact same transcript must not send again to lanes
    // that already succeeded.
    const second = await deliverPeachtreePipeline(result, HIGH_INTENT_TRANSCRIPT, null);
    expect(callCount).toBe(callsAfterFirst); // no new sendDirectMessage calls
    expect(second.delivery.every((item) => item.delivered)).toBe(true);
    expect(second.delivery.some((item) => item.error?.includes("already delivered") || item.error?.includes("Already delivered"))).toBe(true);
  });
});
