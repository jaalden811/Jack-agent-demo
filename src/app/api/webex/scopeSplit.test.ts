import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";

vi.mock("@/lib/webex/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webex/client")>("@/lib/webex/client");
  return { ...actual, exchangeCodeForToken: vi.fn(), getMyIdentity: vi.fn() };
});

import { exchangeCodeForToken, getMyIdentity } from "@/lib/webex/client";
import { GET as startGet } from "@/app/api/webex/oauth/start/route";
import { GET as enableTranscriptsGet } from "@/app/api/webex/oauth/enable-transcripts/route";
import { GET as callbackGet } from "@/app/api/webex/oauth/callback/route";
import { GET as statusGet } from "@/app/api/webex/status/route";
import { GET as autopilotGet, POST as autopilotPost } from "@/app/api/webex/autopilot/route";
import { GET as transcriptsGet } from "@/app/api/webex/transcripts/route";
import { readLastOAuthError, readTokenRecord } from "@/lib/webex/store";
import { getCoreScopes, getTranscriptEnabledScopes, TRANSCRIPT_SCOPE } from "@/lib/webex/scopePolicy";

let isolate: { cleanup: () => void };

beforeEach(() => {
  isolate = useIsolatedDataDir();
  process.env.WEBEX_CLIENT_ID = "test-client-id";
  process.env.WEBEX_CLIENT_SECRET = "test-client-secret";
  process.env.WEBEX_REDIRECT_URI = "http://localhost:3010/api/webex/oauth/callback";
  vi.mocked(exchangeCodeForToken).mockReset();
  vi.mocked(getMyIdentity).mockReset();
});

afterEach(() => {
  isolate.cleanup();
  delete process.env.WEBEX_CLIENT_ID;
  delete process.env.WEBEX_CLIENT_SECRET;
  delete process.env.WEBEX_PUBLIC_BASE_URL;
});

async function connectCore() {
  const startResponse = await startGet();
  const state = new URL(startResponse.headers.get("location")!).searchParams.get("state")!;
  vi.mocked(exchangeCodeForToken).mockResolvedValue({
    access_token: "AT-core",
    refresh_token: "RT-core",
    expires_in: 3600,
    refresh_token_expires_in: 7200,
    token_type: "Bearer",
    scope: "spark:people_read spark:messages_write meeting:schedules_read"
  });
  vi.mocked(getMyIdentity).mockResolvedValue({ id: "p1", displayName: "Test User", emails: ["test@example.com"] });
  await callbackGet(new Request(`http://localhost/api/webex/oauth/callback?code=abc&state=${state}`));
}

describe("Core vs optional Webex scopes", () => {
  it("getCoreScopes never includes the transcript scope, even if present in the configured value", () => {
    const core = getCoreScopes("spark:people_read meeting:transcripts_read spark:messages_write");
    expect(core).not.toContain(TRANSCRIPT_SCOPE);
    expect(core).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("getTranscriptEnabledScopes always includes the transcript scope plus the core set", () => {
    const full = getTranscriptEnabledScopes("spark:people_read spark:messages_write meeting:schedules_read");
    expect(full).toContain(TRANSCRIPT_SCOPE);
    expect(full).toEqual(expect.arrayContaining(["spark:people_read", "spark:messages_write", "meeting:schedules_read"]));
  });

  it("Connect Webex (core) succeeds and reports a fully usable connection without the transcript scope", async () => {
    await connectCore();
    const response = await statusGet();
    const data = await response.json();
    expect(data.connected).toBe(true);
    expect(data.capabilities.core_oauth).toBe(true);
    expect(data.capabilities.identity).toBe(true);
    expect(data.capabilities.messaging).toBe(true);
    expect(data.capabilities.meeting_schedules).toBe(true);
    expect(data.capabilities.meeting_transcripts).toBe(false);
    expect(data.capabilities.manual_transcript_import_available).toBe(false);
    expect(data.capabilities.outbound_delivery_available).toBe(true);
  });

  it("GET /api/webex/oauth/enable-transcripts requests core+transcript scopes together", async () => {
    const response = await enableTranscriptsGet();
    const location = new URL(response.headers.get("location")!);
    const scope = location.searchParams.get("scope")!;
    expect(scope).toContain("meeting:transcripts_read");
    expect(scope).toContain("spark:people_read");
  });

  it("a rejected transcript-scope grant is classified as transcript_scope_rejected with the precise instruction message, and does not disturb the existing core connection", async () => {
    await connectCore();

    const enableResponse = await enableTranscriptsGet();
    const state = new URL(enableResponse.headers.get("location")!).searchParams.get("state")!;
    const failResponse = await callbackGet(
      new Request(`http://localhost/api/webex/oauth/callback?error=invalid_scope&error_description=The+requested+scope+is+invalid.&state=${state}`)
    );
    expect(failResponse.headers.get("location")).toContain("webex=error");

    const lastError = await readLastOAuthError();
    expect(lastError?.code).toBe("transcript_scope_rejected");
    expect(lastError?.message).toContain("Core Webex OAuth works");
    expect(lastError?.message).toContain("meeting:transcripts_read");

    // The existing core connection must remain intact.
    const record = await readTokenRecord();
    expect(record?.accessToken).toBe("AT-core");
  });

  it("a successful transcript-scope grant updates the granted scopes and enables the manual-import capability", async () => {
    await connectCore();

    const enableResponse = await enableTranscriptsGet();
    const state = new URL(enableResponse.headers.get("location")!).searchParams.get("state")!;
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "AT-full",
      refresh_token: "RT-full",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      token_type: "Bearer",
      scope: "spark:people_read spark:messages_write meeting:schedules_read meeting:transcripts_read"
    });
    const response = await callbackGet(new Request(`http://localhost/api/webex/oauth/callback?code=xyz&state=${state}`));
    expect(response.headers.get("location")).toContain("webex=transcripts_enabled");

    const statusResponse = await statusGet();
    const data = await statusResponse.json();
    expect(data.capabilities.meeting_transcripts).toBe(true);
    expect(data.capabilities.manual_transcript_import_available).toBe(true);
  });
});

describe("Transcript autopilot remains gated on transcript scope + public URL", () => {
  it("is unavailable when connected with core scopes only, even with a public URL configured", async () => {
    await connectCore();
    process.env.WEBEX_PUBLIC_BASE_URL = "https://pilot.example.com";
    const response = await autopilotGet();
    const data = await response.json();
    expect(data.available).toBe(false);
  });

  it("rejects enabling autopilot without the transcript scope, with an actionable error", async () => {
    await connectCore();
    process.env.WEBEX_PUBLIC_BASE_URL = "https://pilot.example.com";
    const response = await autopilotPost(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ enabled: true }) }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("transcript access");
  });

  it("never registers/enables against a localhost or absent public URL, even with transcript scope granted", async () => {
    await connectCore();
    delete process.env.WEBEX_PUBLIC_BASE_URL;
    const response = await autopilotPost(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ enabled: true }) }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("public URL");
  });
});

describe("Manual transcript import shows an actionable permission error when transcript scope is missing", () => {
  it("GET /api/webex/transcripts returns a specific 403 (not a generic Webex API error) when the connected token lacks meeting:transcripts_read", async () => {
    await connectCore();
    const response = await transcriptsGet(new Request("http://localhost/api/webex/transcripts"));
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error_code).toBe("transcript_scope_missing");
    expect(data.detail).toContain("Enable transcript access");
  });
});
