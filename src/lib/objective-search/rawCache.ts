import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { loadSearchBudgetPolicy } from "@/lib/objective-search/searchBudget";
import type { RawResultRow } from "@/lib/objective-search/types";

/**
 * RAW provider-result cache for the objective-aware execution controller.
 * The raw cache key depends ONLY on the normalized query + provider + result
 * shape version — never on the Circuit/Stage B prompt version, Stage B schema
 * version, classification thresholds, or seller-profile wording. So changing
 * classification logic reuses raw results without spending another query.
 */

export const RAW_RESULT_SHAPE_VERSION = "shape1";
export const SEARCH_PROVIDER_ID = "serpapi";

type RawEntry = { created_at: string; expires_at: string; rows: RawResultRow[] };
type RawStore = Record<string, RawEntry>;

function rawCachePath(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "objective-search-raw-cache.json");
}

/** Raw key = provider + result-shape version + normalized query. */
export function buildRawCacheKey(query: string): string {
  return `raw:${SEARCH_PROVIDER_ID}:${RAW_RESULT_SHAPE_VERSION}:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

async function readStore(): Promise<RawStore> {
  try {
    return JSON.parse(await readFile(rawCachePath(), "utf8")) as RawStore;
  } catch {
    return {};
  }
}

export async function getRawCached(key: string): Promise<RawResultRow[] | null> {
  const entry = (await readStore())[key];
  if (!entry) return null;
  if (new Date(entry.expires_at).getTime() < Date.now()) return null;
  return entry.rows;
}

export async function setRawCached(key: string, rows: RawResultRow[]): Promise<void> {
  try {
    const store = await readStore();
    const now = new Date();
    const ttl = loadSearchBudgetPolicy().raw_result_cache_ttl_seconds;
    store[key] = { created_at: now.toISOString(), expires_at: new Date(now.getTime() + ttl * 1000).toISOString(), rows };
    await mkdir(path.dirname(rawCachePath()), { recursive: true });
    await writeFile(rawCachePath(), JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}

/** Which of the given raw cache keys are currently cached (for the planner's
 * cache-hit accounting, before any provider call). */
export async function cachedRawKeys(keys: string[]): Promise<Set<string>> {
  const store = await readStore();
  const now = Date.now();
  const hits = new Set<string>();
  for (const key of keys) {
    const entry = store[key];
    if (entry && new Date(entry.expires_at).getTime() >= now) hits.add(key);
  }
  return hits;
}
