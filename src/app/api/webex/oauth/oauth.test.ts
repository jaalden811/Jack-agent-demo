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
import { GET as diagnosticsGet } from "@/app/api/webex/diagnostics/route";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { readTokenRecord, saveOAuthState, readLastOAuthError } from "@/lib/webex/store";

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

  it("redirects to ?webex=error when the state does not match (CSRF protection), and records state_mismatch — not a generic failure", async () => {
    await saveOAuthState("real-state");
    const request = new Request("http://localhost/api/webex/oauth/callback?code=abc&state=wrong-state");
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toContain("webex=error");
    expect(exchangeCodeForToken).not.toHaveBeenCalled();

    const lastError = await readLastOAuthError();
    expect(lastError?.code).toBe("state_mismatch");
  });

  it("surfaces the specific reason (not just 'Could not connect Webex') when the token exchange is rejected", async () => {
    await saveOAuthState("state-reject");
    vi.mocked(exchangeCodeForToken).mockRejectedValue(new Error("Webex API error (400): The redirect_uri provided does not match the registered redirect URI"));

    const request = new Request("http://localhost/api/webex/oauth/callback?code=abc&state=state-reject");
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toContain("webex=error");

    const lastError = await readLastOAuthError();
    expect(lastError?.code).toBe("redirect_uri_mismatch");
    expect(lastError?.message).toContain("redirect_uri");
  });

  it("classifies user_denied when Webex redirects back with error=access_denied", async () => {
    const request = new Request("http://localhost/api/webex/oauth/callback?error=access_denied&error_description=User+declined");
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toContain("webex=error");

    const lastError = await readLastOAuthError();
    expect(lastError?.code).toBe("user_denied");
  });

  it("classifies identity_lookup_failed when the token exchange succeeds but GET /people/me fails", async () => {
    await saveOAuthState("state-identity-fail");
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "AT-3",
      refresh_token: "RT-3",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      token_type: "Bearer",
      scope: "meeting:transcripts_read"
    });
    vi.mocked(getMyIdentity).mockRejectedValue(new Error("Webex API error (401): missing spark:people_read scope"));

    const request = new Request("http://localhost/api/webex/oauth/callback?code=abc&state=state-identity-fail");
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toContain("webex=error");

    const lastError = await readLastOAuthError();
    expect(lastError?.code).toBe("identity_lookup_failed");
  });
});

describe("GET /api/webex/diagnostics", () => {
  it("returns the exact configured redirect URI, requested scopes, and last error code/message — never a token", async () => {
    process.env.WEBEX_REDIRECT_URI = "http://localhost:3010/api/webex/oauth/callback";
    process.env.WEBEX_SCOPES = "meeting:transcripts_read spark:messages_write";
    await saveOAuthState("state-diag");
    vi.mocked(exchangeCodeForToken).mockRejectedValue(new Error("Webex API error (400): redirect_uri mismatch"));
    await callbackGet(new Request("http://localhost/api/webex/oauth/callback?code=abc&state=state-diag"));

    const response = await diagnosticsGet();
    const data = await response.json();

    expect(data.configured).toBe(true);
    expect(data.connected).toBe(false);
    expect(data.redirect_uri).toBe("http://localhost:3010/api/webex/oauth/callback");
    expect(data.requested_scopes).toEqual(["meeting:transcripts_read", "spark:messages_write"]);
    expect(data.last_error_code).toBe("redirect_uri_mismatch");
    expect(JSON.stringify(data)).not.toMatch(/AT-|RT-|access_token|refresh_token/i);
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
