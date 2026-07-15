import type { CircuitErrorCode, CircuitNormalizedError } from "@/lib/circuit/types";

/**
 * Circuit error model (Phase 9). Maps any failure (HTTP status, network,
 * timeout, parse) to a stable, safe classification with a retryable flag.
 * NEVER includes secrets, tokens, authorization headers, or raw
 * credential-bearing provider bodies in the message.
 */

const RETRYABLE_CODES: ReadonlySet<CircuitErrorCode> = new Set([
  "CIRCUIT_RATE_LIMITED",
  "CIRCUIT_TIMEOUT",
  "CIRCUIT_NETWORK_FAILURE",
  "CIRCUIT_SERVER_ERROR"
]);

const SAFE_MESSAGES: Record<CircuitErrorCode, string> = {
  CIRCUIT_NOT_CONFIGURED: "Circuit is not configured. Set the Circuit client id, secret, token URL, and inference URL.",
  CIRCUIT_TOKEN_REQUEST_FAILED: "Circuit token request failed.",
  CIRCUIT_AUTHENTICATION_REJECTED: "Circuit rejected the credentials (authentication failed).",
  CIRCUIT_PERMISSION_REJECTED: "Circuit rejected the request (insufficient permission or scope).",
  CIRCUIT_MODEL_REQUIRED: "CIRCUIT_MODEL is required but not set.",
  CIRCUIT_MODEL_UNAVAILABLE: "The configured Circuit model is unavailable.",
  CIRCUIT_INVALID_REQUEST: "Circuit rejected the request as invalid.",
  CIRCUIT_RATE_LIMITED: "Circuit is rate limiting requests.",
  CIRCUIT_QUOTA_EXCEEDED: "Circuit quota exceeded.",
  CIRCUIT_TIMEOUT: "Circuit request timed out.",
  CIRCUIT_NETWORK_FAILURE: "Could not reach Circuit (network failure).",
  CIRCUIT_SERVER_ERROR: "Circuit returned a server error.",
  CIRCUIT_RESPONSE_PARSE_FAILED: "Circuit response could not be parsed.",
  CIRCUIT_SCHEMA_VALIDATION_FAILED: "Circuit output failed schema validation.",
  CIRCUIT_REFUSAL: "Circuit declined to answer (safety refusal).",
  CIRCUIT_UNKNOWN_ERROR: "Circuit request failed with an unrecognized error."
};

export function makeCircuitError(code: CircuitErrorCode, http_status: number | null = null, request_id: string | null = null): CircuitNormalizedError {
  return { code, message: SAFE_MESSAGES[code], retryable: RETRYABLE_CODES.has(code), http_status, request_id };
}

/** Classifies an HTTP status (from a token or inference call) into a
 * Circuit error code. `phase` distinguishes token vs inference so 401 maps
 * to authentication-rejected consistently. */
export function classifyCircuitHttpStatus(status: number, request_id: string | null = null): CircuitNormalizedError {
  if (status === 400) return makeCircuitError("CIRCUIT_INVALID_REQUEST", status, request_id);
  if (status === 401) return makeCircuitError("CIRCUIT_AUTHENTICATION_REJECTED", status, request_id);
  if (status === 403) return makeCircuitError("CIRCUIT_PERMISSION_REJECTED", status, request_id);
  if (status === 404) return makeCircuitError("CIRCUIT_MODEL_UNAVAILABLE", status, request_id);
  if (status === 429) return makeCircuitError("CIRCUIT_RATE_LIMITED", status, request_id);
  if (status >= 500) return makeCircuitError("CIRCUIT_SERVER_ERROR", status, request_id);
  return makeCircuitError("CIRCUIT_UNKNOWN_ERROR", status, request_id);
}

/** Classifies a thrown fetch/runtime error (never a provider body) into a
 * network/timeout classification. */
export function classifyCircuitThrown(error: unknown): CircuitNormalizedError {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (error instanceof Error && error.name === "AbortError") return makeCircuitError("CIRCUIT_TIMEOUT");
  if (message.includes("timeout") || message.includes("timed out")) return makeCircuitError("CIRCUIT_TIMEOUT");
  if (message.includes("network") || message.includes("fetch failed") || message.includes("econn") || message.includes("enotfound")) {
    return makeCircuitError("CIRCUIT_NETWORK_FAILURE");
  }
  return makeCircuitError("CIRCUIT_UNKNOWN_ERROR");
}

export function isRetryable(error: CircuitNormalizedError): boolean {
  return error.retryable;
}
