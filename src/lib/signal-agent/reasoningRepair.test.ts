import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInterrogative } from "@/lib/signal-agent/speechAct";
import { inferSpeakerSide } from "@/lib/signal-agent/speakerSide";
import { ingestTranscript } from "@/lib/signal-agent/transcript";
import { extractBuyingIntentEvidence, extractStakeholders } from "@/lib/signal-agent/intentExtraction";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";

/**
 * Prompt A regression coverage — every reasoning fix is proven with
 * GENERIC inputs (and one unrelated fixture), never a company/product/
 * score baked into production logic.
 */

const FIXTURE = path.join(process.cwd(), "signal-agent-poc/data/transcripts/untagged_vendor_customer_discovery.txt");

describe("Speech-act detection (Section 9)", () => {
  it("Test 12: a seller question ('...or platform renewal?') is interrogative and never confirmed renewal evidence", () => {
    const q = "Compliance, detection gaps, analyst workload, or platform renewal?";
    expect(isInterrogative(q)).toBe(true);
    const t = ingestTranscript(`Rep: ${q}\nRep: We can show you how this works.`);
    const evidence = extractBuyingIntentEvidence(t);
    expect(evidence.some((e) => e.type === "renewal")).toBe(false);
  });

  it("a customer assertion of renewal (not a question) is still captured — the guard only removes questions", () => {
    // Assertive statements are not interrogative and survive the guard.
    expect(isInterrogative("Our SIEM contract is up for renewal in January.")).toBe(false);
    const t = ingestTranscript("Dana — Customer, Ops Lead\nDana: Our SIEM contract is up for renewal in January and we plan to renew it.");
    const evidence = extractBuyingIntentEvidence(t);
    expect(evidence.some((e) => e.type === "renewal")).toBe(true);
  });
});

describe("Speaker-side inference (Section 9) — generic, behavior-based", () => {
  it("Test 14: a seller-behaving speaker (proposes to show/demonstrate, promises follow-up) is inferred vendor", () => {
    const seller = inferSpeakerSide([
      "Based on what we heard, we can show how the platform fits.",
      "Let me map our capabilities to your use cases.",
      "We'll prepare an outline and bring a commercial model."
    ]);
    expect(seller.side).toBe("vendor");
  });

  it("a customer-behaving speaker (owns the environment/budget/team) is inferred customer, never vendor", () => {
    const customer = inferSpeakerSide([
      "In our environment reliability sits with my team.",
      "We run cloud services and our budget is distributed.",
      "We spent hours gathering evidence between tools."
    ]);
    expect(customer.side).toBe("customer");
  });

  it("a curious customer who only asks questions is not misclassified as a vendor", () => {
    const curious = inferSpeakerSide(["What does that mean?", "How would that work?", "When could we see it?"]);
    expect(curious.side).not.toBe("vendor");
  });
});

describe("Untagged vendor/customer discovery fixture — end-to-end (Sections 9-12)", () => {
  it("Test 14/15/16/24: vendors excluded, seller question is not renewal, working session drives SOLUTION_DISCOVERY + PURSUE_WITH_DISCOVERY", async () => {
    const text = readFileSync(FIXTURE, "utf8");
    const result = await runSignalAgent({ customTranscript: text, options: {} });

    // Vendor-side speakers never enter the customer stakeholder set.
    const stakeholderNames = result.stakeholders.map((s) => (s.name ?? "").toLowerCase());
    expect(stakeholderNames).not.toContain("rachel");
    expect(stakeholderNames).not.toContain("daniel");
    expect(stakeholderNames).toContain("jordan");

    // Seller question, planning boundary, and funding placeholder do not
    // become confirmed renewal / procurement timing / dedicated budget.
    expect(result.commercial_signals.renewal_events).toEqual([]);
    expect(result.commercial_signals.timeline).toBeNull();
    expect(result.commercial_signals.budget).toBeNull();

    // Accepted scenario working session -> SOLUTION_DISCOVERY -> not a
    // renewal-led NURTURE.
    expect(result.opportunity_scoring.deal_maturity).toBe("SOLUTION_DISCOVERY");
    expect(result.opportunity_scoring.decision).toBe("PURSUE_WITH_DISCOVERY");
  });

  it("classifies the two seller-behaving speakers as vendor from the untagged transcript", () => {
    const t = ingestTranscript(readFileSync(FIXTURE, "utf8"));
    const byName = new Map(t.participantRecords.map((r) => [r.name, r.classification]));
    expect(byName.get("Rachel")).toBe("vendor");
    expect(byName.get("Daniel")).toBe("vendor");
    expect(byName.get("Jordan")).toBe("customer");
  });
});

describe("extractStakeholders excludes non-customer speakers", () => {
  it("only customer-classified participants become stakeholders", () => {
    const t = ingestTranscript(readFileSync(FIXTURE, "utf8"));
    const stakeholders = extractStakeholders(t);
    const names = stakeholders.map((s) => (s.name ?? "").toLowerCase());
    expect(names).not.toContain("rachel");
    expect(names).not.toContain("daniel");
  });
});
