import { getCircuitConfig, isCircuitConfigured } from "@/lib/circuit/config";
import { circuitGenerate } from "@/lib/circuit/client";
import { testCircuitAuthentication } from "@/lib/circuit/diagnostics";
import type { AiProvider, AiProviderId } from "@/lib/ai-provider/types";

/**
 * Provider registry (Phase 5/14). Resolves the single active AI provider
 * from AI_PROVIDER (currently only "circuit"). Both application flows
 * (Market + Buyer Intelligence and Signal-to-Action) obtain the provider
 * here so they share one token manager and one client — never a per-flow
 * duplicate. Provider selection never lives in a React component.
 */

const circuitProvider: AiProvider = {
  id: "circuit",
  async getStatus() {
    const config = getCircuitConfig();
    const configured = isCircuitConfigured(config);
    return { provider: "circuit", configured, operational: configured, model: config.model, detail: configured ? null : "Circuit is not configured." };
  },
  async testAuthentication() {
    const result = await testCircuitAuthentication();
    return { ok: result.ok, error_code: result.error_code, at: result.at };
  },
  async generate(request) {
    const result = await circuitGenerate({
      prompt: request.prompt,
      system: request.system,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      timeoutMs: request.timeoutMs
    });
    return {
      ok: result.ok,
      text: result.text,
      model: result.model,
      request_id: result.request_id,
      duration_ms: result.duration_ms,
      error_code: result.error ? result.error.code : null,
      retryable: result.error ? result.error.retryable : false
    };
  }
};

const noneProvider: AiProvider = {
  id: "none",
  async getStatus() {
    return { provider: "none", configured: false, operational: false, model: null, detail: "No AI provider is active; deterministic engine only." };
  },
  async testAuthentication() {
    return { ok: false, error_code: "NO_AI_PROVIDER", at: new Date().toISOString() };
  },
  async generate() {
    return { ok: false, text: null, model: null, request_id: null, duration_ms: 0, error_code: "NO_AI_PROVIDER", retryable: false };
  }
};

/** Resolves the active provider. Defaults to Circuit; "none" only when
 * AI_PROVIDER is explicitly set to none (deterministic-only mode). */
export function getActiveAiProvider(): AiProvider {
  const id = (process.env.AI_PROVIDER ?? "circuit").trim().toLowerCase() as AiProviderId;
  if (id === "none") return noneProvider;
  return circuitProvider;
}
