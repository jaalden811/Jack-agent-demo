import { WebexApiError } from "@/lib/webex/client";
import type { WebexOAuthErrorCode, WebexOAuthErrorRecord } from "@/lib/webex/store";

/**
 * Turns a raw failure from any step of the Webex OAuth flow into one of
 * the specific, actionable error codes the UI can render (instead of a
 * single generic "Could not connect Webex."). Every code maps to
 * something a developer can act on — the wrong redirect URI, a rejected
 * client secret, a denied consent screen, etc.
 */

export type OAuthPhase = "authorize_redirect" | "token_exchange" | "identity_lookup" | "token_store";

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

const TRANSCRIPT_SCOPE_REJECTED_MESSAGE =
  "Core Webex OAuth works, but transcript access was rejected. Edit the Webex Integration, enable meeting:transcripts_read, save the integration, reset OAuth state, and reconnect.";

function classifyRawScopeIssue(lower: string): boolean {
  return lower.includes("invalid_scope") || lower.includes("invalid scope");
}

export function classifyWebexOAuthError(error: unknown, phase: OAuthPhase, purpose: OAuthPurpose = "connect"): WebexOAuthErrorRecord {
  const rawMessage = messageOf(error);
  const lower = rawMessage.toLowerCase();
  const status = error instanceof WebexApiError ? error.status : undefined;

  let code: WebexOAuthErrorCode;
  let message = rawMessage;

  if (lower.includes("redirect_uri") || lower.includes("redirect uri")) {
    code = "redirect_uri_mismatch";
  } else if (lower.includes("invalid_client_secret") || lower.includes("client secret") || lower.includes("client_secret")) {
    code = "invalid_client_secret";
  } else if (lower.includes("invalid_client") || lower.includes("unknown client") || lower.includes("client not found")) {
    code = "invalid_client";
  } else if (classifyRawScopeIssue(lower) && phase !== "identity_lookup") {
    // A scope rejection during the dedicated "Enable transcript access"
    // flow is a precise, actionable signal — not a generic invalid_scope
    // — because that flow requests exactly core+transcript scopes and
    // core scopes are already proven to work independently.
    if (purpose === "enable_transcripts") {
      code = "transcript_scope_rejected";
      message = TRANSCRIPT_SCOPE_REJECTED_MESSAGE;
    } else {
      code = "invalid_scope";
    }
  } else if (lower.includes("access_denied") || lower.includes("denied") || lower.includes("user cancelled") || lower.includes("user canceled")) {
    code = "user_denied";
  } else if (phase === "identity_lookup") {
    code = "identity_lookup_failed";
  } else if (status === 401 || status === 403) {
    code = "invalid_client";
  } else if (phase === "token_store") {
    code = "token_store_failed";
  } else {
    code = "token_exchange_failed";
  }

  return { code, message, occurredAt: new Date().toISOString() };
}

export type OAuthPurpose = "connect" | "enable_transcripts";

/** Maps the `error` query param Webex appends to the redirect (e.g. when
 * the user declines consent on the authorize screen) to our error codes. */
export function classifyAuthorizeRedirectError(errorParam: string, errorDescription: string | null, purpose: OAuthPurpose = "connect"): WebexOAuthErrorRecord {
  const lower = errorParam.toLowerCase();
  let code: WebexOAuthErrorCode = "token_exchange_failed";
  let message = errorDescription || `Webex returned error=${errorParam} on the authorize redirect.`;

  if (lower === "access_denied") code = "user_denied";
  else if (lower.includes("redirect_uri")) code = "redirect_uri_mismatch";
  else if (lower.includes("invalid_scope")) {
    if (purpose === "enable_transcripts") {
      code = "transcript_scope_rejected";
      message = TRANSCRIPT_SCOPE_REJECTED_MESSAGE;
    } else {
      code = "invalid_scope";
    }
  } else if (lower.includes("invalid_client")) code = "invalid_client";

  return { code, message, occurredAt: new Date().toISOString() };
}

export const OAUTH_ERROR_HELP: Record<WebexOAuthErrorCode, string> = {
  redirect_uri_mismatch:
    "The redirect URI sent to Webex does not exactly match a redirect URI registered on the Webex OAuth Integration. Check WEBEX_REDIRECT_URI against the integration's registered redirect URI(s), including trailing slashes and port.",
  invalid_client: "Webex rejected the client ID. Check WEBEX_CLIENT_ID against the OAuth Integration's Client ID.",
  invalid_client_secret: "Webex rejected the client secret. Check WEBEX_CLIENT_SECRET against the OAuth Integration's Client Secret (secrets can be regenerated/rotated).",
  invalid_scope: "One or more requested scopes are not enabled on the Webex OAuth Integration. Check WEBEX_SCOPES against the scopes enabled for this integration.",
  transcript_scope_rejected: TRANSCRIPT_SCOPE_REJECTED_MESSAGE,
  user_denied: "The user declined to authorize the app on the Webex consent screen.",
  state_mismatch: "The OAuth state returned by Webex did not match the state this server issued — the login attempt may have expired or been replayed. Try connecting again.",
  token_exchange_failed: "Webex rejected the authorization-code-to-token exchange. See the message for Webex's specific reason.",
  identity_lookup_failed: "The token exchange succeeded, but GET /people/me failed — the granted scopes may not include spark:people_read, or the access token was rejected.",
  token_store_failed: "The token exchange succeeded, but the server could not persist the token record to local storage."
};
