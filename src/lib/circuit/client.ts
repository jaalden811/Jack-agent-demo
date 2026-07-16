import { getCircuitConfig, isCircuitConfigured, isCircuitContractConfirmed, type CircuitConfig } from "@/lib/circuit/config";
import { buildInferenceRequest, parseInferenceResponse, extractRequestId } from "@/lib/circuit/contract";
import { classifyCircuitHttpStatus, classifyCircuitThrown, makeCircuitError, isRetryable } from "@/lib/circuit/errorNormalizer";
import { getCircuitAccessToken, invalidateCircuitToken } from "@/lib/circuit/tokenManager";
import type { CircuitGenerateRequest, CircuitGenerateResult } from "@/lib/circuit/types";

/**
 * Circuit inference client (Phase 8). Builds the request from the isolated
 * wire contract, attaches the cached access token, and classifies every
 * outcome. Retries only retryable failures (network/timeout/429/5xx) with
 * bounded attempts; refreshes the token once on a 401 and retries once.
 * The model is configuration-driven (never hard-coded); a blank model
 * yields CIRCUIT_MODEL_REQUIRED.
 */

const RETRY_BACKOFF_MS = [0, 500, 1500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function circuitGenerate(request: CircuitGenerateRequest, config: CircuitConfig = getCircuitConfig()): Promise<CircuitGenerateResult> {
  const startedAt = Date.now();
  const base: Omit<CircuitGenerateResult, "ok" | "error"> = {
    text: null,
    model: null,
    finish_reason: null,
    usage: null,
    request_id: null,
    http_status: null,
    duration_ms: 0
  };

  if (!isCircuitConfigured(config)) {
    return { ...base, ok: false, duration_ms: Date.now() - startedAt, error: makeCircuitError("CIRCUIT_NOT_CONFIGURED") };
  }
  // Fail explicitly (no network) until the wire contract is confirmed —
  // never silently send the provisional/assumed inference payload.
  if (!isCircuitContractConfirmed(config)) {
    return { ...base, ok: false, duration_ms: Date.now() - startedAt, error: makeCircuitError("CIRCUIT_CONTRACT_UNCONFIRMED") };
  }
  if (!config.model) {
    return { ...base, ok: false, duration_ms: Date.now() - startedAt, error: makeCircuitError("CIRCUIT_MODEL_REQUIRED") };
  }

  const maxAttempts = Math.max(1, config.maxRetries + 1);
  let refreshedOn401 = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { token, error: tokenError } = await getCircuitAccessToken(config);
    if (!token) {
      return { ...base, ok: false, duration_ms: Date.now() - startedAt, error: tokenError ?? makeCircuitError("CIRCUIT_TOKEN_REQUEST_FAILED") };
    }

    const spec = buildInferenceRequest({
      config,
      accessToken: token.access_token,
      model: config.model,
      prompt: request.prompt,
      system: request.system,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? config.timeoutMs);
    try {
      const res = await fetch(spec.url, { method: spec.method, headers: spec.headers, body: spec.body, signal: controller.signal });
      const requestId = extractRequestId(res.headers);

      if (res.status === 401 && !refreshedOn401) {
        // Refresh the token once and retry once.
        refreshedOn401 = true;
        invalidateCircuitToken();
        continue;
      }

      if (!res.ok) {
        const error = classifyCircuitHttpStatus(res.status, requestId);
        if (isRetryable(error) && attempt < maxAttempts - 1) {
          await sleep(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
          continue;
        }
        return { ...base, ok: false, http_status: res.status, request_id: requestId, duration_ms: Date.now() - startedAt, error };
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { ...base, ok: false, http_status: res.status, request_id: requestId, duration_ms: Date.now() - startedAt, error: makeCircuitError("CIRCUIT_RESPONSE_PARSE_FAILED", res.status, requestId) };
      }

      const parsed = parseInferenceResponse(body);
      if (parsed.text === null) {
        return { ...base, ok: false, http_status: res.status, request_id: requestId, model: parsed.model, duration_ms: Date.now() - startedAt, error: makeCircuitError("CIRCUIT_RESPONSE_PARSE_FAILED", res.status, requestId) };
      }

      return {
        ok: true,
        text: parsed.text,
        model: parsed.model ?? config.model,
        finish_reason: parsed.finish_reason,
        usage: parsed.usage,
        request_id: requestId,
        http_status: res.status,
        duration_ms: Date.now() - startedAt,
        error: null
      };
    } catch (error) {
      const normalized = classifyCircuitThrown(error);
      if (isRetryable(normalized) && attempt < maxAttempts - 1) {
        await sleep(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
        continue;
      }
      return { ...base, ok: false, duration_ms: Date.now() - startedAt, error: normalized };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ...base, ok: false, duration_ms: Date.now() - startedAt, error: makeCircuitError("CIRCUIT_AUTHENTICATION_REJECTED") };
}
