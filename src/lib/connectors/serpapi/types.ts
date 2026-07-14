export type SearchPurpose =
  | "account_resolution"
  | "stakeholder_verification"
  | "strategic_initiative"
  | "financial_priority"
  | "public_incident"
  | "technology_footprint"
  | "competition"
  | "regulatory_context";

export type PlannedQuery = {
  query_id: string;
  purpose: SearchPurpose;
  query: string;
  reason: string;
  evidence_ids: string[];
  priority: number;
};

export type RawOrganicResult = {
  position?: number;
  title?: string;
  link?: string;
  displayed_link?: string;
  source?: string;
  date?: string;
  author?: string;
  snippet?: string;
};

export type RawKnowledgeGraph = {
  title?: string;
  type?: string;
  description?: string;
  source?: { link?: string; name?: string };
  website?: string;
};

export type RawAnswerBox = {
  title?: string;
  link?: string;
  snippet?: string;
  answer?: string;
};

export type RawNewsResult = {
  title?: string;
  link?: string;
  source?: string;
  date?: string;
  snippet?: string;
};

export type RawSerpApiResponse = {
  search_metadata?: { status?: string; total_time_taken?: number };
  organic_results?: RawOrganicResult[];
  knowledge_graph?: RawKnowledgeGraph;
  answer_box?: RawAnswerBox;
  news_results?: RawNewsResult[];
  serpapi_pagination?: { next?: string };
  error?: string;
};

export type SerpResultType = "organic" | "news" | "knowledge_graph" | "answer_box";

export type NormalizedSerpResult = {
  source_id: string;
  provider: "serpapi";
  query_id: string;
  query: string;
  purpose: SearchPurpose;
  title: string;
  url: string;
  canonical_url: string;
  domain: string;
  snippet: string;
  position: number;
  published_at: string | null;
  retrieved_at: string;
  result_type: SerpResultType;
  account_match_confidence: number;
  stakeholder_match_confidence: number;
  signal_relevance: number;
  authority_score: number;
  recency_score: number;
  public_evidence_score: number;
};

export type RejectedSerpResult = {
  source_id: string;
  rejected: true;
  reason: string;
};

export type SerpApiErrorCode =
  | "SERPAPI_NOT_CONFIGURED"
  | "SERPAPI_UNAUTHORIZED"
  | "SERPAPI_FORBIDDEN"
  | "SERPAPI_BAD_REQUEST"
  | "SERPAPI_QUOTA_EXHAUSTED"
  | "SERPAPI_RATE_LIMITED"
  | "SERPAPI_TIMEOUT"
  | "SERPAPI_SERVER_ERROR"
  | "SERPAPI_EMPTY_RESULTS"
  | "SERPAPI_INVALID_RESPONSE";

export class SerpApiError extends Error {
  code: SerpApiErrorCode;
  status?: number;
  constructor(code: SerpApiErrorCode, message: string, status?: number) {
    super(message);
    this.name = "SerpApiError";
    this.code = code;
    this.status = status;
  }
}

export type QueryTrace = {
  query_id: string;
  purpose: SearchPurpose;
  query: string;
  results: number;
  accepted: number;
  rejected: number;
  latency_ms: number;
  cache: "hit" | "miss";
  error: string | null;
};

/** Inputs the query planner needs — deliberately generic/transcript-
 * derived, never a hard-coded company/competitor list. */
export type QueryPlannerInput = {
  account_candidates: Array<{ name: string; domain: string | null; confidence: number }>;
  company_domains: string[];
  stakeholders: Array<{ name: string; title: string | null }>;
  selected_taxonomy_entries: string[];
  detected_products: string[];
  buying_signals: string[];
  commercial_signals: string[];
  lifecycle_stage: "LAND" | "ADOPT" | "EXPAND" | "RENEW";
  meddpicc_gaps: string[];
  mentions_incident: boolean;
  mentions_competitor: boolean;
  location: string | null;
};
