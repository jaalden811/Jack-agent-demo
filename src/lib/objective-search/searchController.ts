import { getConfig } from "@/lib/config";
import { executeSerpApiSearch } from "@/lib/connectors/serpapi/client";
import { SerpApiError } from "@/lib/connectors/serpapi/types";
import { canonicalizeUrl, extractDomain } from "@/lib/connectors/serpapi/canonicalUrl";
import { getRawCached, setRawCached, SEARCH_PROVIDER_ID } from "@/lib/objective-search/rawCache";
import { loadSearchBudgetPolicy } from "@/lib/objective-search/searchBudget";
import { PLANNER_VERSION } from "@/lib/objective-search/queryPlanner";
import type { ExecutableQuery, ExecutionDecision, RawResultRow, SearchTrace } from "@/lib/objective-search/types";

/**
 * The objective-aware execution controller — the SOLE live-SerpAPI executor
 * for objective public evidence. Applies the per-query policy decision
 * (execute | raw_cache | suppress) BEFORE any provider call, executes only
 * approved queries via the EXISTING SerpAPI client (no second client),
 * populates the RAW cache, deduplicates by canonical URL (preserving
 * provenance), and emits the single canonical search trace. The provider is
 * injectable so the planner-controlled flow is testable without a live key.
 */

export type SearchProvider = (query: string, maxResults: number) => Promise<RawResultRow[]>;

function providerConfigured(): boolean {
  return getConfig().hasSerpApi;
}

/** Default provider: reuses executeSerpApiSearch, maps organic results to
 * RawResultRow. Never logs or returns the API key. */
async function defaultProvider(query: string, maxResults: number): Promise<RawResultRow[]> {
  const raw = await executeSerpApiSearch({ query });
  const organic = raw.organic_results ?? [];
  return organic
    .filter((r) => r.title && r.link)
    .slice(0, maxResults)
    .map((r, position) => {
      const url = r.link as string;
      return {
        source_id: "",
        query_id: "",
        title: r.title as string,
        url,
        canonical_url: canonicalizeUrl(url),
        domain: extractDomain(url),
        snippet: r.snippet ?? "",
        published_at: r.date ?? null,
        position,
        provider: SEARCH_PROVIDER_ID as "serpapi",
        source_authority_hint: 0.5,
        raw_cache_key: "",
        found_by_query_ids: []
      };
    });
}

function decide(params: { query: ExecutableQuery; rawCacheHit: boolean; executedSoFar: number; perRunCap: number; budgetRemaining: number; providerReady: boolean }): ExecutionDecision {
  const { query, rawCacheHit, executedSoFar, perRunCap, budgetRemaining } = params;
  if (rawCacheHit) return { decision: "raw_cache", reason_code: "raw_cache_hit", budget_cost: 0, cache_key: query.cache_key };
  if (!params.providerReady) return { decision: "suppress", reason_code: "provider_not_configured", budget_cost: 0, cache_key: query.cache_key };
  if (executedSoFar >= perRunCap) return { decision: "suppress", reason_code: "per_run_limit", budget_cost: 0, cache_key: query.cache_key };
  if (executedSoFar >= budgetRemaining) return { decision: "suppress", reason_code: "daily_budget_exhausted", budget_cost: 0, cache_key: query.cache_key };
  return { decision: "execute", reason_code: "planner_approved", budget_cost: 1, cache_key: query.cache_key };
}

export async function executeObjectiveSearch(params: {
  executableQueries: ExecutableQuery[];
  objectiveIds: string[];
  budgetRemaining: number;
  fallbackUsed?: boolean;
  provider?: SearchProvider;
  providerReadyOverride?: boolean;
}): Promise<{ rows: RawResultRow[]; trace: SearchTrace; executedCount: number }> {
  const policy = loadSearchBudgetPolicy();
  const provider = params.provider ?? defaultProvider;
  const providerReady = params.providerReadyOverride ?? providerConfigured();
  const perRunCap = policy.max_queries_per_run;
  const budgetBefore = params.budgetRemaining;

  const trace: SearchTrace = {
    planner_version: PLANNER_VERSION,
    objective_ids: params.objectiveIds,
    queries_planned: params.executableQueries.length,
    queries_executed: 0,
    raw_cache_hits: 0,
    derived_cache_hits: 0,
    queries_suppressed: 0,
    budget_before: budgetBefore,
    budget_after: budgetBefore,
    fallback_used: Boolean(params.fallbackUsed),
    items: []
  };

  const byCanonicalUrl = new Map<string, RawResultRow>();
  let executed = 0;

  // Priority order.
  const ordered = [...params.executableQueries].sort((a, b) => a.priority - b.priority);
  for (const q of ordered) {
    const started = Date.now();
    const cached = await getRawCached(q.cache_key);
    const decision = decide({ query: q, rawCacheHit: cached != null, executedSoFar: executed, perRunCap, budgetRemaining: budgetBefore, providerReady });

    if (decision.decision === "raw_cache") {
      trace.raw_cache_hits += 1;
      const rows = (cached ?? []).map((r) => ({ ...r, query_id: q.query_id }));
      for (const row of rows) mergeRow(byCanonicalUrl, row, q.query_id);
      trace.items.push({ query_id: q.query_id, purpose: q.purpose, query: q.query, decision: "raw_cache", reason_code: decision.reason_code, returned: rows.length, accepted: rows.length, duration_ms: Date.now() - started, safe_error_code: null });
      continue;
    }

    if (decision.decision === "suppress") {
      trace.queries_suppressed += 1;
      trace.items.push({ query_id: q.query_id, purpose: q.purpose, query: q.query, decision: "suppress", reason_code: decision.reason_code, returned: 0, accepted: 0, duration_ms: Date.now() - started, safe_error_code: null });
      continue;
    }

    // execute
    try {
      const rawRows = (await provider(q.query, q.max_results)).map((r) => ({ ...r, query_id: q.query_id, raw_cache_key: q.cache_key, found_by_query_ids: [q.query_id], source_id: r.source_id || `${q.query_id}:${r.canonical_url}` }));
      await setRawCached(q.cache_key, rawRows);
      executed += 1;
      trace.queries_executed += 1;
      for (const row of rawRows) mergeRow(byCanonicalUrl, row, q.query_id);
      trace.items.push({ query_id: q.query_id, purpose: q.purpose, query: q.query, decision: "execute", reason_code: decision.reason_code, returned: rawRows.length, accepted: rawRows.length, duration_ms: Date.now() - started, safe_error_code: null });
    } catch (error) {
      executed += 1; // a spent attempt (even on error) counts against the run
      trace.queries_executed += 1;
      const code = error instanceof SerpApiError ? error.code : "SEARCH_EXECUTION_FAILED";
      // A failed search is NEUTRAL — never negative evidence.
      trace.items.push({ query_id: q.query_id, purpose: q.purpose, query: q.query, decision: "execute", reason_code: "provider_error", returned: 0, accepted: 0, duration_ms: Date.now() - started, safe_error_code: code });
    }
  }

  trace.budget_after = Math.max(0, budgetBefore - executed);
  return { rows: Array.from(byCanonicalUrl.values()), trace, executedCount: executed };
}

function mergeRow(map: Map<string, RawResultRow>, row: RawResultRow, queryId: string): void {
  const existing = map.get(row.canonical_url);
  if (existing) {
    if (!existing.found_by_query_ids.includes(queryId)) existing.found_by_query_ids.push(queryId);
    return;
  }
  map.set(row.canonical_url, { ...row, found_by_query_ids: Array.from(new Set([...(row.found_by_query_ids ?? []), queryId])) });
}
