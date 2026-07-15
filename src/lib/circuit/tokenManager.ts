import { getCircuitConfig, isCircuitConfigured, type CircuitConfig } from "@/lib/circuit/config";
import { buildTokenRequest, parseTokenResponse } from "@/lib/circuit/contract";
import { classifyCircuitHttpStatus, classifyCircuitThrown, makeCircuitError } from "@/lib/circuit/errorNormalizer";
import type { CircuitNormalizedError, CircuitToken, CircuitTokenState } from "@/lib/circuit/types";

/**
 * Circuit token manager (Phase 7). Requests a short-lived access token via
 * client credentials, caches it in SERVER MEMORY ONLY, refreshes before
 * expiry, and uses a single-flight lock so concurrent callers never mint
 * duplicate tokens.
 *
 * The token is never persisted to disk, never returned to the browser,
 * never logged, and never partially displayed.
 */

let cachedToken: CircuitToken | null = null;
let inFlight: Promise<{ token: CircuitToken | null; error: CircuitNormalizedError | null }> | null = null;
let lastError: CircuitNormalizedError | null = null;

/** For tests: clears the in-memory token + single-flight state. */
export function _resetCircuitTokenCache(): void {
  cachedToken = null;
  inFlight = null;
  lastError = null;
}

function decodeJwtExp(token: string): number | null {
  // Best-effort: read a JWT `exp` when the provider omits expires_in. Never
  // logs or exposes the token.
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isValid(token: CircuitToken | null, skewSeconds: number): boolean {
  if (!token) return false;
  return token.expires_at - skewSeconds * 1000 > Date.now();
}

async function requestNewToken(config: CircuitConfig): Promise<{ token: CircuitToken | null; error: CircuitNormalizedError | null }> {
  const spec = buildTokenRequest(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(spec.url, { method: spec.method, headers: spec.headers, body: spec.body, signal: controller.signal });
    if (!res.ok) {
      const error = classifyCircuitHttpStatus(res.status);
      // Token endpoint failures are token-request failures unless clearly auth.
      return { token: null, error: res.status === 401 || res.status === 403 ? error : makeCircuitError("CIRCUIT_TOKEN_REQUEST_FAILED", res.status) };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { token: null, error: makeCircuitError("CIRCUIT_RESPONSE_PARSE_FAILED", res.status) };
    }
    const parsed = parseTokenResponse(body);
    if (!parsed) return { token: null, error: makeCircuitError("CIRCUIT_TOKEN_REQUEST_FAILED", res.status) };

    const expiresAt = parsed.expires_in
      ? Date.now() + parsed.expires_in * 1000
      : decodeJwtExp(parsed.access_token) ?? Date.now() + config.tokenFallbackTtlSeconds * 1000;

    return { token: { access_token: parsed.access_token, token_type: parsed.token_type, expires_at: expiresAt }, error: null };
  } catch (error) {
    return { token: null, error: classifyCircuitThrown(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Returns a valid access token, minting/refreshing as needed. Single
 * flight: concurrent callers share one in-flight token request. */
export async function getCircuitAccessToken(config: CircuitConfig = getCircuitConfig()): Promise<{ token: CircuitToken | null; error: CircuitNormalizedError | null }> {
  if (!isCircuitConfigured(config)) {
    lastError = makeCircuitError("CIRCUIT_NOT_CONFIGURED");
    return { token: null, error: lastError };
  }
  if (isValid(cachedToken, config.tokenRefreshSkewSeconds)) {
    return { token: cachedToken, error: null };
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const result = await requestNewToken(config);
    if (result.token) {
      cachedToken = result.token;
      lastError = null;
    } else {
      lastError = result.error;
    }
    inFlight = null;
    return result;
  })();
  return inFlight;
}

/** Forces the next call to mint a new token (used after an inference 401
 * and by the "refresh token" admin action). */
export function invalidateCircuitToken(): void {
  cachedToken = null;
}

export function getCircuitTokenState(config: CircuitConfig = getCircuitConfig()): { state: CircuitTokenState; expiresAt: string | null } {
  if (!isCircuitConfigured(config)) return { state: "missing", expiresAt: null };
  if (inFlight) return { state: "refreshing", expiresAt: cachedToken ? new Date(cachedToken.expires_at).toISOString() : null };
  if (!cachedToken) return { state: lastError ? "error" : "missing", expiresAt: null };
  if (isValid(cachedToken, config.tokenRefreshSkewSeconds)) return { state: "valid", expiresAt: new Date(cachedToken.expires_at).toISOString() };
  return { state: "expired", expiresAt: new Date(cachedToken.expires_at).toISOString() };
}

export function getLastCircuitTokenError(): CircuitNormalizedError | null {
  return lastError;
}
