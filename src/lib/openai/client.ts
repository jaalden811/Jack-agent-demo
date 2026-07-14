import { getConfig } from "@/lib/config";

/**
 * One shared server-side OpenAI client per process — never
 * instantiated per-route. The API key is read only here, inside a
 * server module; it is never exposed to the browser, logged, or
 * returned (not even a prefix/suffix/length).
 */

let cachedClient: import("openai").default | null = null;

export class OpenAiNotConfiguredError extends Error {
  constructor() {
    super("OPENAI_NOT_CONFIGURED");
    this.name = "OpenAiNotConfiguredError";
  }
}

export async function getOpenAIClient(): Promise<import("openai").default> {
  const config = getConfig();
  if (!config.OPENAI_API_KEY) throw new OpenAiNotConfiguredError();

  if (!cachedClient) {
    const { default: OpenAI } = await import("openai");
    cachedClient = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      timeout: config.OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: config.OPENAI_MAX_RETRIES
    });
  }
  return cachedClient;
}

/** Test-only: forces the next getOpenAIClient() call to construct a
 * fresh client (e.g. after mocking the "openai" module). */
export function resetOpenAIClientForTests(): void {
  cachedClient = null;
}
