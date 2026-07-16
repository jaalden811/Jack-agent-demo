import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerRunQuestion } from "@/lib/run-assistant/assistantService";
import { validateCitedIds } from "@/lib/run-assistant/evidenceRetriever";
import { recordExchange, readExchanges } from "@/lib/run-assistant/assistantStore";
import type { RunAssistantContext } from "@/lib/run-assistant/types";

const context: RunAssistantContext = {
  run_id: "run-x",
  account: "AECOM",
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

  it("the deterministic answer never auto-searches the web", () => {
    const a = answerRunQuestion("What is the next action?", context, { research: true });
    expect(a.research_used).toBe(false); // answerRunQuestion itself never searches
  });
});

describe("assistant research uses the same objective-aware controller", () => {
  let originalDataDir: string | undefined;
  beforeEach(async () => {
    originalDataDir = process.env.LOCAL_DATA_DIR;
    process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "assistant-research-test-"));
  });
  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
    else process.env.LOCAL_DATA_DIR = originalDataDir;
  });

  it("explicit research executes a planner-controlled query via the shared controller", async () => {
    const { runAssistantResearch } = await import("@/lib/run-assistant/assistantResearch");
    const provider = vi.fn(async () => [{ source_id: "", query_id: "", title: "AECOM security news", url: "https://aecom.com/n", canonical_url: "https://aecom.com/n", domain: "aecom.com", snippet: "s", published_at: null, position: 0, provider: "serpapi" as const, source_authority_hint: 0.6, raw_cache_key: "", found_by_query_ids: [] }]);
    const res = await runAssistantResearch({ question: "Any recent security incidents?", account: "AECOM", provider, providerReadyOverride: true });
    expect((provider as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    expect(res.rows.length).toBe(1);
    expect(res.trace.queries_executed).toBe(1);
  });

  it("does nothing when there is no account (no provider call)", async () => {
    const { runAssistantResearch } = await import("@/lib/run-assistant/assistantResearch");
    const provider = vi.fn(async () => []);
    const res = await runAssistantResearch({ question: "Any budget?", account: null, provider, providerReadyOverride: true });
    expect((provider as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    expect(res.rows.length).toBe(0);
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
