import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";

vi.mock("@/lib/webex/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webex/client")>("@/lib/webex/client");
  return {
    ...actual,
    listWebhooks: vi.fn(),
    createWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    listMeetingTranscripts: vi.fn(),
    listTranscriptSnippets: vi.fn()
  };
});

vi.mock("@/lib/signal-agent/runAgent", () => ({
  runSignalAgent: vi.fn()
}));

vi.mock("@/lib/webex/automation", () => ({
  deliverPeachtreePipeline: vi.fn()
}));

import { listWebhooks, createWebhook } from "@/lib/webex/client";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { deliverPeachtreePipeline } from "@/lib/webex/automation";
import { POST as registerPost, DELETE as registerDelete } from "@/app/api/webex/webhooks/register/route";
import { POST as webhookPost } from "@/app/api/webex/webhooks/transcripts/route";
import { writeTokenRecord, getProcessedTranscript, markTranscriptProcessed, readWebhookRecord } from "@/lib/webex/store";

let isolate: { cleanup: () => void };

async function connectFakeToken() {
  await writeTokenRecord({
    accessToken: "AT-1",
    refreshToken: "RT-1",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshExpiresAt: null,
    scope: "meeting:transcripts_read",
    obtainedAt: new Date().toISOString(),
    lastRefreshedAt: null,
    lastRefreshError: null
  });
}

beforeEach(() => {
  isolate = useIsolatedDataDir();
  vi.mocked(listWebhooks).mockReset();
  vi.mocked(createWebhook).mockReset();
  vi.mocked(runSignalAgent).mockReset();
  vi.mocked(deliverPeachtreePipeline).mockReset();
  delete process.env.WEBEX_PUBLIC_BASE_URL;
});

afterEach(() => {
  isolate.cleanup();
});

describe("POST /api/webex/webhooks/register", () => {
  it("requires WEBEX_PUBLIC_BASE_URL before registering (rejects empty/localhost)", async () => {
    await connectFakeToken();
    delete process.env.WEBEX_PUBLIC_BASE_URL;
    const response = await registerPost();
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("public URL is required");
  });

  it("registers meetingTranscripts/created against the public target URL", async () => {
    await connectFakeToken();
    process.env.WEBEX_PUBLIC_BASE_URL = "https://pilot.example.com";
    vi.mocked(listWebhooks).mockResolvedValue([]);
    vi.mocked(createWebhook).mockResolvedValue({ id: "wh-1", name: "x", targetUrl: "https://pilot.example.com/api/webex/webhooks/transcripts", resource: "meetingTranscripts", event: "created", status: "active" });

    const response = await registerPost();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.registered).toBe(true);
    expect(createWebhook).toHaveBeenCalledWith(
      "AT-1",
      expect.objectContaining({ resource: "meetingTranscripts", event: "created", targetUrl: "https://pilot.example.com/api/webex/webhooks/transcripts" })
    );
  });

  it("avoids duplicate registrations for the same target URL", async () => {
    await connectFakeToken();
    process.env.WEBEX_PUBLIC_BASE_URL = "https://pilot.example.com";
    vi.mocked(listWebhooks).mockResolvedValue([]);
    vi.mocked(createWebhook).mockResolvedValue({ id: "wh-1", name: "x", targetUrl: "https://pilot.example.com/api/webex/webhooks/transcripts", resource: "meetingTranscripts", event: "created", status: "active" });

    const first = await registerPost();
    expect((await first.json()).alreadyRegistered).toBe(false);

    const second = await registerPost();
    const secondData = await second.json();
    expect(secondData.registered).toBe(true);
    expect(secondData.alreadyRegistered).toBe(true);
    // Only the first call should have actually hit the Webex API.
    expect(createWebhook).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/webex/webhooks/register", () => {
  it("removes the registered webhook", async () => {
    await connectFakeToken();
    process.env.WEBEX_PUBLIC_BASE_URL = "https://pilot.example.com";
    vi.mocked(listWebhooks).mockResolvedValue([]);
    vi.mocked(createWebhook).mockResolvedValue({ id: "wh-1", name: "x", targetUrl: "https://pilot.example.com/api/webex/webhooks/transcripts", resource: "meetingTranscripts", event: "created", status: "active" });
    await registerPost();
    expect(await readWebhookRecord()).not.toBeNull();

    await registerDelete();
    expect(await readWebhookRecord()).toBeNull();
  });
});

describe("POST /api/webex/webhooks/transcripts", () => {
  it("returns HTTP 200 immediately for a documented meetingTranscripts/created event", async () => {
    process.env.WEBEX_AUTOPILOT_ENABLED = "true";
    const payload = {
      id: "webhook-event-1",
      resource: "meetingTranscripts",
      event: "created",
      data: { id: "transcript-1", meetingId: "meeting-1", hostEmail: "host@example.com" }
    };
    const request = new Request("http://localhost/api/webex/webhooks/transcripts", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const response = await webhookPost(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.received).toBe(true);
  });

  it("ignores events for a resource/event combination other than meetingTranscripts/created", async () => {
    const payload = { id: "e", resource: "messages", event: "created", data: { id: "m-1" } };
    const request = new Request("http://localhost/api/webex/webhooks/transcripts", { method: "POST", body: JSON.stringify(payload) });
    const response = await webhookPost(request);
    const data = await response.json();
    expect(data.ignored).toBe(true);
  });

  it("does not reprocess a transcript that was already marked processed (duplicate event guard)", async () => {
    process.env.WEBEX_AUTOPILOT_ENABLED = "true";
    await connectFakeToken();
    await markTranscriptProcessed({ transcriptId: "transcript-dup", processedAt: new Date().toISOString(), lanesSent: ["sales"], verdict: "HIGH_INTENT", runId: "run-1" });

    const payload = { id: "e", resource: "meetingTranscripts", event: "created", data: { id: "transcript-dup", meetingId: "m-1" } };
    const request = new Request("http://localhost/api/webex/webhooks/transcripts", { method: "POST", body: JSON.stringify(payload) });
    const response = await webhookPost(request);
    expect(response.status).toBe(200);

    // Give the fire-and-forget background task a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(runSignalAgent).not.toHaveBeenCalled();
    expect(deliverPeachtreePipeline).not.toHaveBeenCalled();

    const record = await getProcessedTranscript("transcript-dup");
    expect(record?.lanesSent).toEqual(["sales"]);
  });

  it("rejects a request with an invalid signature when WEBEX_WEBHOOK_SECRET is configured", async () => {
    process.env.WEBEX_WEBHOOK_SECRET = "shared-secret";
    const payload = { id: "e", resource: "meetingTranscripts", event: "created", data: { id: "t-x" } };
    const request = new Request("http://localhost/api/webex/webhooks/transcripts", {
      method: "POST",
      headers: { "x-spark-signature": "not-a-valid-signature" },
      body: JSON.stringify(payload)
    });
    const response = await webhookPost(request);
    expect(response.status).toBe(401);
    delete process.env.WEBEX_WEBHOOK_SECRET;
  });
});
