import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerRunQuestion } from "@/lib/run-assistant/assistantService";
import { validateCitedIds } from "@/lib/run-assistant/evidenceRetriever";
import { recordExchange, readExchanges } from "@/lib/run-assistant/assistantStore";
import type { RunAssistantContext } from "@/lib/run-assistant/types";

const context: RunAssistantContext = {
  run_id: "run-x",
  transcript_text: "Maya: Security may have renewal-related flexibility. Jordan: I'd like a working session around two or three scenarios.",
  evidence_items: [
    { evidence_id: "t1", source_type: "transcript", text: "Security may have renewal-related flexibility but not a confirmed replacement." },
    { evidence_id: "t2", source_type: "transcript", text: "I'd like a working session around two or three scenarios, not a generic platform presentation." },
    { evidence_id: "t3", source_type: "transcript", text: "Procurement does not need to join yet." }
  ],
  next_action_summary: "Run a scenario-based working session with two or three credible scenarios.",
  open_questions: ["Who is the economic buyer?", "What is the budget owner?"],
  do_not_reask: ["Procurement timing", "Current environment"],
  personal_relevance_summary: "Routed to you because it fits your security expansion goal.",
  goal_alignment_summary: "Supports: expand the security portfolio."
};

describe("run assistant (grounded)", () => {
  it("answers from run evidence and cites valid evidence IDs", () => {
    const a = answerRunQuestion("What did they say about renewal?", context);
    expect(a.answer.toLowerCase()).toContain("renewal");
    expect(a.evidence.length).toBeGreaterThan(0);
    expect(validateCitedIds(a.evidence.map((e) => e.evidence_id), context).valid).toBe(true);
  });

  it("does not invent an answer and identifies missing information", () => {
    const a = answerRunQuestion("What is their Kubernetes cluster version?", context);
    expect(a.confidence).toBeLessThan(0.5);
    expect(a.missing_information.length).toBeGreaterThan(0);
    expect(a.evidence.length).toBe(0);
  });

  it("uses canonical fields for intent questions (next action, do-not-reask, why me)", () => {
    expect(answerRunQuestion("What is the next action?", context).answer).toContain("working session");
    expect(answerRunQuestion("What should I not ask again?", context).answer.toLowerCase()).toContain("procurement");
    expect(answerRunQuestion("Why was this sent to me?", context).answer.toLowerCase()).toContain("security");
  });

  it("rejects unknown evidence IDs", () => {
    expect(validateCitedIds(["t1", "does-not-exist"], context).valid).toBe(false);
  });

  it("respects an explicit research request flag (no auto web search)", () => {
    const a = answerRunQuestion("What is the next action?", context, { research: true });
    expect(a.research_used).toBe(false);
    expect(a.suggested_follow_up).toMatch(/research/i);
  });
});

describe("run assistant persistence", () => {
  let originalDataDir: string | undefined;
  beforeEach(async () => {
    originalDataDir = process.env.LOCAL_DATA_DIR;
    process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "assistant-test-"));
  });
  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
    else process.env.LOCAL_DATA_DIR = originalDataDir;
  });

  it("persists exchanges per run", async () => {
    const a = answerRunQuestion("What did they say about renewal?", context);
    await recordExchange("run-x", "What did they say about renewal?", a);
    const log = await readExchanges("run-x");
    expect(log.length).toBe(1);
    expect(log[0].question).toContain("renewal");
  });
});
