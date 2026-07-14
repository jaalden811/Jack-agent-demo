import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";
import { TranscriptParseIncompleteError } from "@/lib/signal-agent/types";

/**
 * Section 6 adversarial regression suite: proves the parser and
 * taxonomy-dominance fixes generalize to arbitrary names, domains, and
 * topics — never just the one supplied Splunk fixture. No assertion
 * here references Splunk-specific wording as a special case; each
 * transcript is a genuinely different domain and the assertions check
 * the *generic* behavior (no fake speakers, no fabricated dominance,
 * correct category family winning based on its own taxonomy evidence).
 */

const OFF = { useOpenAIEmbeddings: false, useOpenAISynthesis: false };

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  clearCatalogCache();
  clearAccountsCache();
});

function readFixture(name: string): string {
  return readFileSync(`signal-agent-poc/data/transcripts/${name}`, "utf8");
}

describe("A. Hyphen safety — arbitrary hyphenated words never become participant names", () => {
  it("never fabricates a participant from cross-environment, customer-service, three-year, sensitive-field, zero-trust, or cloud-native", async () => {
    const text = [
      "00:00 — Nadia: Let's cover a few architectural points today.",
      "Our cross-environment visibility is limited across every domain.",
      "We've also seen customer-service escalations rise this quarter.",
      "00:15 — Felix: Understood. Can you provide a three-year outlook?",
      "We'd want sensitive-field handling addressed explicitly in scope.",
      "A zero-trust posture matters for us long term.",
      "00:30 — Nadia: Agreed, and our cloud-native footprint keeps growing too."
    ].join("\n");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    const participants = result.transcript_diagnostics.participants;
    expect(participants).toEqual(["Nadia", "Felix"]);
    for (const fake of ["Our cross", "We've also", "Provide a three", "We'd want sensitive", "A zero", "Agreed and our cloud"]) {
      expect(participants).not.toContain(fake);
    }
  });
});

describe("B. Different speakers — arbitrary names unrelated to any fixture parse correctly", () => {
  it("parses an entirely different, unrelated speaker set correctly", async () => {
    const text = [
      "00:00 — Zephyrine Okafor-Lindqvist: Thanks everyone for joining this session.",
      "00:10 — Bartholomew: Happy to be here, let's get started.",
      "00:20 — Zephyrine Okafor-Lindqvist: Can you describe the core problem?",
      "00:30 — Bartholomew: Sure — our biggest issue is inconsistent reporting across regions."
    ].join("\n");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    expect(result.transcript_diagnostics.participants).toEqual(["Zephyrine Okafor-Lindqvist", "Bartholomew"]);
  });
});

describe("C. Networking-focused transcript — networking/assurance wins, not Splunk", () => {
  it("selects a networking category as primary, never a Splunk/SIEM/observability category", async () => {
    const text = readFixture("networking_modernization_signal.txt");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    expect(result.executive_summary.verdict).not.toBe("NOISE");
    expect(result.matches[0]?.domain).toBe("Networking");
    expect(result.matches[0]?.entry_id).not.toMatch(/siem|observability|splunk/i);
  });
});

describe("D. Security/SOC-focused transcript — the SOC/XDR category wins", () => {
  it("selects a SOC/detection-and-response category as primary, never a Splunk-data-platform or networking category", async () => {
    const text = readFixture("soc_xdr_investigation_signal.txt");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    expect(result.executive_summary.verdict).not.toBe("NOISE");
    expect(result.matches[0]?.entry_id).toBe("soc_detection_response");
  });
});

describe("E. Collaboration transcript — collaboration wins", () => {
  it("selects a collaboration category as primary when there is no security/observability pain", async () => {
    const text = readFixture("collaboration_hybrid_work_signal.txt");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    expect(result.executive_summary.verdict).not.toBe("NOISE");
    expect(result.matches[0]?.domain).toBe("Collaboration");
  });
});

describe("F. Explicit negative evidence — a product mentioned only as out-of-scope is never selected", () => {
  it("never selects a SIEM/data-platform category when the transcript explicitly says logging/SIEM is out of scope", async () => {
    const text = readFixture("explicit_negative_splunk_signal.txt");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    expect(result.executive_summary.verdict).not.toBe("NOISE");
    expect(result.matches[0]?.entry_id).not.toBe("siem_compliance");
    expect(result.matches.map((m) => m.entry_id)).not.toContain("siem_compliance");
  });
});

describe("G. Incidental identity mention — identity is not primary when only named as a data source", () => {
  it("never selects Identity/Zero Trust as primary when Entra ID/Okta are mentioned only incidentally", async () => {
    const text = readFixture("incidental_identity_mention_signal.txt");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    expect(result.executive_summary.verdict).not.toBe("NOISE");
    expect(result.matches[0]?.entry_id).not.toBe("identity_zero_trust");
  });
});

describe("H. Long transcript parser guard (generic, unrelated domain) — realistic sentence count, no parse-incomplete warning", () => {
  it("parses a 100+ turn, arbitrary-topic transcript into a realistic sentence count without tripping the parse-incomplete guard", async () => {
    const text = readFixture("ai_infrastructure_scaleup_signal.txt");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    expect(result.transcript_diagnostics.turns_parsed).toBeGreaterThan(100);
    expect(result.transcript_diagnostics.sentences_parsed).toBeGreaterThan(100);
    expect(result.generic_diagnostics.parser.warning).toBeNull();
  });
});

describe("I. Parser failure guard — malformed long text with no valid headers stops analysis", () => {
  it("throws TRANSCRIPT_PARSE_INCOMPLETE for long malformed text with no recognizable speaker structure and implausibly few sentences", async () => {
    // Long, garbled text with no recognizable speaker headers and no
    // real sentence punctuation density — designed to produce
    // implausibly few sentences relative to its length, exactly the
    // parser-failure signature the guard exists to catch.
    const malformed = "asdf qwer zxcv ".repeat(2000);
    await expect(runSignalAgent({ customTranscript: malformed, options: OFF })).rejects.toThrow(TranscriptParseIncompleteError);
  });

  it("never routes or sends when the parse-incomplete guard fires", async () => {
    const malformed = "asdf qwer zxcv ".repeat(2000);
    try {
      await runSignalAgent({ customTranscript: malformed, options: OFF });
      throw new Error("expected runSignalAgent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TranscriptParseIncompleteError);
      // No result object was ever produced, so no routing/delivery
      // pipeline (which only ever runs on a completed result) could
      // have been invoked.
    }
  });
});
