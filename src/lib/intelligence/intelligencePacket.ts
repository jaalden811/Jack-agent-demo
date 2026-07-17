import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import type { IntelligencePacket, PacketSignal, PacketStakeholder } from "@/lib/intelligence/types";

/**
 * Assembles the canonical IntelligencePacket from an analysis result. Pure
 * consolidation + normalization — it never re-parses the transcript, changes a
 * score, or invents a fact. It enforces the customer/vendor separation so the
 * buying committee and customer evidence carry customer-side people/utterances
 * only (the last line of defense behind speaker-side classification).
 */

function customerSideNames(result: SecureNetworkingTriageResult): Set<string> {
  const names = new Set<string>();
  for (const p of result.stakeholder_analysis?.participants ?? []) {
    if (p.classification === "customer" && p.name) names.add(p.name.trim().toLowerCase());
  }
  return names;
}

function toSignal(s: { id: string; label: string; evidence?: string | null; speaker?: string | null }): PacketSignal {
  return { id: s.id, label: s.label, evidence: s.evidence ?? null, speaker: s.speaker ?? null };
}

export function buildIntelligencePacket(result: SecureNetworkingTriageResult): IntelligencePacket {
  const account = getCanonicalAccount(result);
  const di = result.deal_intelligence;
  const dp = result.decision_packet;
  const nba = result.next_best_action;
  const scoring = result.opportunity_scoring;
  const summary = result.executive_summary;
  const primaryMatch = result.matches?.[0];

  // Customer-only buying committee. The power map is already customer-side after
  // speaker classification; this re-guards against any leak (a name that is NOT
  // a classified customer participant is dropped unless no customer set exists).
  const custNames = customerSideNames(result);
  const powerMap = di?.power_map ?? [];
  const stakeholders: PacketStakeholder[] = powerMap
    .filter((p) => custNames.size === 0 || custNames.has(p.name.trim().toLowerCase()))
    .map((p) => ({ name: p.name, role_label: p.role_label, stance: p.stance, play: p.play, evidence: p.evidence }));

  const momentum = (di?.momentum ?? []).map(toSignal);
  const landmines = (di?.risks ?? []).map(toSignal);
  const momentumIds = new Set(momentum.map((m) => m.id));

  const teasers = result.personalization?.recipient_teasers;
  const teaserFor = (lane: "sales" | "technical" | "leadership") => {
    const t = teasers?.[lane];
    if (!t) return undefined;
    return { why_you: t.why_you, goal_alignment: t.goal_alignment ?? null, goal_impact: t.goal_impact ?? null };
  };

  const isActionable = Boolean(nba && nba.action_type !== "suppress" && nba.action_type !== "hold");

  return {
    identity: {
      run_id: result.run_id,
      account: account.name,
      account_label: account.label,
      account_prose: account.prose,
      account_resolved: account.status === "confirmed" || account.status === "probable",
      account_confidence: account.confidence,
      participant_count: (result.stakeholder_analysis?.participants ?? []).length
    },
    opportunity: {
      verdict: summary.verdict,
      signal_strength: scoring?.signal_strength?.score ?? 0,
      signal_band: scoring?.signal_strength?.band ?? "LOW",
      pursuit_decision: scoring?.decision ?? "HOLD",
      pursuit_score: Math.round(scoring?.final_pursuit_score ?? 0),
      pursuit_confidence: scoring?.confidence ?? 0,
      deal_maturity: scoring?.deal_maturity ?? "PROBLEM_DISCOVERY",
      primary_opportunity: summary.primary_opportunity ?? primaryMatch?.pain_category ?? "the customer's stated priorities",
      primary_solution_motion: primaryMatch?.recommended_solutions?.[0] ?? null,
      is_actionable: isActionable
    },
    customer_evidence: {
      pains: [],
      business_impacts: (dp?.business_impact ?? []).map((b) => ({ statement: b.statement, speaker: null, evidence_ids: [] })),
      objections: (dp?.objections ?? []).map((o) => ({ statement: o.statement, speaker: o.speaker, evidence_ids: o.evidence_ids, type: o.type })),
      explicit_negations: (dp?.objections ?? []).filter((o) => o.type === "disqualifier").map((o) => o.statement),
      do_not_reask: result.specialist_handoffs?.sales?.questions_not_to_reask ?? []
    },
    qualification: {
      meddpicc: Object.fromEntries(Object.entries(result.meddpicc ?? {}).map(([k, v]) => [k, (v as { status: string }).status])),
      decision_criteria: (dp?.decision_criteria ?? []).map((c) => ({ statement: c.statement, speaker: c.speaker, evidence_ids: c.evidence_ids }))
    },
    current_environment: (result.specialist_handoffs?.technical?.current_environment ?? primaryMatch?.solution_decision?.retained_existing_platforms ?? []).slice(0, 6),
    stakeholders,
    deal_intelligence: {
      deal_shape: di?.deal_shape?.label ?? null,
      deal_shape_tags: di?.deal_shape?.tags ?? [],
      why_real: momentum,
      momentum,
      landmines,
      top_landmine: landmines[0] ?? null,
      value_hypothesis: di?.value_hypothesis ?? null,
      headline_metric: di?.headline_metric ?? null,
      timing_driver: di?.timing ? { label: di.timing.label, is_procurement: di.timing.is_procurement } : null,
      existing_footprint: momentumIds.has("existing_footprint"),
      exec_program: momentumIds.has("exec_program")
    },
    next_action: {
      primary_action: isActionable ? (nba?.title?.trim() || null) : null,
      primary_action_type: nba?.action_type ?? "hold",
      owner_lane: nba?.owner_lane ?? "shared",
      summary: nba?.summary ?? "",
      success_criteria: (nba?.success_criteria ?? []).filter(Boolean),
      why_now: (nba?.why_now ?? []).filter(Boolean),
      recommended_timing: nba?.recommended_timing ?? null,
      evidence_ids: nba?.evidence_ids ?? []
    },
    workshop: {
      requested: dp?.workshop_plan?.requested ?? false,
      format: dp?.workshop_plan?.format ?? null,
      scenarios: (dp?.workshop_plan?.candidate_scenarios ?? []).map((s) => s.statement),
      data_sources: dp?.workshop_plan?.data_sources ?? [],
      success_criteria: (nba?.success_criteria ?? []).filter(Boolean)
    },
    public_context: (di?.public_context ?? []).map(toSignal),
    personalization: {
      profile_present: Boolean(result.personalization?.profile_complete || result.personalization?.profile_id),
      recipient_teasers: {
        sales: teaserFor("sales"),
        technical: teaserFor("technical"),
        leadership: teaserFor("leadership")
      }
    },
    provenance: {
      analysis_mode: (result as never as { analysis_mode?: string }).analysis_mode ?? "deterministic",
      message_source: (result as never as { message_source?: string }).message_source ?? "deterministic_fallback",
      limitations: dp?.evidence_quality?.limitations ?? []
    }
  };
}
