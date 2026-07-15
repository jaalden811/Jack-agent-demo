import { isCircuitConfigured, isCircuitContractConfirmed } from "@/lib/circuit/config";
import { buildStageAInput } from "@/lib/circuit/stages/stageAAdapter";
import { runStageA } from "@/lib/circuit/stages/stageA";
import { buildStageCInput } from "@/lib/circuit/stages/stageCAdapter";
import { runStageC } from "@/lib/circuit/stages/stageC";
import type { StageTrace } from "@/lib/circuit/stages/types";
import type { AiTrace, CircuitStageTraceSummary, SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Circuit AI-enhancement layer for the Signal-to-Action pipeline (Phases
 * 1 & 3). Runs Stage A (transcript/evidence interpretation) then Stage C
 * (qualification/action/handoff synthesis) via the shared Circuit stage
 * runner AFTER the deterministic result is built. This is ADDITIVE:
 *
 *  - deterministic evidence, account truth, and every numeric score remain
 *    authoritative and unchanged;
 *  - Circuit's validated interpretation is attached under result.ai_trace
 *    (unsupported claims are already rejected by the stage validators);
 *  - when Circuit is unconfigured/unavailable or fails, enhancement is a
 *    no-op and the deterministic result stands (never throws).
 */

const NONE: AiTrace = { provider: "circuit", enhanced: false, stages: [], stage_a: null, stage_c: null };

function summary(trace: StageTrace): CircuitStageTraceSummary {
  return {
    stage: trace.stage,
    attempted: trace.attempted,
    succeeded: trace.succeeded,
    model_returned: trace.model_returned,
    duration_ms: trace.duration_ms,
    repair_attempted: trace.repair_attempted,
    fallback_used: trace.fallback_used,
    safe_error_code: trace.safe_error_code
  };
}

export async function enhanceWithCircuit(result: SecureNetworkingTriageResult): Promise<AiTrace> {
  // Gate: only run when Circuit is fully configured AND the wire contract
  // is confirmed. Otherwise the deterministic result is authoritative.
  if (!isCircuitConfigured() || !isCircuitContractConfirmed()) return NONE;

  try {
    const stageA = await runStageA(buildStageAInput(result));
    const stageC = await runStageC(buildStageCInput(result, stageA.output));
    return {
      provider: "circuit",
      enhanced: stageA.trace.succeeded || stageC.trace.succeeded,
      stages: [summary(stageA.trace), summary(stageC.trace)],
      stage_a: stageA.output,
      stage_c: stageC.output
    };
  } catch {
    // Enhancement must never break a run — fall back to the deterministic
    // result with a non-enhanced trace.
    return NONE;
  }
}
