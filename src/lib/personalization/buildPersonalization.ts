import { buildOpportunityTeaser } from "@/lib/notifications/personalizedTeaser";
import { decideNotification, type NotificationExtras } from "@/lib/notifications/notificationPolicy";
import { relevanceInputFromResult } from "@/lib/personalization/contextBuilder";
import { computeGoalImpact, unavailableGoalImpact } from "@/lib/personalization/goalImpact";
import { computePersonalRelevance, unavailableRelevance } from "@/lib/personalization/relevanceScore";
import type { PersonalizationBlock, SellerProfile } from "@/lib/personalization/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Assembles the additive personalization block for the run. Purely a
 * function of the (already-final) deterministic result + the seller profile —
 * it NEVER mutates the result and never touches deterministic scores,
 * routing, or evidence identity. When no profile exists, returns an
 * "unavailable" block so the product degrades gracefully.
 */

const STRATEGIC_OBJECTIVES = new Set(["grow_strategic_accounts", "prioritize_large_enterprise"]);

export function buildPersonalizationBlock(params: {
  result: SecureNetworkingTriageResult;
  profile: SellerProfile | null;
  verifiedOpportunityValue?: number | null;
  extras?: NotificationExtras;
}): PersonalizationBlock {
  const { result, profile } = params;
  const accountStatus = result.account_resolution?.status ?? "unresolved";

  if (!profile) {
    const goalImpact = unavailableGoalImpact("No seller profile configured.");
    const relevance = unavailableRelevance();
    return {
      profile_id: null,
      profile_complete: false,
      personal_relevance: relevance,
      goal_alignment: [],
      goal_impact: goalImpact,
      notification_decision: decideNotification({ result, relevance, profile: null, extras: params.extras }),
      opportunity_teaser: buildOpportunityTeaser({ result, profile: null, relevance, goalImpact, forOwner: false }),
      search_plan: { objective_ids: [], queries_planned: 0, queries_executed: 0, cache_hits: 0, budget_remaining: 0 }
    };
  }

  const strategicByObjective = profile.goals.some((g) => STRATEGIC_OBJECTIVES.has(g.goal_id));
  const goalImpact = computeGoalImpact({
    profile,
    verifiedOpportunityValue: params.verifiedOpportunityValue ?? null,
    accountStatus,
    strategicByObjective
  });
  const relevance = computePersonalRelevance(relevanceInputFromResult(result, goalImpact), profile, { novelty: params.extras?.novelty });

  return {
    profile_id: profile.profile_id,
    profile_complete: profile.profile_completeness >= 0.7,
    personal_relevance: relevance,
    goal_alignment: relevance.goal_alignment,
    goal_impact: goalImpact,
    notification_decision: decideNotification({ result, relevance, profile, extras: params.extras }),
    opportunity_teaser: buildOpportunityTeaser({ result, profile, relevance, goalImpact, forOwner: true }),
    search_plan: { objective_ids: profile.goals.map((g) => g.goal_id), queries_planned: 0, queries_executed: 0, cache_hits: 0, budget_remaining: 0 }
  };
}
