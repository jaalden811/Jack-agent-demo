import { getObjective } from "@/lib/personalization/objectiveCatalog";
import type { RelevanceInput } from "@/lib/personalization/relevanceScore";
import type { GoalImpact, PersonalRelevance, PersonalizationContext, SellerProfile } from "@/lib/personalization/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Extracts the decoupled RelevanceInput from the full deterministic result
 * (read-only) and builds the SAFE PersonalizationContext for Circuit Stage
 * C/D. The context never includes private compensation values.
 */

const NON_ACTIONABLE = new Set(["hold", "suppress"]);

export function relevanceInputFromResult(result: SecureNetworkingTriageResult, goalImpact: GoalImpact): RelevanceInput {
  const nba = result.next_best_action;
  const account = result.account_resolution;
  return {
    matched_category_ids: result.matches.map((m) => m.entry_id).filter(Boolean),
    matched_evidence_ids: (nba?.evidence_ids ?? []).slice(0, 6),
    verdict: result.executive_summary.verdict,
    account_name: account?.name ?? result.executive_summary.account ?? null,
    account_status: account?.status ?? "unresolved",
    account_geography: null,
    account_segment: null,
    action: {
      actionable: Boolean(nba) && !NON_ACTIONABLE.has(nba.action_type),
      owner_lane: nba?.owner_lane ?? "",
      primary_owner: nba?.primary_owner ?? "",
      recommended_timing: nba?.recommended_timing ?? null,
      due_basis: nba?.due_basis ?? "none",
      confidence: nba?.confidence ?? 0
    },
    recommended_specialists: result.recommended_specialists ?? [],
    overall_confidence: result.executive_summary.confidence ?? 0,
    goal_impact_status: goalImpact.status,
    strategic_size_band: goalImpact.strategic_size_band
  };
}

export function buildPersonalizationContext(params: {
  profile: SellerProfile;
  relevance: PersonalRelevance;
  goalImpact: GoalImpact;
  attendanceStatus?: string;
  alreadyKnows?: string[];
  doNotReask?: string[];
  includeGoalImpact?: boolean;
}): PersonalizationContext {
  const { profile, relevance, goalImpact } = params;
  const topDimensions = [...relevance.factors].sort((a, b) => b.contribution - a.contribution).slice(0, 3).map((f) => f.dimension);
  return {
    recipient: {
      profile_id: profile.profile_id,
      role_family: profile.role_family,
      lane: profile.lane,
      title: profile.title,
      location: profile.location,
      territories: profile.territories,
      specialties: profile.specialties,
      product_domains: profile.product_domains
    },
    goals: profile.goals.map((g) => ({ goal_id: g.goal_id, label: getObjective(g.goal_id)?.label ?? g.goal_id, weight: g.weight })),
    measurement_metrics: profile.measurement_metrics,
    notification_preferences: { message_density: profile.notification_preferences.message_density, tone: profile.notification_preferences.tone },
    personal_relevance: { score: relevance.score, band: relevance.band, top_dimensions: topDimensions },
    // Owner-scoped: only include goal impact when explicitly building the
    // owner's own context (never another recipient's).
    goal_impact: params.includeGoalImpact === false ? { status: "unavailable", headline: "" } : { status: goalImpact.status, headline: goalImpact.headline },
    attendance_status: params.attendanceStatus ?? "UNKNOWN",
    already_knows: params.alreadyKnows ?? [],
    do_not_reask: params.doNotReask ?? []
  };
}
