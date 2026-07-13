import { z } from "zod";

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
};

export type TranscriptChunk = {
  index: number;
  speaker: string | null;
  isCustomer: boolean;
  text: string;
  contextBefore: string | null;
  contextAfter: string | null;
};

export type IngestedTranscript = {
  account: string | null;
  participants: string[];
  sentences: TranscriptSentence[];
  chunks: TranscriptChunk[];
  rawText: string;
};

export type MatchedSemanticCue = {
  cue: string;
  similarity: number;
};

export type CorroborationSignal = {
  signal: string;
  source: "account_csv" | "transcript" | "mapping";
};

export type SemanticMode = "openai_embeddings" | "fallback";

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

export type StakeholderOwnershipType = "executive" | "operational" | "technical" | "security" | "application";

export type Stakeholder = {
  name: string;
  role: string;
  ownership_type: StakeholderOwnershipType;
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
  transcriptId: z.enum(["high_intent", "noise", "secure_networking_triage"]).optional(),
  customTranscript: z.string().trim().max(20000).optional(),
  accountOverride: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  webexSource: webexSourceSchema.optional(),
  options: z
    .object({
      useOpenAIEmbeddings: z.boolean().optional(),
      useOpenAISynthesis: z.boolean().optional(),
      enrichPublicSignals: z.boolean().optional(),
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
  /** OpenAI-only: whether this key/model would currently be used for
   * semantic matching / executive-brief synthesis respectively. Both
   * default to the same live probe result (`usable`) since both uses
   * share the same configured key and model. */
  embeddings_enabled?: boolean;
  synthesis_enabled?: boolean;
};

/** Wire shape for GET /api/signal-agent/status. Mirrors the pattern of
 * ProviderStatusSnapshot in @/lib/types, reusing @/lib/config's
 * getConfig() as the single source of truth for what is configured. */
export type SignalAgentStatus = {
  openai: ProviderStatusEntry;
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
  };
  reference_pack: ReferencePack;
  corroboration_summary: CorroborationSummary;
  public_signals: PublicSignal[];
  audit: { logged: boolean; path: string; warning: string | null };
  transcript_meta: TranscriptMeta;
  timestamp: string;
};

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
