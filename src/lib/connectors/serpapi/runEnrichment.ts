import { getConfig } from "@/lib/config";
import { executeSerpApiSearch } from "@/lib/connectors/serpapi/client";
import { planSerpApiQueries, isGenericAccountName } from "@/lib/connectors/serpapi/queryPlanner";
import { normalizeSerpApiResponse } from "@/lib/connectors/serpapi/resultNormalizer";
import { filterAcceptedResults, toEvidenceItems } from "@/lib/connectors/serpapi/signalExtractor";
import { buildCacheKey, getCachedResults, setCachedResults } from "@/lib/connectors/serpapi/cache";
import { SerpApiError, type NormalizedSerpResult, type QueryPlannerInput } from "@/lib/connectors/serpapi/types";
import type { PublicEnrichmentQueryTrace, PublicEnrichmentStatus } from "@/lib/qualification/types";

/**
 * Orchestrates the full SerpAPI enrichment pass for one analysis run:
 * plan queries -> execute (cache-aware) -> normalize -> accept/reject ->
 * build the trace shown in Setup/Sources & enrichment. Never throws —
 * any failure degrades to `enabled: false` with a specific
 * fallback_reason; transcript analysis and delivery are never blocked.
 */

export type EnrichmentGateResult = { allowed: boolean; reason: string | null };

/** Section 2/6: search runs only when public enrichment is enabled,
 * SerpAPI is configured, the verdict is REVIEW/HIGH_INTENT, and a real
 * (non-generic) account or stakeholder candidate exists. */
export function gateSearchEnrichment(params: {
  enrichmentEnabled: boolean;
  verdict: "HIGH_INTENT" | "REVIEW" | "NOISE";
  accountCandidateName: string | null;
  hasStakeholderCandidate: boolean;
}): EnrichmentGateResult {
  const config = getConfig();
  if (!params.enrichmentEnabled) return { allowed: false, reason: "public enrichment disabled by user" };
  if (!config.hasSerpApi) return { allowed: false, reason: "SerpAPI is not configured (SEARCH_PROVIDER/SEARCH_API_KEY)" };
  if (params.verdict === "NOISE") return { allowed: false, reason: "verdict is NOISE" };
  const hasRealAccount = !isGenericAccountName(params.accountCandidateName);
  if (!hasRealAccount && !params.hasStakeholderCandidate) {
    return { allowed: false, reason: "no real (non-generic) account or stakeholder candidate" };
  }
  return { allowed: true, reason: null };
}

export async function runSerpApiEnrichment(input: QueryPlannerInput & { accountName: string; accountDomain: string | null }): Promise<PublicEnrichmentStatus> {
  const config = getConfig();
  const plannedQueries = planSerpApiQueries(input);

  if (plannedQueries.length === 0) {
    return {
      enabled: true,
      provider: "serpapi",
      configured: config.hasSerpApi,
      queries: [],
      sources: [],
      accepted_evidence: [],
      rejected_count: 0,
      fallback_reason: "no targeted queries were generated from the available evidence"
    };
  }

  const traces: PublicEnrichmentQueryTrace[] = [];
  const allResults: NormalizedSerpResult[] = [];
  let rejectedCount = 0;
  let fallbackReason: string | null = null;

  for (const plannedQuery of plannedQueries) {
    const startedAt = Date.now();
    const cacheKey = buildCacheKey({ engine: config.SERPAPI_ENGINE, query: plannedQuery.query, gl: config.SERPAPI_COUNTRY, hl: config.SERPAPI_LANGUAGE, start: 0 });

    try {
      let normalized = await getCachedResults(cacheKey);
      let cacheStatus: "hit" | "miss" = "hit";

      if (!normalized) {
        cacheStatus = "miss";
        const raw = await executeSerpApiSearch({ query: plannedQuery.query, location: input.location ?? undefined });
        normalized = normalizeSerpApiResponse({
          raw,
          plannedQuery,
          accountName: input.accountName,
          accountDomain: input.accountDomain,
          signals: [...input.buying_signals, ...input.commercial_signals, ...input.detected_products]
        }).slice(0, config.SERPAPI_MAX_RESULTS_PER_QUERY);
        await setCachedResults(cacheKey, normalized, config.SERPAPI_CACHE_TTL_SECONDS);
      }

      const { accepted, rejected } = filterAcceptedResults(normalized.slice(0, config.SERPAPI_DEFAULT_RESULT_LIMIT));
      allResults.push(...accepted);
      rejectedCount += rejected.length;

      traces.push({
        query_id: plannedQuery.query_id,
        purpose: plannedQuery.purpose,
        query: plannedQuery.query,
        results: normalized.length,
        accepted: accepted.length,
        rejected: rejected.length,
        latency_ms: Date.now() - startedAt,
        cache: cacheStatus,
        error: null
      });
    } catch (error) {
      const message = error instanceof SerpApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Unknown SerpAPI error";
      traces.push({
        query_id: plannedQuery.query_id,
        purpose: plannedQuery.purpose,
        query: plannedQuery.query,
        results: 0,
        accepted: 0,
        rejected: 0,
        latency_ms: Date.now() - startedAt,
        cache: "miss",
        error: message
      });
      fallbackReason = fallbackReason ?? message;
      // A single query failing (timeout, rate limit exhausted, etc.)
      // never blocks the remaining planned queries or transcript
      // analysis — continue to the next query.
    }
  }

  const dedupedByUrl = new Map<string, NormalizedSerpResult>();
  for (const result of allResults) {
    const existing = dedupedByUrl.get(result.canonical_url);
    if (!existing || result.public_evidence_score > existing.public_evidence_score) dedupedByUrl.set(result.canonical_url, result);
  }
  const acceptedResults = Array.from(dedupedByUrl.values());

  return {
    enabled: true,
    provider: "serpapi",
    configured: config.hasSerpApi,
    queries: traces,
    sources: acceptedResults.map((r) => toEvidenceItems([r])[0]),
    accepted_evidence: toEvidenceItems(acceptedResults),
    rejected_count: rejectedCount,
    fallback_reason: fallbackReason
  };
}
