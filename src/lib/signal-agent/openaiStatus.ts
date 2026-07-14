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
import { normalizeOpenAiError, type OpenAiOperation, type OpenAiSafeClassification } from "@/lib/openai/errorNormalizer";

/** @deprecated The single source of truth is now
 * @/lib/openai/errorNormalizer's OpenAiSafeClassification. Re-exported
 * here for backward compatibility with existing imports/tests. */
export type SafeOpenAiErrorCode = OpenAiSafeClassification;

export type { OpenAiOperationDiagnostic, SanitizedProviderError };

export type CapabilityCheckResult = {
  usable: boolean;
  message: string;
  error: SanitizedProviderError | null;
  last_check: string;
};

function sanitizeOpenAiError(error: unknown, operation: OpenAiOperation): SanitizedProviderError {
  const normalized = normalizeOpenAiError(error, operation);
  return {
    http_status: normalized.http_status,
    error_type: normalized.error_type,
    error_code: normalized.error_code,
    message: normalized.safe_message
  };
}

function toOperationDiagnostic(operation: OpenAiOperationDiagnostic["operation"], model: string | null, error: unknown): OpenAiOperationDiagnostic {
  const normalized = normalizeOpenAiError(error, operation as OpenAiOperation);
  return {
    operation,
    configured: true,
    operational: false,
    model,
    http_status: normalized.http_status,
    error_type: normalized.error_type,
    error_code: normalized.error_code,
    safe_classification: normalized.safe_classification,
    safe_message: normalized.safe_message,
    request_id: normalized.request_id,
    retryable: normalized.retryable,
    checked_at: normalized.checked_at
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
    safe_classification: null,
    safe_message: "Ready",
    request_id: null,
    retryable: false,
    checked_at: new Date().toISOString()
  };
}

/** Kept for direct reuse/testing of just the safe-reason mapping. */
export function describeOpenAiFailure(error: unknown): string {
  return normalizeOpenAiError(error, "authentication").safe_message;
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
    const sanitized = sanitizeOpenAiError(error, "authentication");
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
    const sanitized = sanitizeOpenAiError(error, "embeddings");
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
    const sanitized = sanitizeOpenAiError(error, "synthesis");
    return { usable: false, message: sanitized.message, error: sanitized, last_check, diagnostic: toOperationDiagnostic("synthesis", model, error) };
  }
}
