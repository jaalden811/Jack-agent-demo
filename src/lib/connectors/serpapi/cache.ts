import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { NormalizedSerpResult } from "@/lib/connectors/serpapi/types";

/**
 * Application-level SerpAPI cache — 24 hours by default
 * (SERPAPI_CACHE_TTL_SECONDS), independent of SerpAPI's own ~1 hour
 * server-side cache. Cache key never includes the API key. Never
 * caches an authentication failure.
 */

type CacheEntry = { created_at: string; expires_at: string; normalized_results: NormalizedSerpResult[] };
type CacheStore = Record<string, CacheEntry>;

function cacheFilePath(): string {
  const config = getConfig();
  const dir = path.resolve(process.cwd(), config.LOCAL_DATA_DIR, "serpapi");
  return path.join(dir, "cache.json");
}

async function readStore(): Promise<CacheStore> {
  try {
    const text = await readFile(cacheFilePath(), "utf8");
    return JSON.parse(text) as CacheStore;
  } catch {
    return {};
  }
}

async function writeStore(store: CacheStore): Promise<void> {
  const filePath = cacheFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
}

export function buildCacheKey(params: { engine: string; query: string; gl: string; hl: string; location?: string; start: number }): string {
  const normalizedQuery = params.query.trim().toLowerCase();
  return `serpapi:${params.engine}:${normalizedQuery}:${params.gl}:${params.hl}:${params.location ?? ""}:${params.start}`;
}

export async function getCachedResults(key: string): Promise<NormalizedSerpResult[] | null> {
  const store = await readStore();
  const entry = store[key];
  if (!entry) return null;
  if (new Date(entry.expires_at).getTime() < Date.now()) return null;
  return entry.normalized_results;
}

export async function setCachedResults(key: string, results: NormalizedSerpResult[], ttlSeconds: number): Promise<void> {
  const store = await readStore();
  const now = new Date();
  store[key] = {
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    normalized_results: results
  };
  await writeStore(store);
}

export async function clearSerpApiCache(): Promise<void> {
  await writeStore({});
}
