/** Objective-aware research planning types. The planner decides IF and WHAT
 * public facts to research based on the seller's goals + account + motion —
 * never private data, always budgeted, cache-aware. */

export type QueryIntent = {
  intent_id: string;
  purpose: string;
  template: string;
  required_inputs: string[];
  optional_inputs: string[];
  accepted_signal_types: string[];
  max_queries: number;
};

export type ObjectiveSearchRule = {
  objective_id: string;
  applicable_taxonomy_categories: string[];
  required_account_resolution: "confirmed" | "probable" | "any";
  query_intents: QueryIntent[];
  message_fields_affected: string[];
  relevance_dimensions_affected: string[];
  active: boolean;
};

export type PlannedQuery = {
  intent_id: string;
  objective_id: string;
  purpose: string;
  query: string;
  accepted_signal_types: string[];
  cache_key: string;
  cache_hit: boolean;
};

export type SearchPlan = {
  should_search: boolean;
  suppression_reason: string | null;
  planned_queries: PlannedQuery[];
  objective_ids: string[];
  queries_planned: number;
  cache_hits: number;
  budget_remaining: number;
  relevance_dimensions_affected: string[];
  message_fields_affected: string[];
};

/** An executable, planner-approved query object — the ONLY thing the
 * execution layer will run. Deterministic ids/keys so runs are reproducible. */
export type ExecutableQuery = {
  query_id: string;
  objective_id: string;
  intent_id: string;
  purpose: string;
  query: string;
  account: string;
  motion_id: string;
  transcript_theme_ids: string[];
  priority: number;
  max_results: number;
  cache_key: string;
  reason: string;
};

/** Per-query policy decision, evaluated BEFORE any provider call. */
export type ExecutionDecision = {
  decision: "execute" | "raw_cache" | "suppress";
  reason_code: string;
  budget_cost: number;
  cache_key: string;
};

/** One normalized raw provider result row (pre-Stage-B, pre-scoring). */
export type RawResultRow = {
  source_id: string;
  query_id: string;
  title: string;
  url: string;
  canonical_url: string;
  domain: string;
  snippet: string;
  published_at: string | null;
  position: number;
  provider: "serpapi";
  source_authority_hint: number;
  raw_cache_key: string;
  /** Every query that surfaced this result (provenance across dedup). */
  found_by_query_ids: string[];
};

/** The single canonical search trace (Section 9), surfaced under
 * personalization.search_plan. */
export type SearchTrace = {
  planner_version: string;
  objective_ids: string[];
  queries_planned: number;
  queries_executed: number;
  raw_cache_hits: number;
  derived_cache_hits: number;
  queries_suppressed: number;
  budget_before: number;
  budget_after: number;
  fallback_used: boolean;
  items: Array<{
    query_id: string;
    purpose: string;
    query: string;
    decision: ExecutionDecision["decision"];
    reason_code: string;
    returned: number;
    accepted: number;
    duration_ms: number;
    safe_error_code: string | null;
  }>;
};

/** The safe surfaced-public-signal shape (Section 5). */
export type DistilledPublicSignal = {
  public_fact: string;
  source_id: string;
  source_url: string;
  source_authority: number;
  account_relevance: number;
  opportunity_relevance: number;
  seller_goal_relevance: number;
  implication: string;
  action_effect: string;
  limitation: string;
  eligibility: { account_context: boolean; narrative: boolean; scoring: boolean };
};
