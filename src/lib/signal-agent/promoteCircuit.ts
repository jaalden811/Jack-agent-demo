import {
  getCircuitConfig,
  isCircuitConfigured,
  isCircuitContractConfirmed,
  isCircuitRequired,
  missingCircuitConfigKeys
} from "@/lib/circuit/config";
import type { StageAOutput } from "@/lib/circuit/stages/stageA";
import type { StageCOutput } from "@/lib/circuit/stages/stageC";
import type { Meddpicc, MeddpiccField, MeddpiccStatus } from "@/lib/qualification/types";
import type { NextBestAction } from "@/lib/action-intelligence/types";
import type {
  AnalysisMode,
  CircuitRunDiagnostic,
  CircuitStageDiagnostic,
  CircuitStageTraceSummary,
  SecureNetworkingTriageResult
} from "@/lib/signal-agent/types";
import { isObjectionOrSkepticism } from "@/lib/qualification/nextStepPolarity";

/**
 * Promotes VALIDATED Circuit output into the canonical result fields the UI
 * renders — Circuit becomes the canonical *interpretation* layer while the
 * deterministic engine remains authoritative for arithmetic, routing, and
 * evidence identity (never overwritten here).
 *
 * Runs AFTER enhanceWithCircuit() has attached result.ai_trace. Promotion is
 * strictly per-stage and gated on that stage's Circuit call actually
 * succeeding (a stage that fell back to deterministic output promotes
 * nothing). It also computes result.analysis_mode + result.circuit_run so a
 * silent deterministic fallback can never be hidden behind an "AI: Ready"
 * badge, and surfaces the exact stage + safe error when Circuit is required.
 *
 * This function mutates: result.meddpicc, result.next_best_action,
 * result.stakeholder_analysis (speaker sides), result.analysis_mode, and
 * result.circuit_run. The caller (runAgent) rebuilds the question index +
 * handoff packets afterwards so readiness reflects the promoted state.
 */

const MEDDPICC_KEYS: (keyof Meddpicc)[] = [
  "metrics",
  "economic_buyer",
  "decision_criteria",
  "decision_process",
  "paper_process",
  "identify_pain",
  "champion",
  "competition"
];

const VALID_MEDD_STATUS = new Set<MeddpiccStatus>([
  "CONFIRMED",
  "PARTIAL",
  "HYPOTHESIS",
  "MISSING",
  "CONFLICTING",
  "DISTRIBUTED"
]);

function normMeddStatus(raw: string): MeddpiccStatus {
  const u = (raw ?? "").trim().toUpperCase();
  return VALID_MEDD_STATUS.has(u as MeddpiccStatus) ? (u as MeddpiccStatus) : "MISSING";
}

function confidenceForStatus(status: MeddpiccStatus): number {
  switch (status) {
    case "CONFIRMED":
      return 0.85;
    case "PARTIAL":
    case "DISTRIBUTED":
      return 0.5;
    case "CONFLICTING":
      return 0.4;
    case "HYPOTHESIS":
      return 0.35;
    default:
      return 0.1;
  }
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => typeof v === "string" && v.trim().length > 0)));
}

/** Objection / gap lines that must never be presented as an urgency driver
 * ("why now"). Objection/skepticism detection is shared with next-step
 * polarity (generic linguistic shapes in config); the remaining patterns
 * cover generic missing-evidence gaps. Never tied to a specific transcript. */
function looksLikeObjectionOrGap(line: string): boolean {
  return (
    isObjectionOrSkepticism(line) ||
    /\b(no quantified|not (?:been )?quantif\w*|no (?:explicit )?(?:budget|timeline|renewal)|no baseline)\b/i.test(line)
  );
}

function firstSentence(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

/** Maps Circuit's Stage C MEDDPICC (loose {status,summary,...}) onto the
 * canonical MeddpiccField shape, per dimension. */
function promoteMeddpicc(canonical: Meddpicc, stageC: StageCOutput): Meddpicc {
  const src = (stageC.meddpicc ?? {}) as Record<
    string,
    { status?: string; summary?: string; evidence_ids?: string[]; next_question?: string } | undefined
  >;
  const out = { ...canonical } as Meddpicc;
  for (const key of MEDDPICC_KEYS) {
    const dim = src[key];
    if (!dim || (!dim.status && !dim.summary)) continue;
    const status = normMeddStatus(dim.status ?? "MISSING");
    const nextQ = (dim.next_question ?? "").trim();
    const field: MeddpiccField = {
      status,
      summary: (dim.summary ?? "").trim() || canonical[key].summary,
      confidence: confidenceForStatus(status),
      evidence_ids: Array.isArray(dim.evidence_ids) ? uniq(dim.evidence_ids) : canonical[key].evidence_ids,
      gaps: nextQ ? uniq([nextQ, ...canonical[key].gaps]).slice(0, 4) : canonical[key].gaps,
      next_question: nextQ || canonical[key].next_question
    };
    out[key] = field;
  }
  return out;
}

/** Overrides only the interpretation/narrative of the Next Best Action from
 * Stage C. Routing-derived fields (owner_lane, primary_owner, due_basis,
 * priority, confidence, action_id) are deterministic and preserved. */
function promoteNextBestAction(canonical: NextBestAction, stageC: StageCOutput): NextBestAction {
  const nba = stageC.next_best_action;
  if (!nba || !nba.summary?.trim()) return canonical;

  const timing = nba.timing_basis?.trim() || canonical.recommended_timing;
  // "Why now" is derived from Circuit's (transcript-grounded) Stage C output
  // and any deterministic drivers that are NOT objections/gaps — never the
  // service-map objection or the "no quantified impact" gap.
  const whyNow = uniq([
    nba.summary.trim() ? `Customer-requested next step: ${firstSentence(nba.summary)}` : "",
    timing ? `Timing driver: ${timing}` : "",
    ...canonical.why_now.filter((line) => !looksLikeObjectionOrGap(line))
  ]).slice(0, 4);

  return {
    ...canonical,
    title: nba.title?.trim() || canonical.title,
    summary: nba.summary.trim(),
    recommended_timing: timing,
    why_now: whyNow.length > 0 ? whyNow : canonical.why_now.filter((l) => !looksLikeObjectionOrGap(l)),
    success_criteria: nba.success_criteria?.length ? uniq(nba.success_criteria) : canonical.success_criteria,
    evidence_ids: uniq([...(nba.evidence_ids ?? []), ...canonical.evidence_ids]).slice(0, 20)
  };
}

/** Vendor-monotonic speaker-side promotion: Circuit Stage A may only upgrade
 * a speaker from customer→vendor (catch a seller the deterministic pass
 * missed); it can never downgrade a vendor to customer. So a Stage A that
 * wrongly leaves a seller as "customer" can never re-introduce that seller
 * into the customer stakeholder list. Returns the set of names promoted to
 * vendor (for stakeholder filtering). */
function promoteSpeakerSides(result: SecureNetworkingTriageResult, stageA: StageAOutput): Set<string> {
  const vendorNames = new Set<string>();
  const sideByName = new Map<string, string>();
  for (const s of stageA.speaker_classifications ?? []) {
    if (s.speaker) sideByName.set(s.speaker.trim().toLowerCase(), (s.side ?? "").toLowerCase());
  }
  for (const p of result.stakeholder_analysis.participants) {
    const stageASide = sideByName.get((p.name ?? "").trim().toLowerCase());
    if (stageASide === "vendor" && p.classification !== "vendor") {
      p.classification = "vendor";
    }
    if (p.classification === "vendor" && p.name) vendorNames.add(p.name.trim().toLowerCase());
  }
  // Never present a vendor-classified speaker as a customer stakeholder.
  result.stakeholder_analysis.named_stakeholders = result.stakeholder_analysis.named_stakeholders.filter(
    (s) => !s.name || !vendorNames.has(s.name.trim().toLowerCase())
  );
  return vendorNames;
}

function stageStatus(t: CircuitStageTraceSummary | undefined, present: boolean): CircuitStageDiagnostic["status"] {
  if (!present || !t) return "skipped";
  if (t.succeeded) return "ok";
  if (t.fallback_used) return "fallback";
  return "fail";
}

/** Promotes validated Circuit output into canonical fields + computes the
 * run diagnostic + analysis_mode. Mutates `result`. */
export function promoteCircuitIntoCanonical(result: SecureNetworkingTriageResult): void {
  const cfg = getCircuitConfig();
  const required = isCircuitRequired(cfg);
  const configured = isCircuitConfigured(cfg);
  const contractConfirmed = isCircuitContractConfirmed(cfg);
  const trace = result.ai_trace;
  const stages = trace.stages ?? [];
  const byStage = new Map(stages.map((s) => [s.stage, s]));

  const hasPublicSources = (result.serpapi_signals?.signals ?? []).length > 0;
  const aTrace = byStage.get("A");
  const bTrace = byStage.get("B");
  const cTrace = byStage.get("C");
  const dTrace = byStage.get("D");

  const aOk = Boolean(aTrace?.succeeded) && trace.stage_a != null;
  const bOk = Boolean(bTrace?.succeeded);
  const cOk = Boolean(cTrace?.succeeded) && trace.stage_c != null;
  const dOk = Boolean(dTrace?.succeeded);

  // --- Promote per stage (only when that Circuit stage actually succeeded) ---
  if (aOk && trace.stage_a) promoteSpeakerSides(result, trace.stage_a);
  if (cOk && trace.stage_c) {
    result.meddpicc = promoteMeddpicc(result.meddpicc, trace.stage_c);
    result.next_best_action = promoteNextBestAction(result.next_best_action, trace.stage_c);
  }
  // Stage B is additive (public-evidence classification lives in ai_trace and
  // is merged into evidence elsewhere); Stage D is promoted at delivery time
  // (the delivery layer re-validates the drafts before using them).

  // --- analysis_mode ---
  const requiredStages: Array<{ key: string; ok: boolean; trace?: CircuitStageTraceSummary }> = [
    { key: "A", ok: aOk, trace: aTrace },
    ...(hasPublicSources ? [{ key: "B", ok: bOk, trace: bTrace }] : []),
    { key: "C", ok: cOk, trace: cTrace },
    { key: "D", ok: dOk, trace: dTrace }
  ];
  const okCount = requiredStages.filter((s) => s.ok).length;
  let analysisMode: AnalysisMode;
  if (!trace.enhanced || okCount === 0) analysisMode = "deterministic_fallback";
  else if (okCount === requiredStages.length) analysisMode = "circuit";
  else analysisMode = "circuit_partial";
  result.analysis_mode = analysisMode;

  // --- run diagnostic (safe; never secrets) ---
  const anySucceeded = stages.some((s) => s.succeeded);
  const attempted = stages.length > 0;
  const firstErr = stages.map((s) => s.safe_error_code).find((c) => Boolean(c)) ?? null;
  const requiredFailure =
    required && analysisMode !== "circuit"
      ? (() => {
          const failed = requiredStages.find((s) => !s.ok);
          if (!failed) return { stage: "unknown", code: "CIRCUIT_NOT_RUN" };
          return {
            stage: `stage_${failed.key.toLowerCase()}`,
            code: failed.trace?.safe_error_code ?? (attempted ? "CIRCUIT_STAGE_FALLBACK" : "CIRCUIT_NOT_CONFIGURED")
          };
        })()
      : null;

  const diagnostic: CircuitRunDiagnostic = {
    required,
    configured,
    contract_confirmed: contractConfirmed,
    authenticated: attempted ? anySucceeded : null,
    inference: attempted ? anySucceeded : null,
    stages: {
      stage_a: { status: stageStatus(aTrace, true), promoted: aOk, safe_error_code: aTrace?.safe_error_code ?? null },
      stage_b: { status: stageStatus(bTrace, hasPublicSources), promoted: false, safe_error_code: bTrace?.safe_error_code ?? null },
      stage_c: { status: stageStatus(cTrace, true), promoted: cOk, safe_error_code: cTrace?.safe_error_code ?? null },
      stage_d: { status: stageStatus(dTrace, true), promoted: dOk, safe_error_code: dTrace?.safe_error_code ?? null }
    },
    repair_attempted: stages.some((s) => s.repair_attempted),
    fallback_used: stages.some((s) => s.fallback_used),
    safe_error_code: firstErr,
    missing_config: missingCircuitConfigKeys(cfg),
    required_failure: requiredFailure
  };
  result.circuit_run = diagnostic;
}
