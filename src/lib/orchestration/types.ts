/**
 * signal-to-action-orchestration-v1 — the ActionCase orchestration contract.
 *
 * The primary product object is an ActionCase (a governed internal action plan),
 * not a transcript. This contract is assembled DETERMINISTICALLY from the
 * already-computed analysis result (scores, evidence identity, routing, the
 * internal action plan, opportunity thread, and feedback stay authoritative);
 * Circuit may only refine safe PROSE fields on top. Everything here is additive
 * and never changes deterministic scores, routing, or evidence identity.
 */

export type OrchestrationStatus = "READY" | "NEEDS_MORE_INFORMATION" | "NOT_ACTIONABLE" | "INVALID_INPUT";
export type OrchestrationMode = "CREATE" | "UPDATE" | "REASSESS" | "OUTCOME_REVIEW";
export type GovernedDecision = "PURSUE" | "NEED_MORE_INFORMATION" | "NOT_NOW" | "PASS";
export type DuplicateStatus = "NEW" | "MATERIAL_UPDATE" | "REPEATED_NO_CHANGE" | "CONFLICTING" | "REJECTED_MOTION";
export type RecommendedHandling = "CREATE" | "UPDATE_EXISTING" | "SUPPRESS" | "HUMAN_REVIEW";
export type OwnerSelectionStatus = "SELECTED" | "ADVISORY" | "AMBIGUOUS" | "UNRESOLVED";
export type ActionLane = "commercial" | "technical" | "leadership" | "legal" | "services";
export type ActionTiming = "immediate" | "before_customer_meeting" | "after_validation" | "at_funding_gate" | "if_blocked";
export type ActionRequirement = "required" | "recommended" | "conditional";
export type ActionStepStatus = "pending" | "accepted" | "in_progress" | "blocked" | "completed";
export type OutcomeEventType =
  | "owner_accepted"
  | "step_completed"
  | "customer_meeting_held"
  | "opportunity_created"
  | "stage_changed"
  | "close_date_changed"
  | "amount_changed"
  | "product_added"
  | "customer_declined"
  | "false_positive_confirmed";
export type OutcomeSource = "user" | "gong" | "crm" | "webex" | "system";

export type ActionCaseHeader = {
  action_case_id: string | null;
  opportunity_thread_id: string | null;
  title: string;
  account_id: string | null;
  account_name: string | null;
  normalized_motion: string | null;
  current_state: string | null;
  recommended_decision: GovernedDecision;
  requires_human_approval: true;
  decision_reason: string;
  positive_evidence_ids: string[];
  risk_evidence_ids: string[];
  explicit_negation_ids: string[];
  limitations: string[];
};

export type NoveltyAndDuplication = {
  duplicate_status: DuplicateStatus;
  existing_action_case_id: string | null;
  material_change: boolean;
  material_change_reasons: string[];
  evidence_ids: string[];
  recommended_handling: RecommendedHandling;
};

export type HumanDecisionEffects = {
  pursue: { create_or_activate_action_case: true; assign_work: true; start_timing: true; prepare_role_packets: true; allow_delivery_after_approval: true; suppress_duplicate_signals: true };
  need_more_information: { create_bounded_discovery_steps: true; notify_full_team: false; required_evidence: string[]; reevaluation_trigger: string | null };
  not_now: { preserve_case: true; suppress_unchanged_signals: true; reevaluation_date: string | null; reevaluation_condition: string | null };
  pass: { preserve_disqualifying_evidence: true; block_same_rejected_motion: true; route_elsewhere_if_applicable: string | null };
};

export type ResolvedParty = {
  status: OwnerSelectionStatus;
  person_id: string | null;
  required_role: string;
  lane: ActionLane;
  selection_reasons: string[];
  capability_matches: string[];
  capability_gaps: string[];
  delivery_ready: boolean;
  confidence: number;
  advisory_only: boolean;
};

export type OwnerResolution = {
  primary_owner: ResolvedParty;
  collaborators: ResolvedParty[];
  alternatives: Array<{ person_id: string | null; role_or_queue: string; reason: string }>;
  unfilled_roles: Array<{ required_role: string; reason: string; fallback_queue: string | null }>;
};

export type ActionStep = {
  id: string;
  actionCaseId: string | null;
  title: string;
  lane: ActionLane;
  assigneePersonId: string | null;
  requiredRole: string;
  timing: ActionTiming;
  requirement: ActionRequirement;
  description: string;
  reason: string;
  expectedArtifact: string;
  dependencyStepIds: string[];
  status: ActionStepStatus;
  dueAt: string | null;
  customerFacing: boolean;
  evidenceIds: string[];
  policyIds: string[];
  failureModeIfSkipped: string;
  confidence: number;
};

export type ActionGraphEdge = { fromStepId: string; toStepId: string; condition: string };

export type ActionGraph = {
  steps: ActionStep[];
  edges: ActionGraphEdge[];
  next_ready_step_ids: string[];
  blocked_step_ids: string[];
  graph_summary: string;
};

export type CustomerEngagementPlan = {
  next_customer_step: {
    title: string | null;
    owner_person_id: string | null;
    timing: string | null;
    expected_outcome: string | null;
    prerequisite_step_ids: string[];
    evidence_ids: string[];
  };
  stakeholders: Array<{
    person_or_role: string;
    buying_role: string;
    stance: "supportive" | "neutral" | "skeptical" | "blocker" | "unknown";
    engagement_objective: string;
    do_not_reask: string[];
    expected_contribution_or_decision: string;
    evidence_ids: string[];
    confidence: number;
  }>;
};

export type PacketCollaborator = { person_id: string | null; role: string; why: string; prepare: string[] };

export type CommercialPacket = {
  recipient_person_id: string | null;
  your_move_now: string;
  why_routed_to_you: string;
  coordinate_with: PacketCollaborator[];
  dependency: string | null;
  customer_next_step: string | null;
  expected_customer_outcome: string | null;
  watch_out: string | null;
  later_gate: string | null;
  evidence_ids: string[];
  message_text: string;
};

export type TechnicalPacket = {
  recipient_person_id: string | null;
  your_move_now: string;
  why_routed_to_you: string;
  coordinate_with: PacketCollaborator[];
  customer_problem: string;
  known_environment: string[];
  required_artifact: string;
  dependency: string | null;
  customer_next_step: string | null;
  watch_out: string | null;
  later_gate: string | null;
  evidence_ids: string[];
  message_text: string;
};

export type RolePackets = {
  commercial: CommercialPacket | null;
  technical: TechnicalPacket | null;
  leadership: null | Record<string, unknown>;
  legal: null | Record<string, unknown>;
  services: null | Record<string, unknown>;
};

export type ProposedOutcomeEvent = {
  id: string | null;
  actionCaseId: string | null;
  type: OutcomeEventType;
  source: OutcomeSource;
  observedAt: string;
  baselineValue: string | number | null;
  observedValue: string | number | null;
  attributionConfidence: number;
  attributionLanguage: string;
  evidenceIds: string[];
  limitations: string[];
};

export type OutcomeLedger = {
  existing_event_count: number;
  proposed_events: ProposedOutcomeEvent[];
  outcome_summary: string | null;
  next_measurements: string[];
  causation_not_established: true;
};

export type OrchestrationQuality = {
  evidence_grounded: boolean;
  no_invented_people: boolean;
  internal_customer_separation_valid: boolean;
  owner_constraints_preserved: boolean;
  graph_acyclic: boolean;
  dependency_integrity_valid: boolean;
  human_approval_preserved: boolean;
  outcome_attribution_safe: boolean;
  messages_action_first: boolean;
  duplicate_policy_respected: boolean;
  limitations: string[];
  missing_inputs: string[];
};

export type ActionCase = {
  schema_version: "signal-to-action-orchestration-v1";
  status: OrchestrationStatus;
  mode: OrchestrationMode;
  run_id: string;
  action_case: ActionCaseHeader;
  novelty_and_duplication: NoveltyAndDuplication;
  human_decision_effects: HumanDecisionEffects;
  owner_resolution: OwnerResolution;
  action_graph: ActionGraph;
  customer_engagement_plan: CustomerEngagementPlan;
  role_packets: RolePackets;
  outcome_ledger: OutcomeLedger;
  quality: OrchestrationQuality;
  /** Whether the safe prose fields were Circuit-refined or purely deterministic. */
  source: "circuit_refined" | "deterministic";
};
