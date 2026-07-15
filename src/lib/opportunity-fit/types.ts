/**
 * Opportunity-fit and pursuit-recommendation types (Sections 4-10).
 * Every field is generic — no company, product, or transcript is ever
 * encoded here. All weights/thresholds/gates referenced by these types
 * are read from signal-agent-poc/config/opportunity_fit_scoring.json.
 */

export type PublicSignalCategory =
  | "strategic_objective"
  | "executive_priority"
  | "trigger_event"
  | "technology_alignment"
  | "buying_capacity"
  | "competition"
  | "timing"
  | "negative_signal";

export type EvidenceClass = "confirmed_public_fact" | "probable_public_signal" | "weak_signal" | "rejected";

export type SupportsDimension = "account_fit" | "strategic_alignment" | "timing" | "solution_fit" | "buying_capacity" | "competitive_context";

export type NormalizedPublicSignal = {
  signal_id: string;
  account_name: string;
  category: PublicSignalCategory;
  subcategory: string;
  claim: string;
  source_title: string;
  source_url: string;
  source_domain: string;
  published_at: string | null;
  retrieved_at: string;
  source_authority: number;
  entity_match: number;
  recency: number;
  transcript_relevance: number;
  signal_strength: number;
  confidence: number;
  evidence_class: EvidenceClass;
  /** Three independent eligibility levels (Section 2). A credible,
   * correctly-matched source is account_context_eligible even with zero
   * opportunity relevance; only scoring_eligible signals affect external
   * fit. */
  account_context_eligible: boolean;
  narrative_eligible: boolean;
  scoring_eligible: boolean;
  rejection_reasons: string[];
  supports: SupportsDimension[];
  limitations: string[];
  /** Other source URLs reporting the same underlying event — corroborating,
   * never counted as additional independent signals. */
  corroborating_urls: string[];
};

export type QueryPurpose =
  | "account_disambiguation"
  | "strategic_objective"
  | "executive_priority"
  | "trigger_event"
  | "technology_alignment"
  | "buying_capacity"
  | "timing"
  | "competition";

export type SerpApiSignalQueryTrace = {
  query_id: string;
  purpose: QueryPurpose;
  query: string;
  transcript_evidence_ids: string[];
  results_returned: number;
  results_accepted: number;
  cache_hit: boolean;
  duration_ms: number;
  error_code: string | null;
};

export type SerpApiSignalsResult = {
  status: "completed" | "partial" | "not_run" | "failed";
  reason: string | null;
  queries: SerpApiSignalQueryTrace[];
  signals: NormalizedPublicSignal[];
  strong_signal_count: number;
  supporting_signal_count: number;
  weak_signal_count: number;
  rejected_result_count: number;
};

export type ExternalFitFactor = {
  factor: "strategic_alignment" | "trigger_strength" | "executive_priority_alignment" | "technology_alignment" | "buying_capacity" | "timing_alignment" | "competitive_opening";
  score_0_100: number;
  weight: number;
  contribution: number;
  explanation: string;
  evidence_ids: string[];
};

export type ExternalFitScoreResult = {
  available: boolean;
  score: number | null;
  reason: string | null;
  factors: ExternalFitFactor[];
};

export type ScoreFactorContribution = {
  factor: string;
  score_contribution: number;
  evidence_ids: string[];
};

export type HardGateResult = {
  gate: string;
  triggered: boolean;
  evidence_ids: string[];
  effect: "cap_score" | "hold" | "do_not_pursue" | "require_review";
};

export type PursuitDecision = "PURSUE" | "PURSUE_WITH_DISCOVERY" | "NURTURE" | "HOLD" | "DO_NOT_PURSUE";

export type PursuitRecommendation = {
  decision: PursuitDecision;
  score: number;
  confidence: number;
  transcript_score: number;
  qualification_score: number;
  external_fit_score: number | null;
  account_resolution_confidence: number;
  positive_factors: ScoreFactorContribution[];
  negative_factors: ScoreFactorContribution[];
  missing_information: string[];
  recommended_next_action: string;
  score_version: string;
  gates: HardGateResult[];
  weights: Record<string, number>;
};

export type SignalStrengthBand = "HIGH" | "MEDIUM" | "LOW";
export type DealMaturityStage = "PROBLEM_DISCOVERY" | "SOLUTION_DISCOVERY" | "VALIDATION" | "COMMERCIAL_EVALUATION" | "PROCUREMENT" | "COMMIT";

export type OpportunityScoringResult = {
  transcript_score: number;
  qualification_score: number;
  external_fit_score: number | null;
  account_confidence_score: number;
  final_pursuit_score: number;
  decision: PursuitDecision;
  confidence: number;
  score_version: string;
  weights: Record<string, number>;
  factors: ScoreFactorContribution[];
  gates: HardGateResult[];
  /** Explicit, independently-labeled score dimensions (Section 5) so the
   * UI never conflates "is the conversation important" (signal strength)
   * with "what should we do now" (pursuit recommendation). */
  signal_strength: { score: number; band: SignalStrengthBand };
  deal_maturity: DealMaturityStage;
  /** Alias of qualification_score, named to match the UI vocabulary. */
  qualification_completeness: number;
};
