/**
 * Canonical Next Best Action (Section 2). The defining output of the
 * product: not "here is information" but "here is the specific recommended
 * action, who owns it, why now, the evidence, and how success is measured."
 * Every field is derived from already-assembled run evidence — nothing is
 * hard-coded to a company/product/transcript.
 */

export type ActionType =
  | "account_confirmation"
  | "commercial_discovery"
  | "technical_discovery"
  | "architecture_workshop"
  | "proof_of_value"
  | "demo"
  | "executive_alignment"
  | "procurement_discovery"
  | "renewal_review"
  | "competitive_validation"
  | "follow_up"
  | "hold"
  | "suppress";

export type ActionOwnerLane = "sales" | "technical" | "shared";
export type ActionPriority = "critical" | "high" | "medium" | "low";
export type ActionDueBasis =
  | "customer_commitment"
  | "planning_boundary"
  | "renewal"
  | "procurement"
  | "operational_urgency"
  | "internal_sla"
  | "none";
export type ActionStatus =
  | "recommended"
  | "accepted"
  | "assigned"
  | "in_progress"
  | "completed"
  | "deferred"
  | "rejected"
  | "superseded";

export type NextBestAction = {
  action_id: string;
  action_type: ActionType;
  title: string;
  summary: string;
  owner_lane: ActionOwnerLane;
  primary_owner: string;
  supporting_owners: string[];
  priority: ActionPriority;
  recommended_timing: string | null;
  due_basis: ActionDueBasis;
  why_now: string[];
  customer_value: string;
  internal_value: string;
  evidence_ids: string[];
  preconditions: string[];
  dependencies: string[];
  risks: string[];
  success_criteria: string[];
  stop_conditions: string[];
  fallback_action: string | null;
  confidence: number;
  status: ActionStatus;
};
