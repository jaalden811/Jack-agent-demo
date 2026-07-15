import { getCircuitConfig, isCircuitConfigured, isCircuitContractConfirmed, isCircuitTokenConfigured } from "@/lib/circuit/config";
import { getCircuitAccessToken, getCircuitTokenState, getLastCircuitTokenError } from "@/lib/circuit/tokenManager";
import { circuitGenerate } from "@/lib/circuit/client";
import { circuitErrorCause } from "@/lib/circuit/errorNormalizer";
import type { CircuitDiagnostics, CircuitProviderState } from "@/lib/circuit/types";

/**
 * Safe Circuit diagnostics (Phase 16). Returns ONLY non-secret metadata —
 * never the token, client id, or client secret. Circuit is an optional
 * enhancement provider, so "not configured / unavailable" is a normal,
 * non-fatal state (the deterministic engine remains authoritative).
 */

/** Derives the five-state provider summary. Credential health is never
 * conflated with an endpoint/payload/quota/TLS/target problem: only a
 * genuine credential-cause error yields a credential-attributed state. */
function deriveProviderState(params: {
  credentialsConfigured: boolean;
  contractConfirmed: boolean;
  tokenState: string;
  lastErrorCause: string | null;
}): CircuitProviderState {
  const { credentialsConfigured, contractConfirmed, tokenState, lastErrorCause } = params;
  if (!credentialsConfigured) return "not_configured";
  if (lastErrorCause === "transient") return "operation_unavailable";
  if (tokenState === "rejected") return "operation_failed"; // credential rejected (cause=credential)
  if (tokenState === "error") return "operation_failed";
  if (tokenState === "valid") {
    if (!contractConfirmed) return "contract_unconfirmed"; // authenticated; blocker is the contract, NOT credentials
    return "operational";
  }
  return "credentials_configured";
}

export function getCircuitDiagnostics(): CircuitDiagnostics {
  const config = getCircuitConfig();
  const configured = isCircuitConfigured(config);
  const credentialsConfigured = isCircuitTokenConfigured(config);
  const contractConfirmed = isCircuitContractConfirmed(config);
  const { state, expiresAt } = getCircuitTokenState(config);
  const lastError = getLastCircuitTokenError();
  const lastErrorCause = lastError ? circuitErrorCause(lastError.code) : null;
  const authenticationAccepted = state === "valid" ? true : lastError ? false : null;

  const providerState = deriveProviderState({ credentialsConfigured, contractConfirmed, tokenState: state, lastErrorCause });

  return {
    aiProvider: "circuit",
    configured,
    credentialsConfigured,
    contractConfirmed,
    contractVersion: config.contractVersion,
    authenticationAccepted,
    authenticated: state === "valid",
    // Operational requires configuration AND a confirmed contract — an
    // unconfirmed contract is a deliberate, non-fatal "enhancement off"
    // state (deterministic path remains authoritative).
    operational: configured && contractConfirmed && state !== "error" && state !== "rejected",
    state: providerState,
    lastErrorCause,
    model: config.model,
    tokenState: state,
    tokenExpiresAt: expiresAt,
    promptVersion: config.promptVersion,
    schemaVersion: config.schemaVersion,
    lastAuthenticationTest: null,
    lastInferenceTest: null,
    safeError: lastError ? lastError.message : !credentialsConfigured ? "Circuit credentials are not configured." : !contractConfirmed ? "Circuit inference contract is not confirmed (token auth works)." : null
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
