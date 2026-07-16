import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { getCircuitConfig } from "@/lib/circuit/config";
import { loadSearchBudgetPolicy } from "@/lib/objective-search/searchBudget";
import type { RawResultRow } from "@/lib/objective-search/types";

/**
 * DERIVED (Stage B classification) cache. The derived key depends on the raw
 * result identity/hash + Stage B prompt version + Stage B schema version +
 * classification policy version + objective context version. So a Stage B
 * classification change misses the derived cache (re-runs Stage B) but still
 * reuses the RAW results without spending another SerpAPI query.
 */

export const CLASSIFICATION_POLICY_VERSION = "classification-v1";

type DerivedEntry<T> = { created_at: string; value: T };
type DerivedStore = Record<string, DerivedEntry<unknown>>;

function derivedCachePath(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "objective-search-derived-cache.json");
}

function circuitVersions(): { prompt: string; schema: string } {
  try {
    const c = getCircuitConfig();
    return { prompt: c.promptVersion, schema: c.schemaVersion };
  } catch {
    return { prompt: "unknown", schema: "unknown" };
  }
}

function rawHash(rows: RawResultRow[]): string {
  const identity = rows.map((r) => `${r.canonical_url}|${r.title}`).sort().join("\n");
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

export function buildDerivedCacheKey(rows: RawResultRow[], objectiveContextVersion: string): string {
  const v = circuitVersions();
  const configuredVersion = loadSearchBudgetPolicy().derived_classification_cache_version;
  return `derived:${rawHash(rows)}:sbp=${v.prompt}:sbs=${v.schema}:pol=${CLASSIFICATION_POLICY_VERSION}:${configuredVersion}:obj=${objectiveContextVersion}`;
}

async function readStore(): Promise<DerivedStore> {
  try {
    return JSON.parse(await readFile(derivedCachePath(), "utf8")) as DerivedStore;
  } catch {
    return {};
  }
}

export async function getDerived<T>(key: string): Promise<T | null> {
  const entry = (await readStore())[key];
  return entry ? (entry.value as T) : null;
}

export async function setDerived<T>(key: string, value: T): Promise<void> {
  try {
    const store = await readStore();
    store[key] = { created_at: new Date().toISOString(), value };
    await mkdir(path.dirname(derivedCachePath()), { recursive: true });
    await writeFile(derivedCachePath(), JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}
