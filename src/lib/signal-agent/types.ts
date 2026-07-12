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
  genericNegationPhrases: string[];
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
  specificityIntentScore: number;
  domainNegativeCuesHit: string[];
  genericNegationHit: string[];
  penalty: number;
  confidence: number;
  intentLabel: "HIGH_INTENT" | "REVIEW" | "NOISE";
  transcriptOnlyMode: boolean;
};

export type AuditSummary = {
  available: boolean;
  totalRecords: number;
  records: Record<string, unknown>[];
  warning: string | null;
};

export const runRequestSchema = z.object({
  transcriptId: z.enum(["high_intent", "noise"]).optional(),
  customTranscript: z.string().trim().max(20000).optional(),
  options: z
    .object({
      useOpenAIEmbeddings: z.boolean().optional(),
      maxLabels: z.number().int().min(1).max(5).optional()
    })
    .optional()
});

export type RunRequest = z.infer<typeof runRequestSchema>;

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
