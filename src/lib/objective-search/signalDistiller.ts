import { loadSearchBudgetPolicy } from "@/lib/objective-search/searchBudget";
import type { DistilledPublicSignal } from "@/lib/objective-search/types";

/**
 * Deterministic distiller that keeps ONLY the public signals salient enough to
 * change the recipient's action, capped to the configured primary limit.
 * Public evidence is account-context/narrative eligible but NEVER
 * scoring-eligible (neutral, not negative) and can never confirm private
 * facts (budget, Economic Buyer). Complements Circuit Stage B.
 */

export type RawSignalCandidate = {
  id: string;
  url: string;
  title: string;
  snippet: string;
  authority?: number;
  account_relevance: number;
  opportunity_relevance: number;
  seller_goal_relevance?: number;
};

export function distillPublicSignals(candidates: RawSignalCandidate[]): DistilledPublicSignal[] {
  const policy = loadSearchBudgetPolicy();
  const eligible = candidates
    .filter((c) => c.account_relevance >= policy.min_account_relevance_for_teaser && c.opportunity_relevance >= policy.min_opportunity_relevance_for_teaser)
    .sort((a, b) => b.account_relevance + b.opportunity_relevance - (a.account_relevance + a.opportunity_relevance))
    .slice(0, policy.max_primary_signals);

  return eligible.map((c) => ({
    public_fact: c.title || c.snippet.slice(0, 140),
    source_id: c.id,
    source_url: c.url,
    source_authority: Math.max(0, Math.min(1, c.authority ?? 0.5)),
    account_relevance: Math.max(0, Math.min(1, c.account_relevance)),
    opportunity_relevance: Math.max(0, Math.min(1, c.opportunity_relevance)),
    seller_goal_relevance: Math.max(0, Math.min(1, c.seller_goal_relevance ?? 0)),
    implication: `Public context relevant to the opportunity: ${c.title || c.snippet.slice(0, 80)}`,
    action_effect: "Adds account context to the recommended next step; does not change the deterministic score.",
    limitation: "Public source — account context / narrative only; never confirms private budget, Economic Buyer, or a deal value.",
    // Public evidence is neutral: usable for account context + narrative, but
    // never scoring-eligible (so it can never confirm private facts).
    eligibility: { account_context: true, narrative: true, scoring: false }
  }));
}
