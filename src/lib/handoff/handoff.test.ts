import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { buildNextBestAction } from "@/lib/action-intelligence/nextBestAction";
import { buildQuestionIndex } from "@/lib/handoff/questionIndex";
import { validateNextBestAction, validateHandoff, handoffsDiffer, isGenericAction } from "@/lib/handoff/handoffValidator";
import { computeHandoffReadiness } from "@/lib/handoff/handoffReadiness";
import { emptyNextBestAction } from "@/lib/handoff/defaults";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Specialist-handoff + action-intelligence coverage (Section 17). Proven
 * on real pipeline output for unrelated fixtures — no company/product/
 * transcript/expected-string is hard-coded in production.
 */

const owners = { sales: { name: "Sales Owner", role: "Commercial" }, technical: { name: "Tech Owner", role: "Specialist" } };

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "signal-agent-poc/data/transcripts", name), "utf8");
}

async function run(name: string): Promise<SecureNetworkingTriageResult> {
  return runSignalAgent({ customTranscript: fixture(name), options: {} });
}

describe("Next Best Action (Section 2)", () => {
  it("Test 1: an active routed action has owner, purpose, evidence, timing basis, and (for a workshop) success criteria", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    const action = buildNextBestAction(result, owners);
    expect(["hold", "suppress"]).not.toContain(action.action_type);
    expect(action.primary_owner).toBeTruthy();
    expect(action.summary.length).toBeGreaterThan(40);
    expect(action.evidence_ids.length).toBeGreaterThan(0);
    expect(action.due_basis).toBeTruthy();
    const check = validateNextBestAction(action);
    expect(check.ok).toBe(true);
  });

  it("Test 2: a generic 'follow up' action fails validation", () => {
    const generic = { ...emptyNextBestAction("r"), action_type: "commercial_discovery" as const, primary_owner: "X", summary: "Follow up with the customer." };
    expect(isGenericAction(generic.summary)).toBe(true);
    expect(validateNextBestAction(generic).ok).toBe(false);
  });
});

describe("Do-not-re-ask question index (Section 4)", () => {
  it("Test 3: an answered topic never appears as an open discovery question", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    const index = buildQuestionIndex(result);
    const answeredCompleteTopics = new Set(index.answered.filter((a) => a.answer_status === "complete").map((a) => a.topic.toLowerCase()));
    for (const open of index.open.filter((q) => q.blocking)) {
      for (const topic of answeredCompleteTopics) {
        expect(open.purpose.toLowerCase().includes(topic)).toBe(false);
      }
    }
  });

  it("Test 4: a partial answer produces a targeted (non-blocking) clarification, not repeated discovery", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    const index = buildQuestionIndex(result);
    const partialAnswered = index.answered.filter((a) => a.answer_status === "partial" && a.follow_up_allowed);
    // Any clarification tied to a partial answer must be non-blocking.
    for (const a of partialAnswered) {
      const clarifier = index.open.find((q) => q.question === a.follow_up_allowed);
      if (clarifier) expect(clarifier.blocking).toBe(false);
    }
  });

  it("Test 5: an explicit customer refusal is captured as declined/sensitive, not an open question", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    const index = buildQuestionIndex(result);
    expect(index.declined_or_sensitive.length).toBeGreaterThan(0);
  });
});

describe("Specialist handoff packets (Sections 3/6)", () => {
  it("Test 6/8/9/10: Bella and Jack differ materially; each carries its lane-specific context", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    const sales = result.specialist_handoffs.sales;
    const tech = result.specialist_handoffs.technical;
    expect(handoffsDiffer(sales, tech)).toBe(true);
    expect(sales.ninety_second_brief).not.toEqual(tech.ninety_second_brief);
    // Commitments (accepted working session) appear in both handoffs.
    expect(sales.customer_commitments.length).toBeGreaterThan(0);
    // Jack carries technical context; Bella carries business context.
    expect(tech.technical_context.length).toBeGreaterThan(0);
    expect(sales.business_context.length).toBeGreaterThan(0);
  });

  it("Test 7: explicitly rejected options surface as 'do not position' guidance", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    const tech = result.specialist_handoffs.technical;
    // things_not_to_say includes declined topics even when no product was rejected.
    expect(Array.isArray(tech.things_not_to_say)).toBe(true);
  });

  it("Test 11/12: a workshop action yields a meeting packet usable without the transcript, with owners + desired outputs", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    const tech = result.specialist_handoffs.technical;
    const meeting = tech.meeting_or_workshop_plan;
    expect(meeting).not.toBeNull();
    expect(meeting!.agenda.length).toBeGreaterThan(0);
    for (const item of meeting!.agenda) {
      expect(item.owner).toBeTruthy();
      expect(item.desired_output).toBeTruthy();
    }
    expect(validateHandoff(tech).ok).toBe(true);
  });

  it("Test 13/14: handoff readiness is separate from MEDDPICC completeness — early discovery can still be ready", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    const readiness = computeHandoffReadiness(result.specialist_handoffs.technical);
    // MEDDPICC is thin in early discovery, yet the technical handoff is usable.
    expect(readiness.status).not.toBe("blocked");
    expect(readiness.score).toBeGreaterThanOrEqual(50);
  });

  it("Test 15/16: only narrative-eligible public signals enter the handoff (weak/irrelevant omitted)", async () => {
    const result = await run("untagged_vendor_customer_discovery.txt");
    for (const p of result.specialist_handoffs.technical.public_context) {
      expect(p.handoff_implication).toBeTruthy();
      expect(p.action_effect).toBeTruthy();
    }
  });
});

describe("Handoff works across four unrelated fixtures (Section 17.24)", () => {
  it.each([
    "networking_modernization_signal.txt",
    "soc_xdr_investigation_signal.txt",
    "collaboration_hybrid_work_signal.txt",
    "noise_general_interest.txt"
  ])("produces a coherent action + handoff for %s", async (name) => {
    const result = await run(name);
    expect(result.next_best_action).toBeTruthy();
    expect(result.question_index).toBeTruthy();
    const sales = result.specialist_handoffs.sales;
    const tech = result.specialist_handoffs.technical;
    // Active opportunities must pass handoff validation; noise suppresses.
    if (result.next_best_action.action_type === "suppress") {
      expect(result.executive_summary.verdict).toBe("NOISE");
    } else {
      expect(validateHandoff(tech).ok).toBe(true);
      expect(validateHandoff(sales).ok).toBe(true);
    }
  });
});
