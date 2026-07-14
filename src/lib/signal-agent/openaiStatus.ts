/**
 * Independent OpenAI capability diagnostics — authentication, embeddings,
 * and synthesis are tested separately because they are separate
 * capabilities with separate models and separate API calls:
 *   - Authentication: GET /v1/models (validates the key alone).
 *   - Embeddings: POST /v1/embeddings with OPENAI_EMBEDDING_MODEL.
 *   - Synthesis: POST /v1/responses with OPENAI_SYNTHESIS_MODEL.
 *
 * Every result is sanitized before it ever leaves this module: only a
 * safe HTTP status, provider error type/code, and a concise message are
 * kept. The API key, Authorization header, and full request/response
 * bodies are never captured or returned.
 */

export type SanitizedProviderError = {
  http_status: number | null;
  error_type: string | null;
  error_code: string | null;
  message: string;
};

export type CapabilityCheckResult = {
  usable: boolean;
  message: string;
  error: SanitizedProviderError | null;
  last_check: string;
};

function sanitizeOpenAiError(error: unknown): SanitizedProviderError {
  const status = (error as { status?: number })?.status ?? null;
  const name = (error as { name?: string })?.name ?? null;
  const nested = (error as { error?: { type?: string; code?: string } })?.error;
  const code = (error as { code?: string })?.code ?? nested?.code ?? null;
  const type = nested?.type ?? null;

  let message: string;
  if (name === "APIConnectionTimeoutError" || code === "ETIMEDOUT") message = "timeout";
  else if (status === 401 || status === 403) message = "request rejected (invalid or unauthorized key)";
  else if (status === 404) message = "model unavailable";
  else if (status === 429) message = "request rejected (rate limited)";
  else if (status && status >= 500) message = "request rejected (provider error)";
  else message = "request rejected";

  return { http_status: status, error_type: type, error_code: code, message };
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

export async function checkOpenAiAuthentication(apiKey: string): Promise<CapabilityCheckResult> {
  const last_check = new Date().toISOString();
  try {
    await withClient(apiKey, (client) => client.models.list());
    return { usable: true, message: "Ready", error: null, last_check };
  } catch (error) {
    const sanitized = sanitizeOpenAiError(error);
    return { usable: false, message: sanitized.message, error: sanitized, last_check };
  }
}

export async function checkOpenAiEmbeddings(apiKey: string, model: string): Promise<CapabilityCheckResult> {
  const last_check = new Date().toISOString();
  try {
    const response = await withClient(apiKey, (client) => client.embeddings.create({ model, input: "diagnostic connectivity check" }));
    if (!response.data?.[0]?.embedding?.length) {
      return { usable: false, message: "model returned an empty embedding", error: null, last_check };
    }
    return { usable: true, message: "Ready", error: null, last_check };
  } catch (error) {
    const sanitized = sanitizeOpenAiError(error);
    return { usable: false, message: sanitized.message, error: sanitized, last_check };
  }
}

export async function checkOpenAiSynthesis(apiKey: string, model: string): Promise<CapabilityCheckResult> {
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
      return { usable: false, message: "model returned an empty response", error: null, last_check };
    }
    return { usable: true, message: "Ready", error: null, last_check };
  } catch (error) {
    const sanitized = sanitizeOpenAiError(error);
    return { usable: false, message: sanitized.message, error: sanitized, last_check };
  }
}
