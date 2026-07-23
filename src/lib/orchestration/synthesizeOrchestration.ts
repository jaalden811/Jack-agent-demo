import { z } from "zod";
import { groundedSynthesis } from "@/lib/circuit/synthesis";
import { loadOrchestrationPrompt } from "@/lib/circuit/prompts/promptLoader";
import { buildActionCase } from "@/lib/orchestration/buildActionCase";
import type { ActionCase } from "@/lib/orchestration/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Produces the signal-to-action-orchestration-v1 ActionCase. The deterministic
 * assembler (buildActionCase) is AUTHORITATIVE and always runs first — it owns
 * every ID, owner, step, dependency, decision, and evidence reference. Circuit is
 * then given the assembled case + the orchestration master prompt and may refine
 * ONLY three safe prose fields (decision_reason, graph_summary, outcome_summary);
 * it can never change IDs, owners, the decision, the graph, or evidence. Any
 * failure (or Circuit unconfigured) keeps the deterministic prose verbatim.
 */

const refinementSchema = z.object({
  decision_reason: z.string().optional(),
  graph_summary: z.string().optional(),
  outcome_summary: z.string().nullable().optional()
});

function unsafe(s: string | null | undefined): boolean {
  if (!s) return false;
  return /https?:\/\//i.test(s) || s.includes("…") || /\bAI (?:caused|generated|created)\b/i.test(s) || /guaranteed impact|definitively caused/i.test(s);
}

export async function synthesizeOrchestration(result: SecureNetworkingTriageResult): Promise<ActionCase> {
  const base = buildActionCase(result);
  // Nothing worth refining for a non-actionable, empty case.
  if (base.action_graph.steps.length === 0) return base;

  const refined = await groundedSynthesis<z.infer<typeof refinementSchema>>({
    schema: refinementSchema,
    system: (() => {
      try {
        return loadOrchestrationPrompt().text;
      } catch {
        return undefined;
      }
    })(),
    buildPrompt: () =>
      JSON.stringify({
        task:
          "Refine ONLY the prose fields for this already-assembled ActionCase. Return ONE JSON object with only these top-level keys: decision_reason, graph_summary, outcome_summary. Do NOT change or restate IDs, owners, steps, the decision, evidence, or scores. Ground every word in the provided facts. Keep each field to one or two concise sentences. Never claim AI caused an outcome.",
        recommended_decision: base.action_case.recommended_decision,
        account_name: base.action_case.account_name,
        title: base.action_case.title,
        positive_evidence_ids: base.action_case.positive_evidence_ids,
        steps: base.action_graph.steps.map((s) => ({ id: s.id, title: s.title, lane: s.lane, timing: s.timing, requirement: s.requirement, customerFacing: s.customerFacing })),
        current_deterministic_prose: {
          decision_reason: base.action_case.decision_reason,
          graph_summary: base.action_graph.graph_summary,
          outcome_summary: base.outcome_ledger.outcome_summary
        }
      }),
    validate: (o) => {
      const issues: string[] = [];
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && (v.length > 400 || unsafe(v))) issues.push(`${k} is over budget or makes an unsafe/causal/URL claim`);
      }
      return issues;
    },
    fallback: () => ({})
  });

  if (!refined.used) return base;
  const o = refined.output;
  return {
    ...base,
    action_case: { ...base.action_case, decision_reason: o.decision_reason && !unsafe(o.decision_reason) ? o.decision_reason.trim() : base.action_case.decision_reason },
    action_graph: { ...base.action_graph, graph_summary: o.graph_summary && !unsafe(o.graph_summary) ? o.graph_summary.trim() : base.action_graph.graph_summary },
    outcome_ledger: { ...base.outcome_ledger, outcome_summary: o.outcome_summary !== undefined && !unsafe(o.outcome_summary) ? (o.outcome_summary ? o.outcome_summary.trim() : null) : base.outcome_ledger.outcome_summary },
    source: "circuit_refined"
  };
}
