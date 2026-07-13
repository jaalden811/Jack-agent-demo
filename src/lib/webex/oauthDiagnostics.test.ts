import { describe, expect, it } from "vitest";
import { classifyAuthorizeRedirectError, classifyWebexOAuthError } from "@/lib/webex/oauthDiagnostics";
import { WebexApiError } from "@/lib/webex/client";

describe("classifyWebexOAuthError", () => {
  it("maps a redirect_uri error message to redirect_uri_mismatch", () => {
    const record = classifyWebexOAuthError(new WebexApiError("Webex API error (400): The redirect_uri does not match", 400), "token_exchange");
    expect(record.code).toBe("redirect_uri_mismatch");
  });

  it("maps an invalid client secret message to invalid_client_secret", () => {
    const record = classifyWebexOAuthError(new Error("invalid_client_secret: client secret is invalid"), "token_exchange");
    expect(record.code).toBe("invalid_client_secret");
  });

  it("maps an invalid_client message to invalid_client", () => {
    const record = classifyWebexOAuthError(new Error("invalid_client: unknown client"), "token_exchange");
    expect(record.code).toBe("invalid_client");
  });

  it("maps an invalid_scope message to invalid_scope", () => {
    const record = classifyWebexOAuthError(new Error("invalid_scope: one or more scopes are not enabled"), "token_exchange");
    expect(record.code).toBe("invalid_scope");
  });

  it("classifies an identity-lookup 401 as identity_lookup_failed", () => {
    const record = classifyWebexOAuthError(new WebexApiError("Webex API error (401): unauthorized", 401), "identity_lookup");
    expect(record.code).toBe("identity_lookup_failed");
  });

  it("classifies a token_store phase failure as token_store_failed", () => {
    const record = classifyWebexOAuthError(new Error("ENOSPC: no space left on device"), "token_store");
    expect(record.code).toBe("token_store_failed");
  });

  it("never returns an access/refresh token in the message", () => {
    const record = classifyWebexOAuthError(new Error("token exchange failed"), "token_exchange");
    expect(record.message).not.toMatch(/access_token|refresh_token/i);
  });
});

describe("classifyAuthorizeRedirectError", () => {
  it("maps Webex's access_denied redirect param to user_denied", () => {
    const record = classifyAuthorizeRedirectError("access_denied", "The user declined");
    expect(record.code).toBe("user_denied");
  });

  it("falls back to token_exchange_failed for an unrecognized error param", () => {
    const record = classifyAuthorizeRedirectError("server_error", null);
    expect(record.code).toBe("token_exchange_failed");
  });
});
