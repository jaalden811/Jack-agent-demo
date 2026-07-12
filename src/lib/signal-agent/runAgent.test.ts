import { beforeEach, describe, expect, it } from "vitest";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache, getCatalog } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_EMBEDDING_MODEL;
  clearCatalogCache();
  clearAccountsCache();
});

const OFF = { useOpenAIEmbeddings: false, useOpenAISynthesis: false };

describe("runSignalAgent — HIGH_INTENT demo (collaboration)", () => {
  it("returns HIGH_INTENT or REVIEW with a non-null solution and specialist", async () => {
    const result = await runSignalAgent({ transcriptId: "high_intent", options: OFF });

    expect(["HIGH_INTENT", "REVIEW"]).toContain(result.executive_summary.verdict);
    expect(result.matches[0].recommended_solutions.length).toBeGreaterThan(0);
    expect(result.recommended_specialists.length).toBeGreaterThan(0);
    expect(result.providers.semantic_mode).toBe("fallback");
    expect(result.audit.path).toContain("signal_log.jsonl");
  });
});

describe("runSignalAgent — NOISE demo", () => {
  it("returns NOISE and does not notify anyone", async () => {
    const result = await runSignalAgent({ transcriptId: "noise", options: OFF });

    expect(result.executive_summary.verdict).toBe("NOISE");
    expect(result.matches[0].recommended_specialist).toBeNull();
    expect(result.matches[0].recommended_solutions).toEqual([]);
  });
});

describe("runSignalAgent — THE REGRESSION FIXTURE: secure networking deal signal", () => {
  it("is not classified as NOISE and reaches at least REVIEW", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });

    expect(result.executive_summary.verdict).not.toBe("NOISE");
    expect(["REVIEW", "HIGH_INTENT"]).toContain(result.executive_summary.verdict);
  });

  it("matches cross_domain_network_operations as the primary label", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    expect(result.matches[0].entry_id).toBe("cross_domain_network_operations");
  });

  it("includes internet_saas_assurance among the secondary/supporting labels", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    const entryIds = result.matches.map((match) => match.entry_id);
    expect(entryIds).toContain("internet_saas_assurance");
  });

  it("does not penalize 'not just curious' (negated negative)", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    const allNegativeCues = result.matches.flatMap((match) => match.negative_cues);
    const curiousResult = allNegativeCues.find((cue) => cue.phrase === "just curious");
    expect(curiousResult).toBeDefined();
    expect(curiousResult?.polarity).toBe("negated_negative");
    expect(curiousResult?.penalty).toBe(0);
  });

  it("detects budget, timeline, executive ownership, quantified impact, and renewal evidence", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    expect(result.commercial_signals.budget).toBeTruthy();
    expect(result.commercial_signals.timeline).toBeTruthy();
    expect(result.commercial_signals.quantified_impact.length).toBeGreaterThan(0);
    expect(result.commercial_signals.renewal_events.length).toBeGreaterThan(0);
    expect(result.stakeholders.some((s) => s.ownership_type === "executive")).toBe(true);
  });

  it("classifies stakeholders by role text, not by mid-word acronym substrings (e.g. 'director' must not match 'cto')", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    const engineeringDirector = result.stakeholders.find((s) => s.role.toLowerCase().includes("network engineering"));
    const securityDirector = result.stakeholders.find((s) => s.role.toLowerCase().includes("security operations"));
    expect(engineeringDirector?.ownership_type).toBe("technical");
    expect(securityDirector?.ownership_type).toBe("security");
  });

  it("detects architecture-workshop and purchase-this-quarter language", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    const allIntentEvidence = result.matches.flatMap((match) => match.intent_evidence);
    expect(allIntentEvidence.some((item) => item.text.toLowerCase().includes("workshop"))).toBe(true);
    expect(result.commercial_signals.purchase_language.length).toBeGreaterThan(0);
  });

  it("recommends at least two specialists", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    expect(result.recommended_specialists.length).toBeGreaterThanOrEqual(2);
  });

  it("never flags a product as an 'adjacent solution to exclude' when that entry already recommends it as primary", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    for (const match of result.matches) {
      const ownPrimaryNames = new Set(match.recommended_solutions.map((name) => name.toLowerCase()));
      for (const decision of match.solution_decision.adjacent_solutions_considered) {
        expect(ownPrimaryNames.has(decision.solution.toLowerCase())).toBe(false);
      }
    }
  });

  it("does not assert unsupported do-not-choose statements as customer facts", async () => {
    const result = await runSignalAgent({ transcriptId: "secure_networking_triage", options: OFF });
    for (const match of result.matches) {
      for (const rule of match.solution_decision.do_not_choose_conflicts) {
        if (rule.status !== "not_evidenced") {
          expect(rule.evidence).toBeTruthy();
        }
      }
    }
  });
});

describe("runSignalAgent — negation/polarity regression examples", () => {
  const transcriptFor = (sentence: string) =>
    ["Account: Polarity Test Co", "Participants: Jamie Lee (Customer, IT Director)", "", `[Jamie Lee]: ${sentence}`].join("\n");

  it("'We are just curious.' is negative", async () => {
    const result = await runSignalAgent({ customTranscript: transcriptFor("We are just curious."), options: OFF });
    const cue = result.matches.flatMap((m) => m.negative_cues).find((c) => c.phrase === "just curious");
    expect(cue?.polarity).toBe("negative");
    expect(cue?.penalty).toBeGreaterThan(0);
  });

  it("'We are not just curious.' is negated_negative (positive)", async () => {
    const result = await runSignalAgent({ customTranscript: transcriptFor("We are not just curious."), options: OFF });
    const cue = result.matches.flatMap((m) => m.negative_cues).find((c) => c.phrase === "just curious");
    expect(cue?.polarity).toBe("negated_negative");
    expect(cue?.penalty).toBe(0);
  });

  it("'This is not funded.' is negative", async () => {
    const result = await runSignalAgent({ customTranscript: transcriptFor("This is not funded."), options: OFF });
    const cue = result.matches.flatMap((m) => m.negative_cues).find((c) => c.phrase === "not funded");
    expect(cue?.polarity).toBe("negative");
  });

  it("'This is not a future-year placeholder.' is negated_negative (positive)", async () => {
    const result = await runSignalAgent({
      customTranscript: transcriptFor("This is not a future-year placeholder."),
      options: OFF
    });
    const cue = result.matches.flatMap((m) => m.negative_cues).find((c) => c.phrase === "future-year placeholder");
    expect(cue?.polarity).toBe("negated_negative");
  });

  it("'We are not evaluating this year.' is negative", async () => {
    const result = await runSignalAgent({ customTranscript: transcriptFor("We are not evaluating this year."), options: OFF });
    const cue = result.matches.flatMap((m) => m.negative_cues).find((c) => c.phrase === "not evaluating");
    expect(cue?.polarity).toBe("negative");
  });

  it("'The presenter showed an XDR slide.' is hypothetical", async () => {
    const result = await runSignalAgent({
      customTranscript: transcriptFor("The presenter showed an XDR slide."),
      options: OFF
    });
    const cue = result.matches.flatMap((m) => m.negative_cues).find((c) => c.phrase === "presenter showed");
    expect(cue?.polarity).toBe("hypothetical");
  });

  it("'We are evaluating XDR after a recent incident.' raises no negative cue at all", async () => {
    const result = await runSignalAgent({
      customTranscript: transcriptFor("We are evaluating XDR after a recent incident."),
      options: OFF
    });
    const cues = result.matches.flatMap((m) => m.negative_cues);
    expect(cues.some((c) => c.polarity === "negative")).toBe(false);
  });
});

describe("runSignalAgent — transcript-only mode exception", () => {
  it("caps a weak transcript-only signal at REVIEW rather than promoting to HIGH_INTENT without evidence", async () => {
    const transcript = [
      "Account: Totally Unknown Company",
      "Participants: Alex Kim (Customer, IT Lead)",
      "",
      "[Alex Kim]: We have too many alerts to triage and our analysts jump between tools during every incident."
    ].join("\n");

    const result = await runSignalAgent({ customTranscript: transcript, options: OFF });
    expect(result.executive_summary.verdict).not.toBe("HIGH_INTENT");
    expect(result.executive_summary.account).toBe("Totally Unknown Company");
  });
});

describe("getCatalog — dynamic taxonomy loading", () => {
  it("loads all entries from the Cisco mapping JSON rather than a hard-coded list", () => {
    const catalog = getCatalog();
    expect(catalog.source).toBe("cisco_mapping");
    expect(catalog.entries.length).toBeGreaterThanOrEqual(30);
    const ids = catalog.entries.map((entry) => entry.id);
    expect(ids).toContain("soc_detection_response");
    expect(ids).toContain("cross_domain_network_operations");
    expect(ids).toContain("internet_saas_assurance");
  });

  it("parses numeric weights and gates from matching_configuration instead of using literals", () => {
    const catalog = getCatalog();
    expect(catalog.matchingConfig.weights.keyword).toBeCloseTo(0.2, 5);
    expect(catalog.matchingConfig.weights.semantic).toBeCloseTo(0.45, 5);
    expect(catalog.matchingConfig.gates.highIntent.confidence).toBeCloseTo(0.78, 5);
    expect(catalog.matchingConfig.gates.review.min).toBeCloseTo(0.62, 5);
  });
});
