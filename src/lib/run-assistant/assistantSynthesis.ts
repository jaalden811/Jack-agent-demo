import { z } from "zod";
import { groundedSynthesis } from "@/lib/circuit/synthesis";
import type { AssistantAnswer, RunAssistantContext } from "@/lib/run-assistant/types";

/**
 * Optional Circuit rewrite of a grounded assistant answer. Circuit only
 * rephrases the deterministic answer using the SAME retrieved evidence into
 * clearer, more natural prose — it never adds facts, numbers, names, URLs, or
 * claims not already in the grounded answer/evidence. The deterministic
 * answer's evidence, confidence, and missing-information stay authoritative;
 * only the prose changes. Falls back to the deterministic answer whenever
 * Circuit is unavailable or its output fails the grounding checks.
 */

const answerSchema = z.object({ answer: z.string().min(1) });

export async function synthesizeAssistantAnswer(
  question: string,
  _context: RunAssistantContext,
  deterministic: AssistantAnswer
): Promise<AssistantAnswer> {
  // Nothing to rewrite when the deterministic path found no grounding — never
  // let Circuit "answer from knowledge" where the run evidence is silent.
  if (deterministic.evidence.length === 0) return deterministic;

  const result = await groundedSynthesis<{ answer: string }>({
    schema: answerSchema,
    buildPrompt: () =>
      JSON.stringify({
        task:
          "Rewrite the grounded answer into a clear, natural, concise reply (2–4 sentences) to the user's question about a sales call. Use ONLY the provided grounded_answer + evidence — do NOT add facts, numbers, names, dates, URLs, or claims that are not already present. Do not speculate. Return ONE JSON object: { \"answer\": string }.",
        question,
        grounded_answer: deterministic.answer,
        evidence: deterministic.evidence.map((e) => ({ id: e.evidence_id, source: e.source_type, text: e.label }))
      }),
    validate: (o) => {
      const issues: string[] = [];
      const text = o.answer.trim();
      if (!text) issues.push("empty answer");
      if (text.length > 900) issues.push("answer exceeds the concise budget");
      if (/https?:\/\//i.test(text)) issues.push("answer must not contain a URL");
      if (text.includes("…")) issues.push("answer contains a truncation ellipsis");
      return issues;
    },
    fallback: () => ({ answer: deterministic.answer })
  });

  if (!result.used) return deterministic;
  // Keep the deterministic (authoritative) evidence/confidence/gaps; only the
  // human-readable prose is Circuit's.
  return { ...deterministic, answer: result.output.answer.trim(), synthesized_by_ai: true };
}
