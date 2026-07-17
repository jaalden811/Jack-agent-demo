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

/** How to work a specific person to win the deal — their role, what they care
 * about, their stance, and the play — all derived from their OWN words. */
export type StakeholderPlay = {
  name: string;
  role_id: string;
  role_label: string;
  stance: "supportive" | "skeptical" | "neutral";
  play: string;
  evidence: string | null;
};

export type DealIntelligence = {
  deal_shape: DealShape;
  /** What makes this real and winnable now (advancing factors). */
  momentum: DealSignal[];
  /** What stalls or kills it — the landmines a seller must respect. */
  risks: DealSignal[];
  /** The business value in the customer's own words. */
  value_hypothesis: string | null;
  /** Who to work, and how — the buying-committee power map (evidence-cited). */
  power_map: StakeholderPlay[];
  /** Distilled public research (SerpAPI) that changes the account read — each
   * with its source. Context/narrative only; never scoring-eligible. */
  public_context: DealSignal[];
  /** The single most compelling quantified metric, in DIGITS and (when the
   * customer stated both) framed baseline→target — e.g. "from 96 to under 30
   * minutes to isolate". Null when no quantified metric was stated. */
  headline_metric: string | null;
  /** The honest timing driver: the decision-relevant deadline/date and whether
   * it is real procurement timing or only a decision/planning boundary. Lets
   * the message say "why now" truthfully instead of manufacturing urgency. */
  timing: { label: string; is_procurement: boolean; evidence: string } | null;
  /** A single honest, compelling read of the opportunity. */
  headline: string;
};
