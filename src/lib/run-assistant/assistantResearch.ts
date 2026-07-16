import { createHash } from "node:crypto";
import { keywords } from "@/lib/run-assistant/evidenceRetriever";
import { buildRawCacheKey } from "@/lib/objective-search/rawCache";
import { executeObjectiveSearch, type SearchProvider } from "@/lib/objective-search/searchController";
import { getBudgetState, recordQuerySpend } from "@/lib/objective-search/searchBudget";
import type { ExecutableQuery, RawResultRow, SearchTrace } from "@/lib/objective-search/types";

/**
 * Assistant-requested research. Uses the SAME objective-aware execution
 * controller (budget + caches + policy) as the run pipeline — the user's
 * question becomes one bounded research intent. Only runs on an EXPLICIT
 * research request; ordinary assistant questions never trigger it.
 */

export async function runAssistantResearch(params: {
  question: string;
  account: string | null;
  provider?: SearchProvider;
  providerReadyOverride?: boolean;
}): Promise<{ rows: RawResultRow[]; trace: SearchTrace; executedCount: number }> {
  const account = (params.account ?? "").trim();
  const kws = keywords(params.question).slice(0, 6);
  if (!account || kws.length === 0) {
    const budget = await getBudgetState();
    return { rows: [], trace: { planner_version: "assistant-research-v1", objective_ids: [], queries_planned: 0, queries_executed: 0, raw_cache_hits: 0, derived_cache_hits: 0, queries_suppressed: 0, budget_before: budget.remaining, budget_after: budget.remaining, fallback_used: false, items: [] }, executedCount: 0 };
  }

  const q = `"${account}" ${kws.join(" ")}`.trim();
  const query: ExecutableQuery = {
    query_id: `ar_${createHash("sha256").update(q.toLowerCase()).digest("hex").slice(0, 10)}`,
    objective_id: "assistant_research",
    intent_id: "assistant_question",
    purpose: "assistant_research",
    query: q,
    account,
    motion_id: "assistant",
    transcript_theme_ids: [],
    priority: 0,
    max_results: 4,
    cache_key: buildRawCacheKey(q),
    reason: "assistant_research_intent"
  };

  const budget = await getBudgetState();
  const result = await executeObjectiveSearch({
    executableQueries: [query],
    objectiveIds: ["assistant_research"],
    budgetRemaining: budget.remaining,
    provider: params.provider,
    providerReadyOverride: params.providerReadyOverride
  });
  if (result.executedCount > 0) await recordQuerySpend(result.executedCount);
  return result;
}
