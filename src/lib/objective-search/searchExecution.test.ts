import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeObjectiveSearch, type SearchProvider } from "@/lib/objective-search/searchController";
import { buildExecutableQueries } from "@/lib/objective-search/queryPlanner";
import { buildRawCacheKey, getRawCached } from "@/lib/objective-search/rawCache";
import { runObjectiveEnrichment } from "@/lib/objective-search/runObjectiveEnrichment";
import type { ExecutableQuery, RawResultRow } from "@/lib/objective-search/types";

let originalDataDir: string | undefined;
beforeEach(async () => {
  originalDataDir = process.env.LOCAL_DATA_DIR;
  process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "search-exec-test-"));
});
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = originalDataDir;
});

function query(id: string, q: string, priority = 0): ExecutableQuery {
  return { query_id: id, objective_id: "expand_security_portfolio", intent_id: "public_security_initiatives", purpose: "public_security_initiatives", query: q, account: "AECOM", motion_id: "soc_detection_response", transcript_theme_ids: [], priority, max_results: 5, cache_key: buildRawCacheKey(q), reason: "planned" };
}

function row(url: string, title = "T"): RawResultRow {
  return { source_id: "", query_id: "", title, url, canonical_url: url.replace(/\/$/, ""), domain: "x.com", snippet: "s", published_at: null, position: 0, provider: "serpapi", source_authority_hint: 0.5, raw_cache_key: "", found_by_query_ids: [] };
}

function provider(rowsByQuery: Record<string, RawResultRow[]>): SearchProvider {
  return vi.fn(async (q: string) => rowsByQuery[q] ?? [row(`https://x.com/${encodeURIComponent(q)}`)]);
}

describe("objective search execution controller (planner is authoritative)", () => {
  it("executes only planner-approved queries via the provider", async () => {
    const p = provider({});
    const res = await executeObjectiveSearch({ executableQueries: [query("q1", "aecom security"), query("q2", "aecom cloud")], objectiveIds: ["expand_security_portfolio"], budgetRemaining: 10, provider: p, providerReadyOverride: true });
    expect((p as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
    expect(res.trace.queries_executed).toBe(2);
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it("suppresses all execution when the provider is not configured (no calls)", async () => {
    const p = provider({});
    const res = await executeObjectiveSearch({ executableQueries: [query("q1", "aecom security")], objectiveIds: [], budgetRemaining: 10, provider: p, providerReadyOverride: false });
    expect((p as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    expect(res.trace.items[0].decision).toBe("suppress");
    expect(res.trace.items[0].reason_code).toBe("provider_not_configured");
  });

  it("enforces the daily budget (executes only within remaining budget)", async () => {
    const p = provider({});
    const res = await executeObjectiveSearch({ executableQueries: [query("q1", "a"), query("q2", "b"), query("q3", "c")], objectiveIds: [], budgetRemaining: 1, provider: p, providerReadyOverride: true });
    expect(res.trace.queries_executed).toBe(1);
    expect(res.trace.items.filter((i) => i.decision === "suppress" && i.reason_code === "daily_budget_exhausted").length).toBe(2);
  });

  it("a raw cache hit prevents a provider call", async () => {
    const q = query("q1", "aecom security");
    const p = provider({});
    await executeObjectiveSearch({ executableQueries: [q], objectiveIds: [], budgetRemaining: 10, provider: p, providerReadyOverride: true }); // seeds raw cache
    expect(await getRawCached(q.cache_key)).not.toBeNull();
    const p2 = provider({});
    const res2 = await executeObjectiveSearch({ executableQueries: [q], objectiveIds: [], budgetRemaining: 10, provider: p2, providerReadyOverride: true });
    expect((p2 as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    expect(res2.trace.raw_cache_hits).toBe(1);
    expect(res2.trace.queries_executed).toBe(0);
  });

  it("deduplicates by canonical URL and preserves query provenance", async () => {
    const shared = row("https://x.com/same");
    const p = provider({ "q one": [shared], "q two": [shared] });
    const res = await executeObjectiveSearch({ executableQueries: [query("qa", "q one"), query("qb", "q two")], objectiveIds: [], budgetRemaining: 10, provider: p, providerReadyOverride: true });
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].found_by_query_ids.sort()).toEqual(["qa", "qb"]);
  });

  it("treats a failed search as neutral, not negative", async () => {
    const failing: SearchProvider = vi.fn(async () => { throw new Error("boom"); });
    const res = await executeObjectiveSearch({ executableQueries: [query("q1", "a")], objectiveIds: [], budgetRemaining: 10, provider: failing, providerReadyOverride: true });
    expect(res.rows.length).toBe(0);
    expect(res.trace.items[0].safe_error_code).toBeTruthy();
    expect(res.trace.items[0].returned).toBe(0);
  });

  it("trace counts are accurate", async () => {
    const p = provider({});
    const res = await executeObjectiveSearch({ executableQueries: [query("q1", "a"), query("q2", "b")], objectiveIds: ["expand_security_portfolio"], budgetRemaining: 10, provider: p, providerReadyOverride: true });
    expect(res.trace.queries_planned).toBe(2);
    expect(res.trace.queries_executed + res.trace.raw_cache_hits + res.trace.queries_suppressed).toBe(2);
    expect(res.trace.budget_after).toBe(res.trace.budget_before - res.trace.queries_executed);
  });
});

describe("runObjectiveEnrichment (planner-driven serpapi_signals)", () => {
  const base = { account: "AECOM", accountDomain: "aecom.com", accountStatus: "confirmed", verdict: "REVIEW", objectiveIds: ["expand_security_portfolio"], primaryMotion: "soc_detection_response", transcriptThemes: ["incident response"], transcriptSignals: ["fragmented detection tooling"] };

  it("suppresses execution for NOISE (no provider calls)", async () => {
    const p = provider({});
    const res = await runObjectiveEnrichment({ ...base, verdict: "NOISE", provider: p, providerReadyOverride: true });
    expect((p as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    expect(res.serpapi_signals.status).toBe("not_run");
  });

  it("suppresses execution for an unresolved account", async () => {
    const p = provider({});
    const res = await runObjectiveEnrichment({ ...base, account: null, accountStatus: "unresolved", provider: p, providerReadyOverride: true });
    expect((p as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    expect(res.serpapi_signals.status).toBe("not_run");
  });

  it("executes planner queries and marks public evidence context-only (scoring_eligible=false)", async () => {
    const relevant: RawResultRow = { source_id: "", query_id: "", title: "AECOM expands security operations and detection modernization", url: "https://aecom.com/news/security", canonical_url: "https://aecom.com/news/security", domain: "aecom.com", snippet: "AECOM announced a security modernization initiative across its estate.", published_at: null, position: 0, provider: "serpapi", source_authority_hint: 0.8, raw_cache_key: "", found_by_query_ids: [] };
    const p: SearchProvider = vi.fn(async () => [relevant]);
    const res = await runObjectiveEnrichment({ ...base, provider: p, providerReadyOverride: true });
    expect((p as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    expect(res.serpapi_signals.signals.length).toBeGreaterThan(0);
    for (const s of res.serpapi_signals.signals) expect(s.scoring_eligible).toBe(false);
  });

  it("planner builds executable queries from goals + account + motion + theme", () => {
    const { queries } = buildExecutableQueries({ account: "AECOM", accountStatus: "confirmed", verdict: "REVIEW", objectiveIds: ["expand_security_portfolio"], primaryMotion: "soc_detection_response", transcriptThemes: ["incident response"], budgetRemaining: 10 });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0].query).toContain("AECOM");
    expect(queries[0].cache_key.startsWith("raw:")).toBe(true);
  });
});
