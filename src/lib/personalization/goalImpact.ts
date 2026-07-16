import type { GoalImpact, SellerProfile } from "@/lib/personalization/types";

/**
 * Goal-impact computation. Uses ONLY user-provided/verified opportunity value
 * (or transparent public size proxies) — never invents a deal value and never
 * converts company revenue into deal value. Quantified quota math requires
 * both a verified opportunity value AND an annual target on the owner's
 * profile. Compensation inputs are private (owner-scoped).
 */

const SIZE_THRESHOLDS = { strategic: 1_000_000, large: 250_000, medium: 50_000 };

function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function sizeBandFromValue(value: number): GoalImpact["strategic_size_band"] {
  if (value >= SIZE_THRESHOLDS.strategic) return "strategic";
  if (value >= SIZE_THRESHOLDS.large) return "large";
  if (value >= SIZE_THRESHOLDS.medium) return "medium";
  return "small";
}

export function unavailableGoalImpact(reason: string): GoalImpact {
  return {
    status: "unavailable",
    headline: "Goal impact unavailable",
    verified_opportunity_value: null,
    quota_contribution_percent: null,
    remaining_target_contribution_percent: null,
    strategic_size_band: "unknown",
    basis: [],
    limitations: [reason, "Company revenue is never converted into deal value."]
  };
}

export function computeGoalImpact(params: {
  profile: SellerProfile | null;
  verifiedOpportunityValue: number | null;
  accountStatus: string;
  strategicByObjective?: boolean;
}): GoalImpact {
  const { profile, verifiedOpportunityValue, accountStatus } = params;
  const comp = profile?.compensation_context ?? null;

  if (verifiedOpportunityValue != null && verifiedOpportunityValue > 0) {
    const band = sizeBandFromValue(verifiedOpportunityValue);
    if (comp?.annual_target && comp.annual_target > 0) {
      const quotaPct = Math.round((verifiedOpportunityValue / comp.annual_target) * 1000) / 10;
      let remainingPct: number | null = null;
      if (comp.current_attainment != null) {
        const attainedFraction = comp.current_attainment > 1 ? Math.min(1, comp.current_attainment / 100) : Math.max(0, comp.current_attainment);
        const remainingTarget = comp.annual_target * (1 - attainedFraction);
        if (remainingTarget > 0) remainingPct = Math.round((verifiedOpportunityValue / remainingTarget) * 1000) / 10;
      }
      return {
        status: "quantified",
        headline: `${money(verifiedOpportunityValue)} ≈ ${quotaPct}% of your annual target`,
        verified_opportunity_value: verifiedOpportunityValue,
        quota_contribution_percent: quotaPct,
        remaining_target_contribution_percent: remainingPct,
        strategic_size_band: band,
        basis: ["Verified opportunity value provided by the user/uploaded data", "Owner's annual target"],
        limitations: ["Quota impact is private to the owner and never shared with other recipients."]
      };
    }
    return {
      status: "qualitative",
      headline: `${money(verifiedOpportunityValue)} verified opportunity value (${band})`,
      verified_opportunity_value: verifiedOpportunityValue,
      quota_contribution_percent: null,
      remaining_target_contribution_percent: null,
      strategic_size_band: band,
      basis: ["Verified opportunity value provided by the user/uploaded data"],
      limitations: ["No annual target on the profile, so quota contribution cannot be computed."]
    };
  }

  // No verified value: only a qualitative strategic band, and only when there
  // is a defensible basis (confirmed account + a strategic objective focus).
  if (params.strategicByObjective && (accountStatus === "confirmed" || accountStatus === "probable")) {
    return {
      status: "qualitative",
      headline: "Strategically sized opportunity (no verified deal value yet)",
      verified_opportunity_value: null,
      quota_contribution_percent: null,
      remaining_target_contribution_percent: null,
      strategic_size_band: "strategic",
      basis: ["Resolved account aligns with the seller's strategic-account focus"],
      limitations: ["No verified opportunity value — size band is qualitative.", "Company revenue is never converted into deal value."]
    };
  }

  return unavailableGoalImpact("No verified opportunity value provided.");
}
