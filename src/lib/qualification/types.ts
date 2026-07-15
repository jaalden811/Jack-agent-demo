/**
 * Shared types for the qualification pipeline (evidence extraction,
 * SerpAPI enrichment, MEDDPICC synthesis, and message synthesis). See
 * src/lib/qualification/*.ts and src/lib/connectors/serpapi/types.ts.
 */

// ─── Evidence graph ─────────────────────────────────────────────────────────

export type EvidenceSourceType = "transcript" | "webex" | "outlook" | "account_context" | "salesforce" | "serpapi" | "manual";
export type EvidenceClassification = "confirmed" | "partial" | "hypothesis" | "conflicting";

export type EvidenceItem = {
  evidence_id: string;
  source_type: EvidenceSourceType;
  source_id: string;
  claim: string | null;
  quote_or_snippet: string;
  speaker: string | null;
  timestamp: string | null;
  title: string | null;
  url: string | null;
  published_at: string | null;
  confidence: number;
  classification: EvidenceClassification;
};

// ─── Stage A: transcript + stakeholder extraction ──────────────────────────

export type AccountCandidate = {
  name: string;
  domain: string | null;
  confidence: number;
  evidence_ids: string[];
};

export type FunctionalArea =
  | "sales"
  | "finance"
  | "procurement"
  | "executive"
  | "networking"
  | "security"
  | "observability"
  | "application"
  | "operations"
  | "architecture"
  | "other";

export type BuyingRole = "economic_buyer" | "champion" | "technical_decision_maker" | "evaluator" | "influencer" | "procurement" | "end_user" | "unknown";
export type BuyingRoleStatus = "confirmed" | "probable" | "hypothesis" | "unknown";
export type InfluenceLevel = "high" | "medium" | "low" | "unknown";
export type SentimentLevel = "positive" | "neutral" | "negative" | "mixed" | "unknown";

export type QualifiedStakeholder = {
  name: string;
  stated_title: string | null;
  company: string | null;
  speaker_label: string | null;
  functional_area: FunctionalArea;
  buying_role: BuyingRole;
  buying_role_status: BuyingRoleStatus;
  influence: InfluenceLevel;
  sentiment: SentimentLevel;
  commitments: string[];
  objections: string[];
  goals: string[];
  evidence_ids: string[];
  confidence: number;
};

export type ExtractedCommercialSignals = {
  budget: string[];
  timeline: string[];
  renewal: string[];
  procurement: string[];
  business_impact: string[];
  purchase_language: string[];
  competitor_mentions: string[];
};

export type ExtractedTechnicalSignals = {
  current_environment: string[];
  architecture: string[];
  integrations: string[];
  operational_gaps: string[];
  success_criteria: string[];
  pilot_or_workshop_requests: string[];
  risks: string[];
};

export type SearchPlanInputs = {
  account_queries_needed: boolean;
  stakeholder_queries_needed: boolean;
  initiative_queries_needed: boolean;
  competition_queries_needed: boolean;
  incident_queries_needed: boolean;
};

export type EvidenceExtractionResult = {
  account_candidates: AccountCandidate[];
  stakeholders: QualifiedStakeholder[];
  commercial_signals: ExtractedCommercialSignals;
  technical_signals: ExtractedTechnicalSignals;
  preliminary_meddpicc: Partial<Meddpicc>;
  search_plan_inputs: SearchPlanInputs;
  missing_information: string[];
  contradictions: string[];
};

// ─── Stage B: public evidence classification ───────────────────────────────

export type PublicEntityMatch = "confirmed" | "probable" | "weak" | "no_match";
export type PublicSignalType =
  | "account_identity"
  | "stakeholder_role"
  | "public_initiative"
  | "public_incident"
  | "technology_footprint"
  | "competition"
  | "financial_priority"
  | "irrelevant";

export type MeddpiccKey = "metrics" | "economic_buyer" | "decision_criteria" | "decision_process" | "paper_process" | "identify_pain" | "champion" | "competition";

export type ClassifiedPublicResult = {
  source_id: string;
  entity_match: PublicEntityMatch;
  signal_type: PublicSignalType;
  summary: string;
  supported_claims: string[];
  unsupported_or_ambiguous_claims: string[];
  meddpicc_relevance: MeddpiccKey[];
  confidence: number;
};

// ─── Stage C: MEDDPICC ──────────────────────────────────────────────────────

export type MeddpiccStatus = "CONFIRMED" | "PARTIAL" | "HYPOTHESIS" | "MISSING" | "CONFLICTING" | "DISTRIBUTED";

export type MeddpiccField = {
  status: MeddpiccStatus;
  summary: string;
  confidence: number;
  evidence_ids: string[];
  gaps: string[];
  next_question: string;
};

export type Meddpicc = {
  metrics: MeddpiccField;
  economic_buyer: MeddpiccField;
  decision_criteria: MeddpiccField;
  decision_process: MeddpiccField;
  paper_process: MeddpiccField;
  identify_pain: MeddpiccField;
  champion: MeddpiccField;
  competition: MeddpiccField;
};

// ─── Account resolution ─────────────────────────────────────────────────────

export type AccountResolutionStatus = "confirmed" | "probable" | "ambiguous" | "unresolved" | "conflicting";
/** Canonical source list — matches @/lib/account-resolution/types's
 * AccountEvidenceSource exactly, since that module is the single
 * authoritative account-identity resolver (Section 1). */
export type AccountResolutionSource = "user_input" | "transcript" | "webex" | "outlook" | "crm" | "email_domain" | "serpapi" | "combined" | null;

export type AccountResolution = {
  name: string | null;
  domain: string | null;
  status: AccountResolutionStatus;
  confidence: number;
  source: AccountResolutionSource;
  alternatives: AccountCandidate[];
  action_required: string | null;
};

// ─── AI processing / public enrichment status (API contract) ──────────────

export type AiProcessingStatus = {
  openai_configured: boolean;
  transcript_extraction_used: boolean;
  public_evidence_classification_used: boolean;
  qualification_synthesis_used: boolean;
  message_synthesis_used: boolean;
  embedding_model: string;
  synthesis_model: string;
  fallback_reason: string | null;
};

export type PublicEnrichmentQueryTrace = {
  query_id: string;
  purpose: string;
  query: string;
  results: number;
  accepted: number;
  rejected: number;
  latency_ms: number;
  cache: "hit" | "miss";
  error: string | null;
};

export type PublicEnrichmentStatus = {
  enabled: boolean;
  provider: "serpapi";
  configured: boolean;
  queries: PublicEnrichmentQueryTrace[];
  sources: EvidenceItem[];
  accepted_evidence: EvidenceItem[];
  rejected_count: number;
  fallback_reason: string | null;
};

// ─── Analysis link (dead-link fix) ──────────────────────────────────────────

export type AnalysisLinkReason = "public_url_ready" | "no_public_base_url" | "local_only_storage" | "persistence_failed" | "validation_failed";

export type AnalysisLink = {
  included: boolean;
  url: string | null;
  reason: AnalysisLinkReason;
  expires_at: string | null;
};

// ─── Persisted run record (for the public results page) ───────────────────

export type PersistedRunRecord = {
  run_id: string;
  created_at: string;
  expires_at: string;
  account: string | null;
  verdict: string;
  confidence: number;
  qualification_json: Record<string, unknown>;
  sales_message: string | null;
  technical_message: string | null;
  source_summary: Array<{ title: string; url: string; domain: string }>;
  delivery_summary: Record<string, unknown>;
};

// ─── Stage D: message synthesis ────────────────────────────────────────────

export type SynthesizedMessages = {
  sales_webex_markdown: string;
  technical_webex_markdown: string;
  sales_email_subject: string;
  sales_email_html: string;
  technical_email_subject: string;
  technical_email_html: string;
};
