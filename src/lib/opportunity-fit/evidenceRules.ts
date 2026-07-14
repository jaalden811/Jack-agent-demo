import { loadOpportunityFitScoringConfig } from "@/lib/opportunity-fit/opportunityFit";
import type { EvidenceClass, PublicSignalCategory, SupportsDimension } from "@/lib/opportunity-fit/types";

/**
 * Generic public-evidence quality scoring and classification (Section
 * 6) plus the hard rule about what a public signal may and may not
 * confirm (Sections 4D/4E/14) — never a lookup for a specific company
 * or product; every input is a 0..1 sub-score already computed
 * generically elsewhere. Weights and thresholds are read from
 * signal-agent-poc/config/opportunity_fit_scoring.json's
 * public_signal_quality section — never hard-coded here.
 */

export function computePublicSignalQuality(params: { entityMatch: number; sourceAuthority: number; transcriptRelevance: number; recency: number; specificity: number }): number {
  const weights = loadOpportunityFitScoringConfig().public_signal_quality.weights;
  return (
    (weights.entity_match ?? 0) * params.entityMatch +
    (weights.source_authority ?? 0) * params.sourceAuthority +
    (weights.transcript_relevance ?? 0) * params.transcriptRelevance +
    (weights.recency ?? 0) * params.recency +
    (weights.specificity ?? 0) * params.specificity
  );
}

export function classifyEvidenceStrength(qualityScore: number): EvidenceClass {
  const thresholds = loadOpportunityFitScoringConfig().public_signal_quality.thresholds;
  if (qualityScore >= thresholds.strong) return "confirmed_public_fact";
  if (qualityScore >= thresholds.supporting) return "probable_public_signal";
  if (qualityScore >= thresholds.weak) return "weak_signal";
  return "rejected";
}

/** What each public-signal category may ever be used to `support` —
 * technology_alignment, for example, may support solution_fit but
 * explicitly can never support buying_capacity or account_fit claims
 * about private facts (install base, contract status, budget). */
export function allowedSupportsForCategory(category: PublicSignalCategory): SupportsDimension[] {
  switch (category) {
    case "strategic_objective":
      return ["strategic_alignment", "solution_fit"];
    case "executive_priority":
      return ["strategic_alignment", "account_fit"];
    case "trigger_event":
      return ["timing", "strategic_alignment"];
    case "technology_alignment":
      return ["solution_fit", "competitive_context"];
    case "buying_capacity":
      return ["buying_capacity", "account_fit"];
    case "competition":
      return ["competitive_context"];
    case "timing":
      return ["timing"];
    case "negative_signal":
      return ["account_fit"];
    default:
      return [];
  }
}

/** A technology mention is supporting evidence only — it never proves
 * install base, an active contract, private architecture, opportunity
 * stage, or a renewal date. Returned as machine-readable limitations
 * attached to every technology_alignment signal. */
export function technologyAlignmentLimitations(): string[] {
  return [
    "Does not prove current install base.",
    "Does not prove an active contract.",
    "Does not prove private architecture.",
    "Does not prove opportunity stage.",
    "Does not prove a renewal date."
  ];
}

/** Buying-capacity indicators (size/revenue/headcount/hiring/capital
 * investment) are fit indicators only — never proof of budget for this
 * specific opportunity. */
export function buyingCapacityLimitations(): string[] {
  return ["Indicates general buying capacity, not confirmed budget for this specific opportunity."];
}

/** MEDDPICC/private-fact fields a public signal may never confirm,
 * regardless of source authority — enforced in code (see
 * meddpiccMerge.ts), restated here so the opportunity-fit and
 * qualification pipelines share one canonical list. */
export const PUBLIC_EVIDENCE_FORBIDDEN_CLAIMS = [
  "internal_budget",
  "opportunity_amount",
  "salesforce_stage",
  "private_renewal_date",
  "procurement_status",
  "private_install_base",
  "economic_buyer_status",
  "champion_status",
  "internal_decision_process"
] as const;
