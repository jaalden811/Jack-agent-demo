import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";
import { computePeachtreePreview } from "@/lib/webex/automation";

/**
 * Section 11 regression fixture: signal-agent-poc/data/transcripts/
 * splunk_platform_rationalization.txt — the exact supplied transcript
 * that exposed the transcript-parser regression (fake hyphen-derived
 * stakeholders, most of the transcript silently dropped before
 * scoring). Runs entirely deterministic (no OpenAI) per item 27.
 */

const FIXTURE_PATH = "signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt";
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, "utf8");
const VALID_SPEAKERS = ["Maya", "Erin", "Marcus", "Tom", "Priya", "Daniel", "Leah"];

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  clearCatalogCache();
  clearAccountsCache();
});

async function runFixture() {
  return runSignalAgent({ customTranscript: FIXTURE_TEXT, options: { useOpenAIEmbeddings: false, useOpenAISynthesis: false, useQualification: true } });
}

describe("Splunk platform rationalization fixture — parser regression (items 1-4)", () => {
  it("1. parses more than 100 turns", async () => {
    const result = await runFixture();
    expect(result.transcript_diagnostics.turns_parsed).toBeGreaterThan(100);
  });

  it("2. parses more than 100 sentences", async () => {
    const result = await runFixture();
    expect(result.transcript_diagnostics.sentences_parsed).toBeGreaterThan(100);
  });

  it("3. recognizes exactly the valid speaker names: Maya, Erin, Marcus, Tom, Priya, Daniel, Leah", async () => {
    const result = await runFixture();
    const participants = result.transcript_diagnostics.participants;
    for (const name of VALID_SPEAKERS) expect(participants).toContain(name);
    expect(participants.length).toBe(VALID_SPEAKERS.length);
  });

  it("4. no fake hyphen-derived participant exists", async () => {
    const result = await runFixture();
    const participants = result.transcript_diagnostics.participants;
    for (const fake of ["The cross", "Plus customer", "So business", "Provide a three", "Include sensitive"]) {
      expect(participants).not.toContain(fake);
    }
  });
});

describe("Splunk platform rationalization fixture — commercial/technical extraction (items 5-20)", () => {
  it("5. $1.8 million is detected", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result.commercial_signals) + JSON.stringify(result.executive_summary);
    expect(haystack).toContain("1.8 million");
  });

  it("6. October deadline is detected", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result);
    expect(haystack).toContain("October");
  });

  it("7. January renewal is detected", async () => {
    const result = await runFixture();
    expect(JSON.stringify(result.commercial_signals.renewal_events)).toContain("January");
  });

  it("8. March renewal is detected", async () => {
    const result = await runFixture();
    expect(JSON.stringify(result.commercial_signals.renewal_events)).toContain("March");
  });

  it("9. platform-rationalization funding is detected", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result.commercial_signals) + result.internal_brief + JSON.stringify(result.matches);
    expect(haystack.toLowerCase()).toContain("platform rationalization");
  });

  it("10. CIO sponsorship is detected (as an inferred functional owner, never a fabricated name)", async () => {
    const result = await runFixture();
    const cio = result.stakeholder_analysis.functional_owners.find((o) => o.function_or_role.includes("CIO"));
    expect(cio).toBeTruthy();
    expect(cio!.name).toBeNull();
  });

  it("11. VP budget control is detected", async () => {
    const result = await runFixture();
    const vp = result.stakeholder_analysis.functional_owners.find((o) => o.function_or_role.includes("Budget Authority"));
    expect(vp).toBeTruthy();
  });

  it("12. CISO authority is detected", async () => {
    const result = await runFixture();
    const ciso = result.stakeholder_analysis.functional_owners.find((o) => o.function_or_role.includes("CISO"));
    expect(ciso).toBeTruthy();
  });

  it("13. Enterprise Architecture authority is detected", async () => {
    const result = await runFixture();
    const ea = result.stakeholder_analysis.functional_owners.find((o) => o.function_or_role === "Enterprise Architecture");
    expect(ea).toBeTruthy();
  });

  it("14. procurement criteria are detected", async () => {
    const result = await runFixture();
    const namedFinance = result.stakeholder_analysis.named_stakeholders.find((s) => s.ownership_type === "finance_vendor_management");
    expect(namedFinance).toBeTruthy();
  });

  it("15. proof of value is detected", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result.matches);
    expect(haystack.toLowerCase()).toContain("proof-of-value");
  });

  it("16. under-20-minute success criterion is detected", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result.matches);
    expect(haystack).toContain("20 minutes");
  });

  it("17. OpenTelemetry is detected", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result.matches);
    expect(haystack).toContain("OpenTelemetry");
  });

  it("18. Splunk discussion is detected", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result.matches[0]?.recommended_solutions);
    expect(haystack).toContain("Splunk");
  });

  it("19. routing/filtering/tiering requirements are detected", async () => {
    const result = await runFixture();
    const haystack = JSON.stringify(result.matches);
    expect(haystack.toLowerCase()).toMatch(/routing|filtering|tiering/);
  });

  it("20. next-session request is detected", async () => {
    const result = await runFixture();
    const haystack = result.internal_brief + JSON.stringify(result.matches) + result.executive_summary.recommended_next_action;
    expect(haystack.toLowerCase()).toMatch(/next session|working session|reconvene|next step/);
  });
});

describe("Splunk platform rationalization fixture — verdict and dominance logic (items 21-26)", () => {
  it("21. verdict is not NOISE", async () => {
    const result = await runFixture();
    expect(result.executive_summary.verdict).not.toBe("NOISE");
  });

  it("22. Identity/ISE is not primary", async () => {
    const result = await runFixture();
    expect(result.matches[0]?.entry_id).not.toBe("identity_zero_trust");
    expect(result.executive_summary.primary_opportunity).not.toContain("Identity security");
  });

  it("23. primary solution is not suppressed", async () => {
    const result = await runFixture();
    expect(result.matches[0]?.recommended_solutions.length ?? 0).toBeGreaterThan(0);
  });

  it("24. Splunk/data-platform/log-management motion is primary", async () => {
    const result = await runFixture();
    expect(result.matches[0]?.entry_id).toBe("siem_compliance");
    expect(result.executive_summary.primary_opportunity).toContain("SIEM");
  });

  it("25. observability/security analytics are secondary/supporting", async () => {
    const result = await runFixture();
    const secondaryIds = result.matches.slice(1).map((m) => m.entry_id);
    expect(secondaryIds.length).toBeGreaterThan(0);
    expect(secondaryIds).toContain("cloud_native_observability");
  });

  it("26. at least one sales and one technical action are routed", async () => {
    const result = await runFixture();
    const preview = await computePeachtreePreview(result);
    const lanes = preview.routing.map((r) => r.lane);
    expect(lanes).toContain("sales");
    expect(lanes).toContain("technical");
  });
});

describe("Splunk platform rationalization fixture — deterministic robustness (items 27-30)", () => {
  it("27. deterministic mode passes without OpenAI (analysis_mode is deterministic)", async () => {
    const result = await runFixture();
    expect(result.providers.analysis_mode).toBe("deterministic");
    expect(result.ai_processing.openai_configured).toBe(false);
  });

  it("28. OpenAI unavailability does not change the deterministic primary mapping", async () => {
    // Run twice with OpenAI unconfigured both times — the deterministic
    // primary mapping must be stable and identical.
    const first = await runFixture();
    const second = await runFixture();
    expect(first.matches[0]?.entry_id).toBe(second.matches[0]?.entry_id);
    expect(first.matches[0]?.entry_id).toBe("siem_compliance");
  });

  it("29. the parser-incomplete guard does not fire for this real, substantial transcript", async () => {
    const result = await runFixture();
    expect(result.transcript_diagnostics.raw_characters).toBeGreaterThan(5000);
    expect(result.transcript_diagnostics.sentences_parsed).toBeGreaterThanOrEqual(20);
  });

  it("30. fake stakeholders cannot reach MEDDPICC or outbound messages", async () => {
    const result = await runFixture();
    const preview = await computePeachtreePreview(result);
    const haystack = JSON.stringify(result.meddpicc) + preview.messages.map((m) => m.markdown).join(" ");
    for (const fake of ["The cross", "Plus customer", "So business", "Provide a three", "Include sensitive"]) {
      expect(haystack).not.toContain(fake);
    }
  });
});
