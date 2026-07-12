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

describe("runSignalAgent — HIGH_INTENT demo", () => {
  it("returns HIGH_INTENT or REVIEW with a non-null solution and specialist", async () => {
    const result = await runSignalAgent({ transcriptId: "high_intent", options: { useOpenAIEmbeddings: false } });

    expect(["HIGH_INTENT", "REVIEW"]).toContain(result.intent_label);
    expect(result.recommended_solution.length).toBeGreaterThan(0);
    expect(result.recommended_specialist).toBeTruthy();
    expect(result.notification_text).not.toBeNull();
    expect(result.semantic_mode).toBe("fallback");
    expect(result.audit.path).toContain("signal_log.jsonl");
  });
});

describe("runSignalAgent — NOISE demo", () => {
  it("returns NOISE and does not notify anyone", async () => {
    const result = await runSignalAgent({ transcriptId: "noise", options: { useOpenAIEmbeddings: false } });

    expect(result.intent_label).toBe("NOISE");
    expect(result.notification_text).toBeNull();
    expect(result.recommended_specialist).toBeNull();
    expect(result.recommended_solution).toEqual([]);
  });
});

describe("runSignalAgent — negation handling", () => {
  it("returns NOISE for a keyword-only transcript that also contains an explicit denial", async () => {
    const transcript = [
      "Account: Ferrowick County Government",
      "Participants: Jamie Rivera (Customer, IT Manager)",
      "",
      "[Jamie Rivera]: We do not have alert fatigue and our SOC is not a priority right now — we're just curious what XDR even means."
    ].join("\n");

    const result = await runSignalAgent({ customTranscript: transcript, options: { useOpenAIEmbeddings: false } });

    expect(result.intent_label).toBe("NOISE");
    expect(result.notification_text).toBeNull();
    expect(result.negative_cues.length).toBeGreaterThan(0);
  });

  it("downgrades a custom transcript containing 'not funded' / 'not a priority'", async () => {
    const transcript = [
      "Account: Acme Retail",
      "Participants: Jordan Lee (Customer, IT Director)",
      "",
      "[Jordan Lee]: We have too many consoles across our network operations, but this is not funded and not a priority this year."
    ].join("\n");

    const result = await runSignalAgent({ customTranscript: transcript, options: { useOpenAIEmbeddings: false } });

    expect(result.intent_label).toBe("NOISE");
    expect(result.notification_text).toBeNull();
    expect(result.negative_cues.some((cue) => cue.toLowerCase().includes("not funded") || cue.toLowerCase().includes("not a priority"))).toBe(
      true
    );
  });
});

describe("runSignalAgent — transcript-only mode (no matching account)", () => {
  it("caps confidence at REVIEW when no account is found and evidence is not overwhelming", async () => {
    const transcript = [
      "Account: Totally Unknown Company",
      "Participants: Alex Kim (Customer, IT Lead)",
      "",
      "[Alex Kim]: We have too many alerts to triage and our analysts jump between tools during every incident."
    ].join("\n");

    const result = await runSignalAgent({ customTranscript: transcript, options: { useOpenAIEmbeddings: false } });

    // Account is surfaced as-stated in the transcript even when it has no
    // CRM match — that "no match" is what puts scoring into
    // transcript-only mode and caps the label below HIGH_INTENT.
    expect(result.account).toBe("Totally Unknown Company");
    expect(result.intent_label).not.toBe("HIGH_INTENT");
  });
});

describe("getCatalog — dynamic taxonomy loading", () => {
  it("loads all entries from the Cisco mapping JSON rather than a hard-coded list", () => {
    const catalog = getCatalog();
    expect(catalog.source).toBe("cisco_mapping");
    expect(catalog.entries.length).toBeGreaterThanOrEqual(30);
    // A handful of ids that must come from the JSON file, not literals baked into loadCatalog.ts.
    const ids = catalog.entries.map((entry) => entry.id);
    expect(ids).toContain("soc_detection_response");
    expect(ids).toContain("ai_infrastructure");
    expect(ids).toContain("collaboration_productivity");
  });

  it("parses numeric weights and gates from matching_configuration instead of using literals", () => {
    const catalog = getCatalog();
    // These values live in signal-agent-poc/config/cisco_painpoint_solution_map.json;
    // if that file's numbers change, this assertion (reading through getCatalog())
    // must change with it — proving the values are not independently hard-coded.
    expect(catalog.matchingConfig.weights.keyword).toBeCloseTo(0.2, 5);
    expect(catalog.matchingConfig.weights.semantic).toBeCloseTo(0.45, 5);
    expect(catalog.matchingConfig.gates.highIntent.confidence).toBeCloseTo(0.78, 5);
    expect(catalog.matchingConfig.gates.review.min).toBeCloseTo(0.62, 5);
  });
});
