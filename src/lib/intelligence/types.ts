/**
 * Canonical intelligence + message contracts.
 *
 * `IntelligencePacket` is the SINGLE normalized, evidence-referenced view of a
 * run that every downstream message/teaser/brief must consume. It is assembled
 * (never re-derived) from the already-computed analysis result — deterministic
 * facts, scores, evidence identity, and routing stay authoritative. It carries
 * concise normalized statements + evidence IDs, never large raw transcript
 * blocks, and enforces customer/vendor separation so a vendor utterance can
 * never surface as customer evidence.
 *
 * `RoleMessage` is the SINGLE content decision per recipient lane. Circuit (when
 * available) or the deterministic synthesizer produces it FROM the packet; every
 * channel (Webex / Outlook / in-app) renders the same RoleMessage — no channel
 * re-interprets the transcript.
 */

export type MessageLane = "sales" | "technical" | "leadership";

export type PacketStakeholder = {
  name: string;
  role_label: string;
  stance: "supportive" | "skeptical" | "neutral";
  play: string;
  evidence: string | null;
};

export type PacketSignal = {
  id: string;
  label: string;
  evidence: string | null;
  speaker: string | null;
};

export type PacketEvidenceItem = {
  statement: string;
  speaker: string | null;
  evidence_ids: string[];
};

export type IntelligencePacket = {
  identity: {
    run_id: string;
    account: string | null;
    account_label: string;
    account_prose: string;
    account_resolved: boolean;
    account_confidence: number;
    participant_count: number;
  };
  opportunity: {
    verdict: string;
    signal_strength: number;
    signal_band: string;
    pursuit_decision: string;
    pursuit_score: number;
    pursuit_confidence: number;
    deal_maturity: string;
    primary_opportunity: string;
    primary_solution_motion: string | null;
    is_actionable: boolean;
    /** Taxonomy category IDs this run matched — used to align recipient goals. */
    matched_category_ids: string[];
  };
  customer_evidence: {
    pains: PacketEvidenceItem[];
    business_impacts: PacketEvidenceItem[];
    objections: Array<PacketEvidenceItem & { type: string }>;
    explicit_negations: string[];
    do_not_reask: string[];
  };
  qualification: {
    meddpicc: Record<string, string>;
    decision_criteria: PacketEvidenceItem[];
  };
  /** Customer's current environment / retained platforms (technical lane). */
  current_environment: string[];
  /** Customer-side buying committee ONLY (vendors/SEs are excluded upstream and
   * re-guarded here). */
  stakeholders: PacketStakeholder[];
  deal_intelligence: {
    deal_shape: string | null;
    deal_shape_tags: string[];
    why_real: PacketSignal[];
    momentum: PacketSignal[];
    landmines: PacketSignal[];
    top_landmine: PacketSignal | null;
    value_hypothesis: string | null;
    headline_metric: string | null;
    timing_driver: { label: string; is_procurement: boolean } | null;
    existing_footprint: boolean;
    exec_program: boolean;
  };
  next_action: {
    /** The ONE canonical next best action (title). Null for suppress/hold. */
    primary_action: string | null;
    primary_action_type: string;
    owner_lane: string;
    summary: string;
    success_criteria: string[];
    why_now: string[];
    recommended_timing: string | null;
    evidence_ids: string[];
  };
  workshop: {
    requested: boolean;
    format: string | null;
    scenarios: string[];
    data_sources: string[];
    success_criteria: string[];
  };
  public_context: PacketSignal[];
  personalization: {
    profile_present: boolean;
    /** RECIPIENT-SCOPED goal IDs per lane — the goals of the profile resolved for
     * THAT lane's recipient. Each lane's message uses its own recipient's goals
     * (Bella's for sales, Jack's for technical), never one global profile. */
    goal_ids_by_lane: Partial<Record<MessageLane, string[]>>;
    /** How each lane's profile was resolved (for personalization explainability). */
    profile_source_by_lane: Partial<Record<MessageLane, string>>;
    recipient_teasers: Partial<Record<MessageLane, { why_you: string; goal_alignment: string | null; goal_impact: string | null }>>;
  };
  provenance: {
    analysis_mode: string;
    message_source: string;
    limitations: string[];
  };
};

export type RoleMessage = {
  lane: MessageLane;
  account: string;
  account_resolved: boolean;
  /** A one-line opener that leads with the opportunity, never a caveat. */
  hook: string;
  why_this_matters: string;
  why_now: string;
  /** The ONE next action (the canonical NBA), framed for this lane. */
  action: string;
  expected_outcome: string;
  watch_out: string | null;
  /** Owner-scoped goal framing (named goals) — null when no profile/goals. */
  goal_alignment: string | null;
  /** Owner-ONLY quota/goal hook — null for non-owner lanes (no quota leak). */
  goal_impact: string | null;
  /** Sales-only champion play; null otherwise. */
  champion: { name: string; play: string } | null;
  /** Technical-only current-environment + motion. */
  environment: string | null;
  evidence_ids: string[];
  confidence: number;
  limitations: string[];
  /** "no_action" role messages render an honest no-pursuit note. */
  kind: "action" | "no_action";
  source: "circuit" | "deterministic";
  /** Explainability trace: WHY this message reads the way it does — which
   * recipient goals were applied and which fields they influenced (facts,
   * scores, routing, and account identity are always unaffected). */
  personalization: {
    goals_used: string[];
    profile_source: string;
    fields_influenced: string[];
  };
};
