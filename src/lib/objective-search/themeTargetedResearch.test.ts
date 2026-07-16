import { describe, expect, it } from "vitest";
import { buildExecutableQueries } from "@/lib/objective-search/queryPlanner";

/**
 * Goal-aware research — profile-less runs. Without a seller profile the planner
 * uses a theme-targeted default objective so research is scoped to the
 * conversation (never generic earnings/investor queries), routed through the
 * SAME planner + budget + cache path, and suppressed consistently on NOISE and
 * unresolved accounts.
 */

const base = {
  account: "Northwind",
  accountStatus: "probable",
  verdict: "REVIEW",
  objectiveIds: ["general_account_research"],
  primaryMotion: "cloud_native_observability",
  transcriptThemes: ["cloud-native observability"],
  budgetRemaining: 8
};

describe("theme-targeted default research (no seller profile)", () => {
  it("plans conversation-theme queries, never generic earnings/investor queries", () => {
    const { plan, queries } = buildExecutableQueries(base);
    expect(plan.should_search).toBe(true);
    const qtext = queries.map((q) => q.query.toLowerCase());
    expect(qtext.length).toBeGreaterThan(0);
    expect(qtext.some((q) => q.includes("cloud-native observability"))).toBe(true);
    expect(qtext.some((q) => q.includes("earnings") || q.includes("investor"))).toBe(false);
    expect(qtext.every((q) => q.includes("northwind"))).toBe(true);
  });

  it("suppresses on NOISE (no queries planned)", () => {
    const { plan } = buildExecutableQueries({ ...base, verdict: "NOISE" });
    expect(plan.should_search).toBe(false);
    expect(plan.suppression_reason).toBe("noise");
  });

  it("suppresses account-scoped research when the account is unresolved", () => {
    const { plan } = buildExecutableQueries({ ...base, account: null, accountStatus: "unresolved" });
    expect(plan.should_search).toBe(false);
  });
});
