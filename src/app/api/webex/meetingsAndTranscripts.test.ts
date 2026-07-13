import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";

vi.mock("@/lib/webex/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webex/client")>("@/lib/webex/client");
  return {
    ...actual,
    listMeetings: vi.fn(),
    listMeetingTranscripts: vi.fn(),
    listTranscriptSnippets: vi.fn(),
    downloadTranscriptText: vi.fn()
  };
});

import { listMeetings, listMeetingTranscripts, listTranscriptSnippets } from "@/lib/webex/client";
import { GET as meetingsGet } from "@/app/api/webex/meetings/route";
import { GET as transcriptsGet } from "@/app/api/webex/transcripts/route";
import { GET as transcriptDetailGet } from "@/app/api/webex/transcripts/[transcriptId]/route";
import { writeTokenRecord } from "@/lib/webex/store";

let isolate: { cleanup: () => void };

async function connectFakeToken() {
  await writeTokenRecord({
    accessToken: "AT-1",
    refreshToken: "RT-1",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshExpiresAt: null,
    scope: "meeting:transcripts_read meeting:schedules_read",
    obtainedAt: new Date().toISOString(),
    lastRefreshedAt: null,
    lastRefreshError: null
  });
}

beforeEach(() => {
  isolate = useIsolatedDataDir();
  vi.mocked(listMeetings).mockReset();
  vi.mocked(listMeetingTranscripts).mockReset();
  vi.mocked(listTranscriptSnippets).mockReset();
});

afterEach(() => {
  isolate.cleanup();
});

describe("GET /api/webex/meetings", () => {
  it("requires a connected Webex user", async () => {
    const response = await meetingsGet(new Request("http://localhost/api/webex/meetings"));
    expect(response.status).toBe(401);
  });

  it("lists recent meetings and supports a title filter", async () => {
    await connectFakeToken();
    vi.mocked(listMeetings).mockResolvedValue([
      { id: "m-1", title: "Acme Retail QBR", start: "2026-01-01T00:00:00Z" },
      { id: "m-2", title: "Weekly standup", start: "2026-01-02T00:00:00Z" }
    ]);

    const response = await meetingsGet(new Request("http://localhost/api/webex/meetings?title=acme"));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe("m-1");
  });
});

describe("GET /api/webex/transcripts", () => {
  it("lists transcripts and supports filtering by meetingId (passed through to the client call)", async () => {
    await connectFakeToken();
    vi.mocked(listMeetingTranscripts).mockResolvedValue([{ id: "t-1", meetingTopic: "Acme Retail QBR", meetingId: "m-1", startTime: "2026-01-01T00:00:00Z" }]);

    const response = await transcriptsGet(new Request("http://localhost/api/webex/transcripts?meetingId=m-1"));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(1);
    expect(listMeetingTranscripts).toHaveBeenCalledWith("AT-1", { meetingId: "m-1", from: undefined, to: undefined });
  });
});

describe("GET /api/webex/transcripts/[transcriptId]", () => {
  it("retrieves transcript metadata + snippets and normalizes them, preserving source metadata", async () => {
    await connectFakeToken();
    vi.mocked(listMeetingTranscripts).mockResolvedValue([
      { id: "t-1", meetingTopic: "Acme Retail QBR", meetingId: "m-1", hostUserId: "host-1", startTime: "2026-01-01T00:00:00Z" }
    ]);
    vi.mocked(listTranscriptSnippets).mockResolvedValue([{ id: "s1", text: "We have too many consoles.", personName: "Jordan Lee" }]);

    const response = await transcriptDetailGet(new Request("http://localhost/api/webex/transcripts/t-1"), {
      params: Promise.resolve({ transcriptId: "t-1" })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transcriptId).toBe("t-1");
    expect(data.meetingId).toBe("m-1");
    expect(data.meetingTitle).toBe("Acme Retail QBR");
    expect(data.source).toBe("webex");
    expect(data.transcriptText).toContain("We have too many consoles.");
  });
});
