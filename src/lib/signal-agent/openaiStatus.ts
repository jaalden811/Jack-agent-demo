/**
 * Independent OpenAI capability diagnostics — authentication, embeddings,
 * and synthesis are tested separately because they are separate
 * capabilities with separate models and separate API calls:
 *   - Authentication: GET /v1/models (validates the key alone).
 *   - Embeddings: POST /v1/embeddings with OPENAI_EMBEDDING_MODEL.
 *   - Synthesis: POST /v1/responses with OPENAI_SYNTHESIS_MODEL.
 *
 * Every result is sanitized before it ever leaves this module: only a
 * safe HTTP status, provider error type/code, request ID, and a
 * concise message are kept. The API key, Authorization header, and
 * full request/response bodies are never captured or returned — never
 * call every failure "request rejected"; classify it precisely.
 */

import type { OpenAiOperationDiagnostic, SanitizedProviderError } from "@/lib/signal-agent/types";

export type SafeOpenAiErrorCode =
  | "OPENAI_AUTHENTICATION_REJECTED"
  | "OPENAI_PERMISSION_REJECTED"
  | "OPENAI_MODEL_UNAVAILABLE"
  | "OPENAI_QUOTA_EXCEEDED"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_INVALID_REQUEST"
  | "OPENAI_TIMEOUT"
  | "OPENAI_NETWORK_FAILURE"
  | "OPENAI_UNKNOWN_ERROR";

export type { OpenAiOperationDiagnostic, SanitizedProviderError };

export type CapabilityCheckResult = {
  usable: boolean;
  message: string;
  error: SanitizedProviderError | null;
  last_check: string;
};

type OpenAiErrorShape = {
  status?: number;
  name?: string;
  code?: string | null;
  requestID?: string | null;
  error?: { type?: string; code?: string; message?: string };
};

function classifySafeOpenAiErrorCode(error: unknown): SafeOpenAiErrorCode {
  const e = error as OpenAiErrorShape;
  const status = e?.status;
  const code = e?.code ?? e?.error?.code ?? null;
  const nameLower = (e?.name ?? "").toLowerCase();
  const messageLower = (error instanceof Error ? error.message : "").toLowerCase();

  if (nameLower.includes("timeout") || code === "ETIMEDOUT") return "OPENAI_TIMEOUT";
  if (nameLower.includes("connectionerror") || code === "ECONNREFUSED" || code === "ENOTFOUND") return "OPENAI_NETWORK_FAILURE";
  if (status === 401) return "OPENAI_AUTHENTICATION_REJECTED";
  if (status === 403) return "OPENAI_PERMISSION_REJECTED";
  if (status === 404) return "OPENAI_MODEL_UNAVAILABLE";
  if (status === 429) {
    // OpenAI's own error code for exhausted billing quota is literally
    // "insufficient_quota" — distinct from a transient request-rate 429.
    if (code === "insufficient_quota" || messageLower.includes("quota") || messageLower.includes("billing")) return "OPENAI_QUOTA_EXCEEDED";
    return "OPENAI_RATE_LIMITED";
  }
  if (status === 400) return "OPENAI_INVALID_REQUEST";
  if (typeof status === "number" && status >= 500) return "OPENAI_NETWORK_FAILURE";
  return "OPENAI_UNKNOWN_ERROR";
}

const SAFE_MESSAGE_BY_CODE: Record<SafeOpenAiErrorCode, string> = {
  OPENAI_AUTHENTICATION_REJECTED: "Authentication rejected (HTTP 401) — the configured API key was not accepted.",
  OPENAI_PERMISSION_REJECTED: "Permission rejected (HTTP 403) — the key is valid but lacks access to this resource/project.",
  OPENAI_MODEL_UNAVAILABLE: "Model unavailable (HTTP 404) — the configured model was not found or is not accessible to this account.",
  OPENAI_QUOTA_EXCEEDED: "Quota exceeded (HTTP 429) — billing quota is exhausted; this will not resolve on retry.",
  OPENAI_RATE_LIMITED: "Rate limited (HTTP 429) — too many requests; safe to retry after a short backoff.",
  OPENAI_INVALID_REQUEST: "Invalid request (HTTP 400) — the request was malformed for the configured model/parameters.",
  OPENAI_TIMEOUT: "Request timed out before OpenAI responded.",
  OPENAI_NETWORK_FAILURE: "Network or provider-side failure — could not complete the request.",
  OPENAI_UNKNOWN_ERROR: "Request failed with an unrecognized error shape — see error_type/error_code for detail."
};

const RETRYABLE_CODES: ReadonlySet<SafeOpenAiErrorCode> = new Set(["OPENAI_RATE_LIMITED", "OPENAI_TIMEOUT", "OPENAI_NETWORK_FAILURE"]);

function sanitizeOpenAiError(error: unknown): SanitizedProviderError {
  const e = error as OpenAiErrorShape;
  const status = e?.status ?? null;
  const code = classifySafeOpenAiErrorCode(error);
  return {
    http_status: typeof status === "number" ? status : null,
    error_type: e?.error?.type ?? null,
    error_code: e?.code ?? e?.error?.code ?? null,
    message: SAFE_MESSAGE_BY_CODE[code]
  };
}

function toOperationDiagnostic(operation: OpenAiOperationDiagnostic["operation"], model: string | null, error: unknown): OpenAiOperationDiagnostic {
  const e = error as OpenAiErrorShape;
  const code = classifySafeOpenAiErrorCode(error);
  return {
    operation,
    configured: true,
    operational: false,
    model,
    http_status: typeof e?.status === "number" ? e.status : null,
    error_type: e?.error?.type ?? null,
    error_code: e?.code ?? e?.error?.code ?? null,
    safe_message: SAFE_MESSAGE_BY_CODE[code],
    request_id: e?.requestID ?? null,
    retryable: RETRYABLE_CODES.has(code),
    checked_at: new Date().toISOString()
  };
}

function operationalDiagnostic(operation: OpenAiOperationDiagnostic["operation"], model: string): OpenAiOperationDiagnostic {
  return {
    operation,
    configured: true,
    operational: true,
    model,
    http_status: null,
    error_type: null,
    error_code: null,
    safe_message: "Ready",
    request_id: null,
    retryable: false,
    checked_at: new Date().toISOString()
  };
}

/** Kept for direct reuse/testing of just the safe-reason mapping. */
export function describeOpenAiFailure(error: unknown): string {
  return sanitizeOpenAiError(error).message;
}

async function withClient<T>(apiKey: string, run: (client: import("openai").default) => Promise<T>): Promise<T> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, timeout: 8000, maxRetries: 0 });
  return run(client);
}

export async function checkOpenAiAuthentication(apiKey: string): Promise<CapabilityCheckResult & { diagnostic: OpenAiOperationDiagnostic }> {
  const last_check = new Date().toISOString();
  try {
    await withClient(apiKey, (client) => client.models.list());
    return { usable: true, message: "Ready", error: null, last_check, diagnostic: operationalDiagnostic("authentication", "n/a") };
  } catch (error) {
    const sanitized = sanitizeOpenAiError(error);
    return { usable: false, message: sanitized.message, error: sanitized, last_check, diagnostic: toOperationDiagnostic("authentication", null, error) };
  }
}

export async function checkOpenAiEmbeddings(apiKey: string, model: string): Promise<CapabilityCheckResult & { diagnostic: OpenAiOperationDiagnostic }> {
  const last_check = new Date().toISOString();
  try {
    const response = await withClient(apiKey, (client) => client.embeddings.create({ model, input: "diagnostic connectivity check" }));
    if (!response.data?.[0]?.embedding?.length) {
      return {
        usable: false,
        message: "model returned an empty embedding",
        error: null,
        last_check,
        diagnostic: { ...operationalDiagnostic("embeddings", model), operational: false, safe_message: "Model returned an empty embedding." }
      };
    }
    return { usable: true, message: "Ready", error: null, last_check, diagnostic: operationalDiagnostic("embeddings", model) };
  } catch (error) {
    const sanitized = sanitizeOpenAiError(error);
    return { usable: false, message: sanitized.message, error: sanitized, last_check, diagnostic: toOperationDiagnostic("embeddings", model, error) };
  }
}

export async function checkOpenAiSynthesis(apiKey: string, model: string): Promise<CapabilityCheckResult & { diagnostic: OpenAiOperationDiagnostic }> {
  const last_check = new Date().toISOString();
  try {
    const response = await withClient(apiKey, (client) =>
      client.responses.create({
        model,
        input: "Reply with exactly one word: ready",
        max_output_tokens: 16
      })
    );
    if (!response.output_text || response.output_text.trim().length === 0) {
      return {
        usable: false,
        message: "model returned an empty response",
        error: null,
        last_check,
        diagnostic: { ...operationalDiagnostic("synthesis", model), operational: false, safe_message: "Model returned an empty response." }
      };
    }
    return { usable: true, message: "Ready", error: null, last_check, diagnostic: operationalDiagnostic("synthesis", model) };
  } catch (error) {
    const sanitized = sanitizeOpenAiError(error);
    return { usable: false, message: sanitized.message, error: sanitized, last_check, diagnostic: toOperationDiagnostic("synthesis", model, error) };
  }
}
