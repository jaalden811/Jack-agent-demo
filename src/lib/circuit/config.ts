/**
 * Circuit configuration (Phase 6). Reads every Circuit setting from the
 * server-side environment at call time. NOTHING here is hard-coded — no
 * endpoint, no model, no App Key. The access token is short-lived runtime
 * state and is never an env var.
 *
 * Per the current Circuit contract, an App Key is NOT used. This module
 * intentionally does not read CIRCUIT_APP_KEY.
 */

export type CircuitConfig = {
  provider: string;
  clientId: string | null;
  clientSecret: string | null;
  tokenUrl: string | null;
  inferenceUrl: string | null;
  model: string | null;
  /** App Key required by the inference contract (sent in the body `user`
   * field). Secret — read from env, never hard-coded/committed. */
  appKey: string | null;
  scope: string | null;
  audience: string | null;
  timeoutMs: number;
  maxRetries: number;
  tokenFallbackTtlSeconds: number;
  tokenRefreshSkewSeconds: number;
  promptVersion: string;
  schemaVersion: string;
  /** The wire contract in contract.ts is confirmed against the Circuit
   * notebook. Until this is explicitly true, NO live token or inference
   * request is sent — the client returns CIRCUIT_CONTRACT_UNCONFIRMED so
   * the provisional (assumed) request/response shapes can never run
   * silently in production. */
  contractConfirmed: boolean;
  /** Human-set identifier of the confirmed contract, surfaced in safe
   * diagnostics (never a secret). */
  contractVersion: string | null;
  /** Server-only local-dev switch (CIRCUIT_REQUIRED). When true the Signal
   * Agent run MUST call Circuit and PROMOTE its validated output into the
   * canonical fields; a failed required stage is surfaced (analysis_mode
   * deterministic_fallback + circuit_run_error) rather than silently hidden. */
  required: boolean;
};

function str(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number((value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Reads Circuit config live from process.env (never cached across
 * requests, so a changed env is picked up and diagnostics stay live). */
export function getCircuitConfig(): CircuitConfig {
  const env = process.env;
  return {
    provider: str(env.AI_PROVIDER) ?? "circuit",
    clientId: str(env.CIRCUIT_CLIENT_ID),
    clientSecret: str(env.CIRCUIT_CLIENT_SECRET),
    tokenUrl: str(env.CIRCUIT_TOKEN_URL),
    inferenceUrl: str(env.CIRCUIT_INFERENCE_URL),
    model: str(env.CIRCUIT_MODEL),
    appKey: str(env.CIRCUIT_APP_KEY),
    scope: str(env.CIRCUIT_SCOPE),
    audience: str(env.CIRCUIT_AUDIENCE),
    timeoutMs: num(env.CIRCUIT_TIMEOUT_MS, 45_000),
    maxRetries: num(env.CIRCUIT_MAX_RETRIES, 2),
    tokenFallbackTtlSeconds: num(env.CIRCUIT_TOKEN_FALLBACK_TTL_SECONDS, 3_000),
    tokenRefreshSkewSeconds: num(env.CIRCUIT_TOKEN_REFRESH_SKEW_SECONDS, 60),
    promptVersion: str(env.CIRCUIT_PROMPT_VERSION) ?? "signal-to-action-circuit-v1",
    schemaVersion: str(env.CIRCUIT_SCHEMA_VERSION) ?? "1.0",
    contractConfirmed: (str(env.CIRCUIT_CONTRACT_CONFIRMED) ?? "false").toLowerCase() === "true",
    contractVersion: str(env.CIRCUIT_CONTRACT_VERSION),
    required: (str(env.CIRCUIT_REQUIRED) ?? "false").toLowerCase() === "true"
  };
}

/** Server-only: whether Circuit is REQUIRED for this run (CIRCUIT_REQUIRED
 * env var). When required, the run promotes Circuit output into the
 * canonical fields and surfaces stage failures instead of quietly labeling
 * the result deterministic. */
export function isCircuitRequired(config: CircuitConfig = getCircuitConfig()): boolean {
  return config.required;
}

/** The exact env-var NAMES still required for Circuit to be fully
 * operational (inference + confirmed contract). Names only — NEVER a value —
 * so the setup/run diagnostics can tell the operator precisely what to set
 * in the local env file without ever surfacing a secret. */
export function missingCircuitConfigKeys(config: CircuitConfig = getCircuitConfig()): string[] {
  const missing: string[] = [];
  if (config.provider !== "circuit") missing.push("AI_PROVIDER=circuit");
  if (!config.clientId) missing.push("CIRCUIT_CLIENT_ID");
  if (!config.clientSecret) missing.push("CIRCUIT_CLIENT_SECRET");
  if (!config.tokenUrl) missing.push("CIRCUIT_TOKEN_URL");
  if (!config.inferenceUrl) missing.push("CIRCUIT_INFERENCE_URL");
  if (!config.appKey) missing.push("CIRCUIT_APP_KEY");
  if (!config.model) missing.push("CIRCUIT_MODEL");
  if (!config.contractConfirmed) missing.push("CIRCUIT_CONTRACT_CONFIRMED=true");
  return missing;
}

/** True only when a human has confirmed contract.ts matches the Circuit
 * notebook (CIRCUIT_CONTRACT_CONFIRMED=true). Gates every live call. */
export function isCircuitContractConfirmed(config: CircuitConfig = getCircuitConfig()): boolean {
  return config.contractConfirmed;
}

/** Token minting needs only the client credentials + token URL (the token
 * contract is confirmed). This lets authentication be tested even before
 * the inference endpoint is known. */
export function isCircuitTokenConfigured(config: CircuitConfig = getCircuitConfig()): boolean {
  return config.provider === "circuit" && Boolean(config.clientId) && Boolean(config.clientSecret) && Boolean(config.tokenUrl);
}

/** Circuit is fully "configured" for inference when token config, the
 * inference endpoint, AND the App Key (required by the confirmed inference
 * contract) are present. The active provider must also be Circuit. Model
 * is validated separately (CIRCUIT_MODEL_REQUIRED) so a missing model
 * surfaces a precise error rather than "not configured". */
export function isCircuitConfigured(config: CircuitConfig = getCircuitConfig()): boolean {
  return isCircuitTokenConfigured(config) && Boolean(config.inferenceUrl) && Boolean(config.appKey);
}
