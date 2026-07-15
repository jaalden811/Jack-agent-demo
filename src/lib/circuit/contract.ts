import type { CircuitConfig } from "@/lib/circuit/config";

/**
 * THE CIRCUIT WIRE CONTRACT — the single place that encodes Circuit's
 * exact request/response shapes. This is deliberately isolated so it can
 * be confirmed against the attached Circuit notebook / sanitized cURL
 * WITHOUT touching the token manager, client, provider abstraction, or
 * any call site.
 *
 * Defaults implement:
 *   - Token: standard OAuth2 client-credentials grant (RFC 6749) —
 *     form-encoded body with grant_type/client_id/client_secret (+ scope,
 *     audience when configured); response { access_token, token_type,
 *     expires_in }.
 *   - Inference: an OpenAI-compatible chat-completions gateway — Bearer
 *     token, body { model, messages: [...] }, response
 *     choices[0].message.content.
 *
 * If the Circuit notebook specifies different field names or paths, adjust
 * ONLY this file. No App Key is sent (the current contract does not use
 * one); do not add an App Key here unless the current notebook cURL
 * includes a required App Key field/header.
 *
 * ⚠ PROVISIONAL + GATED: these defaults are assumptions until confirmed
 * against CIRCUIT_CONTRACT.txt. They are gated off by
 * CIRCUIT_CONTRACT_CONFIRMED — until that is true, the token manager and
 * client return CIRCUIT_CONTRACT_UNCONFIRMED and make NO network request,
 * so nothing here can run silently. After confirming the field
 * names/paths below, set CIRCUIT_CONTRACT_CONFIRMED=true.
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
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", config.clientId);
  form.set("client_secret", config.clientSecret);
  if (config.scope) form.set("scope", config.scope);
  if (config.audience) form.set("audience", config.audience);
  return {
    url: config.tokenUrl,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
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
