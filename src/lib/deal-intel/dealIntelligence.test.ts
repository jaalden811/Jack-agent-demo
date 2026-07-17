import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

/**
 * Deal Intelligence — honest, evidence-cited read of the deal shape, momentum,
 * and landmines. Verified on the CONTOSO discovery fixture (existing Splunk
 * footprint, cross-domain fragmentation, an exec-sponsored resilience program,
 * distributed budgets, and data sovereignty).
 */

const OFF = { enrichPublicSignals: false } as const;
const FIXTURE = "signal-agent-poc/data/transcripts/discovery_negated_org_scenario_signal.txt";

beforeEach(() => {
  clearCatalogCache();
  clearAccountsCache();
});

async function run() {
  return runSignalAgent({ customTranscript: readFileSync(FIXTURE, "utf8"), options: OFF });
}

describe("Deal Intelligence", () => {
  it("reads the deal shape (expansion / consolidation), grounded in evidence", async () => {
    const di = (await run()).deal_intelligence!;
    expect(di).toBeTruthy();
    expect(di.deal_shape.tags.length).toBeGreaterThan(0);
    // Existing Splunk + fragmentation → an expansion/consolidation play, not net-new.
    expect(di.deal_shape.tags.some((t) => t === "expansion" || t === "consolidation")).toBe(true);
    expect(di.headline).toContain("CONTOSO");
  });

  it("surfaces momentum and landmines, each citing the customer's own words", async () => {
    const di = (await run()).deal_intelligence!;
    expect(di.momentum.length).toBeGreaterThan(0);
    expect(di.risks.length).toBeGreaterThan(0);
    // A customer-requested next step is the strongest momentum.
    expect(di.momentum.some((m) => m.id === "requested_next_step")).toBe(true);
    // Distributed budgets / sovereignty / decentralization are real landmines here.
    expect(di.risks.some((r) => ["no_single_eb", "sovereignty", "decentralized_control"].includes(r.id))).toBe(true);
    // Every surfaced signal carries evidence text.
    for (const s of [...di.momentum, ...di.risks]) expect(s.evidence.trim().length).toBeGreaterThan(0);
  });

  it("is additive — deterministic scores/verdict remain intact", async () => {
    const result = await run();
    expect(result.deal_intelligence).toBeTruthy();
    expect(result.opportunity_scoring.deal_maturity).toBe("SOLUTION_DISCOVERY");
    expect(result.account_resolution.name).toBe("CONTOSO");
  });
});
