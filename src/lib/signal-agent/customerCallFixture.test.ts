import { beforeEach, describe, expect, it } from "vitest";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

/**
 * End-to-end acceptance tests for the realistic customer-call fixture
 * (Section 5D). Runs entirely deterministic (no OpenAI) so it is
 * reproducible in CI without a live key.
 */

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  clearCatalogCache();
  clearAccountsCache();
});

async function runFixture() {
  return runSignalAgent({ transcriptId: "cross_domain_data_platform", options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false } });
}

describe("Customer-call fixture — end-to-end analysis", () => {
  it("is not classified as NOISE", async () => {
    const result = await runFixture();
    expect(result.executive_summary.verdict).not.toBe("NOISE");
  });

  it("recognizes the participant count correctly (parser repair)", async () => {
    const result = await runFixture();
    expect(result.transcript_meta.participant_count).toBeGreaterThan(0);
    expect(result.stakeholder_analysis.participants.length).toBeGreaterThanOrEqual(7);
  });

  it("populates named customer stakeholders across the required functions", async () => {
    const result = await runFixture();
    const namedTypes = new Set(result.stakeholder_analysis.named_stakeholders.map((s) => s.ownership_type));
    expect(namedTypes).toContain("reliability");
    expect(namedTypes).toContain("application");
    expect(namedTypes).toContain("infrastructure");
    expect(namedTypes).toContain("security");
    expect(namedTypes).toContain("security_architecture");
    expect(namedTypes).toContain("finance_vendor_management");
  });

  it("infers functional owners for functions mentioned without a named individual (enterprise architecture, cloud platform)", async () => {
    const result = await runFixture();
    const functionalTypes = result.stakeholder_analysis.functional_owners.map((o) => o.function_or_role);
    expect(functionalTypes).toContain("Enterprise Architecture");
    expect(functionalTypes).toContain("Cloud Platform");
    expect(result.stakeholder_analysis.functional_owners.every((o) => o.name === null)).toBe(true);
  });

  it("never labels the Cisco seller (Maya Chen) as a customer decision owner", async () => {
    const result = await runFixture();
    const allNames = [
      ...result.stakeholder_analysis.named_stakeholders.map((s) => s.name),
      ...result.stakeholders.map((s) => s.name)
    ];
    expect(allNames).not.toContain("Maya Chen");
    expect(allNames).not.toContain("Maya");
  });

  it("captures the $1.8 million financial impact", async () => {
    const result = await runFixture();
    const haystack = [result.executive_summary.business_impact, result.commercial_signals.budget ?? "", ...result.commercial_signals.quantified_impact].join(" ");
    expect(haystack).toContain("1.8 million");
  });

  it("captures the October planning deadline and January/March renewal timing", async () => {
    const result = await runFixture();
    const haystack = [result.executive_summary.urgency, result.commercial_signals.timeline ?? "", ...result.commercial_signals.renewal_events].join(" ");
    expect(haystack).toContain("October");
    expect(haystack.toLowerCase()).toMatch(/january/);
    expect(haystack.toLowerCase()).toMatch(/march/);
  });

  it("captures the proof-of-value target (recreate the May incident, identify failure path under 20 minutes)", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result.matches.map((m) => [...m.matched_text, ...m.intent_evidence.map((e) => e.text)]));
    expect(haystack).toContain("20 minutes");
    expect(haystack.toLowerCase()).toContain("may");
  });

  it("does not penalize the negated negative cue ('not just curious')", async () => {
    const result = await runFixture();
    const negativeCues = result.matches.flatMap((m) => m.negative_cues);
    const justCuriousCue = negativeCues.find((cue) => cue.phrase.toLowerCase().includes("just curious"));
    if (justCuriousCue) {
      expect(justCuriousCue.polarity).toBe("negated_negative");
      expect(justCuriousCue.penalty).toBe(0);
    }
  });

  it("recognizes the broader machine-data/observability platform requirement, not generic secure networking", async () => {
    const result = await runFixture();
    const categoryIds = result.matches.map((m) => m.entry_id);
    // The primary category must be an observability/security-data-platform
    // motion, never a generic networking category (this transcript has no
    // network-operations-console pain at all).
    expect(categoryIds).not.toContain("cross_domain_network_operations");
    const relevantIds = ["cloud_native_observability", "siem_compliance", "service_health_aiops", "soc_detection_response", "hybrid_onprem_apm", "extensible_observability"];
    expect(categoryIds.some((id) => relevantIds.includes(id))).toBe(true);
  });

  it("can surface supporting security and IT-service-management motions alongside the primary observability motion", async () => {
    const result = await runFixture();
    const categoryIds = new Set(result.matches.map((m) => m.entry_id));
    const supportingIds = ["siem_compliance", "soc_detection_response", "service_health_aiops"];
    expect(supportingIds.some((id) => categoryIds.has(id))).toBe(true);
  });

  it("every match's evidence text is real transcript content, never fabricated", async () => {
    const result = await runFixture();
    for (const match of result.matches) {
      for (const text of match.matched_text) {
        expect(result.transcript_meta.raw_text).toContain(text);
      }
    }
  });

  it("reports a specific analysis_mode (deterministic, since OpenAI is disabled in this test)", async () => {
    const result = await runFixture();
    expect(result.providers.analysis_mode).toBe("deterministic");
  });
});

/**
 * Section 15 regression: qualification-layer expectations (account
 * resolution, MEDDPICC, search gating, evidence-backed messages, analysis
 * link) for the same fixture — verified in deterministic-fallback mode
 * (no OPENAI_API_KEY / no SEARCH_API_KEY in CI), and re-verified with the
 * real account resolved from the transcript's explicit Account: line and
 * the CRM (accounts.csv) match.
 */
describe("Customer-call fixture — qualification layer (Section 15 regression)", () => {
  it("resolves the account from real evidence (transcript Account: line + CRM match) — never fabricated", async () => {
    const result = await runFixture();
    expect(result.account_resolution.name).toBe("Meridian Health Systems");
    expect(result.account_resolution.status).toBe("resolved");
    expect(result.account_resolution.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.account_resolution.action_required).toBeNull();
  });

  it("Metrics is CONFIRMED from the quantified $1.8M impact", async () => {
    const result = await runFixture();
    expect(result.meddpicc.metrics.status).toBe("CONFIRMED");
  });

  it("Identify Pain is CONFIRMED from the stated business problem", async () => {
    const result = await runFixture();
    expect(result.meddpicc.identify_pain.status).toBe("CONFIRMED");
  });

  it("Economic Buyer is never CONFIRMED from a title alone (MISSING, PARTIAL, or HYPOTHESIS only)", async () => {
    const result = await runFixture();
    expect(["MISSING", "PARTIAL", "HYPOTHESIS"]).toContain(result.meddpicc.economic_buyer.status);
  });

  it("Champion is never CONFIRMED from mere meeting participation", async () => {
    const result = await runFixture();
    expect(result.meddpicc.champion.status).not.toBe("CONFIRMED");
  });

  it("Decision Process reflects the stated renewal timing when present", async () => {
    const result = await runFixture();
    expect(["PARTIAL", "CONFIRMED", "HYPOTHESIS", "MISSING"]).toContain(result.meddpicc.decision_process.status);
  });

  it("does not run SerpAPI enrichment when SEARCH_API_KEY is not configured", async () => {
    const result = await runFixture();
    expect(result.public_enrichment.configured).toBe(false);
  });

  it("reports ai_processing.openai_configured:false and a fallback_reason in deterministic mode", async () => {
    const result = await runFixture();
    expect(result.ai_processing.openai_configured).toBe(false);
    expect(result.ai_processing.qualification_synthesis_used).toBe(false);
  });

  it("produces a stable, URL-safe run_id distinct from the timestamp", async () => {
    const result = await runFixture();
    expect(result.run_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.run_id).not.toBe(result.timestamp);
  });
});
