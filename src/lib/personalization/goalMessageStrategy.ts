import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Goal → message-strategy resolution (recipient personalization spine).
 *
 * A recipient's goals change message EMPHASIS only — which risk to lead the
 * watch-out with, which evidence/momentum to foreground, and how to frame the
 * why-this-matters / action / outcome. Goals NEVER change opportunity facts,
 * scores, MEDDPICC, routing, or account identity. The mapping is fully
 * data-driven (config/recipient_goal_message_taxonomy.json); this module only
 * scores goal-to-opportunity fit deterministically and never references a
 * company, product, or transcript.
 */

export type GoalMessageStrategy = {
  why_this_matters_focus: string[];
  why_now_focus: string[];
  action_focus: string[];
  expected_outcome_focus: string[];
  watch_out_focus: string[];
};

export type GoalFrame = {
  goal_id: string;
  label: string;
  alignment: number;
  reason: string;
  preferred_risk_types: string[];
  preferred_momentum_types: string[];
  message_strategy: GoalMessageStrategy;
};

export type ResolvedGoalFrames = {
  frames: GoalFrame[];
  source: "profile" | "lane_default" | "none";
  goal_ids_used: string[];
};

type TaxonomyGoal = {
  goal_id: string;
  label: string;
  allowed_lanes: string[];
  compatible_opportunity_categories: string[];
  preferred_momentum_types: string[];
  preferred_risk_types: string[];
  message_strategy: GoalMessageStrategy;
  default_weight: number;
  active: boolean;
};
type Taxonomy = { goals: TaxonomyGoal[]; lane_default_goals: Record<string, string[]> };

let cached: Taxonomy | null = null;

export function clearGoalTaxonomyCache(): void {
  cached = null;
}

function loadTaxonomy(): Taxonomy {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "recipient_goal_message_taxonomy.json");
  cached = JSON.parse(readFileSync(filePath, "utf8")) as Taxonomy;
  return cached;
}

export type GoalFrameInputs = {
  /** Recipient goals from the resolved profile: { goal_id, weight }. Empty/omitted → lane defaults. */
  profileGoals: Array<{ goal_id: string; weight?: number }>;
  lane: "sales" | "technical" | "leadership" | "specialist";
  /** Category IDs the run matched (from taxonomy matching). */
  matchedCategoryIds: string[];
  /** Deal-intel momentum + risk IDs actually present on this opportunity. */
  presentMomentumIds: string[];
  presentRiskIds: string[];
};

function scoreGoal(goal: TaxonomyGoal, inputs: GoalFrameInputs, weight: number): { alignment: number; reason: string } {
  const catCompatible =
    goal.compatible_opportunity_categories.includes("*") ||
    goal.compatible_opportunity_categories.some((c) => inputs.matchedCategoryIds.includes(c));
  const momentumHits = goal.preferred_momentum_types.filter((m) => inputs.presentMomentumIds.includes(m)).length;
  const riskHits = goal.preferred_risk_types.filter((r) => inputs.presentRiskIds.includes(r)).length;
  // Evidence must actually support the goal frame — no evidence, no forced hook.
  const evidenceHits = momentumHits + riskHits;
  if (!catCompatible || evidenceHits === 0) return { alignment: 0, reason: "No aligned evidence for this goal on this opportunity." };
  const catScore = goal.compatible_opportunity_categories.includes("*") ? 0.4 : 1.0;
  const evidenceScore = Math.min(1, evidenceHits / 3);
  const alignment = Math.round(Math.min(1, weight * (0.5 * catScore + 0.5 * evidenceScore)) * 100) / 100;
  const reason = momentumHits > 0 ? "This opportunity shows the momentum this goal prioritizes." : "This opportunity carries the risk this goal must manage.";
  return { alignment, reason };
}

/** Resolves the top (<=2) goal frames for a recipient/lane. Uses profile goals
 * when present, else the lane defaults. Only goals with supporting evidence are
 * returned (no forced goal hook). */
export function resolveGoalFrames(inputs: GoalFrameInputs): ResolvedGoalFrames {
  const taxonomy = loadTaxonomy();
  const byId = new Map(taxonomy.goals.filter((g) => g.active).map((g) => [g.goal_id, g]));
  const laneOk = (g: TaxonomyGoal) => g.allowed_lanes.includes(inputs.lane) || g.allowed_lanes.includes("*");

  const fromProfile = inputs.profileGoals
    .map((pg) => ({ goal: byId.get(pg.goal_id), weight: pg.weight ?? byId.get(pg.goal_id)?.default_weight ?? 0.5 }))
    .filter((x): x is { goal: TaxonomyGoal; weight: number } => Boolean(x.goal) && laneOk(x.goal!));

  const toFrame = (goal: TaxonomyGoal, weight: number): GoalFrame | null => {
    const { alignment, reason } = scoreGoal(goal, inputs, weight);
    if (alignment <= 0) return null;
    return {
      goal_id: goal.goal_id,
      label: goal.label,
      alignment,
      reason,
      preferred_risk_types: goal.preferred_risk_types,
      preferred_momentum_types: goal.preferred_momentum_types,
      message_strategy: goal.message_strategy
    };
  };

  if (fromProfile.length > 0) {
    const frames = fromProfile
      .map((x) => toFrame(x.goal, x.weight))
      .filter((f): f is GoalFrame => Boolean(f))
      .sort((a, b) => b.alignment - a.alignment)
      .slice(0, 2);
    if (frames.length > 0) return { frames, source: "profile", goal_ids_used: frames.map((f) => f.goal_id) };
    // Profile exists but no goal aligns to this opportunity → no forced hook.
    return { frames: [], source: "profile", goal_ids_used: [] };
  }

  // No profile → lane defaults (still evidence-gated).
  const defaults = (taxonomy.lane_default_goals[inputs.lane] ?? [])
    .map((id) => byId.get(id))
    .filter((g): g is TaxonomyGoal => Boolean(g))
    .filter(laneOk);
  const frames = defaults
    .map((g) => toFrame(g, g.default_weight))
    .filter((f): f is GoalFrame => Boolean(f))
    .sort((a, b) => b.alignment - a.alignment)
    .slice(0, 2);
  return { frames, source: frames.length > 0 ? "lane_default" : "none", goal_ids_used: frames.map((f) => f.goal_id) };
}
