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
 * INFERENCE — CONFIRMED against the Cisco Circuit inference cURL:
 *   POST {CIRCUIT_INFERENCE_URL}  (OpenAI/Azure-compatible; the model is a
 *     deployment in the path — a "{model}" placeholder is substituted with
 *     CIRCUIT_MODEL, or the URL is used as-is when it has no placeholder).
 *   Header: api-key: <access-token>   (NOT Authorization: Bearer)
 *   Content-Type / Accept: application/json
 *   Body: { messages: [{role,content}...], user: "{\"appkey\":\"<APP_KEY>\"}",
 *           stop: ["<|im_end|>"] }
 *   Response: OpenAI/Azure chat completion — choices[0].message.content.
 *
 * The App Key IS required by this contract and is passed as a JSON string
 * in the body `user` field (read from CIRCUIT_APP_KEY — never hard-coded).
 * The access token (minted via the confirmed token contract) is the
 * `api-key` header value.
 */

/** The confirmed stop sequence for this gateway/model. */
const CIRCUIT_STOP_SEQUENCES = ["<|im_end|>"];

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

/** Resolves the deployment URL: substitutes a "{model}" (or "{deployment}")
 * placeholder with the configured model, else returns the URL unchanged. */
export function resolveInferenceUrl(inferenceUrl: string, model: string | null): string {
  if (!model) return inferenceUrl;
  return inferenceUrl.replace(/\{model\}/g, model).replace(/\{deployment\}/g, model);
}

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
  if (!config.appKey) throw new Error("Circuit inference request requires the App Key (CIRCUIT_APP_KEY).");
  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  // Confirmed body shape: messages + user(appkey JSON string) + stop.
  // model is NOT in the body (it is the deployment in the URL path).
  const body: Record<string, unknown> = {
    messages,
    user: JSON.stringify({ appkey: config.appKey }),
    stop: CIRCUIT_STOP_SEQUENCES
  };
  if (typeof temperature === "number") body.temperature = temperature;
  if (typeof maxOutputTokens === "number") body.max_tokens = maxOutputTokens;
  return {
    url: resolveInferenceUrl(config.inferenceUrl, model),
    method: "POST",
    // Confirmed contract: the access token is the `api-key` header value.
    headers: { "api-key": accessToken, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  };
}

export type ParsedInference = {
  text: string | null;
  model: string | null;
  finish_reason: string | null;
  usage: { input_tokens: number | null; output_tokens: number | null } | null;
};

/** Parses the CONFIRMED OpenAI/Azure chat-completion response:
 * choices[0].message.content (+ finish_reason), model, and usage
 * (prompt/completion tokens). No heuristic probing of unrelated shapes. */
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
    if (typeof first.finish_reason === "string") finish = first.finish_reason;
  }

  const model = typeof b.model === "string" ? b.model : null;
  const usageRaw = b.usage as Record<string, unknown> | undefined;
  const usage = usageRaw
    ? {
        input_tokens: typeof usageRaw.prompt_tokens === "number" ? usageRaw.prompt_tokens : null,
        output_tokens: typeof usageRaw.completion_tokens === "number" ? usageRaw.completion_tokens : null
      }
    : null;

  return { text, model, finish_reason: finish, usage };
}

/** Extracts a safe request-id from response headers (never a token). */
export function extractRequestId(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("x-requestid") ?? headers.get("request-id") ?? null;
}
