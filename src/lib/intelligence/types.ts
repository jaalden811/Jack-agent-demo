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

/** An internal owner (from the routing config), OR a role-only slot (name null)
 * when a role is implied but no concrete person is configured. Names are NEVER
 * invented and NEVER a customer participant. */
export type InternalOwner = { name: string | null; role: string };

/** WHEN an internal coordination step happens. Immediate/before-meeting steps are
 * the near-term work; the rest are later/conditional and must render subordinate. */
export type CoordinationTiming =
  | "immediate"
  | "before_customer_meeting"
  | "after_validation"
  | "at_funding_gate"
  | "if_blocked"
  | "monitor";

/** HOW necessary a coordination step is. `required`/`recommended` are the "do now"
 * steps; `conditional`/`context_only` are later/optional and never carry
 * do-now priority. */
export type CoordinationRequirement = "required" | "recommended" | "conditional" | "context_only";

/** One INTERNAL coordination step: who to loop in, why (tied to the customer next
 * step), what to prepare, and — deterministically — WHEN and HOW necessary it is.
 * The `to` party is always internal; the customer champion/sponsor live under
 * `customer_engagement`, never here. */
export type CoordinationPartner = {
  name: string | null;
  role: string;
  lane: "sales" | "technical" | "executive";
  why: string;
  prepare: string[];
  /** Deterministic timing — Circuit may not change it. */
  timing: CoordinationTiming;
  /** Deterministic necessity — Circuit may not elevate it. */
  requirement: CoordinationRequirement;
  /** The explicit trigger code that produced this step (e.g. TECHNICAL_VALIDATION,
   * COMMITTEE_FUNDING_GATE, EXEC_MEETING_REQUESTED). Null for a default step. */
  trigger_code: string | null;
  /** A short "when this applies" qualifier for a conditional/later step (e.g.
   * "only if it reaches committee funding review"). Null for do-now steps. */
  condition?: string | null;
};

/** A CUSTOMER-side stakeholder to engage (kept strictly separate from internal
 * coordination). A customer executive sponsor / committee chair belongs HERE —
 * never as an internal `CoordinationPartner`. */
export type CustomerStakeholder = {
  name: string | null;
  role: string;
  engagement: string;
};

/**
 * The INTERNAL action plan for one recipient perspective — the core value of the
 * product: "conversation → internal coordination → customer action". It answers
 * why this was routed to me, what I do internally first, who I coordinate with
 * and why, and only then the customer-facing next step. Deterministic; owners
 * come from the routing config, never from a stakeholder.
 */
export type InternalActionPlan = {
  primary_owner: InternalOwner & { lane: "sales" | "technical" | "leadership" };
  /** Why this opportunity was routed to this owner. */
  routed_reason: string;
  /** The internal next move — coordination/preparation, NOT the customer step. */
  your_move: string;
  /** Internal people/roles to coordinate with before the customer engagement. */
  coordinate_with: CoordinationPartner[];
  /** The customer-facing outcome — kept explicitly SEPARATE from internal work.
   * Customer-side people (incl. any customer executive sponsor / committee chair)
   * live here in `stakeholders`, never in `coordinate_with`. */
  customer_engagement: {
    next_step: string;
    champion: { name: string | null; role: string; why: string } | null;
    stakeholders: CustomerStakeholder[];
  };
  /** ADVISORY-only additional coordination the AI layer (Circuit) surfaced from
   * the conversation that the deterministic sales/technical/executive triggers do
   * not cover (e.g. legal on redlines, a product specialist on a named
   * competitor). Role-only (never a named person); never authoritative routing. */
  suggested_coordination?: Array<{ role: string; why: string; trigger: string }>;
  /** Whether the deal-specific rationale/prep was written by Circuit or is the
   * deterministic template. The WHO (owners/lanes) is always deterministic. */
  source?: "circuit" | "deterministic";
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
  /** Internal lane owners resolved from the routing config (never customer
   * participants). Used to name coordination partners in the internal plan. */
  owners: { sales: InternalOwner | null; technical: InternalOwner | null };
  /** An EXPLICIT, evidence-backed executive-coordination trigger (the customer
   * asked for exec engagement, or the decision is blocked at leadership) — the
   * ONLY thing that creates an immediate internal-leadership step. Distributed
   * authority alone does NOT set this (it produces a conditional funding gate). */
  executive_trigger: { code: string; description: string } | null;
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
  /** The ONE next action (the canonical NBA), framed for this lane. This is the
   * CUSTOMER-facing step; the internal work lives in `internal_action`. */
  action: string;
  /** The internal coordination plan for this recipient — what they do
   * internally and who to loop in BEFORE the customer step. Null for no_action. */
  internal_action: InternalActionPlan | null;
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
