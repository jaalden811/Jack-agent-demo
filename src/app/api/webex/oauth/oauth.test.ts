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
import { POST as resetPost } from "@/app/api/webex/oauth/reset/route";
import { GET as diagnosticsGet } from "@/app/api/webex/diagnostics/route";
import { POST as minimalScopePost } from "@/app/api/webex/diagnostics/minimal-scope/route";
import { POST as scopeTestPost } from "@/app/api/webex/diagnostics/scope-test/route";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { readTokenRecord, readIdentityRecord, saveOAuthState, readLastOAuthError } from "@/lib/webex/store";

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

  it("normalizes a comma-separated, quoted WEBEX_SCOPES into a clean space-separated scope param with no quotes/commas/duplicates", async () => {
    process.env.WEBEX_SCOPES = '"spark:people_read","spark:people_read","spark:messages_write"';
    const response = await startGet();
    const location = new URL(response.headers.get("location")!);
    const scopeParam = location.searchParams.get("scope")!;
    expect(scopeParam).toBe("spark:people_read spark:messages_write");
    expect(scopeParam).not.toContain('"');
    expect(scopeParam).not.toContain(",");
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

  it("classifies invalid_scope when Webex's authorize redirect reports error=invalid_scope (the live failure this repair targets)", async () => {
    const request = new Request(
      "http://localhost/api/webex/oauth/callback?error=invalid_scope&error_description=The+requested+scope+is+invalid."
    );
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toContain("webex=error");

    const lastError = await readLastOAuthError();
    expect(lastError?.code).toBe("invalid_scope");
    expect(lastError?.message).toBe("The requested scope is invalid.");
  });

  it("also classifies invalid_scope when it only surfaces from the token endpoint's error body", async () => {
    await saveOAuthState("state-invalid-scope-token");
    vi.mocked(exchangeCodeForToken).mockRejectedValue(new Error("Webex API error (400): invalid_scope: one or more scopes are not enabled"));
    const request = new Request("http://localhost/api/webex/oauth/callback?code=abc&state=state-invalid-scope-token");
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toContain("webex=error");

    const lastError = await readLastOAuthError();
    expect(lastError?.code).toBe("invalid_scope");
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

  it("returns requested_scopes_raw, client_id/secret configured booleans, authorization_url_origin, and the failing scope set — never the client id/secret values", async () => {
    process.env.WEBEX_SCOPES = '"meeting:transcripts_read","spark:messages_write"';
    await saveOAuthState("state-diag-2");
    vi.mocked(exchangeCodeForToken).mockRejectedValue(new Error("Webex API error (400): invalid_scope: one or more scopes are not enabled"));
    await callbackGet(new Request("http://localhost/api/webex/oauth/callback?code=abc&state=state-diag-2"));

    const response = await diagnosticsGet();
    const data = await response.json();

    expect(data.requested_scopes_raw).toBe('"meeting:transcripts_read","spark:messages_write"');
    expect(data.requested_scopes).toEqual(["meeting:transcripts_read", "spark:messages_write"]);
    expect(data.authorization_url_origin).toBe("https://webexapis.com");
    expect(data.client_id_configured).toBe(true);
    expect(data.client_secret_configured).toBe(true);
    expect(data.last_error_code).toBe("invalid_scope");
    expect(data.last_failed_scope_set).toEqual(["meeting:transcripts_read", "spark:messages_write"]);
    expect(JSON.stringify(data)).not.toContain("test-client-id");
    expect(JSON.stringify(data)).not.toContain("test-client-secret");
  });

  it("includes all four incremental scope diagnostic tests, defaulting to not_run", async () => {
    const response = await diagnosticsGet();
    const data = await response.json();
    const testIds = data.scope_tests.map((t: { test_id: string }) => t.test_id);
    expect(testIds).toEqual(["identity", "messaging", "meetings", "transcripts"]);
    expect(data.scope_tests.every((t: { status: string }) => t.status === "not_run")).toBe(true);
  });
});

describe("POST /api/webex/oauth/reset", () => {
  it("clears the pending OAuth state and last error so a stuck handshake can be retried cleanly", async () => {
    await saveOAuthState("stuck-state");
    await callbackGet(new Request("http://localhost/api/webex/oauth/callback?error=invalid_scope&error_description=bad"));
    expect((await readLastOAuthError())?.code).toBe("invalid_scope");

    const response = await resetPost();
    expect(response.status).toBe(200);
    expect(await readLastOAuthError()).toBeNull();

    // The old state (even if somehow replayed) is no longer valid.
    const replay = await callbackGet(new Request("http://localhost/api/webex/oauth/callback?code=abc&state=stuck-state"));
    expect(replay.headers.get("location")).toContain("webex=error");
  });
});

describe("POST /api/webex/diagnostics/minimal-scope", () => {
  it("initiates OAuth using only spark:people_read, independent of the configured production scope set", async () => {
    process.env.WEBEX_SCOPES = "meeting:transcripts_read meeting:schedules_read spark:people_read spark:rooms_read spark:messages_write";
    const response = await minimalScopePost();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.scopes).toEqual(["spark:people_read"]);

    const authorizeUrl = new URL(data.authorize_url);
    expect(authorizeUrl.searchParams.get("scope")).toBe("spark:people_read");
  });

  it("a successful minimal-scope probe never overwrites the main connection's token/identity state", async () => {
    const startResponse = await minimalScopePost();
    const { authorize_url } = await startResponse.json();
    const state = new URL(authorize_url).searchParams.get("state")!;

    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "DIAGNOSTIC-AT",
      refresh_token: "DIAGNOSTIC-RT",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      token_type: "Bearer",
      scope: "spark:people_read"
    });
    vi.mocked(getMyIdentity).mockResolvedValue({ id: "diag-person", displayName: "Diagnostic User", emails: ["diag@example.com"] });

    const response = await callbackGet(new Request(`http://localhost/api/webex/oauth/callback?code=diag-code&state=${state}`));
    expect(response.headers.get("location")).toContain("webex=diagnostic");
    expect(response.headers.get("location")).toContain("test=identity");
    expect(response.headers.get("location")).toContain("result=success");

    // Main connection state must remain untouched.
    expect(await readTokenRecord()).toBeNull();
    expect(await readIdentityRecord()).toBeNull();

    const diagnostics = await (await diagnosticsGet()).json();
    const identityTest = diagnostics.scope_tests.find((t: { test_id: string }) => t.test_id === "identity");
    expect(identityTest.status).toBe("success");
  });

  it("a failed minimal-scope probe records the failure on the scope test only, not on the main last-oauth-error", async () => {
    const startResponse = await minimalScopePost();
    const { authorize_url } = await startResponse.json();
    const state = new URL(authorize_url).searchParams.get("state")!;

    const response = await callbackGet(
      new Request(`http://localhost/api/webex/oauth/callback?error=invalid_scope&error_description=bad&state=${state}`)
    );
    expect(response.headers.get("location")).toContain("webex=diagnostic");
    expect(response.headers.get("location")).toContain("result=failed");

    expect(await readLastOAuthError()).toBeNull();
    const diagnostics = await (await diagnosticsGet()).json();
    const identityTest = diagnostics.scope_tests.find((t: { test_id: string }) => t.test_id === "identity");
    expect(identityTest.status).toBe("failed");
    expect(identityTest.error_code).toBe("invalid_scope");
  });
});

describe("POST /api/webex/diagnostics/scope-test", () => {
  it("uses the expected cumulative scope set for each incremental test", async () => {
    const identity = await (await scopeTestPost(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ testId: "identity" }) }))).json();
    expect(identity.scopes).toEqual(["spark:people_read"]);

    const messaging = await (await scopeTestPost(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ testId: "messaging" }) }))).json();
    expect(messaging.scopes).toEqual(["spark:people_read", "spark:messages_write"]);

    const meetings = await (await scopeTestPost(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ testId: "meetings" }) }))).json();
    expect(meetings.scopes).toEqual(["spark:people_read", "spark:messages_write", "meeting:schedules_read"]);

    const transcripts = await (
      await scopeTestPost(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ testId: "transcripts" }) }))
    ).json();
    expect(transcripts.scopes).toEqual(["spark:people_read", "spark:messages_write", "meeting:schedules_read", "meeting:transcripts_read"]);
  });

  it("rejects an unknown testId", async () => {
    const response = await scopeTestPost(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ testId: "bogus" }) }));
    expect(response.status).toBe(400);
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
