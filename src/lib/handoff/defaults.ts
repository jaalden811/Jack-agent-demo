import type { NextBestAction } from "@/lib/action-intelligence/types";
import type { QuestionIndex, SpecialistHandoffPacket } from "@/lib/handoff/types";

/**
 * Minimal, valid defaults for the action/handoff fields. Used by tests and
 * as safe placeholders — never as production content (runAgent always
 * builds real values). No company/product/transcript strings here.
 */

export function emptyNextBestAction(runId = "run"): NextBestAction {
  return {
    action_id: `act_${runId}`,
    action_type: "hold",
    title: "Hold pending stronger signal",
    summary: "No confident action yet.",
    owner_lane: "shared",
    primary_owner: "",
    supporting_owners: [],
    priority: "low",
    recommended_timing: null,
    due_basis: "none",
    why_now: [],
    customer_value: "",
    internal_value: "",
    evidence_ids: [],
    preconditions: [],
    dependencies: [],
    risks: [],
    success_criteria: [],
    stop_conditions: [],
    fallback_action: null,
    confidence: 0,
    status: "recommended"
  };
}

export function emptyQuestionIndex(): QuestionIndex {
  return { answered: [], open: [], declined_or_sensitive: [], contradictory: [] };
}

export function emptyHandoffPacket(lane: "sales" | "technical", runId = "run"): SpecialistHandoffPacket {
  return {
    handoff_id: `hop_${lane}_${runId}`,
    run_id: runId,
    account: { name: null, confidence: 0, status: "unresolved" },
    recipient: { lane, name: "", role: "" },
    ninety_second_brief: "",
    customer_problem: "",
    business_context: [],
    technical_context: [],
    current_environment: [],
    customer_goals: [],
    customer_constraints: [],
    customer_objections: [],
    customer_commitments: [],
    decisions_already_made: [],
    explicitly_rejected_options: [],
    product_roles: [],
    stakeholder_map: [],
    meddpicc_summary: {},
    public_context: [],
    recommended_action: emptyNextBestAction(runId),
    meeting_or_workshop_plan: null,
    questions_already_answered: [],
    questions_not_to_reask: [],
    remaining_questions: [],
    sensitive_or_declined_questions: [],
    recommended_opening: "",
    recommended_talking_points: [],
    things_not_to_say: [],
    assets_to_prepare: [],
    expected_deliverables: [],
    success_criteria: [],
    evidence_ids: [],
    readiness_score: 0,
    readiness_status: "blocked"
  };
}

export function emptyActionAndHandoffFields(runId = "run"): {
  next_best_action: NextBestAction;
  specialist_handoffs: { sales: SpecialistHandoffPacket; technical: SpecialistHandoffPacket };
  question_index: QuestionIndex;
  ai_trace: { provider: "circuit"; enhanced: boolean; stages: []; stage_a: null; stage_b: null; stage_c: null; stage_d: null };
} {
  return {
    next_best_action: emptyNextBestAction(runId),
    specialist_handoffs: { sales: emptyHandoffPacket("sales", runId), technical: emptyHandoffPacket("technical", runId) },
    question_index: emptyQuestionIndex(),
    ai_trace: { provider: "circuit", enhanced: false, stages: [], stage_a: null, stage_b: null, stage_c: null, stage_d: null }
  };
}
