import { GraphApiError } from "@/lib/outlook/client";
import type { OutlookErrorCode, OutlookErrorRecord } from "@/lib/outlook/types";

export type OutlookOAuthPhase = "token_exchange" | "identity_lookup" | "token_store" | "send_mail" | "token_refresh";

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

export function classifyOutlookError(error: unknown, phase: OutlookOAuthPhase): OutlookErrorRecord {
  const rawMessage = messageOf(error);
  const lower = rawMessage.toLowerCase();
  const status = error instanceof GraphApiError ? error.status : undefined;

  let code: OutlookErrorCode;

  if (lower.includes("redirect_uri") || lower.includes("redirect uri") || lower.includes("aadsts50011")) {
    code = "redirect_uri_mismatch";
  } else if (lower.includes("invalid_client") && lower.includes("secret")) {
    code = "invalid_client_secret";
  } else if (lower.includes("aadsts7000215") || lower.includes("invalid client secret")) {
    code = "invalid_client_secret";
  } else if (lower.includes("invalid_client") || lower.includes("unauthorized_client")) {
    code = "invalid_client";
  } else if (lower.includes("invalid_scope") || lower.includes("mail.send")) {
    code = phase === "send_mail" ? "mail_send_missing" : "invalid_scope";
  } else if (lower.includes("access_denied") || lower.includes("consent_required") || lower.includes("declined")) {
    code = "user_denied";
  } else if (phase === "token_refresh") {
    code = "token_refresh_failed";
  } else if (phase === "identity_lookup") {
    code = "identity_lookup_failed";
  } else if (phase === "token_store") {
    code = "token_store_failed";
  } else if (phase === "send_mail") {
    code = "graph_rejected";
  } else if (status === 401 || status === 403) {
    code = "invalid_client";
  } else {
    code = "token_exchange_failed";
  }

  return { code, message: rawMessage, occurredAt: new Date().toISOString() };
}

export function classifyAuthorizeRedirectError(errorParam: string, errorDescription: string | null): OutlookErrorRecord {
  const lower = errorParam.toLowerCase();
  let code: OutlookErrorCode = "token_exchange_failed";
  if (lower.includes("access_denied")) code = "user_denied";
  else if ((errorDescription ?? "").toLowerCase().includes("aadsts50011")) code = "redirect_uri_mismatch";

  return {
    code,
    message: errorDescription || `Microsoft returned error=${errorParam} on the authorize redirect.`,
    occurredAt: new Date().toISOString()
  };
}

export const OUTLOOK_ERROR_HELP: Record<OutlookErrorCode, string> = {
  redirect_uri_mismatch:
    "The redirect URI sent to Microsoft does not exactly match a redirect URI registered on the Entra app registration. Check MICROSOFT_REDIRECT_URI against the app's registered redirect URI.",
  invalid_client: "Microsoft rejected the client ID. Check MICROSOFT_CLIENT_ID against the Entra app registration's Application (client) ID.",
  invalid_client_secret: "Microsoft rejected the client secret. Check MICROSOFT_CLIENT_SECRET — client secrets expire and must be rotated in Entra.",
  invalid_scope: "One or more requested scopes are not granted. Ensure the Entra app has delegated User.Read and Mail.Send permissions with consent granted.",
  user_denied: "The user declined to authorize the app on the Microsoft consent screen.",
  state_mismatch: "The OAuth state returned by Microsoft did not match the state this server issued — the login attempt may have expired or been replayed. Try connecting again.",
  token_exchange_failed: "Microsoft rejected the authorization-code-to-token exchange. See the message for the specific reason.",
  identity_lookup_failed: "The token exchange succeeded, but GET /me failed — the access token may have been rejected or User.Read is missing.",
  token_store_failed: "The token exchange succeeded, but the server could not persist the token record to local storage.",
  mail_send_missing: "The connected account's token does not include the Mail.Send permission. Reconnect after an admin grants Mail.Send consent.",
  token_refresh_failed: "The Microsoft refresh token was rejected or has expired. Reconnect Outlook.",
  graph_rejected: "Microsoft Graph rejected the sendMail request. See the message for the specific reason."
};
