import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";

vi.mock("@/lib/webex/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webex/client")>("@/lib/webex/client");
  return {
    ...actual,
    exchangeCodeForToken: vi.fn(),
    refreshAccessToken: vi.fn(),
    getMyIdentity: vi.fn()
  };
});

import { exchangeCodeForToken, getMyIdentity, refreshAccessToken } from "@/lib/webex/client";
import { GET as startGet } from "@/app/api/webex/oauth/start/route";
import { GET as callbackGet } from "@/app/api/webex/oauth/callback/route";
import { POST as disconnectPost } from "@/app/api/webex/oauth/disconnect/route";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { readTokenRecord, saveOAuthState } from "@/lib/webex/store";

let isolate: { cleanup: () => void };

beforeEach(() => {
  isolate = useIsolatedDataDir();
  process.env.WEBEX_CLIENT_ID = "test-client-id";
  process.env.WEBEX_CLIENT_SECRET = "test-client-secret";
  process.env.WEBEX_REDIRECT_URI = "http://localhost:3010/api/webex/oauth/callback";
  vi.mocked(exchangeCodeForToken).mockReset();
  vi.mocked(refreshAccessToken).mockReset();
  vi.mocked(getMyIdentity).mockReset();
});

afterEach(() => {
  isolate.cleanup();
  delete process.env.WEBEX_CLIENT_ID;
  delete process.env.WEBEX_CLIENT_SECRET;
});

describe("GET /api/webex/oauth/start", () => {
  it("redirects to the Webex authorize URL with the configured scopes", async () => {
    process.env.WEBEX_SCOPES = "meeting:transcripts_read spark:people_read";
    const response = await startGet();
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).toContain("https://webexapis.com/v1/authorize");
    expect(location).toContain("meeting%3Atranscripts_read");
  });

  it("returns 400 when WEBEX_CLIENT_ID is not configured", async () => {
    delete process.env.WEBEX_CLIENT_ID;
    const response = await startGet();
    expect(response.status).toBe(400);
  });
});

describe("GET /api/webex/oauth/callback", () => {
  it("exchanges the code for a token, loads identity, and redirects to ?webex=connected", async () => {
    await saveOAuthState("valid-state");
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "AT-1",
      refresh_token: "RT-1",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      token_type: "Bearer",
      scope: "meeting:transcripts_read spark:people_read"
    });
    vi.mocked(getMyIdentity).mockResolvedValue({ id: "person-1", displayName: "Test User", emails: ["test@example.com"] });

    const request = new Request("http://localhost/api/webex/oauth/callback?code=abc&state=valid-state");
    const response = await callbackGet(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("webex=connected");

    const record = await readTokenRecord();
    expect(record?.accessToken).toBe("AT-1");
    expect(record?.refreshToken).toBe("RT-1");
  });

  it("redirects to ?webex=error when the state does not match (CSRF protection)", async () => {
    await saveOAuthState("real-state");
    const request = new Request("http://localhost/api/webex/oauth/callback?code=abc&state=wrong-state");
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toContain("webex=error");
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/webex/oauth/disconnect", () => {
  it("removes the saved connection", async () => {
    await saveOAuthState("state-1");
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "AT-2",
      refresh_token: "RT-2",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      token_type: "Bearer"
    });
    vi.mocked(getMyIdentity).mockResolvedValue({ id: "p", displayName: "P", emails: [] });
    await callbackGet(new Request("http://localhost/api/webex/oauth/callback?code=x&state=state-1"));
    expect(await readTokenRecord()).not.toBeNull();

    const response = await disconnectPost();
    expect(response.status).toBe(200);
    expect(await readTokenRecord()).toBeNull();
  });
});

describe("OAuth token refresh", () => {
  it("refreshes the access token when it is near expiry", async () => {
    await saveOAuthState("state-refresh");
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "AT-expiring",
      refresh_token: "RT-original",
      expires_in: 1, // expires almost immediately -> triggers refresh on next getValidAccessToken()
      refresh_token_expires_in: 7200,
      token_type: "Bearer"
    });
    vi.mocked(getMyIdentity).mockResolvedValue({ id: "p", displayName: "P", emails: [] });
    await callbackGet(new Request("http://localhost/api/webex/oauth/callback?code=x&state=state-refresh"));

    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: "AT-refreshed",
      refresh_token: "RT-refreshed",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      token_type: "Bearer"
    });

    const { accessToken, health } = await getValidAccessToken();
    expect(refreshAccessToken).toHaveBeenCalledWith({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "RT-original"
    });
    expect(accessToken).toBe("AT-refreshed");
    expect(health).toBe("healthy");
  });

  it("reports refresh_failed and never crashes when the refresh call fails", async () => {
    await saveOAuthState("state-refresh-fail");
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "AT-expiring-2",
      refresh_token: "RT-original-2",
      expires_in: 1,
      refresh_token_expires_in: 7200,
      token_type: "Bearer"
    });
    vi.mocked(getMyIdentity).mockResolvedValue({ id: "p", displayName: "P", emails: [] });
    await callbackGet(new Request("http://localhost/api/webex/oauth/callback?code=x&state=state-refresh-fail"));

    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("invalid_grant"));

    const { health } = await getValidAccessToken();
    expect(health).toBe("refresh_failed");
  });
});
