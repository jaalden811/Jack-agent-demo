import type { z } from "zod";
import { circuitGenerate } from "@/lib/circuit/client";
import { getCircuitConfig, isCircuitConfigured, isCircuitContractConfirmed } from "@/lib/circuit/config";
import { loadCircuitMasterPrompt } from "@/lib/circuit/prompts/promptLoader";
import { extractJsonObject } from "@/lib/circuit/stages/jsonParser";

/**
 * Lightweight, grounded Circuit synthesis for CONTENT PRODUCTION beyond the
 * A–D stages (Decision Packet narrative, run-assistant answers). Same discipline
 * as the stage runner — call → parse one JSON object → Zod-validate → grounding
 * validate → one repair → deterministic fallback — but decoupled from the
 * A–D stage enum/trace. Circuit is an enhancement layer: a failure NEVER breaks
 * the deterministic result, and the caller decides how to use `used` for
 * honest provenance. Grounding is the caller's responsibility (the `validate`
 * hook), so Circuit can only rephrase evidence it was given — never invent.
 */

export type GroundedSynthesisResult<T> = { output: T; used: boolean; safe_error_code: string | null };

export async function groundedSynthesis<T>(params: {
  schema: z.ZodType<T>;
  buildPrompt: () => string;
  /** Grounding + shape checks beyond the schema. Return issues (empty = ok). */
  validate?: (output: T) => string[];
  /** Deterministic value used whenever Circuit is unavailable/invalid. */
  fallback: () => T;
  /** Optional system-prompt override (e.g. the orchestration master prompt).
   * Defaults to the A–D master prompt. */
  system?: string;
  timeoutMs?: number;
}): Promise<GroundedSynthesisResult<T>> {
  const cfg = getCircuitConfig();
  if (!isCircuitConfigured(cfg) || !isCircuitContractConfirmed(cfg)) {
    return { output: params.fallback(), used: false, safe_error_code: "CIRCUIT_NOT_CONFIGURED" };
  }

  let system: string;
  try {
    system = params.system ?? loadCircuitMasterPrompt().text;
  } catch {
    return { output: params.fallback(), used: false, safe_error_code: "MASTER_PROMPT_UNAVAILABLE" };
  }

  const attempt = async (
    prompt: string
  ): Promise<{ ok: true; output: T } | { ok: false; code: string; issues: string[] }> => {
    const r = await circuitGenerate({ system, prompt, timeoutMs: params.timeoutMs });
    if (!r.ok || r.text === null) return { ok: false, code: r.error?.code ?? "CIRCUIT_UNKNOWN_ERROR", issues: [r.error?.message ?? "no text"] };
    const parsed = extractJsonObject(r.text);
    if (parsed === null) return { ok: false, code: "CIRCUIT_RESPONSE_PARSE_FAILED", issues: ["response was not valid JSON"] };
    const sr = params.schema.safeParse(parsed);
    if (!sr.success) return { ok: false, code: "CIRCUIT_SCHEMA_VALIDATION_FAILED", issues: sr.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`) };
    const issues = params.validate ? params.validate(sr.data) : [];
    if (issues.length > 0) return { ok: false, code: "CIRCUIT_SCHEMA_VALIDATION_FAILED", issues };
    return { ok: true, output: sr.data };
  };

  const first = await attempt(params.buildPrompt());
  if (first.ok) return { output: first.output, used: true, safe_error_code: null };
  // A provider/config failure (not a schema/parse problem) → straight to fallback.
  if (first.code !== "CIRCUIT_SCHEMA_VALIDATION_FAILED" && first.code !== "CIRCUIT_RESPONSE_PARSE_FAILED") {
    return { output: params.fallback(), used: false, safe_error_code: first.code };
  }

  const repairPrompt = [
    params.buildPrompt(),
    "",
    "Your previous response was rejected. Return ONE valid JSON object only (no markdown, no code fences, no commentary).",
    "Use ONLY the facts/evidence provided in the input — do not add anything not present. Fix these problems:",
    ...first.issues.map((i) => `- ${i}`)
  ].join("\n");
  const repaired = await attempt(repairPrompt);
  if (repaired.ok) return { output: repaired.output, used: true, safe_error_code: null };
  return { output: params.fallback(), used: false, safe_error_code: repaired.code };
}
