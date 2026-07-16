import { createHash } from "node:crypto";
import { loadSearchBudgetPolicy } from "@/lib/objective-search/searchBudget";
import { searchRuleFor } from "@/lib/objective-search/objectiveSearchMap";
import { buildRawCacheKey } from "@/lib/objective-search/rawCache";
import type { ExecutableQuery, PlannedQuery, SearchPlan } from "@/lib/objective-search/types";

export const PLANNER_VERSION = "objective-planner-v1";

/**
 * Objective-aware research planner. Decides IF and WHAT public facts to
 * research from the seller's goals + account + motion + transcript themes.
 * Never plans private-data searches; suppresses when the account is
 * unresolved, the verdict is NOISE, no objective needs enrichment, the answer
 * is cached, or the budget is exhausted. Pure — budget/cache state is passed
 * in so it is deterministic and unit-testable.
 */

const ACCOUNT_RANK: Record<string, number> = { unresolved: 0, any: 0, probable: 1, confirmed: 2 };
const REQUIRED_RANK: Record<string, number> = { any: 0, probable: 1, confirmed: 2 };

export type PlannerInput = {
  account: string | null;
  accountStatus: string;
  verdict: string;
  objectiveIds: string[];
  primaryMotion: string;
  supportingMotions?: string[];
  transcriptThemes?: string[];
  geography?: string | null;
  industry?: string | null;
  budgetRemaining: number;
  cachedKeys?: Set<string>;
};

function fillTemplate(template: string, input: PlannerInput): string {
  return template
    .replace(/\{account\}/g, input.account ?? "")
    .replace(/\{industry\}/g, input.industry ?? "")
    .replace(/\{geography\}/g, input.geography ?? "")
    .replace(/\{product_motion\}/g, input.primaryMotion ?? "")
    .replace(/\{transcript_theme\}/g, (input.transcriptThemes ?? [])[0] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function rawCacheKey(query: string): string {
  // Raw-search cache key deliberately EXCLUDES the classification version, so
  // changing classification logic never forces re-purchasing the search.
  return buildRawCacheKey(query);
}

function emptyPlan(reason: string, budgetRemaining: number): SearchPlan {
  return { should_search: false, suppression_reason: reason, planned_queries: [], objective_ids: [], queries_planned: 0, cache_hits: 0, budget_remaining: budgetRemaining, relevance_dimensions_affected: [], message_fields_affected: [] };
}

export function planObjectiveSearch(input: PlannerInput): SearchPlan {
  const policy = loadSearchBudgetPolicy();
  const cached = input.cachedKeys ?? new Set<string>();

  if (input.verdict === "NOISE") return emptyPlan("noise", input.budgetRemaining);
  if (input.budgetRemaining <= 0 && !policy.cache_only_mode) return emptyPlan("budget_exhausted", input.budgetRemaining);

  const accountRank = ACCOUNT_RANK[input.accountStatus] ?? 0;
  const dimensions = new Set<string>();
  const fields = new Set<string>();
  const usedObjectives = new Set<string>();
  const seenKeys = new Set<string>();
  const queries: PlannedQuery[] = [];
  let anyAccountIntentSuppressed = false;

  for (const objectiveId of input.objectiveIds) {
    const rule = searchRuleFor(objectiveId);
    if (!rule) continue;
    if (accountRank < (REQUIRED_RANK[rule.required_account_resolution] ?? 0)) {
      anyAccountIntentSuppressed = true;
      continue;
    }
    for (const intent of rule.query_intents) {
      // An intent requiring the account is suppressed when the account is
      // unresolved or absent.
      if (intent.required_inputs.includes("account") && (!input.account || accountRank === 0)) {
        anyAccountIntentSuppressed = true;
        continue;
      }
      const query = fillTemplate(intent.template, input);
      if (!query) continue;
      const key = rawCacheKey(query);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      queries.push({ intent_id: intent.intent_id, objective_id: objectiveId, purpose: intent.purpose, query, accepted_signal_types: intent.accepted_signal_types, cache_key: key, cache_hit: cached.has(key) });
      usedObjectives.add(objectiveId);
      for (const d of rule.relevance_dimensions_affected) dimensions.add(d);
      for (const f of rule.message_fields_affected) fields.add(f);
    }
  }

  const cacheHitQueries = queries.filter((q) => q.cache_hit);
  let executableQueries = queries.filter((q) => !q.cache_hit);
  if (policy.cache_only_mode) executableQueries = [];

  // Enforce per-run + remaining daily budget on queries that would EXECUTE.
  const runCap = Math.max(0, Math.min(policy.max_queries_per_run, input.budgetRemaining));
  executableQueries = executableQueries.slice(0, runCap);

  const plannedQueries = [...cacheHitQueries, ...executableQueries];
  if (plannedQueries.length === 0) {
    return emptyPlan(anyAccountIntentSuppressed && accountRank === 0 ? "unresolved_account" : usedObjectives.size === 0 ? "no_objective_requires_enrichment" : "budget_exhausted", input.budgetRemaining);
  }

  return {
    should_search: executableQueries.length > 0 || cacheHitQueries.length > 0,
    suppression_reason: null,
    planned_queries: plannedQueries,
    objective_ids: Array.from(usedObjectives),
    queries_planned: executableQueries.length,
    cache_hits: cacheHitQueries.length,
    budget_remaining: Math.max(0, input.budgetRemaining - executableQueries.length),
    relevance_dimensions_affected: Array.from(dimensions),
    message_fields_affected: Array.from(fields)
  };
}

function queryId(objectiveId: string, intentId: string, query: string): string {
  return `oq_${createHash("sha256").update(`${objectiveId}:${intentId}:${query.toLowerCase()}`).digest("hex").slice(0, 10)}`;
}

/** Maps a plan into deterministic, executable query objects — the ONLY thing
 * the execution layer will run. Cache-hit queries are included (they resolve
 * from the raw cache, not the provider). */
export function buildExecutableQueries(input: PlannerInput): { plan: SearchPlan; queries: ExecutableQuery[] } {
  const policy = loadSearchBudgetPolicy();
  const plan = planObjectiveSearch(input);
  const themeIds = (input.transcriptThemes ?? []).map((t) => t.toLowerCase());
  const queries: ExecutableQuery[] = plan.planned_queries.map((q, index) => ({
    query_id: queryId(q.objective_id, q.intent_id, q.query),
    objective_id: q.objective_id,
    intent_id: q.intent_id,
    purpose: q.purpose,
    query: q.query,
    account: input.account ?? "",
    motion_id: input.primaryMotion,
    transcript_theme_ids: themeIds,
    priority: index,
    max_results: policy.max_source_fetches_per_run > 0 ? Math.min(5, policy.max_source_fetches_per_run) : 5,
    cache_key: q.cache_key,
    reason: q.cache_hit ? "raw_cache_candidate" : "planned"
  }));
  return { plan, queries };
}
