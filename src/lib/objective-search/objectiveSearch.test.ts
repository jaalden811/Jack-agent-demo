import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planObjectiveSearch } from "@/lib/objective-search/queryPlanner";
import { distillPublicSignals, type RawSignalCandidate } from "@/lib/objective-search/signalDistiller";
import { getBudgetState, recordQuerySpend, loadSearchBudgetPolicy } from "@/lib/objective-search/searchBudget";

function baseInput(overrides = {}) {
  return {
    account: "AECOM",
    accountStatus: "confirmed",
    verdict: "REVIEW",
    objectiveIds: ["expand_security_portfolio"],
    primaryMotion: "soc_detection_response",
    transcriptThemes: ["incident response"],
    budgetRemaining: 100,
    ...overrides
  };
}

describe("objective-aware query planner", () => {
  it("plans queries from objective + account + motion + transcript theme", () => {
    const plan = planObjectiveSearch(baseInput());
    expect(plan.should_search).toBe(true);
    expect(plan.planned_queries.length).toBeGreaterThan(0);
    expect(plan.planned_queries[0].query).toContain("AECOM");
    expect(plan.objective_ids).toContain("expand_security_portfolio");
  });

  it("suppresses account-specific search when the account is unresolved", () => {
    const plan = planObjectiveSearch(baseInput({ account: null, accountStatus: "unresolved" }));
    expect(plan.should_search).toBe(false);
    expect(plan.suppression_reason).toBe("unresolved_account");
  });

  it("suppresses enrichment for NOISE", () => {
    const plan = planObjectiveSearch(baseInput({ verdict: "NOISE" }));
    expect(plan.should_search).toBe(false);
    expect(plan.suppression_reason).toBe("noise");
  });

  it("enforces the query budget", () => {
    const plan = planObjectiveSearch(baseInput({ objectiveIds: ["grow_strategic_accounts", "expand_security_portfolio"], budgetRemaining: 1 }));
    expect(plan.queries_planned).toBeLessThanOrEqual(1);
    expect(plan.budget_remaining).toBeLessThanOrEqual(1);
  });

  it("reuses cached raw searches instead of re-planning execution", () => {
    const first = planObjectiveSearch(baseInput());
    const cachedKeys = new Set(first.planned_queries.map((q) => q.cache_key));
    const second = planObjectiveSearch({ ...baseInput(), cachedKeys });
    expect(second.cache_hits).toBeGreaterThan(0);
    expect(second.queries_planned).toBe(0);
  });

  it("raw cache key is independent of the classification version (changing classification reuses the raw search)", () => {
    const plan = planObjectiveSearch(baseInput());
    expect(plan.planned_queries[0].cache_key.startsWith("raw:")).toBe(true);
    expect(plan.planned_queries[0].cache_key).not.toContain(loadSearchBudgetPolicy().derived_classification_cache_version);
  });
});

describe("signal distiller", () => {
  const candidates: RawSignalCandidate[] = [
    { id: "s1", url: "https://a.com/1", title: "Strong relevant fact", snippet: "x", account_relevance: 0.9, opportunity_relevance: 0.8 },
    { id: "s2", url: "https://a.com/2", title: "Supporting fact", snippet: "y", account_relevance: 0.6, opportunity_relevance: 0.5 },
    { id: "s3", url: "https://a.com/3", title: "Another relevant", snippet: "z", account_relevance: 0.7, opportunity_relevance: 0.6 },
    { id: "s4", url: "https://a.com/4", title: "Irrelevant", snippet: "n", account_relevance: 0.1, opportunity_relevance: 0.05 }
  ];

  it("drops irrelevant results and caps to the primary limit (<=3)", () => {
    const distilled = distillPublicSignals(candidates);
    expect(distilled.length).toBeLessThanOrEqual(3);
    expect(distilled.some((d) => d.source_id === "s4")).toBe(false);
  });

  it("public evidence is account-context/narrative eligible but never scoring-eligible (neutral, not negative)", () => {
    const distilled = distillPublicSignals(candidates);
    for (const d of distilled) {
      expect(d.eligibility.scoring).toBe(false);
      expect(d.eligibility.account_context).toBe(true);
      expect(d.limitation).toMatch(/never confirms private/i);
    }
  });

  it("returns nothing (not a negative signal) when no candidate is relevant", () => {
    expect(distillPublicSignals([candidates[3]])).toEqual([]);
  });
});

describe("app-observed search budget", () => {
  let originalDataDir: string | undefined;
  beforeEach(async () => {
    originalDataDir = process.env.LOCAL_DATA_DIR;
    process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "budget-test-"));
  });
  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
    else process.env.LOCAL_DATA_DIR = originalDataDir;
  });

  it("tracks app-observed consumption against the daily budget", async () => {
    const before = await getBudgetState();
    await recordQuerySpend(3);
    const after = await getBudgetState();
    expect(after.used).toBe(before.used + 3);
    expect(after.remaining).toBe(before.remaining - 3);
  });
});
