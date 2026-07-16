/**
 * Personalization domain types (seller profile, objectives, personal
 * relevance, goal impact, teaser, notification decision, personalization
 * context). All lists/weights are data-driven (config), never hard-coded in
 * components. Personalization affects ranking + communication ONLY — never
 * the deterministic opportunity scores, routing, or evidence identity.
 */

export type SellerLane = "sales" | "technical" | "specialist" | "leadership" | "operations";

export type GoalTimeframe = "quarter" | "year" | "rolling";

export type SellerGoal = {
  goal_id: string;
  weight: number;
  target: number | null;
  unit: string | null;
  timeframe: GoalTimeframe;
};

/** Private by construction — never serialized into messages, shared audit
 * exports, public links, or another recipient's view. */
export type CompensationContext = {
  currency: string | null;
  annual_target: number | null;
  current_attainment: number | null;
  pipeline_coverage_target: number | null;
  minimum_opportunity_value: number | null;
  private: true;
};

export type NotificationPreferences = {
  mode: "immediate" | "in_app_only" | "daily_digest";
  quiet_hours: { enabled: boolean; start: string; end: string };
  max_immediate_per_day: number | null;
  min_personal_relevance: number | null;
  min_signal_strength: number | null;
  alert_on_review: boolean;
  alert_on_high_intent: boolean;
  never_alert_on_noise: boolean;
  message_density: "concise" | "standard" | "detailed";
  tone: "executive" | "commercial" | "technical" | "neutral";
  channels: Array<"webex" | "outlook" | "in_app">;
};

export type SellerProfile = {
  profile_id: string;
  person_id: string | null;
  display_name: string;
  email: string;
  title: string | null;
  role_family: string;
  lane: SellerLane;
  location: string | null;
  geographies: string[];
  territories: string[];
  segments: string[];
  specialties: string[];
  product_domains: string[];
  assigned_account_types: string[];
  measurement_metrics: string[];
  goals: SellerGoal[];
  compensation_context: CompensationContext;
  notification_preferences: NotificationPreferences;
  version: string;
  created_at: string;
  updated_at: string;
  profile_completeness: number;
  active: boolean;
};

/** The profile as safe to expose to OTHER recipients / shared exports:
 * private compensation context is stripped. */
export type SafeSellerProfile = Omit<SellerProfile, "compensation_context">;

export type ObjectiveDefinition = {
  objective_id: string;
  label: string;
  description: string;
  applicable_role_families: string[];
  measurement_types: string[];
  compatible_taxonomy_categories: string[];
  message_emphasis: string[];
  research_signal_types: string[];
  default_weight: number;
  active: boolean;
};

export type PersonalRelevanceFactor = {
  dimension: string;
  score: number;
  weight: number;
  contribution: number;
  reason: string;
  evidence_ids: string[];
};

export type GoalAlignment = {
  goal_id: string;
  alignment: number;
  reason: string;
};

export type PersonalRelevance = {
  score: number;
  confidence: number;
  band: "high" | "medium" | "low" | "unavailable";
  factors: PersonalRelevanceFactor[];
  missing_inputs: string[];
  goal_alignment: GoalAlignment[];
  /** Penalty reason codes actually applied (never negative surprises). */
  penalties_applied: string[];
};

export type GoalImpact = {
  status: "quantified" | "qualitative" | "unavailable";
  headline: string;
  verified_opportunity_value: number | null;
  quota_contribution_percent: number | null;
  remaining_target_contribution_percent: number | null;
  strategic_size_band: "small" | "medium" | "large" | "strategic" | "unknown";
  basis: string[];
  limitations: string[];
};

export type TeaserEvidencePoint = { text: string; evidence_ids: string[] };

export type OpportunityTeaser = {
  headline: string;
  account: string;
  signal_label: string;
  why_you: string;
  why_now: string;
  goal_alignment: string | null;
  goal_impact: string | null;
  recommended_action: string;
  expected_output: string;
  evidence_points: TeaserEvidencePoint[];
  confidence: number;
  limitation: string | null;
  cta_labels: string[];
};

export type NotificationDecision = {
  decision: "immediate" | "digest" | "in_app_only" | "suppress";
  reason_codes: string[];
  recipient_profile_id: string | null;
  personal_relevance_score: number;
  novelty_score: number;
  duplicate_of: string | null;
  cooldown_until: string | null;
  message_density: "concise" | "standard" | "detailed";
};

/** Safe, validated context passed to Circuit Stage C/D for salience/wording
 * only. Never contains private compensation values. */
export type PersonalizationContext = {
  recipient: {
    profile_id: string;
    role_family: string;
    lane: string;
    title: string | null;
    location: string | null;
    territories: string[];
    specialties: string[];
    product_domains: string[];
  };
  goals: Array<{ goal_id: string; label: string; weight: number }>;
  measurement_metrics: string[];
  notification_preferences: { message_density: string; tone: string };
  personal_relevance: { score: number; band: string; top_dimensions: string[] };
  goal_impact: { status: string; headline: string };
  attendance_status: string;
  already_knows: string[];
  do_not_reask: string[];
};

/** The additive personalization block attached to the canonical result. */
export type PersonalizationBlock = {
  profile_id: string | null;
  profile_complete: boolean;
  personal_relevance: PersonalRelevance;
  goal_alignment: GoalAlignment[];
  goal_impact: GoalImpact;
  notification_decision: NotificationDecision;
  opportunity_teaser: OpportunityTeaser;
  /** Per-recipient teasers with lane-specific emphasis (owner-only goal
   * impact). Sales and technical are materially different. */
  recipient_teasers?: Record<"sales" | "technical" | "leadership", OpportunityTeaser>;
  search_plan: {
    objective_ids: string[];
    queries_planned: number;
    queries_executed: number;
    cache_hits: number;
    budget_remaining: number;
  };
};
