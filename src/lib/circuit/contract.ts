import type { CircuitConfig } from "@/lib/circuit/config";

/**
 * THE CIRCUIT WIRE CONTRACT — the single place that encodes Circuit's
 * exact request/response shapes. Isolated so it can be confirmed against
 * the Circuit contract WITHOUT touching the token manager, client,
 * provider abstraction, or any call site.
 *
 * TOKEN — CONFIRMED against the Cisco Circuit cURL (id.cisco.com Okta):
 *   POST {CIRCUIT_TOKEN_URL}
 *   Authorization: Basic base64(client_id:client_secret)
 *   Content-Type: application/x-www-form-urlencoded
 *   body: grant_type=client_credentials  (client id/secret are NOT in the
 *   body — they are the Basic-auth header). Response is the standard Okta
 *   OAuth2 JSON { access_token, token_type, expires_in, scope }; the
 *   access_token is a JWT with exp.
 *
 * INFERENCE — NOT YET CONFIRMED. No inference cURL has been supplied
 * (endpoint URL + request/response shape for the Gemini gateway). The
 * inference builder/parser below remain PROVISIONAL and are gated off by
 * CIRCUIT_CONTRACT_CONFIRMED: until that is true, the inference client
 * returns CIRCUIT_CONTRACT_UNCONFIRMED and makes NO network request, so
 * the assumed inference shape can never run silently. Confirm the
 * inference fields here, then set CIRCUIT_CONTRACT_CONFIRMED=true.
 *
 * No App Key is used or sent (the current contract does not use one).
 */

export type HttpRequestSpec = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

// ─── Token request (client-credentials) ───────────────────────────────

export function buildTokenRequest(config: CircuitConfig): HttpRequestSpec {
  if (!config.tokenUrl || !config.clientId || !config.clientSecret) {
    throw new Error("Circuit token request requires tokenUrl, clientId, and clientSecret.");
  }
  // CONFIRMED contract: HTTP Basic auth (base64 of client_id:client_secret)
  // in the Authorization header; the body carries ONLY grant_type (plus
  // scope/audience when explicitly configured — the reference cURL sends
  // neither, so they are omitted unless set).
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  if (config.scope) form.set("scope", config.scope);
  if (config.audience) form.set("audience", config.audience);
  return {
    url: config.tokenUrl,
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: form.toString()
  };
}

export type ParsedToken = { access_token: string; token_type: string; expires_in: number | null } | null;

/** Parses a token response body. Prefers `access_token` + `expires_in`;
 * tolerant of a `token`/`accessToken` alias. Returns null when no token
 * field is present (caller maps to CIRCUIT_TOKEN_REQUEST_FAILED). */
export function parseTokenResponse(body: unknown): ParsedToken {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const token = (typeof b.access_token === "string" && b.access_token) || (typeof b.token === "string" && b.token) || (typeof b.accessToken === "string" && b.accessToken);
  if (!token || typeof token !== "string") return null;
  const tokenType = typeof b.token_type === "string" ? b.token_type : typeof b.tokenType === "string" ? b.tokenType : "Bearer";
  const expiresRaw = b.expires_in ?? b.expiresIn ?? null;
  const expires_in = typeof expiresRaw === "number" && Number.isFinite(expiresRaw) ? expiresRaw : null;
  return { access_token: token, token_type: tokenType, expires_in };
}

// ─── Inference request/response ────────────────────────────────────────

export function buildInferenceRequest(params: {
  config: CircuitConfig;
  accessToken: string;
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): HttpRequestSpec {
  const { config, accessToken, model, prompt, system, temperature, maxOutputTokens } = params;
  if (!config.inferenceUrl) throw new Error("Circuit inference request requires inferenceUrl.");
  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const body: Record<string, unknown> = { model, messages };
  if (typeof temperature === "number") body.temperature = temperature;
  if (typeof maxOutputTokens === "number") body.max_tokens = maxOutputTokens;
  return {
    url: config.inferenceUrl,
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  };
}

export type ParsedInference = {
  text: string | null;
  model: string | null;
  finish_reason: string | null;
  usage: { input_tokens: number | null; output_tokens: number | null } | null;
};

/** Parses an inference response. Supports the OpenAI-compatible shape
 * (choices[0].message.content) and tolerates a couple of common aliases
 * (output_text, candidates[].content). Adjust here to match the notebook
 * if Circuit differs. */
export function parseInferenceResponse(body: unknown): ParsedInference {
  const empty: ParsedInference = { text: null, model: null, finish_reason: null, usage: null };
  if (!body || typeof body !== "object") return empty;
  const b = body as Record<string, unknown>;

  let text: string | null = null;
  let finish: string | null = null;
  const choices = b.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const message = first.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === "string") text = message.content;
    else if (typeof first.text === "string") text = first.text;
    if (typeof first.finish_reason === "string") finish = first.finish_reason;
  }
  if (text === null && typeof b.output_text === "string") text = b.output_text;
  if (text === null && Array.isArray(b.candidates) && b.candidates.length > 0) {
    const content = (b.candidates[0] as Record<string, unknown>).content as Record<string, unknown> | undefined;
    const parts = content?.parts;
    if (Array.isArray(parts) && parts.length > 0 && typeof (parts[0] as Record<string, unknown>).text === "string") {
      text = (parts[0] as Record<string, unknown>).text as string;
    }
  }

  const model = typeof b.model === "string" ? b.model : null;
  const usageRaw = b.usage as Record<string, unknown> | undefined;
  const usage = usageRaw
    ? {
        input_tokens: typeof usageRaw.prompt_tokens === "number" ? usageRaw.prompt_tokens : typeof usageRaw.input_tokens === "number" ? usageRaw.input_tokens : null,
        output_tokens: typeof usageRaw.completion_tokens === "number" ? usageRaw.completion_tokens : typeof usageRaw.output_tokens === "number" ? usageRaw.output_tokens : null
      }
    : null;

  return { text, model, finish_reason: finish, usage };
}

/** Extracts a safe request-id from response headers (never a token). */
export function extractRequestId(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("x-requestid") ?? headers.get("request-id") ?? null;
}
