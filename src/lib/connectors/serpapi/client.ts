import { getConfig } from "@/lib/config";
import { mapSerpApiError, isRetryableSerpApiError } from "@/lib/connectors/serpapi/errorMapping";
import { SerpApiError, type RawSerpApiResponse } from "@/lib/connectors/serpapi/types";

/**
 * Thin HTTP client for the official SerpAPI Google Search endpoint
 * (https://serpapi.com/search.json). Builds the request, adds the API
 * key, sets a timeout, retries transient failures with backoff, and
 * returns raw JSON — never logs, returns, or otherwise exposes the API
 * key (SEARCH_API_KEY; no second key variable).
 */

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

export type SerpApiRequest = {
  query: string;
  location?: string;
  start?: number;
};

async function attemptRequest(request: SerpApiRequest): Promise<RawSerpApiResponse> {
  const config = getConfig();
  const apiKey = config.SEARCH_API_KEY;
  if (!apiKey || config.SEARCH_PROVIDER !== "serpapi") {
    throw new SerpApiError("SERPAPI_NOT_CONFIGURED", "SerpAPI is not configured (SEARCH_PROVIDER must be serpapi and SEARCH_API_KEY must be set).");
  }

  const params = new URLSearchParams({
    engine: config.SERPAPI_ENGINE,
    q: request.query,
    api_key: apiKey,
    hl: config.SERPAPI_LANGUAGE,
    gl: config.SERPAPI_COUNTRY,
    safe: config.SERPAPI_SAFE,
    output: "json",
    start: String(request.start ?? 0)
  });
  if (request.location) params.set("location", request.location);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.SERPAPI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SerpApiError("SERPAPI_INVALID_RESPONSE", "SerpAPI returned a non-JSON response.", response.status);
    }

    if (!response.ok) {
      throw mapSerpApiError(response.status, body);
    }

    return body as RawSerpApiResponse;
  } catch (error) {
    if (error instanceof SerpApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SerpApiError("SERPAPI_TIMEOUT", "SerpAPI request timed out.");
    }
    throw new SerpApiError("SERPAPI_SERVER_ERROR", error instanceof Error ? error.message : "SerpAPI request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

/** Executes one SerpAPI search with the configured retry budget.
 * Non-retryable errors (400/401/403/not-configured) fail immediately;
 * 429/5xx/timeout retry with exponential backoff. */
export async function executeSerpApiSearch(request: SerpApiRequest): Promise<RawSerpApiResponse> {
  const config = getConfig();
  const maxAttempts = Math.max(1, config.SERPAPI_MAX_RETRIES + 1);
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await attemptRequest(request);
    } catch (error) {
      lastError = error;
      if (!isRetryableSerpApiError(error) || attempt === maxAttempts - 1) throw error;
      const delayMs = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
