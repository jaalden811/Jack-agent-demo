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

export type WorkshopScenario = {
  scenario_id: string;
  statement: string;
  speaker: string | null;
  data_sources: string[];
  evidence_ids: string[];
};

export type WorkshopPlan = {
  requested: boolean;
  format: string | null;
  candidate_scenarios: WorkshopScenario[];
  data_sources: string[];
  required_participants: string[];
  data_constraints: string[];
  timing: string | null;
  /** true when procurement must engage, false when the customer said it need
   * not join yet, null when procurement was not addressed. */
  procurement_needed: boolean | null;
};

/** A concise executive read of the packet — Circuit-synthesized when available
 * (grounded strictly in the extracted criteria/objections/impact, never new
 * claims), else a deterministic composition. `source` makes provenance honest. */
export type DecisionPacketNarrative = {
  text: string;
  source: "circuit" | "deterministic";
};

export type DecisionPacket = {
  narrative: DecisionPacketNarrative;
  business_impact: ImpactEntry[];
  decision_criteria: DecisionCriterion[];
  objections: ObjectionEntry[];
  workshop_plan: WorkshopPlan;
  evidence_quality: {
    criteria_count: number;
    objection_count: number;
    impact_count: number;
    confidence: number;
    limitations: string[];
  };
};
