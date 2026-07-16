import { buildOpportunityTeaser, buildRecipientTeasers } from "@/lib/notifications/personalizedTeaser";
import { decideNotification, type NotificationExtras } from "@/lib/notifications/notificationPolicy";
import { buildPersonalizationContext, relevanceInputFromResult } from "@/lib/personalization/contextBuilder";
import { computeGoalImpact, unavailableGoalImpact } from "@/lib/personalization/goalImpact";
import { computePersonalRelevance, unavailableRelevance } from "@/lib/personalization/relevanceScore";
import type { PersonalizationBlock, PersonalizationContext, SellerProfile } from "@/lib/personalization/types";
import type { SearchTrace } from "@/lib/objective-search/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/** Empty canonical search trace (no objective search executed yet). */
function emptySearchTrace(objectiveIds: string[]): SearchTrace {
  return { planner_version: "objective-planner-v1", objective_ids: objectiveIds, queries_planned: 0, queries_executed: 0, raw_cache_hits: 0, derived_cache_hits: 0, queries_suppressed: 0, budget_before: 0, budget_after: 0, fallback_used: false, items: [] };
}

/**
 * Assembles the additive personalization block for the run. Purely a
 * function of the (already-final) deterministic result + the seller profile —
 * it NEVER mutates the result and never touches deterministic scores,
 * routing, or evidence identity. When no profile exists, returns an
 * "unavailable" block so the product degrades gracefully.
 */

const STRATEGIC_OBJECTIVES = new Set(["grow_strategic_accounts", "prioritize_large_enterprise"]);

/** Builds the SAFE recipient personalization context for Circuit Stage C/D
 * from the deterministic result + profile (pre-promotion). Returns null when
 * there is no profile. Never includes private compensation values. */
export function buildPersonalizationContextForResult(params: {
  result: SecureNetworkingTriageResult;
  profile: SellerProfile | null;
  verifiedOpportunityValue?: number | null;
}): PersonalizationContext | null {
  const { result, profile } = params;
  if (!profile) return null;
  const strategicByObjective = profile.goals.some((g) => STRATEGIC_OBJECTIVES.has(g.goal_id));
  const goalImpact = computeGoalImpact({ profile, verifiedOpportunityValue: params.verifiedOpportunityValue ?? null, accountStatus: result.account_resolution?.status ?? "unresolved", strategicByObjective });
  const relevance = computePersonalRelevance(relevanceInputFromResult(result, goalImpact), profile);
  return buildPersonalizationContext({ profile, relevance, goalImpact, includeGoalImpact: true });
}

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
      search_plan: emptySearchTrace([])
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
    recipient_teasers: buildRecipientTeasers({ result, profile, relevance, goalImpact }),
    search_plan: emptySearchTrace(profile.goals.map((g) => g.goal_id))
  };
}
