import { z } from "zod";
import { groundedSynthesis } from "@/lib/circuit/synthesis";
import type { DecisionPacket, DecisionPacketNarrative } from "@/lib/decision-packet/types";

/**
 * Optional Circuit synthesis of the Decision Packet narrative. Circuit writes a
 * concise executive read grounded STRICTLY in the extracted decision criteria,
 * objections, workshop request, and business impact — it never adds facts,
 * numbers, names, dates, URLs, or claims not present in the packet. Falls back
 * to the deterministic narrative whenever Circuit is unavailable or its output
 * fails the grounding checks.
 */

const narrativeSchema = z.object({ narrative: z.string().min(1) });

export async function synthesizeDecisionPacketNarrative(packet: DecisionPacket, account: string | null): Promise<DecisionPacketNarrative> {
  // Nothing to synthesize from → keep the deterministic composition.
  if (packet.decision_criteria.length === 0 && packet.objections.length === 0) return packet.narrative;

  const result = await groundedSynthesis<{ narrative: string }>({
    schema: narrativeSchema,
    buildPrompt: () =>
      JSON.stringify({
        task:
          "Write a concise (2–3 sentence) executive read of this opportunity for an internal seller. Use ONLY the provided decision criteria, objections, workshop request, and business impact — do NOT add facts, numbers, names, dates, URLs, or claims not present. Convey what the customer cares about, the key objection(s) to address, and the recommended next step. Return ONE JSON object: { \"narrative\": string }.",
        account,
        decision_criteria: packet.decision_criteria.map((c) => ({ theme: c.label, statement: c.statement })).slice(0, 12),
        objections: packet.objections.map((o) => ({ type: o.label, statement: o.statement })).slice(0, 8),
        workshop: {
          requested: packet.workshop_plan.requested,
          format: packet.workshop_plan.format,
          scenarios: packet.workshop_plan.candidate_scenarios.map((s) => s.statement).slice(0, 5)
        },
        business_impact: packet.business_impact.map((i) => i.statement).slice(0, 4)
      }),
    validate: (o) => {
      const issues: string[] = [];
      const t = o.narrative.trim();
      if (!t) issues.push("empty narrative");
      if (t.length > 700) issues.push("narrative exceeds the concise budget");
      if (/https?:\/\//i.test(t)) issues.push("narrative must not contain a URL");
      if (t.includes("…")) issues.push("narrative contains a truncation ellipsis");
      return issues;
    },
    fallback: () => ({ narrative: packet.narrative.text })
  });

  return result.used ? { text: result.output.narrative.trim(), source: "circuit" } : packet.narrative;
}
