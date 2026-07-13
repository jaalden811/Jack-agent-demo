import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, generateCodeChallenge, generateCodeVerifier, sendMail, GraphApiError } from "@/lib/outlook/client";

describe("buildAuthorizeUrl", () => {
  it("includes Mail.Send and offline_access in the requested scope, plus PKCE parameters", () => {
    const codeVerifier = generateCodeVerifier();
    const url = buildAuthorizeUrl({
      tenantId: "organizations",
      clientId: "client-1",
      redirectUri: "http://localhost:3010/api/outlook/oauth/callback",
      scopes: "openid profile offline_access User.Read Mail.Send",
      state: "state-1",
      codeChallenge: generateCodeChallenge(codeVerifier)
    });

    expect(url).toContain("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(url).toContain("Mail.Send");
    expect(url).toContain("offline_access");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("response_type=code");
  });
});

describe("PKCE code verifier / challenge", () => {
  it("produces a deterministic S256 challenge for a given verifier", () => {
    const verifier = "test-verifier-1234567890";
    const challenge1 = generateCodeChallenge(verifier);
    const challenge2 = generateCodeChallenge(verifier);
    expect(challenge1).toBe(challenge2);
    expect(challenge1).not.toBe(verifier);
  });
});

describe("sendMail", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to /me/sendMail and treats HTTP 202 as accepted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, ok: false, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendMail("access-token", { toEmail: "belrobin@cisco.com", subject: "Test", html: "<p>hi</p>", text: "hi" });
    expect(result).toEqual({ accepted: true, statusCode: 202 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.message.toRecipients[0].emailAddress.address).toBe("belrobin@cisco.com");
    expect(body.saveToSentItems).toBe(true);
  });

  it("throws a GraphApiError with the Graph error detail on a non-202 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
      json: async () => ({ error: { message: "Mail.Send permission is missing" } })
    }) as unknown as typeof fetch;

    await expect(sendMail("access-token", { toEmail: "x@example.com", subject: "s", html: "h", text: "t" })).rejects.toThrow(GraphApiError);
  });
});
