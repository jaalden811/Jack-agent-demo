import { z } from "zod";
import type { AccountResolution, AiProcessingStatus, AnalysisLink, Meddpicc, PublicEnrichmentStatus } from "@/lib/qualification/types";
import type { OpportunityScoringResult, SerpApiSignalsResult } from "@/lib/opportunity-fit/types";
import type { AuthorityGraph } from "@/lib/stakeholder-intelligence/authorityGraph";
import type { NextBestAction } from "@/lib/action-intelligence/types";
import type { QuestionIndex, SpecialistHandoffPacket } from "@/lib/handoff/types";
import type { StageAOutput } from "@/lib/circuit/stages/stageA";
import type { StageBOutput } from "@/lib/circuit/stages/stageB";
import type { StageCOutput } from "@/lib/circuit/stages/stageC";
import type { StageDOutput } from "@/lib/circuit/stages/stageD";
import type { PersonalizationBlock } from "@/lib/personalization/types";
import type { ParticipationMatrix } from "@/lib/meeting-participation/participation";
import type { DecisionPacket } from "@/lib/decision-packet/types";
import type { DealIntelligence } from "@/lib/deal-intel/types";
import type { InternalActionPlan } from "@/lib/intelligence/types";

/** Safe per-stage Circuit trace (no token/App Key/transcript/headers). */
export type CircuitStageTraceSummary = {
  stage: string;
  attempted: boolean;
  succeeded: boolean;
  model_returned: string | null;
  duration_ms: number;
  repair_attempted: boolean;
  fallback_used: boolean;
  safe_error_code: string | null;
};

/** The AI-enhancement trace attached to every run. When Circuit is
 * unconfigured/unavailable this is { provider: "circuit", enhanced: false
 * } and the deterministic result stands unchanged. */
/** Which interpretation layer produced the canonical fields this run. */
export type AnalysisMode = "circuit" | "circuit_partial" | "deterministic_fallback";
/** Origin of the final recipient messages. */
export type MessageSource = "circuit_stage_d" | "deterministic_fallback";

/** Safe per-run Circuit diagnostic — surfaced in the run diagnostic panel.
 * Contains NO secrets (never a token, client secret, app key, or URL). */
export type CircuitRunDiagnostic = {
  /** Circuit is required for this run (CIRCUIT_REQUIRED=true). */
  required: boolean;
  /** Fully configured for inference (token creds + endpoint + app key). */
  configured: boolean;
  /** Wire contract confirmed (gates any live call). */
  contract_confirmed: boolean;
  /** Auth token was obtained during this run (null when no stage ran). */
  authenticated: boolean | null;
  /** At least one inference call succeeded this run (null when none ran). */
  inference: boolean | null;
  /** Per-stage outcome: ok | fallback | fail | skipped. */
  stages: Record<"stage_a" | "stage_b" | "stage_c" | "stage_d", CircuitStageDiagnostic>;
  /** A one-shot JSON/schema repair was attempted on any stage. */
  repair_attempted: boolean;
  /** Any stage fell back to the deterministic path. */
  fallback_used: boolean;
  /** First safe error code seen (CIRCUIT_* taxonomy), or null. */
  safe_error_code: string | null;
  /** Env-var NAMES still required for Circuit to be operational (never a
   * value/secret) — empty when fully configured. Lets the run diagnostic
   * tell the operator exactly what to set when analysis fell back because
   * Circuit was not configured. */
  missing_config: string[];
  /** Set when Circuit was required but a required stage did not produce a
   * promotable result — the exact stage + safe code the run failed on. */
  required_failure: { stage: string; code: string } | null;
};

export type CircuitStageDiagnostic = {
  status: "ok" | "fallback" | "fail" | "skipped";
  /** Whether this stage's validated output was promoted into canonical. */
  promoted: boolean;
  safe_error_code: string | null;
};

export type AiTrace = {
  provider: "circuit";
  enhanced: boolean;
  stages: CircuitStageTraceSummary[];
  /** Circuit's evidence-backed interpretation (additive — deterministic
   * fields remain authoritative; scores are never changed). */
  stage_a: StageAOutput | null;
  stage_b: StageBOutput | null;
  stage_c: StageCOutput | null;
  /** Circuit's recipient-specific message drafts (commercial + technical
   * Webex/email). Preferred by the delivery layer over the deterministic
   * message builder when present and quality-valid; null when Circuit is
   * unconfigured/unavailable or Stage D fell back. */
  stage_d: StageDOutput | null;
};
import type { GenericSignal } from "@/lib/qualification/genericSignalExtraction";
import type { CategoryScoreDiagnostic } from "@/lib/signal-agent/dominance";

/**
 * All types here describe data shapes only. Nothing in this file encodes a
 * specific pain category, product, specialist, or threshold — those all
 * come from signal-agent-poc/config/cisco_painpoint_solution_map.json (or
 * the legacy fallback map) at runtime via loadCatalog.ts.
 */

export type PrimarySolution = {
  name: string;
  role: string;
};

/** One taxonomy entry, normalized from either the Cisco mapping JSON or the
 * legacy simple map into a single shape the generic engine can score. */
export type CatalogEntry = {
  id: string;
  domain: string;
  painCategory: string;
  customerLanguage: string[];
  keywords: string[];
  semanticCues: string[];
  negativeCues: string[];
  solutionSummary: string;
  primarySolutions: PrimarySolution[];
  adjacentSolutions: string[];
  chooseWhen: string[];
  doNotChooseWhen: string[];
  corroborationHints: string[];
  installBaseSignals: string[];
  buyingRoles: string[];
  intentMarkers: string[];
  recommendedSpecialist: string | null;
};

/** Product/service name -> public reference URL. Documentation only —
 * never an API endpoint that gets called. */
export type SourceCatalog = Record<string, string>;

export type CatalogMetadata = {
  title: string;
  version: string;
  asOf?: string;
  scope?: string;
  designPrinciples: string[];
};

export type ParsedMatchingConfig = {
  weights: {
    keyword: number;
    semantic: number;
    corroboration: number;
    specificityIntent: number;
  };
  keywordCap: number;
  semanticFormula: {
    maxWeight: number;
    meanTopWeight: number;
    topN: number;
  };
  semanticThresholds: {
    candidate: number;
    strong: number;
    veryStrong: number;
  };
  penalties: {
    negation: number;
    hypotheticalOrEducation: number;
    wrongDomain: number;
    competitorOnlyContext: number;
  };
  gates: {
    highIntent: { confidence: number; semantic: number; corroboration: number };
    review: { min: number; max: number };
    noise: { max: number };
  };
  transcriptOnlyMode: {
    weights: { keyword: number; semantic: number };
    maxLabelWithoutSignals: "HIGH_INTENT" | "REVIEW" | "NOISE";
  };
  multiLabel: {
    enabled: boolean;
    maxLabels: number;
    scoreWindow: number;
  };
};

/** Data-driven negation lexicon + polarity-resolution config loaded from
 * signal-agent-poc/config/generic_negation_phrases.json. The *phrases* and
 * *category* of each phrase (hypothetical vs. plain negative) live here;
 * the clause-aware polarity algorithm itself lives in polarity.ts and
 * never hard-codes a phrase. */
export type NegationConfig = {
  phrases: string[];
  hypotheticalMarkers: string[];
  externalNegators: string[];
  resolutionMarkers: string[];
  resolutionEvidenceTerms: string[];
  penaltyWeight: number;
  hypotheticalPenaltyWeight: number;
  negationWindowWords: number;
};

export type LoadedCatalog = {
  source: "cisco_mapping" | "legacy_fallback";
  sourcePath: string;
  metadata: CatalogMetadata | null;
  matchingConfig: ParsedMatchingConfig;
  /** Raw matching_configuration block as shipped in the JSON, surfaced
   * read-only in the API/UI for transparency — never re-parsed by hand
   * anywhere else in application code. */
  rawMatchingConfig: Record<string, unknown> | null;
  entries: CatalogEntry[];
  sourceCatalog: SourceCatalog;
  negationConfig: NegationConfig;
};

export type AccountRecord = {
  account: string;
  matched: boolean;
  openOpportunity: boolean;
  stage: string | null;
  opportunityStage: string | null;
  dealValue: number;
  installBase: string[];
  budgetSignal: string | null;
  installBaseCategory: string | null;
  lifecyclePressure: string | null;
  strategicInitiative: string | null;
  multiSite: boolean;
  cloudComplexity: string | null;
  securityPriority: boolean;
  renewalWindowMonths: number | null;
  servicePerformanceIssue: boolean;
  recentIncident: boolean;
  complianceDeadline: boolean;
  aiInitiative: boolean;
  siteCount: number | null;
  affectedUsers: number | null;
  /** Full raw CSV row. Used by accountContext.ts to generically scan every
   * column's text against an entry's hint word-lists instead of hard-coded
   * per-field branches. */
  raw: Record<string, string>;
};

export type TranscriptSentence = {
  index: number;
  speaker: string | null;
  isCustomer: boolean;
  text: string;
  /** Normalized MM:SS or HH:MM:SS timestamp when the source line had
   * one — never treated as part of the speaker name. */
  timestamp: string | null;
};

export type TranscriptChunk = {
  index: number;
  speaker: string | null;
  isCustomer: boolean;
  text: string;
  timestamp: string | null;
  contextBefore: string | null;
  contextAfter: string | null;
};

export type ParticipantClassification = "customer" | "vendor" | "internal" | "unknown";

/** A structural record of everyone who spoke or appeared in a
 * participant header — built purely from transcript text, never
 * invented. See @/lib/signal-agent/transcript#ingestTranscript. */
export type ParticipantRecord = {
  name: string;
  title: string | null;
  organization: string | null;
  classification: ParticipantClassification;
  turnCount: number;
  firstEvidenceIndex: number | null;
  lastEvidenceIndex: number | null;
};

/** Parser transparency/diagnostics (never shown on the main result
 * card — surfaced only in the Audit tab and the API response) so a
 * parsing regression is visible immediately instead of silently
 * producing a confident wrong result. See
 * @/lib/signal-agent/transcript#ingestTranscript. */
export type TranscriptDiagnostics = {
  raw_characters: number;
  raw_lines: number;
  speaker_headers_detected: number;
  turns_parsed: number;
  sentences_parsed: number;
  participants: string[];
  /** Lines that looked like a "Name — Title" header candidate but were
   * rejected by speaker-name plausibility validation (e.g. a
   * hyphenated-compound-word continuation line, or a sentence-like
   * fragment) — never silently promoted to a fake participant. */
  rejected_header_candidates: string[];
};

export type IngestedTranscript = {
  account: string | null;
  /** Legacy "Name (role)" string list — retained for backward
   * compatibility with existing consumers; derived from
   * participantRecords. */
  participants: string[];
  participantRecords: ParticipantRecord[];
  sentences: TranscriptSentence[];
  chunks: TranscriptChunk[];
  rawText: string;
  diagnostics: TranscriptDiagnostics;
};

export type MatchedSemanticCue = {
  cue: string;
  similarity: number;
};

export type CorroborationSignal = {
  signal: string;
  source: "account_csv" | "transcript" | "mapping";
};

/** Semantic taxonomy-matching engine. Only the deterministic local engine
 * exists (Circuit has no embedding endpoint); retained as a single-value type
 * for the status/audit wire shape. */
export type SemanticMode = "deterministic";

export type NegativeCuePolarity = "negative" | "negated_negative" | "hypothetical" | "resolved";

/** Result of clause-aware polarity analysis for one matched negative-cue
 * phrase. See polarity.ts — never raw substring "contains negative
 * phrase => penalize" logic. */
export type NegativeCueResult = {
  phrase: string;
  polarity: NegativeCuePolarity;
  context: string;
  penalty: number;
};

export type BuyingIntentEvidenceType = "budget" | "timeline" | "owner" | "impact" | "renewal" | "evaluation" | "next_step";

export type BuyingIntentEvidence = {
  type: BuyingIntentEvidenceType;
  text: string;
  normalized_value: string | null;
  score_contribution: number;
};

export type StakeholderOwnershipType =
  | "executive"
  | "operational"
  | "technical"
  | "security"
  | "application"
  | "reliability"
  | "infrastructure"
  | "finance_vendor_management"
  | "security_architecture"
  | "enterprise_architecture"
  | "cloud_platform"
  | "itsm";

export type Stakeholder = {
  name: string;
  role: string;
  ownership_type: StakeholderOwnershipType;
};

export type StakeholderTier = "explicit" | "inferred_functional";

/** Three-tier stakeholder model (Section 3): explicitly named
 * individuals are `tier: "explicit"`; a function that appears
 * responsible without a definitively named individual is
 * `tier: "inferred_functional"` and `name` is null — never a
 * fabricated person. */
export type StakeholderRecord = {
  name: string | null;
  function_or_role: string;
  ownership_type: StakeholderOwnershipType;
  tier: StakeholderTier;
  evidence: string;
  location: string | null;
  confidence: number;
  why_it_matters: string;
};

export type StakeholderAnalysis = {
  participants: ParticipantRecord[];
  named_stakeholders: StakeholderRecord[];
  functional_owners: StakeholderRecord[];
};

export type RuleEvaluationStatus = "matched" | "contradicted" | "not_evidenced";

export type RuleEvaluation = {
  rule: string;
  status: RuleEvaluationStatus;
  evidence: string | null;
};

export type AdjacentSolutionDecision = {
  solution: string;
  decision: "include" | "secondary" | "exclude" | "needs_discovery";
  reason: string;
};

export type SolutionDecision = {
  recommended: string[];
  supporting_products: string[];
  retained_existing_platforms: string[];
  choose_when_evidence: RuleEvaluation[];
  do_not_choose_conflicts: RuleEvaluation[];
  adjacent_solutions_considered: AdjacentSolutionDecision[];
};

export type MatchRelationship = "primary" | "secondary" | "supporting";

export type EntryEvaluation = {
  entry: CatalogEntry;
  keywordScore: number;
  matchedKeywords: string[];
  matchedText: string[];
  semanticScore: number;
  matchedSemanticCues: MatchedSemanticCue[];
  semanticMode: SemanticMode;
  corroborationScore: number;
  corroboration: CorroborationSignal[];
  transcriptCorroborationScore: number;
  transcriptCorroboration: CorroborationSignal[];
  specificityIntentScore: number;
  intentEvidence: BuyingIntentEvidence[];
  negativeCueResults: NegativeCueResult[];
  penalty: number;
  confidence: number;
  /** Pre-clamp confidence, used only to break ties between entries that
   * both saturate at the 0..1 ceiling — several entries can legitimately
   * all reach "1.0" while still differing meaningfully in how strongly
   * their own keyword/semantic evidence supports them. */
  rawConfidence: number;
  intentLabel: "HIGH_INTENT" | "REVIEW" | "NOISE";
  transcriptOnlyMode: boolean;
  strongIntentOverride: boolean;
};

export type AuditSummary = {
  available: boolean;
  totalRecords: number;
  records: Record<string, unknown>[];
  warning: string | null;
};

export const webexSourceSchema = z.object({
  transcriptId: z.string(),
  meetingId: z.string().nullable().optional(),
  meetingTitle: z.string().nullable().optional(),
  host: z.string().nullable().optional(),
  meetingDate: z.string().nullable().optional(),
  source: z.literal("webex").optional().default("webex")
});

export const runRequestSchema = z.object({
  transcriptId: z.enum(["high_intent", "noise", "secure_networking_triage", "cross_domain_data_platform"]).optional(),
  customTranscript: z.string().trim().max(20000).optional(),
  accountOverride: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** User-corrected/entered account name (Section 12) — takes priority
   * over every other account-identity source except an even-more-
   * explicit future CRM lock. Never silently rewrites transcript
   * evidence; only affects account_resolution and downstream
   * public-signal search. */
  userEnteredAccount: z.string().trim().max(200).optional(),
  webexSource: webexSourceSchema.optional(),
  options: z
    .object({
      enrichPublicSignals: z.boolean().optional(),
      /** "Enrich with public account and stakeholder signals" toggle
       * (Section 13) — gates the SerpAPI qualification pass and, unless
       * explicitly overridden, the legacy `public_signals` search. */
      useQualification: z.boolean().optional(),
      maxLabels: z.number().int().min(1).max(5).optional(),
      deliverToWebex: z.boolean().optional()
    })
    .optional()
});

export type RunRequest = z.infer<typeof runRequestSchema>;

export type ProviderStatusEntry = {
  configured: boolean;
  usable: boolean;
  model?: string;
  provider?: string;
  used_for: string;
  last_check?: string;
  message: string;
};

/** AI provider (Circuit) status for the Setup/status UI. Built from the safe
 * Circuit diagnostics (@/lib/circuit/diagnostics) — never a secret, never a
 * network probe. Circuit is an OPTIONAL enhancement layer, so "not configured"
 * is a normal, non-fatal state (the deterministic engine stays authoritative). */
export type AiProviderStatus = {
  provider: "circuit";
  configured: boolean;
  contract_confirmed: boolean;
  operational: boolean;
  /** Five-state Circuit provider summary (see @/lib/circuit/types). */
  state: string;
  model: string | null;
  /** Safe, human-readable status/next-action message (never a secret). */
  message: string;
  /** Env-var NAMES still required for Circuit to be operational (never a
   * value/secret) — empty when fully configured. Surfaced in the setup
   * panel so the operator knows exactly which env vars to add. */
  missing_config: string[];
};

/** Wire shape for GET /api/signal-agent/status. Mirrors the pattern of
 * ProviderStatusSnapshot in @/lib/types, reusing @/lib/config's
 * getConfig() as the single source of truth for what is configured. */
export type SignalAgentStatus = {
  ai_provider: AiProviderStatus;
  search: ProviderStatusEntry;
  firecrawl: ProviderStatusEntry;
  contact_enrichment: ProviderStatusEntry;
  taxonomy: { loaded: boolean; file: string; version: string; as_of: string | null; categories: number };
  reference_report: { loaded: boolean; file: string };
  audit_log: { writable: boolean; path: string };
};

export type PublicSignal = {
  title: string;
  url: string;
  snippet: string;
  relevance: string;
};

export type CorroborationSummary = {
  transcript_score: number;
  structured_account_score: number;
  combined_score: number;
  transcript_signals: CorroborationSignal[];
  structured_signals: CorroborationSignal[];
  structured_account_available: boolean;
};

/** One taxonomy match in the multi-label result — the full per-entry
 * evaluation, serialized for the API/UI. */
export type ScoreBreakdown = {
  keyword_score: number;
  keyword_weight: number;
  semantic_score: number;
  semantic_weight: number;
  intent_score: number;
  intent_weight: number;
  structured_account_score: number;
  structured_account_weight: number;
  penalty: number;
  final: number;
};

export type MatchOutput = {
  entry_id: string;
  pain_category: string;
  domain: string;
  confidence: number;
  rank: number;
  relationship: MatchRelationship;
  matched_text: string[];
  matched_keywords: string[];
  semantic_evidence: MatchedSemanticCue[];
  intent_evidence: BuyingIntentEvidence[];
  corroboration: CorroborationSignal[];
  negative_cues: NegativeCueResult[];
  recommended_solutions: string[];
  recommended_specialist: string | null;
  solution_decision: SolutionDecision;
  score_breakdown: ScoreBreakdown;
};

export type ReferencePack = {
  taxonomy_file: string;
  taxonomy_version: string;
  taxonomy_as_of: string | null;
  taxonomy_scope: string | null;
  category_count: number;
  final_formula: string | null;
  multi_label_policy: string | null;
  notification_gates: { high_intent: string | null; review: string | null; noise: string | null };
  report_file: string;
  report_loaded: boolean;
};

export type TranscriptMeta = {
  title: string | null;
  account: string | null;
  participant_count: number;
  sentence_count: number;
  raw_text: string;
};

/** Full response shape for POST /api/signal-agent/run — the
 * "secure_networking_deal_signal_triage" use-case contract. */
export type SecureNetworkingTriageResult = {
  use_case: "secure_networking_deal_signal_triage";
  executive_summary: {
    verdict: "HIGH_INTENT" | "REVIEW" | "NOISE";
    confidence: number;
    account: string | null;
    business_problem: string;
    business_impact: string;
    urgency: string;
    primary_opportunity: string | null;
    secondary_opportunities: string[];
    recommended_next_action: string;
  };
  stakeholders: Stakeholder[];
  /** Three-tier stakeholder model: call participants, explicitly named
   * stakeholders, and evidence-backed inferred functional owners. Never
   * fabricates a person's name. */
  stakeholder_analysis: StakeholderAnalysis;
  commercial_signals: {
    budget: string | null;
    timeline: string | null;
    renewal_events: string[];
    quantified_impact: string[];
    evaluation_stage: string | null;
    purchase_language: string[];
  };
  matches: MatchOutput[];
  solution_architecture: Array<{ layer: string; product: string; role: string }>;
  recommended_specialists: string[];
  discovery_questions: string[];
  internal_brief: string;
  /** Internal-only notification draft for the primary match (never sent
   * to the customer). Null when the primary match is NOISE and nothing
   * should be routed. */
  notification_text: string | null;
  providers: {
    embeddings_used: boolean;
    synthesis_used: boolean;
    fallback_reason: string | null;
    semantic_mode: SemanticMode;
    /** Which capability combination actually produced this result —
     * embeddings and synthesis degrade fully independently, so any
     * combination is possible. Never implies one blocks the other. */
    analysis_mode: "deterministic" | "embeddings_assisted" | "synthesis_assisted" | "embeddings_and_synthesis";
  };
  reference_pack: ReferencePack;
  corroboration_summary: CorroborationSummary;
  public_signals: PublicSignal[];
  audit: { logged: boolean; path: string; warning: string | null };
  transcript_meta: TranscriptMeta;
  timestamp: string;
  /** Stable, URL-safe identifier for this run — distinct from
   * `timestamp` (which is used as a dedupe-key component elsewhere).
   * Used by the persisted public results page. */
  run_id: string;
  /** Evidence-backed account identity resolution (Section 2/14) —
   * distinct from executive_summary.account, which may still show a
   * best-effort transcript-stated name even when unresolved. */
  account_resolution: AccountResolution;
  /** Evidence-backed MEDDPICC qualification (Section 7/14). */
  meddpicc: Meddpicc;
  /** SerpAPI public enrichment trace (Section 1-4/13/14) — always
   * present; `enabled: false` when disabled, not configured, or gated
   * off by the search-enrichment decision logic. */
  public_enrichment: PublicEnrichmentStatus;
  /** Which AI-provider (Circuit) qualification/synthesis stages actually ran
   * for this result (Section 13/14) — independent of the existing
   * `providers` block, which covers only embeddings/legacy synthesis. */
  ai_processing: AiProcessingStatus;
  /** Signed, expiring public link to this run's read-only result page
   * — never a localhost/private-address URL (Section 11). */
  analysis_link: AnalysisLink;
  /** Parser transparency (never shown on the main result card — only
   * in the Audit tab and this API response) so a parsing regression is
   * visible immediately instead of silently producing a confident
   * wrong result. */
  transcript_diagnostics: TranscriptDiagnostics;
  /** Generic, transcript-agnostic diagnostic trace (Section 8): every
   * field here is derived purely from the parser and the generic
   * evidence-scoring engine — never from a transcript-specific branch.
   * `category_scores` covers every taxonomy entry that was evaluated,
   * not only the ones selected as matches, so the full ranking (and
   * why one category dominated another) is always inspectable. */
  generic_diagnostics: GenericDiagnostics;
  /** SerpAPI account-fit signal search trace and accepted signals —
   * distinct from `public_enrichment` (which feeds MEDDPICC evidence
   * merge); this feeds the independent external-fit/pursuit scoring
   * model. Always `not_run` with a specific reason when the account is
   * unresolved, enrichment is disabled, or SerpAPI is unconfigured. */
  serpapi_signals: SerpApiSignalsResult;
  /** The four independent, deterministic scores (transcript
   * opportunity, qualification completeness, external account fit,
   * pursuit recommendation) plus the full weighted breakdown, hard
   * gates, and evidence-linked factors — every weight read from
   * signal-agent-poc/config/opportunity_fit_scoring.json. */
  opportunity_scoring: OpportunityScoringResult;
  /** Evidence-backed buying-committee / authority graph: role inferences
   * from customer behavior plus a distributed-economic-authority model
   * (never a fabricated named Economic Buyer). */
  buying_committee: AuthorityGraph;
  /** The canonical, specific Next Best Action (who/does what/why/using
   * which evidence/by when/success criteria) — the defining output. */
  next_best_action: NextBestAction;
  /** Lane-specific specialist handoff packets: Bella (commercial) and Jack
   * (technical) each arrive already synced. */
  specialist_handoffs: { sales: SpecialistHandoffPacket; technical: SpecialistHandoffPacket };
  /** The do-not-re-ask index: answered / open / declined / contradictory. */
  question_index: QuestionIndex;
  /** Circuit AI-enhancement trace (additive; deterministic path is
   * authoritative and complete without it). */
  ai_trace: AiTrace;
  /** Which interpretation layer actually produced the canonical fields:
   * `circuit` when every required stage passed and its validated output was
   * promoted; `circuit_partial` when some stages were promoted and others
   * fell back; `deterministic_fallback` when Circuit did not run (or a
   * required stage failed and nothing was promoted). Distinct from
   * `providers.analysis_mode`, which only covers embeddings/legacy synthesis. */
  analysis_mode: AnalysisMode;
  /** Origin of the final recipient messages: `circuit_stage_d` when the
   * quality-valid Stage D draft is used, else `deterministic_fallback`.
   * Set once messages are built (delivery path); `deterministic_fallback`
   * until then. */
  message_source: MessageSource;
  /** Exact, safe explanation of why message_source is what it is (e.g. Stage D
   * passed the gate, or the specific quality reason it was rejected). Makes
   * message provenance truthful when Stage D succeeded at the Circuit level but
   * its draft did not become the delivered message. */
  message_source_reason?: string | null;
  /** Safe, per-run Circuit diagnostic (never secrets): configuration,
   * auth/inference reachability, per-stage status, repair/fallback flags,
   * and a safe error code — so a silent deterministic fallback is always
   * visible at the run level. */
  circuit_run: CircuitRunDiagnostic;
  /** Meeting participation matrix (who spoke / attended, matched to the
   * team roster) used for attendance-aware message routing. Optional and
   * additive — computed in the delivery path; null when not yet computed.
   * A transcript proves speakers only; absence is never inferred. */
  meeting_participation?: ParticipationMatrix | null;
  /** Additive personalization block (seller-goal-aware relevance, goal
   * impact, notification decision, and a concise opportunity teaser).
   * Purely a function of this result + the seller profile — it NEVER changes
   * the deterministic opportunity scores, routing, or evidence identity.
   * Optional: absent on legacy/unpersonalized runs. */
  personalization?: PersonalizationBlock | null;
  /** Local opportunity-thread summary: how this account+motion has evolved
   * across runs (what changed, prior pursuit decision) so repeat unchanged
   * opportunities don't create alert fatigue. Additive/optional. */
  opportunity_thread?: {
    thread_id: string;
    previous_run_count: number;
    material_changes: string[];
    previous_decision: string | null;
  } | null;
  /** Latest pursuit-feedback state for this run (Pursue/Need more/Not now/
   * Pass) + resulting action status. Additive/optional. */
  feedback?: { latest_decision: string | null; action_status: string } | null;
  /** Run-scoped assistant availability + suggested grounded questions.
   * Additive/optional. */
  assistant?: { available: boolean; suggested_questions: string[] } | null;
  /** Additive analytical Decision Packet: a decomposed, evidence-linked,
   * confidence-scored view of the customer's decision criteria, typed
   * objections (with generic response framing), and material impact. NEVER
   * changes scores, verdict, routing, MEDDPICC, or evidence identity. */
  decision_packet?: DecisionPacket | null;
  /** Additive Deal Intelligence: an honest, evidence-cited read of the deal
   * SHAPE, MOMENTUM, RISKS/landmines, and value hypothesis — the "is this real,
   * why now, what could kill it" synthesis that sharpens the message + handoff.
   * Never changes scores/verdict/routing/evidence identity. */
  deal_intelligence?: DealIntelligence | null;
  /** Additive INTERNAL action plan (from the routed owner's perspective): who
   * owns the internal next move, who to coordinate with and why, what each
   * should prepare, and — kept separate — the customer-facing step. Drives the
   * "Next Internal Move" primary card. Never changes scores/routing/evidence. */
  internal_action_plan?: InternalActionPlan | null;
};

export type GenericDiagnostics = {
  parser: {
    turns: number;
    sentences: number;
    participants: string[];
    warning: string | null;
  };
  signals: {
    commercial: GenericSignal[];
    technical: GenericSignal[];
    ownership: GenericSignal[];
    next_steps: GenericSignal[];
  };
  category_scores: CategoryScoreDiagnostic[];
};

/** Thrown by runSignalAgent when the transcript is long enough that a
 * healthy parse should have found substantially more sentences than it
 * did — signals a parser regression rather than a genuinely short
 * transcript, and must never silently continue as a normal run. */
export class TranscriptParseIncompleteError extends Error {
  code = "TRANSCRIPT_PARSE_INCOMPLETE" as const;
  diagnostics: TranscriptDiagnostics;
  constructor(diagnostics: TranscriptDiagnostics) {
    super(
      `Transcript parsing produced only ${diagnostics.sentences_parsed} sentence(s) from ${diagnostics.raw_characters} characters — this looks like a parser failure, not a short transcript. Refusing to produce a result or auto-send.`
    );
    this.name = "TranscriptParseIncompleteError";
    this.diagnostics = diagnostics;
  }
}

/** Wire shape for GET /api/signal-agent/catalog — one taxonomy entry as
 * sent to the browser. Snake_case to match the entry's own JSON fields. */
export type CatalogWireEntry = {
  id: string;
  domain: string;
  pain_category: string;
  customer_language: string[];
  keywords: string[];
  semantic_cues: string[];
  negative_cues: string[];
  primary_solutions: PrimarySolution[];
  adjacent_solutions: string[];
  choose_when: string[];
  do_not_choose_when: string[];
  corroboration_hints: string[];
  install_base_signals: string[];
  buying_roles: string[];
  intent_markers: string[];
  recommended_specialist: string | null;
};

export type CatalogResponse = {
  source: "cisco_mapping" | "legacy_fallback";
  source_path: string;
  metadata: CatalogMetadata | null;
  domains: string[];
  entry_count: number;
  entries: CatalogWireEntry[];
  source_catalog: SourceCatalog;
  matching_configuration: Record<string, unknown> | null;
};

export type SignalAgentLabel = {
  pain_category: string | null;
  pain_category_label: string | null;
  domain: string | null;
  confidence: number;
  intent_label: "HIGH_INTENT" | "REVIEW" | "NOISE";
  recommended_solution: string[];
};

/** Exact API response shape for POST /api/signal-agent/run. Snake_case is
 * intentional to match the contract this app was asked to expose. */
export type SignalAgentRunResult = {
  account: string | null;
  pain_category: string | null;
  pain_category_label: string | null;
  domain: string | null;
  confidence: number;
  intent_label: "HIGH_INTENT" | "REVIEW" | "NOISE";
  matched_text: string[];
  matched_keywords: string[];
  matched_semantic_cues: MatchedSemanticCue[];
  negative_cues: string[];
  corroboration: CorroborationSignal[];
  recommended_solution: string[];
  primary_solutions: PrimarySolution[];
  adjacent_solutions: string[];
  why_this_solution: string;
  why_not_adjacent_solution: string;
  recommended_specialist: string | null;
  next_best_action: "specialist_route" | "human_review" | "suppress";
  notification_text: string | null;
  semantic_mode: SemanticMode;
  additional_labels: SignalAgentLabel[];
  audit: {
    logged: boolean;
    path: string;
    warning: string | null;
  };
  timestamp: string;
};
