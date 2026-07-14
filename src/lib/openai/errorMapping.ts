/**
 * Maps raw OpenAI SDK errors into the safe application error codes from
 * the implementation guide (Section 12) — the client never sees the
 * raw SDK error. Also implements the recommended exponential-backoff
 * retry helper for retryable errors, and separates rate-limit (retry)
 * from quota-exhaustion (do not retry indefinitely) per the OpenAI docs.
 */

export type OpenAiErrorCode =
  | "OPENAI_NOT_CONFIGURED"
  | "OPENAI_AUTH_REJECTED"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_QUOTA_EXCEEDED"
  | "OPENAI_TIMEOUT"
  | "OPENAI_MODEL_UNAVAILABLE"
  | "OPENAI_SCHEMA_FAILURE"
  | "OPENAI_REFUSAL"
  | "OPENAI_OUTPUT_PARSE_FAILURE"
  | "OPENAI_NETWORK_FAILURE";

export function classifyOpenAiError(error: unknown): OpenAiErrorCode {
  if (error instanceof Error && error.name === "OpenAiNotConfiguredError") return "OPENAI_NOT_CONFIGURED";

  const status = (error as { status?: number })?.status;
  const code = (error as { code?: string })?.code;
  const name = (error as { name?: string })?.name;
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (name === "APIConnectionTimeoutError" || code === "ETIMEDOUT") return "OPENAI_TIMEOUT";
  if (status === 401 || status === 403) return "OPENAI_AUTH_REJECTED";
  if (status === 404) return "OPENAI_MODEL_UNAVAILABLE";
  if (status === 429) {
    // OpenAI documents separate conditions for request-rate limiting vs.
    // exhausted quota under the same 429 status — quota exhaustion
    // messages mention billing/quota explicitly.
    if (message.includes("quota") || message.includes("billing")) return "OPENAI_QUOTA_EXCEEDED";
    return "OPENAI_RATE_LIMITED";
  }
  if (message.includes("refus")) return "OPENAI_REFUSAL";
  if (error instanceof SyntaxError || message.includes("json")) return "OPENAI_OUTPUT_PARSE_FAILURE";
  if (status && status >= 500) return "OPENAI_NETWORK_FAILURE";
  return "OPENAI_NETWORK_FAILURE";
}

function isRetryable(code: OpenAiErrorCode): boolean {
  return code === "OPENAI_RATE_LIMITED" || code === "OPENAI_TIMEOUT" || code === "OPENAI_NETWORK_FAILURE";
}

export async function withOpenAiRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = classifyOpenAiError(error);
      // Quota exhaustion must never retry indefinitely — it will not
      // resolve within this request's lifetime.
      if (!isRetryable(code) || attempt === attempts - 1) throw error;
      const delayMs = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
