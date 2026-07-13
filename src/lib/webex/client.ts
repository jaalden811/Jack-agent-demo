import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Thin wrapper around the official Webex REST API
 * (https://webexapis.com/v1/). Every endpoint path and response field
 * used here is documented at developer.webex.com — see comments per
 * function. Nothing is invented.
 */

const WEBEX_API_BASE = "https://webexapis.com/v1";
const WEBEX_AUTHORIZE_URL = "https://webexapis.com/v1/authorize";
const WEBEX_TOKEN_URL = "https://webexapis.com/v1/access_token";

export class WebexApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WebexApiError";
    this.status = status;
  }
}

async function webexFetch<T>(
  url: string,
  init: RequestInit & { retryOnce?: boolean } = {}
): Promise<T> {
  const { retryOnce = true, ...requestInit } = init;
  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await fetch(url, { ...requestInit, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };

  let response: Response;
  try {
    response = await attempt();
  } catch (error) {
    if (!retryOnce) throw new WebexApiError(error instanceof Error ? error.message : "Network error");
    response = await attempt();
  }

  // Retry once on transient (5xx / 429) failures per the "retry transient
  // Webex failures once" requirement.
  if (retryOnce && (response.status >= 500 || response.status === 429)) {
    response = await attempt();
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.message ?? JSON.stringify(body);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new WebexApiError(`Webex API error (${response.status}): ${detail}`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ─── OAuth ──────────────────────────────────────────────────────────────────

export function buildAuthorizeUrl(params: { clientId: string; redirectUri: string; scopes: string; state: string }): string {
  const url = new URL(WEBEX_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scopes);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export type WebexTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  token_type: string;
  scope?: string;
};

export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<WebexTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri
  });
  return webexFetch<WebexTokenResponse>(WEBEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    retryOnce: false
  });
}

export async function refreshAccessToken(params: { clientId: string; clientSecret: string; refreshToken: string }): Promise<WebexTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken
  });
  return webexFetch<WebexTokenResponse>(WEBEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    retryOnce: false
  });
}

// ─── Identity (GET /people/me — spark:people_read) ────────────────────────

export type WebexPerson = {
  id: string;
  displayName: string;
  emails: string[];
};

export async function getMyIdentity(accessToken: string): Promise<WebexPerson> {
  return webexFetch<WebexPerson>(`${WEBEX_API_BASE}/people/me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

export async function findPersonByEmail(accessToken: string, email: string): Promise<WebexPerson | null> {
  const url = new URL(`${WEBEX_API_BASE}/people`);
  url.searchParams.set("email", email);
  const response = await webexFetch<{ items: WebexPerson[] }>(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.items[0] ?? null;
}

// ─── Meetings (GET /meetings — meeting:schedules_read) ────────────────────

export type WebexMeeting = {
  id: string;
  title?: string;
  start?: string;
  end?: string;
  hostEmail?: string;
  hostDisplayName?: string;
  webLink?: string;
  state?: string;
  meetingType?: string;
};

export async function listMeetings(
  accessToken: string,
  params: { from?: string; to?: string; meetingType?: string; max?: number } = {}
): Promise<WebexMeeting[]> {
  const url = new URL(`${WEBEX_API_BASE}/meetings`);
  if (params.from) url.searchParams.set("from", params.from);
  if (params.to) url.searchParams.set("to", params.to);
  if (params.meetingType) url.searchParams.set("meetingType", params.meetingType);
  url.searchParams.set("max", String(params.max ?? 50));

  const response = await webexFetch<{ items: WebexMeeting[] }>(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.items;
}

// ─── Meeting Transcripts (meeting:transcripts_read + meeting:schedules_read) ─
// https://developer.webex.com/meeting/docs/api/v1/meeting-transcripts

export type WebexTranscript = {
  id: string;
  siteUrl?: string;
  startTime?: string;
  meetingTopic?: string;
  meetingId?: string;
  scheduledMeetingId?: string;
  meetingSeriesId?: string;
  hostUserId?: string;
  vttDownloadLink?: string;
  txtDownloadLink?: string;
  status?: string;
};

export async function listMeetingTranscripts(
  accessToken: string,
  params: { meetingId?: string; from?: string; to?: string } = {}
): Promise<WebexTranscript[]> {
  const url = new URL(`${WEBEX_API_BASE}/meetingTranscripts`);
  if (params.meetingId) url.searchParams.set("meetingId", params.meetingId);
  if (params.from) url.searchParams.set("from", params.from);
  if (params.to) url.searchParams.set("to", params.to);

  const response = await webexFetch<{ items: WebexTranscript[] }>(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.items;
}

export type WebexTranscriptSnippet = {
  id: string;
  text?: string;
  personName?: string;
  personEmail?: string;
  offsetMillisecond?: number;
  durationMillisecond?: number;
};

export async function listTranscriptSnippets(accessToken: string, transcriptId: string): Promise<WebexTranscriptSnippet[]> {
  const url = `${WEBEX_API_BASE}/meetingTranscripts/${encodeURIComponent(transcriptId)}/snippets`;
  const response = await webexFetch<{ items: WebexTranscriptSnippet[] }>(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.items;
}

/** Falls back to the raw txt download when snippets are unavailable. */
export async function downloadTranscriptText(accessToken: string, transcriptId: string): Promise<string> {
  const url = `${WEBEX_API_BASE}/meetingTranscripts/${encodeURIComponent(transcriptId)}/download?format=txt`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new WebexApiError(`Webex transcript download failed (${response.status})`, response.status);
  return response.text();
}

// ─── Webhooks (POST/GET/DELETE /webhooks) ─────────────────────────────────

export type WebexWebhook = {
  id: string;
  name: string;
  targetUrl: string;
  resource: string;
  event: string;
  status: string;
};

export async function listWebhooks(accessToken: string): Promise<WebexWebhook[]> {
  const response = await webexFetch<{ items: WebexWebhook[] }>(`${WEBEX_API_BASE}/webhooks`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.items;
}

export async function createWebhook(
  accessToken: string,
  params: { name: string; targetUrl: string; resource: string; event: string; secret?: string }
): Promise<WebexWebhook> {
  return webexFetch<WebexWebhook>(`${WEBEX_API_BASE}/webhooks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      targetUrl: params.targetUrl,
      resource: params.resource,
      event: params.event,
      ...(params.secret ? { secret: params.secret } : {})
    }),
    retryOnce: false
  });
}

export async function deleteWebhook(accessToken: string, webhookId: string): Promise<void> {
  await webexFetch<void>(`${WEBEX_API_BASE}/webhooks/${encodeURIComponent(webhookId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    retryOnce: false
  });
}

/** HMAC-SHA1 signature validation for the X-Spark-Signature header, per
 * the Webex "Handling Requests from Webex" webhook guide. */
export function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signatureHeader, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

// ─── Messages (POST /messages — spark:messages_write, bot identity) ───────

export type WebexMessage = {
  id: string;
  toPersonEmail?: string;
  roomId?: string;
  created?: string;
};

export async function sendDirectMessage(
  botAccessToken: string,
  params: { toPersonEmail: string; markdown: string }
): Promise<WebexMessage> {
  return webexFetch<WebexMessage>(`${WEBEX_API_BASE}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${botAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ toPersonEmail: params.toPersonEmail, markdown: params.markdown })
  });
}
