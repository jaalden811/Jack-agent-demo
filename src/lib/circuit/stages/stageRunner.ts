import { circuitGenerate } from "@/lib/circuit/client";
import { getCircuitConfig } from "@/lib/circuit/config";
import { loadCircuitMasterPrompt } from "@/lib/circuit/prompts/promptLoader";
import { extractJsonObject } from "@/lib/circuit/stages/jsonParser";
import type { StageDefinition, StageResult, StageTrace } from "@/lib/circuit/stages/types";

/**
 * Generic Circuit stage runner (Phase 1). One code path for every stage:
 * assemble prompt → call Circuit → parse one JSON object → Zod-validate →
 * evidence-validate → one repair on failure → deterministic fallback.
 * Circuit is an enhancement; a failure NEVER breaks the deterministic
 * result. Trace metadata is safe (no token/App Key/transcript/headers).
 */

function baseTrace(stage: StageTrace["stage"], schemaVersion: string, modelConfigured: string | null): StageTrace {
  return {
    stage,
    attempted: false,
    succeeded: false,
    model_configured: modelConfigured,
    model_returned: null,
    duration_ms: 0,
    request_id: null,
    schema_version: schemaVersion,
    repair_attempted: false,
    fallback_used: false,
    safe_error_code: null
  };
}

async function callAndValidate<TInput, TOutput>(params: {
  def: StageDefinition<TInput, TOutput>;
  input: TInput;
  system: string;
  userPrompt: string;
  timeoutMs?: number;
}): Promise<{ ok: true; output: TOutput; model: string | null; requestId: string | null } | { ok: false; errorCode: string; issues: string[]; model: string | null; requestId: string | null }> {
  const { def, input, system, userPrompt, timeoutMs } = params;
  const result = await circuitGenerate({ system, prompt: userPrompt, timeoutMs });
  if (!result.ok || result.text === null) {
    return { ok: false, errorCode: result.error?.code ?? "CIRCUIT_UNKNOWN_ERROR", issues: [result.error?.message ?? "no text"], model: result.model, requestId: result.request_id };
  }
  const parsed = extractJsonObject(result.text);
  if (parsed === null) {
    return { ok: false, errorCode: "CIRCUIT_RESPONSE_PARSE_FAILED", issues: ["response was not valid JSON"], model: result.model, requestId: result.request_id };
  }
  const schemaResult = def.schema.safeParse(parsed);
  if (!schemaResult.success) {
    return { ok: false, errorCode: "CIRCUIT_SCHEMA_VALIDATION_FAILED", issues: schemaResult.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`), model: result.model, requestId: result.request_id };
  }
  const semanticIssues = def.validate ? def.validate(schemaResult.data, input) : [];
  if (semanticIssues.length > 0) {
    return { ok: false, errorCode: "CIRCUIT_SCHEMA_VALIDATION_FAILED", issues: semanticIssues.slice(0, 8), model: result.model, requestId: result.request_id };
  }
  return { ok: true, output: schemaResult.data, model: result.model, requestId: result.request_id };
}

export async function runStage<TInput, TOutput>(def: StageDefinition<TInput, TOutput>, input: TInput, opts?: { timeoutMs?: number }): Promise<StageResult<TOutput>> {
  const config = getCircuitConfig();
  const startedAt = Date.now();
  const trace = baseTrace(def.stage, config.schemaVersion, config.model);

  const fallback = (safeErrorCode: string | null): StageResult<TOutput> => {
    trace.fallback_used = true;
    trace.succeeded = false;
    trace.safe_error_code = safeErrorCode;
    trace.duration_ms = Date.now() - startedAt;
    return { output: def.deterministicFallback(input), trace };
  };

  let system: string;
  try {
    system = loadCircuitMasterPrompt().text;
  } catch {
    return fallback("MASTER_PROMPT_UNAVAILABLE");
  }

  const userPrompt = def.buildPrompt(input);
  trace.attempted = true;

  // First attempt.
  const first = await callAndValidate({ def, input, system, userPrompt, timeoutMs: opts?.timeoutMs });
  trace.model_returned = first.model;
  trace.request_id = first.requestId;
  if (first.ok) {
    trace.succeeded = true;
    trace.duration_ms = Date.now() - startedAt;
    return { output: first.output, trace };
  }

  // A provider/config failure (not a schema problem) → straight to fallback.
  if (first.errorCode !== "CIRCUIT_SCHEMA_VALIDATION_FAILED" && first.errorCode !== "CIRCUIT_RESPONSE_PARSE_FAILED") {
    return fallback(first.errorCode);
  }

  // One repair attempt for a malformed/invalid response.
  trace.repair_attempted = true;
  const repairPrompt = [
    userPrompt,
    "",
    "Your previous response was rejected. Return ONE valid JSON object only (no markdown, no code fences, no commentary).",
    "Fix these problems and cite ONLY evidence IDs and URLs present in the input:",
    ...first.issues.map((i) => `- ${i}`)
  ].join("\n");
  const repaired = await callAndValidate({ def, input, system, userPrompt: repairPrompt, timeoutMs: opts?.timeoutMs });
  trace.model_returned = repaired.model ?? trace.model_returned;
  trace.request_id = repaired.requestId ?? trace.request_id;
  if (repaired.ok) {
    trace.succeeded = true;
    trace.duration_ms = Date.now() - startedAt;
    return { output: repaired.output, trace };
  }

  return fallback(repaired.errorCode);
}
