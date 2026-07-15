/**
 * Circuit provider types. Circuit is an enterprise generative-AI gateway
 * reached with an OAuth2 client-credentials token. Every endpoint, model,
 * and contract detail is configuration-driven (never hard-coded); the
 * exact request/response field mapping lives in one place (contract.ts) so
 * it can be confirmed against the Circuit notebook without touching the
 * rest of the codebase.
 */

export type CircuitErrorCode =
  | "CIRCUIT_NOT_CONFIGURED"
  | "CIRCUIT_TOKEN_REQUEST_FAILED"
  | "CIRCUIT_AUTHENTICATION_REJECTED"
  | "CIRCUIT_PERMISSION_REJECTED"
  | "CIRCUIT_MODEL_REQUIRED"
  | "CIRCUIT_MODEL_UNAVAILABLE"
  | "CIRCUIT_INVALID_REQUEST"
  | "CIRCUIT_RATE_LIMITED"
  | "CIRCUIT_QUOTA_EXCEEDED"
  | "CIRCUIT_TIMEOUT"
  | "CIRCUIT_NETWORK_FAILURE"
  | "CIRCUIT_SERVER_ERROR"
  | "CIRCUIT_RESPONSE_PARSE_FAILED"
  | "CIRCUIT_SCHEMA_VALIDATION_FAILED"
  | "CIRCUIT_REFUSAL"
  | "CIRCUIT_UNKNOWN_ERROR";

export type CircuitNormalizedError = {
  code: CircuitErrorCode;
  /** A safe, human-readable message — never contains secrets, tokens, or
   * raw authorization headers. */
  message: string;
  retryable: boolean;
  http_status: number | null;
  request_id: string | null;
};

/** In-memory-only access token state (never persisted to disk or returned
 * to the browser). */
export type CircuitToken = {
  access_token: string;
  token_type: string;
  /** Absolute expiry (epoch ms). */
  expires_at: number;
};

export type CircuitGenerateRequest = {
  prompt: string;
  /** Optional system/master-context prompt, when the contract supports a
   * distinct system role. */
  system?: string;
  /** Optional generation controls; only sent if the contract documents
   * them. */
  temperature?: number;
  maxOutputTokens?: number;
  /** Per-request timeout override (ms). */
  timeoutMs?: number;
};

export type CircuitGenerateResult = {
  ok: boolean;
  text: string | null;
  model: string | null;
  finish_reason: string | null;
  usage: { input_tokens: number | null; output_tokens: number | null } | null;
  request_id: string | null;
  http_status: number | null;
  duration_ms: number;
  error: CircuitNormalizedError | null;
};

export type CircuitTokenState = "missing" | "valid" | "refreshing" | "expired" | "error";

/** Safe diagnostics — never includes the token, secret, or client id. */
export type CircuitDiagnostics = {
  aiProvider: "circuit";
  configured: boolean;
  authenticated: boolean;
  operational: boolean;
  model: string | null;
  tokenState: CircuitTokenState;
  tokenExpiresAt: string | null;
  promptVersion: string;
  schemaVersion: string;
  lastAuthenticationTest: { ok: boolean; at: string; error_code: string | null } | null;
  lastInferenceTest: { ok: boolean; at: string; error_code: string | null; model: string | null } | null;
  safeError: string | null;
};
