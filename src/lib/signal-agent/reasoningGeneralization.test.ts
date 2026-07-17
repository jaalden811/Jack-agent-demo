import { describe, expect, it } from "vitest";
import { normalizeSpelledNumbers } from "@/lib/signal-agent/numberWords";
import { ingestTranscript, isPlausibleSpeakerName, stripSpeakerDescriptor } from "@/lib/signal-agent/transcript";
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

  it("authorizing a design session/test is NOT economic authority; approving spend IS", () => {
    const test = [{ name: "Juno", text: "If security clears it, I can authorize a nonproduction design session. I am not authorizing a purchase or a paid tenant." }];
    const g1 = inferAuthorityGraph({ stakeholderTurns: test, allCustomerText: test.map((t) => t.text) });
    expect(g1.roles.some((r) => r.role_type === "economic_buyer" && r.status === "confirmed")).toBe(false);

    const spend = [{ name: "Dana", text: "I own the budget and I can approve the spend for this project." }];
    const g2 = inferAuthorityGraph({ stakeholderTurns: spend, allCustomerText: spend.map((t) => t.text) });
    expect(g2.economic_authority.status).toBe("confirmed");
  });
});

describe("inline 'Name — Org:' parsing and bot/system accounts (parser)", () => {
  it("strips the org/title suffix so a '[time] Name — Org:' line yields the person's name", () => {
    expect(stripSpeakerDescriptor("Quinn.Mercer — Hearthlane")).toBe("Quinn.Mercer");
    expect(stripSpeakerDescriptor("Maya Chen — Acme Account Executive")).toBe("Maya Chen");
    expect(stripSpeakerDescriptor("Dana Lee")).toBe("Dana Lee");
  });

  it("a bot/system account is never a speaker; real 'Name — Org:' people parse", () => {
    const t = ingestTranscript(
      [
        "[07:42] IncidentBot — ServiceNow: Channel created for INC001. Severity two.",
        "[07:43] Quinn.Mercer — Hearthlane: I manage the retail data platform and audit feed stopped.",
        "[07:44] Elise.Wong — Hearthlane: I own security logging and this is a compliance-evidence gap."
      ].join("\n")
    );
    const names = t.participantRecords.map((r) => r.name);
    expect(names).toContain("Quinn.Mercer");
    expect(names).toContain("Elise.Wong");
    expect(names.some((n) => /bot/i.test(n))).toBe(false);
    // "Abbot" is an ordinary surname, not a bot account.
    expect(isPlausibleSpeakerName("Abbot")).toBe(true);
    expect(isPlausibleSpeakerName("IncidentBot")).toBe(false);
    expect(isPlausibleSpeakerName("System")).toBe(false);
  });
});

describe("timing driver honesty & procurement classification (deal-intel via runSignalAgent)", () => {
  it("skips locked-in / 'not under review' statements, picks the forward deadline, and flags real procurement", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rachel — Vendor, Account Executive",
      "Rachel: I cover Beacon Freight for our company. A possible path is to test the platform.",
      "Dana — Customer, Ops Lead",
      "Dana: I run operations at Beacon Freight. Our current SD-WAN is contracted through 2029 and is not under replacement review. Our board decision target is October ninth, and the earliest purchase-order target is October twentieth. I'd like a scenario-design working session next week."
    ].join("\n");
    const di = (await runSignalAgent({ customTranscript: transcript })).deal_intelligence!;
    expect(di.timing).toBeTruthy();
    // The forward decision/procurement deadline, not the locked-in contract.
    expect(di.timing!.label.toLowerCase()).toContain("october");
    expect(di.timing!.label.toLowerCase()).not.toContain("contracted through");
    // A council/board decision + purchase-order IS procurement timing.
    expect(di.timing!.is_procurement).toBe(true);
  });
});
