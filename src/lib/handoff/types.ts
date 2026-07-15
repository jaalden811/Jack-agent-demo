import type { NextBestAction, ActionOwnerLane } from "@/lib/action-intelligence/types";

/**
 * Specialist Handoff Packet types (Sections 3-9). The packet lets a
 * specialist arrive already synced — without rereading the transcript or
 * re-asking answered questions. Every field is derived from assembled run
 * evidence; nothing company/product/transcript-specific is hard-coded.
 */

// ─── Do-not-re-ask question index (Section 4) ──────────────────────────

export type AnswerStatus = "complete" | "partial" | "conflicting";

export type AnsweredQuestion = {
  topic: string;
  question: string;
  answer: string;
  answer_status: AnswerStatus;
  speaker: string | null;
  evidence_ids: string[];
  safe_to_restate: boolean;
  follow_up_allowed: string | null;
};

export type OpenQuestion = {
  question: string;
  purpose: string;
  owner_lane: ActionOwnerLane;
  priority: "critical" | "high" | "medium" | "low";
  blocking: boolean;
  what_is_already_known: string;
  why_the_gap_matters: string;
  evidence_ids: string[];
};

export type DeclinedQuestion = {
  topic: string;
  what_was_declined: string;
  evidence_ids: string[];
  reraise_condition: string;
};

export type ContradictoryAnswer = {
  topic: string;
  conflicting_statements: string[];
  evidence_ids: string[];
  resolution_question: string;
};

export type QuestionIndex = {
  answered: AnsweredQuestion[];
  open: OpenQuestion[];
  declined_or_sensitive: DeclinedQuestion[];
  contradictory: ContradictoryAnswer[];
};

// ─── Meeting / workshop ready packet (Section 7) ───────────────────────

export type MeetingParticipant = { role: string; reason: string };
export type AgendaItem = { minutes: number; topic: string; owner: string; desired_output: string };
export type MeetingScenario = {
  name: string;
  business_question: string;
  known_context: string[];
  data_sources: string[];
  constraints: string[];
  success_criteria: string[];
  human_approval_points: string[];
};

export type MeetingPacket = {
  meeting_type: string;
  title: string;
  objective: string;
  recommended_duration_minutes: number;
  required_participants: MeetingParticipant[];
  optional_participants: MeetingParticipant[];
  prework: string[];
  agenda: AgendaItem[];
  scenarios: MeetingScenario[];
  questions_not_to_reask: string[];
  remaining_questions: string[];
  deliverables: string[];
  follow_up_actions: string[];
};

// ─── Handoff readiness (Section 9) ─────────────────────────────────────

export type ReadinessStatus = "ready" | "ready_with_gaps" | "blocked";

export type ReadinessComponent = {
  dimension: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
};

export type HandoffReadiness = {
  score: number;
  status: ReadinessStatus;
  components: ReadinessComponent[];
  blocking_gaps: string[];
  recommended_remediation: string[];
};

// ─── Public context that changes the action (Section 12) ───────────────

export type HandoffPublicContext = {
  public_fact: string;
  handoff_implication: string;
  action_effect: string;
  limitation: string;
  source_url: string;
  evidence_ids: string[];
};

// ─── Stakeholder / product-role summaries (compact) ────────────────────

export type HandoffStakeholder = {
  name: string | null;
  role: string;
  status: string;
  confidence: number;
  evidence: string[];
  next_question: string | null;
};

export type HandoffProductRole = {
  product: string;
  role: string;
  reason: string;
};

// ─── The packet ────────────────────────────────────────────────────────

export type HandoffAccount = {
  name: string | null;
  confidence: number;
  status: string;
};

export type HandoffRecipient = {
  lane: "sales" | "technical";
  name: string;
  role: string;
};

export type SpecialistHandoffPacket = {
  handoff_id: string;
  run_id: string;
  account: HandoffAccount;
  recipient: HandoffRecipient;
  ninety_second_brief: string;
  customer_problem: string;
  business_context: string[];
  technical_context: string[];
  current_environment: string[];
  customer_goals: string[];
  customer_constraints: string[];
  customer_objections: string[];
  customer_commitments: string[];
  decisions_already_made: string[];
  explicitly_rejected_options: string[];
  product_roles: HandoffProductRole[];
  stakeholder_map: HandoffStakeholder[];
  meddpicc_summary: Record<string, { status: string; summary: string }>;
  public_context: HandoffPublicContext[];
  recommended_action: NextBestAction;
  meeting_or_workshop_plan: MeetingPacket | null;
  questions_already_answered: AnsweredQuestion[];
  questions_not_to_reask: string[];
  remaining_questions: OpenQuestion[];
  sensitive_or_declined_questions: DeclinedQuestion[];
  recommended_opening: string;
  recommended_talking_points: string[];
  things_not_to_say: string[];
  assets_to_prepare: string[];
  expected_deliverables: string[];
  success_criteria: string[];
  evidence_ids: string[];
  readiness_score: number;
  readiness_status: ReadinessStatus;
};

// ─── Action feedback (Sections 10-11) ──────────────────────────────────

export type ActionFeedbackResponse =
  | "accepted"
  | "assigned"
  | "reassigned"
  | "deferred"
  | "completed"
  | "rejected"
  | "more_research_requested";

export type ActionFeedback = {
  action_id: string;
  run_id: string;
  actor: string;
  response: ActionFeedbackResponse;
  reason: string | null;
  timestamp: string;
  resulting_action: string | null;
};
