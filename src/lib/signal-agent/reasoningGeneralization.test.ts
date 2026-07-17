import { describe, expect, it } from "vitest";
import { normalizeSpelledNumbers } from "@/lib/signal-agent/numberWords";
import { ingestTranscript, isPlausibleSpeakerName } from "@/lib/signal-agent/transcript";
import { extractBuyingIntentEvidence } from "@/lib/signal-agent/intentExtraction";
import { inferSpeakerSide } from "@/lib/signal-agent/speakerSide";
import { extractDialogueAccountCandidates } from "@/lib/account-resolution/candidateExtractor";
import { inferAuthorityGraph } from "@/lib/stakeholder-intelligence/authorityGraph";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

/**
 * Generalization regressions distilled from a reinforcement pass over a
 * synthetic meeting-reasoning benchmark. Every case uses GENERIC example
 * inputs (never a benchmark account/name/phrase) — the fixes are behavioral,
 * so the tests prove the behavior, not a memorized answer.
 */

describe("spelled-out number normalization (numberWords)", () => {
  it("converts worded cardinals (incl. hyphenated, hundreds, thousands) to digits", () => {
    expect(normalizeSpelledNumbers("ninety-six minutes")).toBe("96 minutes");
    expect(normalizeSpelledNumbers("sixty-two percent")).toBe("62 percent");
    expect(normalizeSpelledNumbers("thirty-one thousand sessions")).toBe("31000 sessions");
    expect(normalizeSpelledNumbers("three hundred eighty thousand dollars")).toBe("380000 dollars");
    expect(normalizeSpelledNumbers("four hundred twenty thousand")).toBe("420000");
  });

  it("leaves non-number words untouched", () => {
    expect(normalizeSpelledNumbers("the incident bridge was chaotic")).toBe("the incident bridge was chaotic");
  });
});

describe("worded metrics are detected as impact (was digit-only)", () => {
  it("captures a worded currency + duration impact from a customer turn", () => {
    const t = ingestTranscript("Dana — Customer, Ops Lead\nDana: The outage cost three hundred eighty thousand dollars and took ninety-six minutes to isolate.");
    const evidence = extractBuyingIntentEvidence(t);
    expect(evidence.some((e) => e.type === "impact")).toBe(true);
    // The stored quote is the ORIGINAL (worded) sentence, not the digit copy.
    expect(evidence.find((e) => e.type === "impact")?.text).toContain("ninety-six minutes");
  });

  it("a past/incident duration is NOT a buying timeline; a forward window is", () => {
    const past = extractBuyingIntentEvidence(ingestTranscript("Dana — Customer\nDana: The incident took four days to resolve."));
    expect(past.some((e) => e.type === "timeline")).toBe(false);
    const fwd = extractBuyingIntentEvidence(ingestTranscript("Dana — Customer\nDana: We need a decision within sixty days."));
    expect(fwd.some((e) => e.type === "timeline")).toBe(true);
  });
});

describe("vendor self-identification is inferred as vendor (generic, behavior-based)", () => {
  it("a rep who names the account they cover + proposes a path is vendor", () => {
    const s = inferSpeakerSide([
      "I cover Acme Retail for Contoso and Initech.",
      "A possible path is to test whether the platform can correlate these signals.",
      "I will send a two-page charter on Tuesday."
    ]);
    expect(s.side).toBe("vendor");
  });

  it("a specialist supporting the account exec is vendor", () => {
    const s = inferSpeakerSide([
      "I am the security specialist supporting the account team.",
      "I can prepare a one-page feasibility map for the group."
    ]);
    expect(s.side).toBe("vendor");
  });

  it("a customer who owns the environment/budget is never flipped to vendor", () => {
    const s = inferSpeakerSide([
      "In our environment reliability sits with my team and our budget is distributed.",
      "We run the SIEM and we need to cut isolation time."
    ]);
    expect(s.side).toBe("customer");
  });
});

describe("speaker-name plausibility (parser)", () => {
  it("rejects multi-word annotation labels but keeps real (incl. particled) names", () => {
    expect(isPlausibleSpeakerName("System note appended by organizer")).toBe(false);
    expect(isPlausibleSpeakerName("Recording started automatically now")).toBe(false);
    expect(isPlausibleSpeakerName("Mara Chen")).toBe(true);
    expect(isPlausibleSpeakerName("Jean-Paul Okafor-Lindqvist")).toBe(true);
    expect(isPlausibleSpeakerName("Juan de la Cruz")).toBe(true);
  });

  it("a discourse marker ending in a colon is not a speaker in one-line transcripts", () => {
    const t = ingestTranscript(
      "Dana Lee: We have a cross-team problem. Priya Shah: Tell me more about it. Dana Lee: Tentatively: option one and option two. Priya Shah: Understood and agreed."
    );
    const names = t.participantRecords.map((r) => r.name);
    expect(names).toContain("Dana Lee");
    expect(names).toContain("Priya Shah");
    expect(names).not.toContain("Tentatively");
    expect(names).not.toContain("Understood");
  });
});

describe("account coverage extraction (candidateExtractor)", () => {
  it("captures the covered account, never the vendor/product being renewed", () => {
    const covered = extractDialogueAccountCandidates(["I cover Acme Retail for Contoso and Initech."]).map((c) => c.name);
    expect(covered).toContain("Acme Retail");

    // "I cover the <Vendor> renewal for <account>" must NOT yield the vendor.
    const renewal = extractDialogueAccountCandidates(["I cover the Contoso renewal for the retailer."]).map((c) => c.name);
    expect(renewal).not.toContain("Contoso");
  });
});

describe("deal-intelligence output quality (metric / honest timing / champion)", () => {
  const TRANSCRIPT = [
    "Rachel — Vendor, Account Executive",
    "Rachel: I cover Acme Retail for our company. A possible path is to test whether the platform can help.",
    "Dana — Customer, Reliability Lead",
    "Dana: I run reliability at Acme Retail. Across incidents our mean time to isolate was ninety-six minutes and our board target is under thirty minutes. The review committee closes on October ninth, but that is a planning boundary, not procurement timing. I'd like to run a scenario-design working session next week."
  ].join("\n");

  it("distills a digit metric (baseline→target), an honest timing driver, and the next-step driver as champion", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const r = await runSignalAgent({ customTranscript: TRANSCRIPT });
    const di = r.deal_intelligence!;
    expect(di).toBeTruthy();
    // Metric is distilled to digits, baseline→target (not a spelled-out quote).
    expect(di.headline_metric).toContain("96");
    expect(di.headline_metric).toContain("30");
    // Timing is the forward decision boundary, framed HONESTLY (not procurement).
    expect(di.timing?.label.toLowerCase()).toContain("october");
    expect(di.timing?.is_procurement).toBe(false);
    expect(di.timing?.label.toLowerCase()).toContain("not procurement");
    // The customer who drives the accepted next step is the champion (Dana),
    // not the vendor rep (Rachel) — and never a vendor.
    const champ = di.power_map.find((p) => p.role_id === "business_champion");
    expect(champ?.name.toLowerCase()).toContain("dana");
    expect(di.power_map.some((p) => p.name.toLowerCase().includes("rachel"))).toBe(false);
  });
});

describe("committee / distributed economic authority (authorityGraph)", () => {
  it("committee-approval + Finance vote → distributed authority, never names the speaker as buyer", () => {
    const turns = [{ name: "Sam", text: "The investment committee approves cross-platform spend, and Finance has a vote. I am not the sole economic buyer." }];
    const g = inferAuthorityGraph({ stakeholderTurns: turns, allCustomerText: turns.map((t) => t.text) });
    expect(g.economic_authority.status).toBe("distributed");
    expect(g.economic_authority.named_person).toBeNull();
    expect(g.roles.some((r) => r.role_type === "economic_buyer" && r.status === "confirmed")).toBe(false);
  });
});
