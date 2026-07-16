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
