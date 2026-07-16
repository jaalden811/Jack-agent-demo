import { describe, expect, it } from "vitest";
import { ingestTranscript, normalizeInlineSpeakers } from "@/lib/signal-agent/transcript";

const ONE_LINE =
  "Account: AECOM Rachel: Thanks for making the time, could you frame what prompted it? " +
  "Jordan: We are reviewing how information moves between teams when something goes wrong across security and infrastructure. " +
  "Maya: Different teams form different pictures during an incident. " +
  "Daniel: Where do people start today when that happens? " +
  "Eric: Usually in their own tool, cloud monitoring or the SIEM. " +
  "Rachel: Is there a particular incident behind the review? " +
  "Jordan: Not one event, several cases where we had the data but could not form a reliable picture. " +
  "Maya: We also need to be careful about what data belongs where. " +
  "Eric: Instrumentation will not be uniform across our estate.";

describe("one-line paste normalization", () => {
  it("recovers turns/participants from a single-line transcript", () => {
    const ingested = ingestTranscript(ONE_LINE);
    const names = ingested.participantRecords.map((p) => p.name);
    expect(ingested.participantRecords.length).toBeGreaterThanOrEqual(4);
    expect(names).toContain("Rachel");
    expect(names).toContain("Jordan");
    expect(names).toContain("Maya");
  });

  it("leaves a normally-formatted transcript unchanged", () => {
    const normal = "Account: Acme\nRachel: hello there everyone.\nJordan: we have a problem with our stack.\nRachel: tell me more about it.";
    expect(normalizeInlineSpeakers(normal)).toBe(normal);
  });
});
