import { isCircuitConfigured, isCircuitContractConfirmed } from "@/lib/circuit/config";
import { buildStageAInput } from "@/lib/circuit/stages/stageAAdapter";
import { runStageA } from "@/lib/circuit/stages/stageA";
import { buildStageBInput } from "@/lib/circuit/stages/stageBAdapter";
import { runStageB } from "@/lib/circuit/stages/stageB";
import { buildStageCInput } from "@/lib/circuit/stages/stageCAdapter";
import { runStageC } from "@/lib/circuit/stages/stageC";
import { buildStageDInput } from "@/lib/circuit/stages/stageDAdapter";
import { runStageD } from "@/lib/circuit/stages/stageD";
import type { StageTrace } from "@/lib/circuit/stages/types";
import type { AiTrace, CircuitStageTraceSummary, SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Circuit AI-enhancement layer for the Signal-to-Action pipeline (Phases
 * 1, 3 & 7). Runs Stage A (transcript/evidence interpretation), Stage B
 * (public-evidence classification, when there are public sources), Stage C
 * (qualification/action/handoff synthesis), then Stage D (recipient-specific
 * message drafts) via the shared Circuit stage runner AFTER the deterministic
 * result is built. This is ADDITIVE:
 *
 *  - deterministic evidence, account truth, and every numeric score remain
 *    authoritative and unchanged;
 *  - Circuit's validated interpretation is attached under result.ai_trace
 *    (unsupported claims are already rejected by the stage validators);
 *  - Stage D drafts are attached to ai_trace.stage_d; the delivery layer
 *    prefers them over the deterministic message builder only when they pass
 *    the same delivery-time quality gate (@/lib/webex/messageQuality);
 *  - when Circuit is unconfigured/unavailable or fails, enhancement is a
 *    no-op and the deterministic result stands (never throws).
 */

const NONE: AiTrace = { provider: "circuit", enhanced: false, stages: [], stage_a: null, stage_b: null, stage_c: null, stage_d: null };

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

    // Stage B only runs when there are normalized public sources to
    // classify — otherwise there is nothing for Circuit to do (SerpAPI
    // did not run / returned nothing).
    const hasPublicSources = (result.serpapi_signals?.signals ?? []).length > 0;
    const stageB = hasPublicSources ? await runStageB(buildStageBInput(result)) : null;

    const stageC = await runStageC(buildStageCInput(result, stageA.output, stageB?.output));

    // Stage D — recipient-specific message drafts, built from the (always
    // populated) Stage C output. If Circuit fails here it falls back to the
    // deterministic Stage D messages; the delivery layer independently
    // re-validates before ever preferring these over the message builder.
    const stageD = await runStageD(buildStageDInput(result, stageC.output));

    return {
      provider: "circuit",
      enhanced:
        stageA.trace.succeeded ||
        (stageB?.trace.succeeded ?? false) ||
        stageC.trace.succeeded ||
        stageD.trace.succeeded,
      stages: [
        summary(stageA.trace),
        ...(stageB ? [summary(stageB.trace)] : []),
        summary(stageC.trace),
        summary(stageD.trace)
      ],
      stage_a: stageA.output,
      stage_b: stageB?.output ?? null,
      stage_c: stageC.output,
      stage_d: stageD.output
    };
  } catch {
    // Enhancement must never break a run — fall back to the deterministic
    // result with a non-enhanced trace.
    return NONE;
  }
}
