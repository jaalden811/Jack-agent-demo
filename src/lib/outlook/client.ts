import { createHash, randomBytes } from "node:crypto";

/**
 * Thin wrapper around the Microsoft identity platform v2.0 endpoints and
 * Microsoft Graph — every URL and field used here matches the documented
 * authorization code + PKCE flow and the `/me/sendMail` API. Nothing is
 * invented. See:
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 * https://learn.microsoft.com/en-us/graph/api/user-sendmail
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class GraphApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GraphApiError";
    this.status = status;
  }
}

function authorityBase(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
}

// ─── PKCE ───────────────────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

// ─── Authorize ──────────────────────────────────────────────────────────────

export function buildAuthorizeUrl(params: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(`${authorityBase(params.tenantId)}/authorize`);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", params.scopes);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ─── Token exchange / refresh ──────────────────────────────────────────────

export type MicrosoftTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

async function tokenFetch(tenantId: string, body: URLSearchParams): Promise<MicrosoftTokenResponse> {
  const response = await fetch(`${authorityBase(tenantId)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.json();
      detail = errBody?.error_description ?? errBody?.error ?? JSON.stringify(errBody);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new GraphApiError(`Microsoft token endpoint error (${response.status}): ${detail}`, response.status);
  }

  return (await response.json()) as MicrosoftTokenResponse;
}

export async function exchangeCodeForToken(params: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  scopes: string;
}): Promise<MicrosoftTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    scope: params.scopes
  });
  return tokenFetch(params.tenantId, body);
}

export async function refreshAccessToken(params: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  scopes: string;
}): Promise<MicrosoftTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    scope: params.scopes
  });
  return tokenFetch(params.tenantId, body);
}

// ─── Identity (GET /me) ─────────────────────────────────────────────────────

export type GraphUser = {
  id: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
};

export async function getMyIdentity(accessToken: string): Promise<GraphUser> {
  const response = await fetch(`${GRAPH_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GraphApiError(`Microsoft Graph /me error (${response.status}): ${detail}`, response.status);
  }
  return (await response.json()) as GraphUser;
}

// ─── Send mail (POST /me/sendMail — delegated Mail.Send) ──────────────────

export type SendMailResult = { accepted: boolean; statusCode: number };

export async function sendMail(
  accessToken: string,
  params: { toEmail: string; subject: string; html: string; text: string }
): Promise<SendMailResult> {
  const response = await fetch(`${GRAPH_BASE}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: params.subject,
        body: { contentType: "HTML", content: params.html },
        toRecipients: [{ emailAddress: { address: params.toEmail } }]
      },
      saveToSentItems: true
    })
  });

  // Per Microsoft Graph docs, a successful sendMail returns 202 Accepted
  // with an empty body.
  if (response.status === 202) {
    return { accepted: true, statusCode: 202 };
  }

  let detail = "";
  try {
    const body = await response.json();
    detail = body?.error?.message ?? JSON.stringify(body);
  } catch {
    detail = await response.text().catch(() => params.text);
  }
  throw new GraphApiError(`Microsoft Graph sendMail error (${response.status}): ${detail}`, response.status);
}
