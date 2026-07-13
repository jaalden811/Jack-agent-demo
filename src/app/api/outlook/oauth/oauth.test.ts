import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";

vi.mock("@/lib/outlook/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/outlook/client")>("@/lib/outlook/client");
  return {
    ...actual,
    exchangeCodeForToken: vi.fn(),
    refreshAccessToken: vi.fn(),
    getMyIdentity: vi.fn()
  };
});

import { exchangeCodeForToken, getMyIdentity } from "@/lib/outlook/client";
import { GET as startGet } from "@/app/api/outlook/oauth/start/route";
import { GET as callbackGet } from "@/app/api/outlook/oauth/callback/route";
import { POST as disconnectPost } from "@/app/api/outlook/oauth/disconnect/route";
import { GET as statusGet } from "@/app/api/outlook/status/route";
import { readTokenRecord, saveOAuthState, readLastOAuthError } from "@/lib/outlook/store";

let isolate: { cleanup: () => void };

beforeEach(() => {
  isolate = useIsolatedDataDir();
  process.env.MICROSOFT_CLIENT_ID = "test-ms-client-id";
  process.env.MICROSOFT_CLIENT_SECRET = "test-ms-client-secret";
  process.env.MICROSOFT_TENANT_ID = "organizations";
  process.env.MICROSOFT_REDIRECT_URI = "http://localhost:3010/api/outlook/oauth/callback";
  vi.mocked(exchangeCodeForToken).mockReset();
  vi.mocked(getMyIdentity).mockReset();
});

afterEach(() => {
  isolate.cleanup();
  delete process.env.MICROSOFT_CLIENT_ID;
  delete process.env.MICROSOFT_CLIENT_SECRET;
});

describe("GET /api/outlook/oauth/start", () => {
  it("redirects to the Microsoft authorize URL requesting Mail.Send and offline_access, with PKCE", async () => {
    process.env.MICROSOFT_SCOPES = "openid profile offline_access User.Read Mail.Send";
    const response = await startGet();
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).toContain("login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(location).toContain("Mail.Send");
    expect(location).toContain("offline_access");
    expect(location).toContain("code_challenge=");
    expect(location).toContain("code_challenge_method=S256");
  });

  it("returns 400 when Microsoft OAuth is not configured", async () => {
    delete process.env.MICROSOFT_CLIENT_ID;
    const response = await startGet();
    expect(response.status).toBe(400);
  });
});

describe("GET /api/outlook/oauth/callback", () => {
  it("exchanges the code + PKCE verifier for a token, stores access/refresh token metadata, and redirects to ?outlook=connected", async () => {
    const startResponse = await startGet();
    const location = new URL(startResponse.headers.get("location")!);
    const state = location.searchParams.get("state")!;

    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "MS-AT-1",
      refresh_token: "MS-RT-1",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "openid profile offline_access User.Read Mail.Send"
    });
    vi.mocked(getMyIdentity).mockResolvedValue({ id: "ms-user-1", displayName: "Test User", mail: "test@example.com" });

    const request = new Request(`http://localhost/api/outlook/oauth/callback?code=abc&state=${state}`);
    const response = await callbackGet(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("outlook=connected");

    const record = await readTokenRecord();
    expect(record?.accessToken).toBe("MS-AT-1");
    expect(record?.refreshToken).toBe("MS-RT-1");

    expect(vi.mocked(exchangeCodeForToken).mock.calls[0][0]).toMatchObject({ codeVerifier: expect.any(String) });
  });

  it("redirects to ?outlook=error and records state_mismatch when the state does not match (CSRF protection)", async () => {
    await saveOAuthState("real-state", "verifier-1");
    const request = new Request("http://localhost/api/outlook/oauth/callback?code=abc&state=wrong-state");
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toContain("outlook=error");
    expect(exchangeCodeForToken).not.toHaveBeenCalled();

    const lastError = await readLastOAuthError();
    expect(lastError?.code).toBe("state_mismatch");
  });
});

describe("POST /api/outlook/oauth/disconnect", () => {
  it("removes the saved connection", async () => {
    await saveOAuthState("state-1", "verifier-1");
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "MS-AT-2",
      refresh_token: "MS-RT-2",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "openid profile offline_access User.Read Mail.Send"
    });
    vi.mocked(getMyIdentity).mockResolvedValue({ id: "u", displayName: "U", mail: "u@example.com" });
    await callbackGet(new Request("http://localhost/api/outlook/oauth/callback?code=x&state=state-1"));
    expect(await readTokenRecord()).not.toBeNull();

    const response = await disconnectPost();
    expect(response.status).toBe(200);
    expect(await readTokenRecord()).toBeNull();
  });
});

describe("GET /api/outlook/status", () => {
  it("reports mail_send_available true only once connected with the Mail.Send scope granted", async () => {
    await saveOAuthState("state-mail-send", "verifier-2");
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      access_token: "MS-AT-3",
      refresh_token: "MS-RT-3",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "openid profile offline_access User.Read Mail.Send"
    });
    vi.mocked(getMyIdentity).mockResolvedValue({ id: "u2", displayName: "U2", mail: "u2@example.com" });
    await callbackGet(new Request("http://localhost/api/outlook/oauth/callback?code=x&state=state-mail-send"));

    const response = await statusGet();
    const data = await response.json();
    expect(data.connected).toBe(true);
    expect(data.mail_send_available).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/MS-AT-|MS-RT-/);
  });
});
