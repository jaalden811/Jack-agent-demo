import { z } from "zod";
import { groundedSynthesis } from "@/lib/circuit/synthesis";
import { loadSuggestedRoles } from "@/lib/intelligence/internalActionPlan";
import type { IntelligencePacket, InternalActionPlan } from "@/lib/intelligence/types";

/**
 * Circuit enrichment of the INTERNAL action plan. The deterministic plan decides
 * WHO coordinates with whom (owners, lanes, the customer step) — that stays
 * authoritative. Circuit only sharpens the DEAL-SPECIFIC narrative, grounded
 * strictly in this run's evidence:
 *   - a tailored internal `your_move`;
 *   - per existing partner (matched by lane): a deal-specific `why` + `prepare`;
 *   - ADVISORY `suggested_coordination` — extra roles the fixed triggers miss
 *     (legal on redlines, a product specialist on a named competitor, a delivery
 *     lead on a deployment-timeline condition), role-only and from an allow-list.
 *
 * Circuit can never add a named internal owner, change the routing lanes, or
 * touch scores/evidence identity. Any failure (or Circuit not configured) keeps
 * the deterministic plan verbatim (source stays "deterministic").
 */

const enrichmentSchema = z.object({
  your_move: z.string().optional(),
  coordinate_with: z
    .array(
      z.object({
        lane: z.enum(["sales", "technical", "executive"]),
        why: z.string(),
        prepare: z.array(z.string())
      })
    )
    .optional(),
  suggested_coordination: z
    .array(z.object({ role: z.string(), why: z.string(), trigger: z.string() }))
    .optional()
});

type Enrichment = z.infer<typeof enrichmentSchema>;

function badText(s: string): boolean {
  return !s || !s.trim() || /https?:\/\//i.test(s) || s.includes("…");
}

export async function enrichInternalActionPlan(plan: InternalActionPlan, packet: IntelligencePacket): Promise<InternalActionPlan> {
  const inputLanes = new Set(plan.coordinate_with.map((c) => c.lane));
  const suggestedRoles = loadSuggestedRoles();
  const allowedRoleKeys = new Set(suggestedRoles.map((r) => r.toLowerCase()));

  const result = await groundedSynthesis<Enrichment>({
    schema: enrichmentSchema,
    buildPrompt: () =>
      JSON.stringify({
        task:
          "You are refining an INTERNAL coordination plan for one seller (the primary owner). Do NOT change who coordinates with whom — the `coordinate_with` lanes and the customer step are fixed. Using ONLY the provided evidence, return: (1) `your_move`: one concrete internal next move for the primary owner (coordination/prep, NOT the customer step); (2) `coordinate_with`: for EACH provided partner lane, a deal-specific `why` (one sentence tied to what is actually unresolved in THIS conversation) and a `prepare` list of 2-4 concrete items grounded in the evidence (real integrations, risks, data sources, gaps — never generic filler); (3) optional `suggested_coordination`: 0-3 ADDITIONAL roles to loop in that the evidence clearly warrants, each a { role, why, trigger }. The `role` MUST be chosen verbatim from `allowed_suggested_roles`; never invent a role and never name a person. Do NOT add a partner lane that is not in `partner_lanes`. Use ONLY the provided facts — no invented numbers, names, dates, or URLs. Return ONE JSON object.",
        account: packet.identity.account_label,
        primary_owner_lane: plan.primary_owner.lane,
        customer_next_step: plan.customer_engagement.next_step,
        partner_lanes: [...inputLanes],
        allowed_suggested_roles: suggestedRoles,
        evidence: {
          customer_problem: packet.customer_evidence.business_impacts.map((b) => b.statement).slice(0, 5),
          headline_metric: packet.deal_intelligence.headline_metric,
          value_hypothesis: packet.deal_intelligence.value_hypothesis,
          decision_criteria: packet.qualification.decision_criteria.map((c) => c.statement).slice(0, 8),
          objections: packet.customer_evidence.objections.map((o) => ({ type: o.type, statement: o.statement })).slice(0, 6),
          risks: packet.deal_intelligence.landmines.map((r) => r.label).slice(0, 6),
          meddpicc: packet.qualification.meddpicc,
          workshop: { requested: packet.workshop.requested, scenarios: packet.workshop.scenarios.slice(0, 4), data_sources: packet.workshop.data_sources.slice(0, 6) },
          current_environment: packet.current_environment,
          public_context: packet.public_context.map((p) => p.label).slice(0, 4)
        }
      }),
    validate: (o) => {
      const issues: string[] = [];
      if (o.your_move !== undefined && (badText(o.your_move) || o.your_move.length > 320)) issues.push("your_move is empty, over budget, or contains a URL/ellipsis");
      const seen = new Set<string>();
      for (const c of o.coordinate_with ?? []) {
        if (!inputLanes.has(c.lane)) issues.push(`coordinate_with lane '${c.lane}' is not one of the fixed partner lanes`);
        if (seen.has(c.lane)) issues.push(`duplicate coordinate_with lane '${c.lane}'`);
        seen.add(c.lane);
        if (badText(c.why) || c.why.length > 240) issues.push(`coordinate_with.${c.lane}.why is empty/over budget/has a URL`);
        const prep = c.prepare.filter((p) => !badText(p) && p.length <= 160);
        if (prep.length === 0) issues.push(`coordinate_with.${c.lane}.prepare has no valid items`);
      }
      for (const s of o.suggested_coordination ?? []) {
        if (!allowedRoleKeys.has(s.role.trim().toLowerCase())) issues.push(`suggested role '${s.role}' is not in the allowed list`);
        if (badText(s.why) || badText(s.trigger)) issues.push("suggested_coordination has empty/invalid why or trigger");
      }
      return issues;
    },
    fallback: () => ({} as Enrichment)
  });

  if (!result.used) return { ...plan, source: "deterministic" };

  const o = result.output;
  // Merge Circuit's deal-specific narrative onto the deterministic skeleton: the
  // owners/lanes/customer step stay authoritative; only why/prepare/your_move are
  // refined, and advisory suggestions are appended.
  const byLane = new Map((o.coordinate_with ?? []).map((c) => [c.lane, c]));
  const coordinate_with = plan.coordinate_with.map((p) => {
    const enriched = byLane.get(p.lane);
    if (!enriched) return p;
    const prep = enriched.prepare.map((s) => s.trim()).filter((s) => s && !badText(s) && s.length <= 160).slice(0, 4);
    return { ...p, why: enriched.why.trim() || p.why, prepare: prep.length > 0 ? prep : p.prepare };
  });

  const suggested = (o.suggested_coordination ?? [])
    .filter((s) => allowedRoleKeys.has(s.role.trim().toLowerCase()))
    .slice(0, 3)
    .map((s) => ({ role: s.role.trim(), why: s.why.trim(), trigger: s.trigger.trim() }));

  return {
    ...plan,
    your_move: o.your_move && !badText(o.your_move) ? o.your_move.trim() : plan.your_move,
    coordinate_with,
    suggested_coordination: suggested.length > 0 ? suggested : undefined,
    source: "circuit"
  };
}
