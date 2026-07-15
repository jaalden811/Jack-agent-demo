import { getCircuitConfig, isCircuitConfigured } from "@/lib/circuit/config";
import { getCircuitAccessToken, getCircuitTokenState, getLastCircuitTokenError } from "@/lib/circuit/tokenManager";
import { circuitGenerate } from "@/lib/circuit/client";
import type { CircuitDiagnostics } from "@/lib/circuit/types";

/**
 * Safe Circuit diagnostics (Phase 16). Returns ONLY non-secret metadata —
 * never the token, client id, or client secret. Circuit is an optional
 * enhancement provider, so "not configured / unavailable" is a normal,
 * non-fatal state (the deterministic engine remains authoritative).
 */

export function getCircuitDiagnostics(): CircuitDiagnostics {
  const config = getCircuitConfig();
  const configured = isCircuitConfigured(config);
  const { state, expiresAt } = getCircuitTokenState(config);
  const lastError = getLastCircuitTokenError();

  return {
    aiProvider: "circuit",
    configured,
    authenticated: state === "valid",
    operational: configured && state !== "error",
    model: config.model,
    tokenState: state,
    tokenExpiresAt: expiresAt,
    promptVersion: config.promptVersion,
    schemaVersion: config.schemaVersion,
    lastAuthenticationTest: null,
    lastInferenceTest: null,
    safeError: lastError ? lastError.message : configured ? null : "Circuit is not configured."
  };
}

/** Actively tests authentication by minting a token (server-side only).
 * Returns a safe result — never the token. */
export async function testCircuitAuthentication(): Promise<{ ok: boolean; error_code: string | null; at: string }> {
  const { token, error } = await getCircuitAccessToken();
  return { ok: Boolean(token), error_code: error ? error.code : null, at: new Date().toISOString() };
}

/** Actively tests inference with a tiny prompt. Returns safe metadata
 * (returned model, ok/error) — never the token or raw provider body. */
export async function testCircuitInference(): Promise<{ ok: boolean; error_code: string | null; model: string | null; at: string }> {
  const result = await circuitGenerate({ prompt: "Reply with the single word: ok", maxOutputTokens: 8, temperature: 0 });
  return { ok: result.ok, error_code: result.error ? result.error.code : null, model: result.model, at: new Date().toISOString() };
}
