import type { BuyingIntentEvidence } from "@/lib/signal-agent/types";

/**
 * Aggregates the flat `BuyingIntentEvidence[]` list into the
 * `commercial_signals` block of the output contract — budget, timeline,
 * renewal events, quantified impact, evaluation stage, and purchase
 * language. Purely a reshaping/aggregation step over evidence already
 * extracted in intentExtraction.ts; no new detection logic here.
 */

const PURCHASE_MARKERS = ["prepared to purchase", "purchase this quarter", "ready to buy", "ready to purchase", "ready to move forward"];

export type CommercialSignals = {
  budget: string | null;
  timeline: string | null;
  renewal_events: string[];
  quantified_impact: string[];
  evaluation_stage: string | null;
  purchase_language: string[];
};

export function buildCommercialSignals(evidence: BuyingIntentEvidence[]): CommercialSignals {
  const byType = (type: BuyingIntentEvidence["type"]) => evidence.filter((item) => item.type === type);

  const budgetEvidence = byType("budget");
  const timelineEvidence = byType("timeline");
  const renewalEvidence = byType("renewal");
  const impactEvidence = byType("impact");
  const evaluationEvidence = byType("evaluation");

  const purchaseLanguage = Array.from(
    new Set(
      evidence
        .filter((item) => PURCHASE_MARKERS.some((marker) => item.text.toLowerCase().includes(marker)))
        .map((item) => item.text)
    )
  );

  return {
    budget: budgetEvidence[0]?.text ?? null,
    timeline: timelineEvidence[0]?.text ?? null,
    renewal_events: Array.from(new Set(renewalEvidence.map((item) => item.text))),
    quantified_impact: Array.from(new Set(impactEvidence.map((item) => item.text))),
    evaluation_stage: evaluationEvidence[0]?.text ?? null,
    purchase_language: purchaseLanguage
  };
}
