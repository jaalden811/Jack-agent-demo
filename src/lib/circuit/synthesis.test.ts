import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { groundedSynthesis } from "@/lib/circuit/synthesis";
import { synthesizeAssistantAnswer } from "@/lib/run-assistant/assistantSynthesis";
import type { AssistantAnswer, RunAssistantContext } from "@/lib/run-assistant/types";

/**
 * Grounded Circuit synthesis is an enhancement layer: when Circuit is not
 * configured (as in CI) it MUST fall back to the deterministic value and
 * report used=false — never break or fabricate.
 */

const CIRCUIT_ENV = ["CIRCUIT_CLIENT_ID", "CIRCUIT_CLIENT_SECRET", "CIRCUIT_TOKEN_URL", "CIRCUIT_INFERENCE_URL", "CIRCUIT_APP_KEY", "CIRCUIT_MODEL", "CIRCUIT_CONTRACT_CONFIRMED"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of CIRCUIT_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of CIRCUIT_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("groundedSynthesis", () => {
  it("returns the deterministic fallback with used=false when Circuit is not configured", async () => {
    const result = await groundedSynthesis<{ v: string }>({
      schema: z.object({ v: z.string() }),
      buildPrompt: () => "{}",
      fallback: () => ({ v: "deterministic" })
    });
    expect(result.used).toBe(false);
    expect(result.output.v).toBe("deterministic");
    expect(result.safe_error_code).toBe("CIRCUIT_NOT_CONFIGURED");
  });
});

describe("synthesizeAssistantAnswer", () => {
  const ctx: RunAssistantContext = {
    run_id: "r1",
    account: "AECOM",
    transcript_text: "",
    evidence_items: [],
    next_action_summary: null,
    open_questions: [],
    do_not_reask: [],
    personal_relevance_summary: null,
    goal_alignment_summary: null
  };

  it("returns the deterministic answer unchanged when Circuit is unavailable", async () => {
    const deterministic: AssistantAnswer = {
      answer: "Based on the meeting evidence: the customer requested a working session.",
      evidence: [{ evidence_id: "t1", source_type: "transcript", label: "working session" }],
      confidence: 0.7,
      missing_information: [],
      suggested_follow_up: null,
      research_used: false
    };
    const out = await synthesizeAssistantAnswer("what is the next step?", ctx, deterministic);
    expect(out.answer).toBe(deterministic.answer);
    expect(out.synthesized_by_ai).toBeFalsy();
  });

  it("never synthesizes when there is no grounding evidence", async () => {
    const deterministic: AssistantAnswer = {
      answer: "The run evidence doesn't cover that.",
      evidence: [],
      confidence: 0.2,
      missing_information: ["No evidence"],
      suggested_follow_up: null,
      research_used: false
    };
    const out = await synthesizeAssistantAnswer("did they mention pricing?", ctx, deterministic);
    expect(out).toBe(deterministic);
  });
});
