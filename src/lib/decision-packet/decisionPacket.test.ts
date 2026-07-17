import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

/**
 * Decision Packet — additive analytical layer. Verified on a discovery
 * transcript that states explicit decision criteria, voices objections, and
 * describes qualitative impact. The packet must decompose those into an
 * evidence-linked, confidence-scored ledger without changing any score.
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

describe("Decision Packet (additive analytical layer)", () => {
  it("decomposes explicit customer decision criteria into a categorized, grounded ledger", async () => {
    const result = await run();
    const packet = result.decision_packet;
    expect(packet).toBeTruthy();
    expect(packet!.decision_criteria.length).toBeGreaterThanOrEqual(3);
    const categories = new Set(packet!.decision_criteria.map((c) => c.category));
    expect(categories.has("security_access")).toBe(true);
    expect(categories.has("integration")).toBe(true);
    // Every criterion cites a verbatim statement that exists in the transcript.
    for (const c of packet!.decision_criteria) {
      expect(result.transcript_meta.raw_text).toContain(c.statement);
      expect(c.confidence).toBeGreaterThan(0);
    }
  });

  it("only surfaces substantive, complete quotes — no context-free fragments", async () => {
    const result = await run();
    const packet = result.decision_packet!;
    const statements = [...packet.decision_criteria.map((c) => c.statement), ...packet.objections.map((o) => o.statement)];
    for (const s of statements) {
      expect(s.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(4);
    }
    for (const fragment of ["So not zero.", "Then skills.", "Also internal politics.", "There are diagrams."]) {
      expect(statements).not.toContain(fragment);
    }
  });

  it("types objections and attaches a generic (non-fabricated) response framing", async () => {
    const result = await run();
    const packet = result.decision_packet!;
    expect(packet.objections.length).toBeGreaterThanOrEqual(1);
    for (const o of packet.objections) {
      expect(["trust", "commercial", "technical", "scope", "political", "general"]).toContain(o.type);
      expect(o.suggested_response.trim().length).toBeGreaterThan(0);
    }
  });

  it("populates evidence_quality with explicit limitations (transparency)", async () => {
    const result = await run();
    const packet = result.decision_packet!;
    expect(packet.evidence_quality.criteria_count).toBe(packet.decision_criteria.length);
    expect(packet.evidence_quality.objection_count).toBe(packet.objections.length);
    expect(packet.evidence_quality.limitations.length).toBeGreaterThan(0);
  });

  it("has an executive narrative (deterministic fallback when Circuit is not configured)", async () => {
    const result = await run();
    const packet = result.decision_packet!;
    expect(packet.narrative.text.length).toBeGreaterThan(0);
    // No Circuit in CI → deterministic narrative, grounded in the extracted labels.
    expect(packet.narrative.source).toBe("deterministic");
    expect(packet.narrative.text.toLowerCase()).toContain("decision criteria");
  });

  it("is additive — it does not change the verdict or pursuit score", async () => {
    const result = await run();
    // Baseline invariants for this fixture remain intact alongside the packet.
    expect(result.decision_packet).toBeTruthy();
    expect(result.opportunity_scoring.deal_maturity).toBe("SOLUTION_DISCOVERY");
    expect(result.account_resolution.name).toBe("CONTOSO");
  });

  it("extracts the requested workshop structure (scenarios, data sources, timing, procurement gating)", async () => {
    const result = await run();
    const wp = result.decision_packet!.workshop_plan;
    expect(wp.requested).toBe(true);
    expect(wp.format).toBe("Scenario-based working session");
    expect(wp.candidate_scenarios.length).toBeGreaterThanOrEqual(2);
    expect(wp.data_sources.length).toBeGreaterThanOrEqual(1);
    expect(wp.timing).not.toBeNull();
    // Customer said procurement does not need to join at this stage.
    expect(wp.procurement_needed).toBe(false);
  });
});

describe("Workshop plan — required participants", () => {
  const OFF2 = { enrichPublicSignals: false } as const;
  const TRANSCRIPT = [
    "Account: Northwind Engineering Group",
    "00:00 — Dana: What would a good next step look like?",
    "00:10 — Sam: In our environment a major incident can idle hundreds of specialists. I'd like a working session around two or three scenarios. Architecture, service management, and someone from enterprise risk should join, and we need security architecture, not only operations."
  ].join("\n");

  it("captures required participants stated in a participation-request context", async () => {
    const result = await runSignalAgent({ customTranscript: TRANSCRIPT, options: OFF2 });
    const wp = result.decision_packet!.workshop_plan;
    expect(wp.requested).toBe(true);
    const participants = wp.required_participants.map((p) => p.toLowerCase());
    expect(participants).toContain("service management");
    expect(participants).toContain("enterprise risk");
    expect(participants).toContain("security architecture");
  });
});
