import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";

/**
 * Search-budget policy + APP-OBSERVED daily consumption (never an invented
 * provider quota). Also the raw-search cache TTL + derived-classification
 * cache version live here so a classification-logic change never forces
 * re-purchasing the same search.
 */

export type SearchBudgetPolicy = {
  max_queries_per_run: number;
  max_source_fetches_per_run: number;
  raw_result_cache_ttl_seconds: number;
  derived_classification_cache_version: string;
  daily_local_query_budget: number;
  cache_only_mode: boolean;
  max_primary_signals: number;
  min_account_relevance_for_teaser: number;
  min_opportunity_relevance_for_teaser: number;
};

const CONFIG_RELATIVE_PATH = "signal-agent-poc/config/search_budget_policy.json";
let cachedPolicy: SearchBudgetPolicy | null = null;
export function clearSearchBudgetPolicyCache(): void {
  cachedPolicy = null;
}
export function loadSearchBudgetPolicy(): SearchBudgetPolicy {
  if (cachedPolicy) return cachedPolicy;
  cachedPolicy = JSON.parse(readFileSync(path.join(process.cwd(), CONFIG_RELATIVE_PATH), "utf8")) as SearchBudgetPolicy;
  return cachedPolicy;
}

type DailyLedger = { date: string; queries: number };

function budgetPath(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "search-budget.json");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readLedger(): Promise<DailyLedger> {
  try {
    const l = JSON.parse(await readFile(budgetPath(), "utf8")) as DailyLedger;
    return l.date === today() ? l : { date: today(), queries: 0 };
  } catch {
    return { date: today(), queries: 0 };
  }
}

/** App-observed remaining daily query budget (not a provider quota). */
export async function getBudgetState(): Promise<{ used: number; remaining: number; daily_budget: number }> {
  const policy = loadSearchBudgetPolicy();
  const ledger = await readLedger();
  return { used: ledger.queries, remaining: Math.max(0, policy.daily_local_query_budget - ledger.queries), daily_budget: policy.daily_local_query_budget };
}

/** Records `count` executed queries against today's app-observed budget. */
export async function recordQuerySpend(count: number): Promise<void> {
  if (count <= 0) return;
  try {
    const ledger = await readLedger();
    ledger.queries += count;
    await mkdir(path.dirname(budgetPath()), { recursive: true });
    await writeFile(budgetPath(), JSON.stringify(ledger, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}
