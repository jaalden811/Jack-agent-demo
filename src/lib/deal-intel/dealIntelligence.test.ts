import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { buildDealIntelligence } from "@/lib/deal-intel/buildDealIntelligence";
import { ingestTranscript } from "@/lib/signal-agent/transcript";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";
import type { AccountRecord } from "@/lib/signal-agent/types";
import type { NormalizedPublicSignal, SerpApiSignalsResult } from "@/lib/opportunity-fit/types";

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

  it("builds an evidence-cited stakeholder power map (who to work, and how)", async () => {
    const di = (await run()).deal_intelligence!;
    expect(di.power_map.length).toBeGreaterThan(0);
    // Every entry names a real stakeholder, has a role + play, and cites evidence.
    for (const p of di.power_map) {
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.play.trim().length).toBeGreaterThan(0);
      expect(["business_champion", "cost_gatekeeper", "security_risk_owner", "technical_evaluator", "influencer"]).toContain(p.role_id);
    }
    // The CONTOSO fixture has distinct personas — at least two different roles.
    expect(new Set(di.power_map.map((p) => p.role_id)).size).toBeGreaterThanOrEqual(2);
  });

  it("is additive — deterministic scores/verdict remain intact", async () => {
    const result = await run();
    expect(result.deal_intelligence).toBeTruthy();
    expect(result.opportunity_scoring.deal_maturity).toBe("SOLUTION_DISCOVERY");
    expect(result.account_resolution.name).toBe("CONTOSO");
    // public_context is always present (empty when enrichment is off).
    expect(Array.isArray(result.deal_intelligence!.public_context)).toBe(true);
  });

  it("distills narrative-eligible public research into public_context (with source)", async () => {
    // Take advantage of the environment: when public research surfaces a
    // narrative-eligible fact, it becomes a distilled, sourced deal-intel signal.
    const text = readFileSync(FIXTURE, "utf8");
    const result = await run();
    const transcript = ingestTranscript(text);
    const account = { openOpportunity: false, budgetSignal: null } as unknown as AccountRecord;

    const eligible = { claim: "CONTOSO is a global firm expanding its AI resilience program", source_title: "CONTOSO investor update", source_url: "https://investors.contoso.com/ai", narrative_eligible: true } as unknown as NormalizedPublicSignal;
    const rejected = { claim: "unrelated aggregator listing", source_title: "jobs.example", source_url: "https://jobs.example/x", narrative_eligible: false } as unknown as NormalizedPublicSignal;
    result.serpapi_signals = { status: "completed", reason: null, queries: [], signals: [eligible, rejected], strong_signal_count: 1, supporting_signal_count: 0, weak_signal_count: 0, rejected_result_count: 1 } as SerpApiSignalsResult;

    const di = buildDealIntelligence({ result, account, transcript });
    // Only the narrative-eligible signal is distilled, and it carries its source.
    expect(di.public_context.length).toBe(1);
    expect(di.public_context[0].label).toContain("AI resilience program");
    expect(di.public_context[0].evidence).toBe("CONTOSO investor update");
  });
});
