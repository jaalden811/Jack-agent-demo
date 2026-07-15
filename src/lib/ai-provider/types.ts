/**
 * Provider-neutral AI abstraction (Phase 5). Circuit is the only active
 * provider today, but call sites depend on this interface — not on Circuit
 * (or any vendor) directly — so provider selection is centralized and no
 * environment reads or vendor SDKs leak into components or business logic.
 */

export type AiProviderId = "circuit" | "none";

export type AiProviderStatus = {
  provider: AiProviderId;
  configured: boolean;
  operational: boolean;
  model: string | null;
  detail: string | null;
};

export type AiProviderTestResult = {
  ok: boolean;
  error_code: string | null;
  at: string;
};

export type AiGenerateRequest = {
  prompt: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export type AiGenerateResult = {
  ok: boolean;
  text: string | null;
  model: string | null;
  request_id: string | null;
  duration_ms: number;
  error_code: string | null;
  /** True when the failure is transient (network/timeout/429/5xx). */
  retryable: boolean;
};

export interface AiProvider {
  id: AiProviderId;
  getStatus(): Promise<AiProviderStatus>;
  testAuthentication(): Promise<AiProviderTestResult>;
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
}
