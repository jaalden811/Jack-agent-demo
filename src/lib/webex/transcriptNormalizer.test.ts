import { describe, expect, it } from "vitest";
import { normalizeWebexSnippetsToTranscriptText, normalizeWebexRawTextToTranscriptText, buildWebexSourceMetadata } from "@/lib/webex/transcriptNormalizer";
import { ingestTranscript } from "@/lib/signal-agent/transcript";

describe("normalizeWebexSnippetsToTranscriptText", () => {
  it("normalizes speaker/text snippets into the existing Signal Agent transcript format", () => {
    const text = normalizeWebexSnippetsToTranscriptText({
      snippets: [
        { id: "s1", text: "We have too many consoles.", personName: "Jordan Lee", offsetMillisecond: 1000 },
        { id: "s2", text: "That sounds painful.", personName: "Taylor Grant", offsetMillisecond: 5000 }
      ],
      meetingTitle: "Acme Retail QBR"
    });

    expect(text).toContain("Account: Acme Retail QBR");
    expect(text).toContain("Source: webex");
    expect(text).toContain("[Jordan Lee]");
    expect(text).toContain("We have too many consoles.");
    expect(text).toContain("[Taylor Grant]");
  });

  it("produces text that the existing ingestTranscript() can parse into sentences", () => {
    const text = normalizeWebexSnippetsToTranscriptText({
      snippets: [
        { id: "s1", text: "We have too many consoles across every site.", personName: "Jordan Lee" },
        { id: "s2", text: "We need an architecture workshop this quarter.", personName: "Jordan Lee" }
      ],
      meetingTitle: "Acme Retail QBR"
    });

    const ingested = ingestTranscript(text);
    expect(ingested.account).toBe("Acme Retail QBR");
    expect(ingested.sentences.length).toBeGreaterThanOrEqual(2);
    expect(ingested.sentences.some((s) => s.text.includes("architecture workshop"))).toBe(true);
  });

  it("uses an explicit account override instead of the meeting title when provided", () => {
    const text = normalizeWebexSnippetsToTranscriptText({
      snippets: [{ id: "s1", text: "Hello.", personName: "A" }],
      meetingTitle: "Weekly Sync",
      accountNameOverride: "Acme Retail"
    });
    expect(text).toContain("Account: Acme Retail");
  });

  it("skips empty-text snippets", () => {
    const text = normalizeWebexSnippetsToTranscriptText({
      snippets: [
        { id: "s1", text: "", personName: "A" },
        { id: "s2", text: "Real content.", personName: "B" }
      ],
      meetingTitle: "Meeting"
    });
    expect(text).toContain("Real content.");
    expect(text).not.toContain("[A]:");
  });
});

describe("normalizeWebexRawTextToTranscriptText", () => {
  it("prepends the required Account/Source header to raw downloaded text", () => {
    const text = normalizeWebexRawTextToTranscriptText({ rawText: "Jordan Lee: Hello there.", meetingTitle: "Acme Retail QBR" });
    expect(text).toContain("Account: Acme Retail QBR");
    expect(text).toContain("Source: webex");
    expect(text).toContain("Jordan Lee: Hello there.");
  });
});

describe("buildWebexSourceMetadata", () => {
  it("preserves transcriptId, meetingId, meeting title, host, and meeting date", () => {
    const source = buildWebexSourceMetadata({
      transcriptId: "t-1",
      meetingId: "m-1",
      meetingTitle: "Acme Retail QBR",
      host: "host-1",
      meetingDate: "2026-01-01T00:00:00Z"
    });
    expect(source).toEqual({
      transcriptId: "t-1",
      meetingId: "m-1",
      meetingTitle: "Acme Retail QBR",
      host: "host-1",
      meetingDate: "2026-01-01T00:00:00Z",
      source: "webex"
    });
  });
});
