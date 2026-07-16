/**
 * Decision Packet (additive analytical layer). A structured, evidence-linked,
 * confidence-scored view assembled from evidence the pipeline already produced
 * — it NEVER changes deterministic scores, the verdict, routing, MEDDPICC, or
 * evidence identity. Its purpose is analytical depth: decompose the customer's
 * decision criteria, type their objections (with generic, evidence-grounded
 * response framing), and surface material business impact — each with a
 * confidence and its supporting evidence, and an explicit note of what is
 * missing (the product mirrors the transparency its buyers ask for).
 */

export type DecisionCriterion = {
  criterion_id: string;
  category: string;
  label: string;
  statement: string;
  speaker: string | null;
  confidence: number;
  evidence_ids: string[];
};

export type ObjectionType = "trust" | "commercial" | "technical" | "scope" | "political" | "general";

export type ObjectionEntry = {
  objection_id: string;
  type: ObjectionType;
  label: string;
  statement: string;
  speaker: string | null;
  suggested_response: string;
  evidence_ids: string[];
};

export type ImpactEntry = {
  kind: "quantified" | "qualitative";
  statement: string;
  confidence: number;
};

export type DecisionPacket = {
  business_impact: ImpactEntry[];
  decision_criteria: DecisionCriterion[];
  objections: ObjectionEntry[];
  evidence_quality: {
    criteria_count: number;
    objection_count: number;
    impact_count: number;
    confidence: number;
    limitations: string[];
  };
};
