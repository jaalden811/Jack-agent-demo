import { getConfig } from "@/lib/config";
import { buildExecutableQueries } from "@/lib/objective-search/queryPlanner";
import { cachedRawKeys } from "@/lib/objective-search/rawCache";
import { executeObjectiveSearch, type SearchProvider } from "@/lib/objective-search/searchController";
import { getBudgetState, recordQuerySpend } from "@/lib/objective-search/searchBudget";
import { buildNormalizedSignal, acceptedSignals, deduplicateSignals } from "@/lib/opportunity-fit/signalScoring";
import type { NormalizedPublicSignal, PublicSignalCategory, QueryPurpose, SerpApiSignalQueryTrace, SerpApiSignalsResult } from "@/lib/opportunity-fit/types";
import type { SearchTrace } from "@/lib/objective-search/types";

/**
 * Objective-aware public enrichment — the CANONICAL controller for live
 * SerpAPI execution of opportunity public evidence. Planner decides the
 * queries; the controller applies policy + caches + executes only approved
 * queries; results are normalized into the existing NormalizedPublicSignal
 * shape (so Stage B is unchanged) but marked context/narrative-only
 * (scoring_eligible = false) so public evidence never alters the deterministic
 * opportunity score. Returns a SerpApiSignalsResult (Stage B input) + the
 * single canonical search trace.
 */

const PURPOSE_TO_CATEGORY: Record<string, PublicSignalCategory> = {
  company_scale: "strategic_objective",
  strategic_priorities: "strategic_objective",
  public_security_initiatives: "executive_priority",
  public_cloud_initiatives: "executive_priority",
  public_ai_initiatives: "executive_priority"
};

function categoryForIntent(intentId: string): PublicSignalCategory {
  return PURPOSE_TO_CATEGORY[intentId] ?? "strategic_objective";
}

export type ObjectiveEnrichmentInput = {
  account: string | null;
  accountDomain: string | null;
  accountStatus: string;
  verdict: string;
  objectiveIds: string[];
  primaryMotion: string;
  transcriptThemes: string[];
  transcriptSignals: string[];
  /** Injectable provider for tests (defaults to the live SerpAPI client). */
  provider?: SearchProvider;
  providerReadyOverride?: boolean;
};

export type ObjectiveEnrichmentResult = { serpapi_signals: SerpApiSignalsResult; trace: SearchTrace };

export async function runObjectiveEnrichment(input: ObjectiveEnrichmentInput): Promise<ObjectiveEnrichmentResult> {
  const budget = await getBudgetState();
  const { plan, queries } = buildExecutableQueries({
    account: input.account,
    accountStatus: input.accountStatus,
    verdict: input.verdict,
    objectiveIds: input.objectiveIds,
    primaryMotion: input.primaryMotion,
    transcriptThemes: input.transcriptThemes,
    budgetRemaining: budget.remaining,
    cachedKeys: await cachedRawKeys([])
  });

  const emptyTrace: SearchTrace = {
    planner_version: "objective-planner-v1",
    objective_ids: plan.objective_ids,
    queries_planned: 0,
    queries_executed: 0,
    raw_cache_hits: 0,
    derived_cache_hits: 0,
    queries_suppressed: 0,
    budget_before: budget.remaining,
    budget_after: budget.remaining,
    fallback_used: false,
    items: []
  };

  if (!plan.should_search || queries.length === 0) {
    return {
      serpapi_signals: { status: "not_run", reason: plan.suppression_reason ?? "no objective queries planned", queries: [], signals: [], strong_signal_count: 0, supporting_signal_count: 0, weak_signal_count: 0, rejected_result_count: 0 },
      trace: { ...emptyTrace, queries_suppressed: queries.length }
    };
  }

  const { rows, trace, executedCount } = await executeObjectiveSearch({
    executableQueries: queries,
    objectiveIds: plan.objective_ids,
    budgetRemaining: budget.remaining,
    provider: input.provider,
    providerReadyOverride: input.providerReadyOverride
  });
  if (executedCount > 0) await recordQuerySpend(executedCount);

  // Normalize into the existing signal shape (Stage B input) — but public
  // evidence is context/narrative ONLY (never scoring-eligible), so it can
  // never alter the deterministic opportunity score.
  const queryPurposeById = new Map(queries.map((q) => [q.query_id, q.intent_id]));
  const normalized: NormalizedPublicSignal[] = rows.map((row) => {
    const signal = buildNormalizedSignal({
      accountName: input.account ?? "",
      accountDomain: input.accountDomain,
      category: categoryForIntent(queryPurposeById.get(row.query_id) ?? ""),
      subcategory: queryPurposeById.get(row.query_id) ?? "objective",
      title: row.title,
      url: row.url,
      snippet: row.snippet,
      publishedAt: row.published_at,
      transcriptSignals: input.transcriptSignals
    });
    return { ...signal, scoring_eligible: false };
  });

  const accepted = deduplicateSignals(acceptedSignals(normalized));
  const rejectedCount = normalized.length - accepted.length;
  const strong = accepted.filter((s) => s.evidence_class === "confirmed_public_fact").length;
  const supporting = accepted.filter((s) => s.evidence_class === "probable_public_signal").length;
  const weak = accepted.filter((s) => s.evidence_class === "weak_signal").length;
  const anyError = trace.items.some((i) => i.safe_error_code);

  // Honest reason when nothing ran: distinguish "SerpAPI is not configured"
  // from "all objective queries suppressed" (budget/cache/policy).
  const nothingRan = trace.queries_executed === 0 && trace.raw_cache_hits === 0;
  const providerNotConfigured = input.providerReadyOverride !== true && !getConfig().hasSerpApi;
  const notRunReason = nothingRan
    ? providerNotConfigured
      ? "SerpAPI is not configured"
      : "all objective queries suppressed"
    : null;

  const traces: SerpApiSignalQueryTrace[] = trace.items.map((i) => ({
    query_id: i.query_id,
    purpose: i.purpose as QueryPurpose,
    query: i.query,
    transcript_evidence_ids: [],
    results_returned: i.returned,
    results_accepted: i.accepted,
    cache_hit: i.decision === "raw_cache",
    duration_ms: i.duration_ms,
    error_code: i.safe_error_code
  }));

  return {
    serpapi_signals: {
      status: nothingRan ? "not_run" : anyError && accepted.length === 0 ? "failed" : anyError ? "partial" : "completed",
      reason: notRunReason,
      queries: traces,
      signals: accepted,
      strong_signal_count: strong,
      supporting_signal_count: supporting,
      weak_signal_count: weak,
      rejected_result_count: rejectedCount
    },
    trace
  };
}
