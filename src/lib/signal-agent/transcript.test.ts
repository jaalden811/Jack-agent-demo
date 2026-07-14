import { describe, expect, it } from "vitest";
import { ingestTranscript, selectRelevantChunks } from "@/lib/signal-agent/transcript";

describe("ingestTranscript — multi-format speaker parsing", () => {
  it("parses 'MM:SS — Name:' turns and builds a non-zero participant count", () => {
    const text = [
      "29:45 — Daniel: Absolutely, we can look at that.",
      "29:47 — Maya: Great, let's move forward with the workshop."
    ].join("\n");
    const transcript = ingestTranscript(text);
    expect(transcript.participantRecords.length).toBe(2);
    expect(transcript.participants.length).toBeGreaterThan(0);
    const names = transcript.participantRecords.map((p) => p.name);
    expect(names).toContain("Daniel");
    expect(names).toContain("Maya");
  });

  it("parses 'MM:SS - Name:' (hyphen) turns", () => {
    const text = "13:52 - Priya: Debug logs may last seven days.";
    const transcript = ingestTranscript(text);
    expect(transcript.participantRecords.map((p) => p.name)).toContain("Priya");
    expect(transcript.sentences[0].timestamp).toBe("13:52");
  });

  it("parses '[MM:SS] Name:' bracketed-timestamp turns", () => {
    const text = "[21:56] Erin: We need to recreate the incident from May.";
    const transcript = ingestTranscript(text);
    expect(transcript.participantRecords.map((p) => p.name)).toContain("Erin");
    expect(transcript.sentences[0].timestamp).toBe("21:56");
  });

  it("still parses the legacy '[Speaker]: text' bracket format with no timestamp", () => {
    const text = "[Jordan Lee]: We are evaluating several vendors this quarter.";
    const transcript = ingestTranscript(text);
    expect(transcript.participantRecords.map((p) => p.name)).toContain("Jordan Lee");
    expect(transcript.sentences[0].timestamp).toBeNull();
  });

  it("parses plain 'Name: dialogue' turns with no timestamp or brackets", () => {
    const text = "Renee: We have board approval for this initiative.";
    const transcript = ingestTranscript(text);
    expect(transcript.participantRecords.map((p) => p.name)).toContain("Renee");
  });

  it("normalizes the timestamp and never treats it as part of the speaker name", () => {
    const text = "00:05 — Sam Okafor: This is our first checkpoint.";
    const transcript = ingestTranscript(text);
    const record = transcript.participantRecords.find((p) => p.name === "Sam Okafor");
    expect(record).toBeTruthy();
    expect(record!.name).not.toContain(":");
    expect(record!.name).not.toContain("00:05");
  });

  it("collapses repeated speaker turns into a single participant record with an incrementing turn count", () => {
    const text = [
      "00:01 — Maya: First point.",
      "00:02 — Daniel: Response.",
      "00:03 — Maya: Second point.",
      "00:04 — Maya: Third point."
    ].join("\n");
    const transcript = ingestTranscript(text);
    expect(transcript.participantRecords.length).toBe(2);
    const maya = transcript.participantRecords.find((p) => p.name === "Maya")!;
    expect(maya.turnCount).toBe(3);
    expect(maya.firstEvidenceIndex).toBe(0);
    expect(maya.lastEvidenceIndex).toBeGreaterThan(maya.firstEvidenceIndex!);
  });
});

describe("ingestTranscript — participant headers before the conversation", () => {
  it("attaches title and organization from 'Name — Title' header lines", () => {
    const text = [
      "Maya Chen — Cisco Account Executive",
      "Daniel Cho — Customer, Reliability Lead",
      "",
      "00:00 — Maya: Thanks everyone for joining today.",
      "00:05 — Daniel: Happy to be here."
    ].join("\n");
    const transcript = ingestTranscript(text);
    const maya = transcript.participantRecords.find((p) => p.name === "Maya Chen")!;
    const daniel = transcript.participantRecords.find((p) => p.name === "Daniel Cho")!;
    expect(maya.organization).toBe("Cisco");
    expect(maya.classification).toBe("vendor");
    expect(maya.title).toContain("Account Executive");
    expect(daniel.classification).toBe("customer");
    expect(daniel.title).toContain("Reliability Lead");
  });

  it("attaches title from 'Name (Title)' header lines", () => {
    const text = ["Priya Nair (Applications Lead)", "", "00:00 — Priya: Let's start."].join("\n");
    const transcript = ingestTranscript(text);
    const priya = transcript.participantRecords.find((p) => p.name === "Priya Nair")!;
    expect(priya.title).toBe("Applications Lead");
  });

  it("still supports the legacy 'Participants: Name (role), Name2 (role2)' one-liner", () => {
    const text = [
      "Account: Acme Retail",
      "Participants: Jordan Lee (Customer, IT Director), Sam Rivera (Cisco Account Executive)",
      "",
      "[Jordan Lee]: We need a better solution."
    ].join("\n");
    const transcript = ingestTranscript(text);
    expect(transcript.account).toBe("Acme Retail");
    const jordan = transcript.participantRecords.find((p) => p.name === "Jordan Lee")!;
    const sam = transcript.participantRecords.find((p) => p.name === "Sam Rivera")!;
    expect(jordan.classification).toBe("customer");
    expect(sam.classification).toBe("vendor");
    expect(sam.organization).toBe("Cisco");
  });
});

describe("ingestTranscript — vendor vs customer classification", () => {
  it("distinguishes a Cisco seller from customer participants regardless of how often the seller speaks", () => {
    const text = [
      "Maya Chen — Cisco Account Executive",
      "Daniel Cho — Customer, Reliability Lead",
      "",
      "00:00 — Maya: Let's start with introductions.",
      "00:01 — Maya: Can everyone confirm they can hear me?",
      "00:02 — Maya: Great, let's begin the agenda.",
      "00:03 — Maya: I'll hand it over to the team.",
      "00:04 — Daniel: Thanks Maya, we have one core issue to discuss."
    ].join("\n");
    const transcript = ingestTranscript(text);
    const maya = transcript.participantRecords.find((p) => p.name === "Maya Chen")!;
    const daniel = transcript.participantRecords.find((p) => p.name === "Daniel Cho")!;
    // Maya spoke far more often, but must still be classified as vendor, not a customer owner.
    expect(maya.turnCount).toBeGreaterThan(daniel.turnCount);
    expect(maya.classification).toBe("vendor");
    expect(daniel.classification).toBe("customer");
  });

  it("excludes vendor-classified speakers from the customer evidence pool used for matching", () => {
    const text = [
      "Maya Chen — Cisco Account Executive",
      "Daniel Cho — Customer, Reliability Lead",
      "",
      "00:00 — Maya: We think you should buy our unrelated product line.",
      "00:01 — Daniel: We have too many consoles and need unified operations."
    ].join("\n");
    const transcript = ingestTranscript(text);
    const relevantChunks = selectRelevantChunks(transcript);
    expect(relevantChunks.every((chunk) => chunk.isCustomer)).toBe(true);
    expect(relevantChunks.some((chunk) => chunk.text.includes("too many consoles"))).toBe(true);
    expect(relevantChunks.some((chunk) => chunk.text.includes("unrelated product line"))).toBe(false);
  });
});

describe("ingestTranscript — freeform fallback preserved", () => {
  it("treats fully unattributed pasted text as one customer-equivalent block", () => {
    const text = "We have too many consoles and need a unified view across the network.";
    const transcript = ingestTranscript(text);
    expect(transcript.sentences.length).toBeGreaterThan(0);
    expect(transcript.sentences.every((s) => s.isCustomer)).toBe(true);
    expect(transcript.participantRecords).toEqual([]);
  });
});
