/**
 * Deal Intelligence — the downstream synthesis that answers, honestly and from
 * evidence, "is this real, why now, and what could kill it" so a seller can
 * instantly decide to lean in. Every signal cites the customer's own words; the
 * layer never invents a fact, a number, or a claim. It is additive — it does
 * not change scores, verdict, routing, MEDDPICC, or evidence identity.
 */

export type DealSignal = {
  id: string;
  label: string;
  evidence: string;
  speaker: string | null;
};

export type DealShape = {
  /** e.g. "Expansion / land-and-expand · Aligned to a sponsored program". */
  label: string;
  tags: string[];
  rationale: string | null;
};

export type DealIntelligence = {
  deal_shape: DealShape;
  /** What makes this real and winnable now (advancing factors). */
  momentum: DealSignal[];
  /** What stalls or kills it — the landmines a seller must respect. */
  risks: DealSignal[];
  /** The business value in the customer's own words. */
  value_hypothesis: string | null;
  /** A single honest, compelling read of the opportunity. */
  headline: string;
};
