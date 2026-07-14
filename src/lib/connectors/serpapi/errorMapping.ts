import { SerpApiError, type SerpApiErrorCode } from "@/lib/connectors/serpapi/types";

/** Maps an HTTP status (and, where available, a response body) into one
 * of the documented SerpAPI error codes — never a raw SDK/HTTP error. */
export function mapSerpApiError(status: number, body: unknown): SerpApiError {
  const message = typeof body === "object" && body !== null && "error" in body ? String((body as { error?: unknown }).error) : `HTTP ${status}`;

  let code: SerpApiErrorCode;
  if (status === 401) code = "SERPAPI_UNAUTHORIZED";
  else if (status === 403) code = "SERPAPI_FORBIDDEN";
  else if (status === 400) code = "SERPAPI_BAD_REQUEST";
  else if (status === 429) code = "SERPAPI_RATE_LIMITED";
  else if (status >= 500) code = "SERPAPI_SERVER_ERROR";
  else code = "SERPAPI_INVALID_RESPONSE";

  return new SerpApiError(code, message, status);
}

/** Whether an error should be retried with backoff — 429 and 5xx/timeout
 * are retryable; 400/401/403 are not (they will not resolve on retry). */
export function isRetryableSerpApiError(error: unknown): boolean {
  if (!(error instanceof SerpApiError)) return true; // network/timeout errors
  return error.code === "SERPAPI_RATE_LIMITED" || error.code === "SERPAPI_SERVER_ERROR" || error.code === "SERPAPI_TIMEOUT";
}
