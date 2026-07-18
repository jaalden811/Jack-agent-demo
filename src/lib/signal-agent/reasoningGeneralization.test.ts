import { describe, expect, it } from "vitest";
import { normalizeSpelledNumbers } from "@/lib/signal-agent/numberWords";
import { ingestTranscript, isPlausibleSpeakerName, stripSpeakerDescriptor, orgFromDescriptor } from "@/lib/signal-agent/transcript";
import { validateAccountCandidateName } from "@/lib/account-resolution/accountValidation";
import { extractBuyingIntentEvidence } from "@/lib/signal-agent/intentExtraction";
import { inferSpeakerSide } from "@/lib/signal-agent/speakerSide";
import { extractDialogueAccountCandidates, extractSubEntityNames } from "@/lib/account-resolution/candidateExtractor";
import { inferAuthorityGraph } from "@/lib/stakeholder-intelligence/authorityGraph";
import { parseOrganizationEntities } from "@/lib/account-resolution/organizationEntityParser";
import { detectHardRejection } from "@/lib/signal-agent/rejectionGuard";
import { detectSatisfiedIncumbent } from "@/lib/signal-agent/satisfactionGuard";
import { buildStageDInput } from "@/lib/circuit/stages/stageDAdapter";
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
    // Timing is the forward decision boundary, classified HONESTLY as a
    // decision boundary (not procurement) via the structural flag. The label is
    // the customer's own sentence (which here happens to say "not procurement
    // timing"); what we must NEVER do is splice in our own debug annotation.
    expect(di.timing?.label.toLowerCase()).toContain("october");
    expect(di.timing?.is_procurement).toBe(false);
    expect(di.timing?.label.toLowerCase()).not.toContain("(decision boundary");
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

  it("a NEGATED authority statement never confirms an economic buyer", () => {
    // "did not approve a purchase" / "not approve purchase" is the OPPOSITE of
    // authority — must not be counted as an economic-buyer signal.
    for (const text of ["It did not approve a purchase.", "The review can recommend discovery, not approve purchase.", "No one on this call can award the budget alone."]) {
      const g = inferAuthorityGraph({ stakeholderTurns: [{ name: "Nessa", text }], allCustomerText: [text] });
      expect(g.roles.some((r) => r.role_type === "economic_buyer" && r.status === "confirmed")).toBe(false);
    }
  });
});

describe("account signals: customer employer, explicit declaration, artifact/numbered speakers", () => {
  it("captures the account from a customer stating their employer and from an explicit declaration", () => {
    const employer = extractDialogueAccountCandidates(["I lead cyber operations for Stonepine."]).map((c) => c.name);
    expect(employer).toContain("Stonepine");
    // Explicit "X is the account" is the strongest dialogue signal (high confidence).
    const explicit = extractDialogueAccountCandidates(["For clarity, Meridian Shield Insurance is the account."]);
    const decl = explicit.find((c) => c.name === "Meridian Shield Insurance");
    expect(decl).toBeTruthy();
    expect(decl!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("rejects document-artifact labels but allows anonymized numbered speakers", () => {
    expect(isPlausibleSpeakerName("Action appendix")).toBe(false);
    expect(isPlausibleSpeakerName("QBR appendix")).toBe(false);
    expect(isPlausibleSpeakerName("Participant 4")).toBe(true);
    expect(isPlausibleSpeakerName("Speaker 1")).toBe(true);
    expect(isPlausibleSpeakerName("Mara Chen")).toBe(true);
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

describe("account identity from shared participant org descriptors", () => {
  it("orgFromDescriptor captures a real leading proper-noun org, never a role/side fragment", () => {
    expect(orgFromDescriptor("NovaWave VP, Security Operations")).toBe("NovaWave");
    expect(orgFromDescriptor("Splunk Account")).toBe("Splunk");
    expect(orgFromDescriptor("Aegis Ridge Systems")).toBe("Aegis Ridge Systems");
    // Role-only / side-tag descriptors must NOT yield an org (never invent one).
    expect(orgFromDescriptor("Reliability Lead")).toBeNull();
    expect(orgFromDescriptor("Customer, Ops Lead")).toBeNull();
    expect(orgFromDescriptor("Security Architect")).toBeNull();
  });

  it("a pluralized acronym is never a company; a bare acronym company still is", () => {
    expect(validateAccountCandidateName("IDs").valid).toBe(false);
    expect(validateAccountCandidateName("APIs").valid).toBe(false);
    expect(validateAccountCandidateName("SLAs").valid).toBe(false);
    expect(validateAccountCandidateName("IBM").valid).toBe(true);
    expect(validateAccountCandidateName("AWS").valid).toBe(true);
    expect(validateAccountCandidateName("Acme Retail").valid).toBe(true);
  });

  it("resolves the customer account when several speakers share a 'Name — <Org> role' descriptor", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "[09:00] Rae Lin — Beacon Freight VP, Operations: I run reliability here. Our mean time to isolate was ninety-six minutes.",
      "[09:01] Omar Diaz — Beacon Freight director, SRE: A credible design must coexist with our existing tools; we need to cut isolation time.",
      "[09:02] Priya Shah — Vendor, Account Executive: I cover Beacon Freight for our company. A possible path is to test the platform."
    ].join("\n");
    const r = await runSignalAgent({ customTranscript: transcript });
    expect(r.account_resolution?.name?.toLowerCase()).toContain("beacon freight");
    // The vendor rep's "Vendor, Account Executive" descriptor contributes no org.
    expect(["confirmed", "probable"]).toContain(r.account_resolution?.status);
  });
});

describe("action-shape motion + momentum richness (PoC actionability)", () => {
  const APPROVED_EVAL = [
    "Rae — Customer, Security Lead",
    "Rae: I run the SOC at Acme. The steering committee approved a six-week evaluation of a new detection platform. Our decision criteria are correlation quality, integration with ServiceNow, and cost. We are actively evaluating two vendors. Our existing tool renewal is in the background but not the focus. We took ninety-six minutes to correlate and our target is under thirty."
  ].join("\n");

  it("an approved/active evaluation is NOT overwritten by a 'renewal review'", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const r = await runSignalAgent({ customTranscript: APPROVED_EVAL });
    // The renewal is incidental; the drafted action must match the real motion.
    expect(r.next_best_action?.action_type).not.toBe("renewal_review");
  });

  it("momentum is derived from validated fields (metrics/criteria) so a strong deal reads as strong", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const di = (await runSignalAgent({ customTranscript: APPROVED_EVAL })).deal_intelligence!;
    const ids = di.momentum.map((m) => m.id);
    // Derived from validated MEDDPICC/scoring fields (dynamic, not keyword cues)
    // — a confirmed metric becomes a "winnable now" signal a cue list misses.
    expect(ids).toContain("quantified_metrics");
    expect(di.momentum.length).toBeGreaterThan(0);
  });
});

describe("dynamic compositional risks (budget-not-approved / privacy-gate)", () => {
  it("detects the SEMANTIC co-occurrence, not a memorized phrase, and does not over-trigger", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const withRisks = [
      "Dana — Customer, Ops Lead",
      "Dana: I run reliability at Acme. Our innovation fund exists but has not been approved for this project. Subscriber identifiers cannot leave our region without a privacy review. I'd like a scenario-design working session next week."
    ].join("\n");
    const di = (await runSignalAgent({ customTranscript: withRisks })).deal_intelligence!;
    const ids = di.risks.map((r) => r.id);
    // Money-term × non-approval-term co-occurrence → budget risk (wording is
    // NOT any of the pruned memorized phrases).
    expect(ids).toContain("budget_not_approved");
    // Sensitivity-term × restriction-term co-occurrence → privacy risk.
    expect(ids).toContain("privacy_gate");

    clearCatalogCache();
    clearAccountsCache();
    const noRisks = [
      "Dana — Customer, Ops Lead",
      "Dana: I run reliability at Acme. We approved the budget last quarter and the rollout is going well. I'd like a scenario-design working session next week."
    ].join("\n");
    const di2 = (await runSignalAgent({ customTranscript: noRisks })).deal_intelligence!;
    // "approved the budget" must NOT trip the not-approved risk.
    expect(di2.risks.map((r) => r.id)).not.toContain("budget_not_approved");
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

  it("does not treat the modal 'may' or a hedged/retention duration as a timing date", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rachel — Vendor, Account Executive",
      "Rachel: A possible path is to validate the platform.",
      "Dana — Customer, Director of Operations",
      "Dana: We run operations here. Some project records may need to exist for years, other information only for ninety days. It may be a deadline becoming harder to meet, but there is no set date."
    ].join("\n");
    const di = (await runSignalAgent({ customTranscript: transcript })).deal_intelligence!;
    // "may need", "for years/ninety days", and "it may be" are not timing drivers.
    expect(di.timing).toBeNull();
  });

  it("never surfaces a negated deadline ('it is not a procurement deadline') as why-now", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rachel — Vendor, Account Executive",
      "Rachel: I cover Beacon Freight for our company. A possible path is to validate the platform.",
      "Dana — Customer, Director of Reliability",
      "Dana: I run reliability at Beacon Freight. Our review of the validation evidence is on August 18. It is not a procurement deadline. I'd like a scenario-design working session next week."
    ].join("\n");
    const di = (await runSignalAgent({ customTranscript: transcript })).deal_intelligence!;
    if (di.timing) {
      // The forward driver (the August 18 review), not the negation sentence.
      expect(di.timing.label.toLowerCase()).not.toContain("not a procurement deadline");
      expect(di.timing.label.toLowerCase()).toContain("august");
    }
  });
});

describe("one-line transcript: trailing word merged with a recurring speaker", () => {
  it("does not fabricate a speaker when a prior-sentence word precedes a recurring one-line label", () => {
    const raw = "Liam: Could we schedule a post-renewal discovery for October Miko: Maybe internally we review the tabletop results Liam: Understood the current-tool plan Miko: We asked for fewer handoffs not one view Liam: Confirmed Miko: Confirmed";
    const names = ingestTranscript(raw).diagnostics.participants;
    expect(names).toContain("Liam");
    expect(names).toContain("Miko");
    expect(names).not.toContain("October Miko");
  });
});

describe("account plausibility & explicit operating-entity declarations", () => {
  it("rejects technical/telecom jargon acronyms as accounts but keeps company acronyms", () => {
    for (const jargon of ["PSTN", "VPN", "SIEM", "APM", "MTTR", "SaaS"]) {
      expect(validateAccountCandidateName(jargon).valid).toBe(false);
    }
    for (const company of ["IBM", "SAP", "AWS", "HPE"]) {
      expect(validateAccountCandidateName(company).valid).toBe(true);
    }
  });

  it("captures a full '& / and' company name from an explicit operating-entity declaration", () => {
    const candidates = extractDialogueAccountCandidates([
      "For the record, the operating utility is PineRiver Water & Power.",
      "Barnes and Noble is the contracting entity."
    ]);
    const names = candidates.map((c) => c.name);
    expect(names).toContain("PineRiver Water & Power");
    expect(candidates.find((c) => c.name === "PineRiver Water & Power")!.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe("delivered message anchors to the canonical Next Best Action", () => {
  it("Stage D recommended action is the NBA title, not a generic MEDDPICC-gap action", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rachel — Vendor, Account Executive",
      "Rachel: I cover Beacon Freight for our company. A possible path is to validate the platform.",
      "Dana — Customer, Director of Reliability",
      "Dana: I run reliability at Beacon Freight. During the last staged failure it took us 47 minutes to isolate the bad dependency. I'd like a scenario-design working session next week to scope a proof of value."
    ].join("\n");
    const result = await runSignalAgent({ customTranscript: transcript });
    const nba = result.next_best_action;
    if (nba && nba.action_type !== "suppress" && nba.action_type !== "hold" && nba.title) {
      const stageC = {
        opportunity_thesis: "", do_not_reask: [], next_best_action: { success_criteria: [], timing_basis: "" },
        commercial_handoff: { remaining_questions: [] }, technical_handoff: { remaining_questions: [] }
      } as never;
      const input = buildStageDInput(result, stageC);
      expect(input.deterministic.sales_webex).toContain(nba.title);
      expect(input.deterministic.technical_webex).toContain(nba.title);
      // And never leads with a hedged/impact "why now".
      expect(input.deterministic.sales_webex.toLowerCase()).not.toContain("it may be");
    }
  });
});

describe("copied CRM block + slash-joined account (S030 class)", () => {
  it("does not parse CRM/metadata field labels as speakers and takes the primary entity from a slash-joined account", () => {
    const transcript = [
      "Account: Acme State University / Acme Health / Acme Foundation",
      "Parent: Acme University Foundation",
      "Opportunity: Unified digital experience platform",
      "Products: Splunk ITSI, AppDynamics",
      "Budget: $1,800,000 approved",
      "Sponsor: University CIO",
      "Timeline: October 1 enrollment deadline",
      "Stage: POV requested",
      "Source: partner conversations",
      "Juno Park: I am the outgoing account executive; several CRM fields were assembled before I validated the entities.",
      "Tariq Bello: I am taking the account. Is the Foundation actually the parent?"
    ].join("\n");
    const t = ingestTranscript(transcript);
    const names = t.diagnostics.participants;
    for (const label of ["Parent", "Opportunity", "Products", "Budget", "Sponsor", "Timeline", "Stage", "Source"]) {
      expect(names).not.toContain(label);
    }
    // Primary (first) entity only — excluded affiliates are not merged in.
    expect(t.account).toBe("Acme State University");
  });
});

describe("economic-owner self-identification (S029 class)", () => {
  it("confirms a named economic buyer from 'I am the economic owner … I can approve within that envelope'", () => {
    const turns = [
      { name: "Marla", text: "I am vice president of customer experience and the program's economic owner. I confirm the $420,000 envelope. I can approve a recommendation within that envelope after the gates. I have not approved a vendor or price." }
    ];
    const graph = inferAuthorityGraph({ stakeholderTurns: turns, allCustomerText: turns.map((t) => t.text) });
    expect(graph.economic_authority.status).toBe("confirmed");
    expect(graph.economic_authority.named_person).toBe("Marla");
  });
});

describe("speaker side — a vendor SE who pitches product capabilities", () => {
  it("classifies product-capability pitches as vendor, but a customer describing their own environment stays customer", () => {
    const se = inferSpeakerSide([
      "Splunk can derive relationships from telemetry rather than relying on manual mapping.",
      "Federated search and integrations can query data across environments.",
      "ES provides security detections, investigations, and risk-based alerting.",
      "They can share a data foundation while maintaining separate access."
    ]);
    expect(se.side).toBe("vendor");

    const customer = inferSpeakerSide([
      "Our environment is decentralized and we run several monitoring tools.",
      "We need to correlate incidents faster; our team spends hours pivoting between tools.",
      "Our budget for this sits with the resilience program."
    ]);
    expect(customer.side).toBe("customer");
  });
});

describe("hard-rejection trap guard (never chase a rejected motion)", () => {
  it("fires on an explicit customer rejection of the vendor's motion", () => {
    const r = detectHardRejection([
      "Remove the product from the account opportunity and correct the note; you have no customer-facing commercial action.",
      "Procurement is engaged in the renewal and rejected the added scope."
    ]);
    expect(r.rejected).toBe(true);
    expect(r.count).toBeGreaterThanOrEqual(1);
  });

  it("does NOT fire on entity-boundary, early-stage absence, or a scope constraint (still-real deals)", () => {
    const r = detectHardRejection([
      "The shared-services entity participates as operator, not a separate expansion opportunity.",
      "There is no commercial decision yet; this session is a technical validation.",
      "We are not authorizing a rip-and-replace — keep the incumbent alongside it.",
      "No budget has been approved for the evaluation at this stage."
    ]);
    expect(r.rejected).toBe(false);
  });

  it("suppresses pursuit end-to-end when the customer rejects the proposed scope", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Seller — Vendor, Account Executive",
      "Seller: Given the incidents and the sixty-four-minute recovery time, this looks like a strong expansion for our service-intelligence product.",
      "Petra — Customer, Procurement",
      "Petra: This meeting is a renewal review for the incumbent only. Remove the product from the account opportunity — there is no such project and no customer-facing commercial action. Unsolicited products are nonconforming and will be rejected without evaluation.",
      "Vik — Customer, IT Owner",
      "Vik: Our current tools are the active plan. We have not defined requirements, budget, or an evaluation."
    ].join("\n");
    const result = await runSignalAgent({ customTranscript: transcript });
    expect(result.executive_summary.verdict).toBe("NOISE");
    expect(result.opportunity_scoring.decision).toBe("DO_NOT_PURSUE");
    expect(result.next_best_action?.action_type).toBe("suppress");
  });
});

describe("account resolution: parent/main account over a sub-entity; 'Role, Org' descriptors", () => {
  it("reads the org from a 'Role, Org' descriptor, not only 'Org Role'", () => {
    expect(orgFromDescriptor("director of network platforms, Acme Networks")).toBe("Acme Networks");
    expect(orgFromDescriptor("vice president, branch operations, Acme Networks")).toBe("Acme Networks");
    expect(orgFromDescriptor("Contoso account executive")).toBe("Contoso");
    expect(orgFromDescriptor("systems architect")).toBeNull();
  });

  it("flags an acquired estate / division / subsidiary as a sub-entity (so it is demoted below the parent)", () => {
    const subs = extractSubEntityNames([
      "The program covers those sites plus twelve Riverbend acquisition sites still on the legacy stack.",
      "I run Larkspur, one of the nine divisions, and we retain local control.",
      "The Meadowbrook subsidiary keeps its own tooling."
    ]);
    expect(subs.has("riverbend")).toBe(true);
    expect(subs.has("larkspur")).toBe(true);
    expect(subs.has("meadowbrook")).toBe(true);
  });

  it("resolves the shared participant org over a more-frequent acquired estate", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rep — Vendor, Account Executive: This is the Cortex Rail renewal review; branch standardization is the larger item.",
      "Lena — director of network platforms, Cortex Rail: We keep renewal and transformation separate. The program covers our sites plus twelve Delta Freight acquisition sites still on the legacy stack.",
      "Omar — vice president, operations, Cortex Rail: New sites take twenty-one days to open; our target is eight. We will validate before migrating the Delta Freight sites.",
      "Rep — Vendor, Account Executive: For the twelve Delta Freight sites, do we replace immediately?",
      "Lena — director of network platforms, Cortex Rail: No, coexistence until those contracts expire."
    ].join("\n");
    const r = await runSignalAgent({ customTranscript: transcript });
    // The acquired estate ("Delta Freight") is mentioned repeatedly but must not
    // win over the org shared by the customer participants ("Cortex Rail").
    expect(r.account_resolution?.name).toBe("Cortex Rail");
  });
});

describe("account + qualified-deal rescue (funded program surfaced from a support-led call)", () => {
  it("extracts a customer's own employer from 'We run X for <Org>' (first-person plural)", () => {
    const cands = extractDialogueAccountCandidates([
      "We run nine member-facing journeys across web and mobile for Northwind Cooperative."
    ]);
    expect(cands.map((c) => c.name)).toContain("Northwind Cooperative");
  });

  it("lifts a funded program (named EB + confirmed pain + confirmed metrics, criteria present) out of NOISE", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Lena — Vendor, Support Engineer: I opened this for support case 12. Your synthetic check failed after an upgrade; I will return a fix by Friday.",
      "Cara — Customer, Platform Engineer: The browser logs in, but the monitor fails at the token exchange step.",
      "Owen — Customer, Director of Member Experience: The ticket and our broader program are separate. We run nine member journeys for Northwind Cooperative. Last quarter we had 19 customer-visible failures and median time to recognize a failure was 41 minutes.",
      "Dana — Customer, VP Member Digital: I sponsor the assurance program and own the outcome. The leadership council approved a 500,000 dollar envelope this year for monitoring software, and I can approve a vendor within that envelope after the security gate. I have not approved a vendor.",
      "Owen — Customer, Director of Member Experience: Our decision criteria: cover six journeys from three regions, detect a seeded failure within five minutes, and produce evidence of whether a failure is app, identity, or network.",
      "Owen — Customer, Director of Member Experience: Can we get a comparative validation plan next week?"
    ].join("\n");
    const r = await runSignalAgent({ customTranscript: transcript });
    // The support ticket must not bury a funded, EB-backed program.
    expect(r.executive_summary.verdict).not.toBe("NOISE");
    expect(r.opportunity_scoring.decision).not.toBe("HOLD");
    expect(r.next_best_action?.action_type).not.toBe("suppress");
  });
});

describe("satisfied incumbent is never pursued; decimal metrics count as impact", () => {
  it("flags a satisfied incumbent (healthy metrics + no buying motion), not a painful constrained deal", () => {
    const satisfied = detectSatisfiedIncumbent([
      "For the trailing ninety days availability was 99.97 percent and we are inside all of them.",
      "There is no performance gap that justifies a replacement.",
      "There is no active requisition, RFP, or supplier comparison for monitoring."
    ]);
    expect(satisfied.satisfied).toBe(true);
    // A real painful opportunity with a scope constraint must NOT read as satisfied.
    const painful = detectSatisfiedIncumbent([
      "Detection takes 42 minutes and we need under 10; this is hurting us.",
      "Keep the incumbent tool alongside it — no rip-and-replace."
    ]);
    expect(painful.satisfied).toBe(false);
  });

  it("suppresses pursuit for a satisfied incumbent end-to-end (positive metrics are not pain)", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rep — Vendor, Account Executive: Executive briefing on your monitoring.",
      "CTO — customer: We finished the migration in April. We are not starting a monitoring modernization and not comparing products.",
      "SRE — customer: Availability was 99.97 percent, detection 3.8 minutes, change failure 2.1 percent. We are inside all of them. There is no performance gap that justifies a replacement.",
      "Proc — customer: There is no active requisition, RFP, renewal, or supplier comparison for monitoring.",
      "Spec — Vendor, Specialist: I can send a documentation compatibility brief by August 5."
    ].join("\n");
    const r = await runSignalAgent({ customTranscript: transcript });
    expect(r.executive_summary.verdict).toBe("NOISE");
  });

  it("counts a decimal duration ('5.4 days') as quantified impact", () => {
    const t = ingestTranscript("Owner — customer: New joiners wait a median of 5.4 days for full access, which is too slow.");
    const ev = extractBuyingIntentEvidence(t);
    expect(ev.some((e) => e.type === "impact")).toBe(true);
  });

  it("distills a headline pair when the baseline qualifier TRAILS the number ('14 hours ... on average')", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rep — Vendor, Account Executive: Plant modernization review.",
      "Lead — director of manufacturing IT, Acme Foods: Unplanned downtime cost us fourteen hours per plant last quarter on average, and our target is under four hours by year end.",
      "Lead — director of manufacturing IT, Acme Foods: Please deliver a validation design by August 6."
    ].join("\n");
    const r = await runSignalAgent({ customTranscript: transcript });
    const metric = r.deal_intelligence?.headline_metric ?? "";
    expect(metric).toContain("14");
    expect(metric).toContain("4");
    expect(metric).toMatch(/→/);
  });
});

describe("output quality: headline metric, named EB, question-subject account, production dates", () => {
  it("distills a baseline→target improvement pair, never a raw scale count", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rep — Vendor, Account Executive: Renewal review for the branch estate.",
      "Lead — director of network platforms, Acme Rail: We run 408 branch locations. We detect a degrading circuit in forty-two minutes at the median; we need median recognition under ten minutes.",
      "Lead — director of network platforms, Acme Rail: Please deliver a validation design by August 5."
    ].join("\n");
    const r = await runSignalAgent({ customTranscript: transcript });
    const metric = r.deal_intelligence?.headline_metric ?? "";
    expect(metric).toContain("→");
    expect(metric).toContain("10");
    expect(metric).not.toMatch(/customer|location/i);
  });

  it("confirms a third-person named economic buyer (an absent CFO), not distributed", () => {
    const text = "Chief financial officer Imogen Vale releases the program funds after the investment committee recommendation. Imogen is the economic buyer.";
    const g = inferAuthorityGraph({ stakeholderTurns: [{ name: "Asha", text }], allCustomerText: [text] });
    expect(g.economic_authority.status).toBe("confirmed");
    expect(g.economic_authority.named_person).toContain("Imogen");
  });

  it("extracts the account named as a question subject ('does <Org> have a ... project')", () => {
    const orgs = parseOrganizationEntities(["Nola, does Brightwave have a global consolidation project?"], { participantFirstNames: ["Nola"] });
    expect(orgs.organization_candidates.map((o) => o.name)).toContain("Brightwave");
  });

  it("does NOT capture a person in 'is <Person> the economic buyer?' as an account", () => {
    const orgs = parseOrganizationEntities(["Is Arden the economic buyer?"], { participantFirstNames: [] });
    expect(orgs.organization_candidates.map((o) => o.name)).not.toContain("Arden");
  });

  it("never surfaces a media/production event date (screenings, premiere) as the timing driver", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rep — Vendor, Account Executive: QBR.",
      "Lead — customer: Toronto screenings begin September 9 and two launches are October 3. Those are production boundaries, not procurement dates."
    ].join("\n");
    const r = await runSignalAgent({ customTranscript: transcript });
    const timing = r.deal_intelligence?.timing?.label ?? "";
    expect(timing.toLowerCase()).not.toContain("screening");
  });
});

describe("accepted next step: a committed dated deliverable, not only a workshop", () => {
  it("detects an owner committing to a dated deliverable as a next_step", () => {
    const t = ingestTranscript("Owner — Vendor, Solutions Engineer: I own the two-plane validation design by August 5.");
    const ev = extractBuyingIntentEvidence(t);
    expect(ev.some((e) => e.type === "next_step")).toBe(true);
  });

  it("does NOT match a negated activity as a next step ('we did not agree to send anything by Friday')", () => {
    const t = ingestTranscript("Buyer — customer: We did not agree to send anything by August 5.");
    const ev = extractBuyingIntentEvidence(t);
    // A negated commitment must not be counted as an accepted next step.
    expect(ev.some((e) => e.type === "next_step")).toBe(false);
  });
});

describe("objection typing does not confuse latent interest with disqualification", () => {
  it("does not type a forward-looking exploratory musing as a disqualifier", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Tom — Vendor, Renewal Manager: This is the renewal review for your switching support at Rivergate.",
      "Hugo — Customer, Network Manager: We intend to renew; the current term ends December 15.",
      "Hugo — Customer, Network Manager: Separately, and I am not committing to anything today, we have started wondering whether we have enough visibility into network experience for our clinical applications."
    ].join("\n");
    const r = await runSignalAgent({ customTranscript: transcript });
    const disqualifiers = (r.decision_packet?.objections ?? []).filter((o) => o.type === "disqualifier");
    expect(disqualifiers).toHaveLength(0);
  });
});

describe("colon-less, side-tagged, low-punctuation transcript parsing", () => {
  it("parses 'Name customer/vendor <text>' turns with correct sides even without colons or punctuation", () => {
    const t = ingestTranscript(
      [
        "Jin Alvarez vendor account executive thanks everyone the purpose is to validate the cloud opportunity",
        "Mara Vole customer director cloud economics no that is not the purpose the numbers are yours not ours",
        "Cedra Yoon customer cloud platform lead the vendor tab is not our analysis",
        "Olan Rusk customer procurement lead there is no requisition budget or evaluation for this",
        "Siven Mora vendor specialist I will produce a product-neutral methodology note"
      ].join("\n")
    );
    expect(t.diagnostics.turns_parsed).toBeGreaterThanOrEqual(4);
    // A no-punctuation paste must not collapse into one giant sentence.
    expect(t.diagnostics.sentences_parsed).toBeGreaterThanOrEqual(4);
    const byName = new Map(t.participantRecords.map((r) => [r.name, r.classification]));
    expect(byName.get("Jin Alvarez")).toBe("vendor");
    expect(byName.get("Mara Vole")).toBe("customer");
    expect(byName.get("Olan Rusk")).toBe("customer");
  });

  it("attributes a follow-up first-name-only turn to an established speaker (no-colon side mode)", () => {
    const t = ingestTranscript(
      [
        "[00:00] Pax Ellis vendor seller contact center planning",
        "[00:03] Mace Toll customer not approved planning discussion",
        "[00:06] Kira Sen customer regional lead we volunteer to explore forty seats",
        "[00:12] Kira calls transfer twice on average and agents retype case notes",
        "[00:20] Pax who owns the regional budget"
      ].join("\n")
    );
    const byName = new Map(t.participantRecords.map((r) => [r.name, r.classification]));
    expect(byName.get("Kira Sen")).toBe("customer");
    expect(byName.get("Pax Ellis")).toBe("vendor");
    expect(t.diagnostics.turns_parsed).toBeGreaterThanOrEqual(4);
  });

  it("does NOT enter no-colon side mode on ordinary prose that mentions 'customer'", () => {
    const t = ingestTranscript(
      ["Dana: Our customer base grew and customer satisfaction improved.", "Rui: The customer wants faster onboarding this year."].join("\n")
    );
    const names = t.participantRecords.map((r) => r.name);
    expect(names).not.toContain("Our");
    expect(names).not.toContain("The");
  });
});

describe("inline 'Name — Role: text' turn parsing (single-line descriptor+utterance)", () => {
  it("parses speakers and sides from an inline em-dash descriptor before the colon", () => {
    // Descriptor AND the utterance are on ONE line — a very common export format
    // ("Priya — Customer, Director: We are not renewing."). The explicit
    // Customer/Vendor tag is the strongest side signal and must win.
    const t = ingestTranscript(
      [
        "Marcus — Vendor, Account Executive: I cover the account and brought our specialist.",
        "Priya — Customer, Director of Operations: Our median recovery time is 84 minutes and we need it under 20.",
        "Devon — Customer, VP and Budget Owner: I approved the program budget and can select a vendor within it.",
        "Ada — Vendor, Solutions Engineer: What environment is in scope for a proof of value?"
      ].join("\n")
    );
    expect(t.diagnostics.turns_parsed).toBeGreaterThanOrEqual(4);
    const byName = new Map(t.participantRecords.map((r) => [r.name, r.classification]));
    expect(byName.get("Marcus")).toBe("vendor");
    expect(byName.get("Ada")).toBe("vendor");
    expect(byName.get("Priya")).toBe("customer");
    expect(byName.get("Devon")).toBe("customer");
  });

  it("does NOT treat an ordinary mid-sentence em-dash aside as a speaker", () => {
    // "we — as a team — decided:" has an em-dash but no role descriptor, so it
    // must not be mistaken for a "Name — Role:" turn header.
    const t = ingestTranscript(
      ["Nolan: We — as a team — decided: the checkout latency is the priority this quarter."].join("\n")
    );
    expect(t.participantRecords.map((r) => r.name)).toEqual(["Nolan"]);
  });
});

