import { readFileSync } from "node:fs";
import path from "node:path";
import { listObjectives } from "@/lib/personalization/objectiveCatalog";
import type { GoalAlignment, PersonalRelevance, PersonalRelevanceFactor, SellerProfile } from "@/lib/personalization/types";

/**
 * Deterministic Personal Relevance scoring. Reads the (already-computed)
 * deterministic result + the seller profile and returns a SEPARATE score
 * object. It never mutates the result and never reads/writes any of the
 * factual opportunity scores — so changing a seller profile changes personal
 * relevance and message emphasis but NEVER the deterministic opportunity
 * scores. All weights/penalties/bands are read from
 * signal-agent-poc/config/personal_relevance_scoring.json (weights sum to 1).
 */

type RelevanceConfig = {
  weights: Record<string, number>;
  bands: { high: number; medium: number };
  penalties: Record<string, number> & { max_total: number };
  confidence: { base: number; per_present_input: number; min: number; max: number };
  inputs_for_confidence: string[];
};

const CONFIG_RELATIVE_PATH = "signal-agent-poc/config/personal_relevance_scoring.json";
let cached: RelevanceConfig | null = null;
export function clearRelevanceConfigCache(): void {
  cached = null;
}
function loadConfig(): RelevanceConfig {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(path.join(process.cwd(), CONFIG_RELATIVE_PATH), "utf8")) as RelevanceConfig;
  return cached;
}

/** Minimal, decoupled view of the run needed for relevance — extracted from
 * the full result by relevanceInputFromResult(). */
export type RelevanceInput = {
  matched_category_ids: string[];
  matched_evidence_ids: string[];
  verdict: string;
  account_name: string | null;
  account_status: string;
  account_geography: string | null;
  account_segment: string | null;
  action: { actionable: boolean; owner_lane: string; primary_owner: string; recommended_timing: string | null; due_basis: string; confidence: number };
  recommended_specialists: string[];
  overall_confidence: number;
  goal_impact_status: "quantified" | "qualitative" | "unavailable";
  strategic_size_band: string;
};

export type RelevanceExtras = { novelty?: number; duplicate?: boolean; stale?: boolean };

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function includesAny(haystack: string[], needles: string[]): boolean {
  const hay = haystack.map((h) => h.toLowerCase());
  return needles.some((n) => {
    const t = n.toLowerCase();
    return hay.some((h) => h.includes(t) || t.includes(h));
  });
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bl = b.map((x) => x.toLowerCase());
  const hits = a.filter((x) => bl.some((y) => y.includes(x.toLowerCase()) || x.toLowerCase().includes(y))).length;
  return clamp01(hits / a.length);
}

/** The seller's active objective definitions (goals present on the profile). */
function sellerObjectives(profile: SellerProfile) {
  const goalIds = new Set(profile.goals.map((g) => g.goal_id));
  return listObjectives().filter((o) => goalIds.has(o.objective_id));
}

function prioritizesLargeAccounts(profile: SellerProfile): boolean {
  const ids = new Set(profile.goals.map((g) => g.goal_id));
  return ids.has("prioritize_large_enterprise") || ids.has("grow_strategic_accounts");
}

/** Personal relevance when no usable profile exists. */
export function unavailableRelevance(): PersonalRelevance {
  return {
    score: 0,
    confidence: 0,
    band: "unavailable",
    factors: [],
    missing_inputs: ["seller_profile"],
    goal_alignment: [],
    penalties_applied: []
  };
}

export function computePersonalRelevance(input: RelevanceInput, profile: SellerProfile, extras: RelevanceExtras = {}): PersonalRelevance {
  const config = loadConfig();
  const missing: string[] = [];
  const objectives = sellerObjectives(profile);

  // --- goal alignment (per goal + aggregate dimension) ---
  const goalAlignment: GoalAlignment[] = [];
  let goalDimTotal = 0;
  let goalWeightTotal = 0;
  for (const goal of profile.goals) {
    const obj = objectives.find((o) => o.objective_id === goal.goal_id);
    let alignment: number;
    let reason: string;
    if (!obj) {
      alignment = 0.3;
      reason = "Goal not found in the objective catalog; treated as weak, generic alignment.";
    } else if (obj.compatible_taxonomy_categories.length === 0) {
      // Broad objective (e.g. strategic accounts) — aligns via account/size dims, neutral here.
      alignment = 0.5;
      reason = `Broad objective "${obj.label}" — aligned via account/size factors.`;
    } else {
      alignment = overlapRatio(input.matched_category_ids, obj.compatible_taxonomy_categories);
      reason = alignment > 0 ? `Opportunity motion matches "${obj.label}".` : `Opportunity motion does not match "${obj.label}".`;
    }
    goalAlignment.push({ goal_id: goal.goal_id, alignment: Math.round(alignment * 100) / 100, reason });
    goalDimTotal += alignment * (goal.weight || 0.5);
    goalWeightTotal += goal.weight || 0.5;
  }
  if (profile.goals.length === 0) missing.push("goals");
  const goalDim = goalWeightTotal > 0 ? clamp01(goalDimTotal / goalWeightTotal) : 0;

  // --- other dimensions ---
  const lane = profile.lane.toLowerCase();
  const laneFit = input.action.owner_lane && input.action.owner_lane.toLowerCase() === lane ? 1 : lane === "leadership" ? 0.6 : input.recommended_specialists.length > 0 && lane === "specialist" ? 0.7 : 0.3;

  const roleFit = (() => {
    if (input.action.owner_lane && input.action.owner_lane.toLowerCase() === lane) return 1;
    if (lane === "leadership") return 0.7;
    if (lane === "specialist" && input.recommended_specialists.length > 0) return 0.8;
    if (lane === "sales") return 0.6;
    return 0.4;
  })();

  if (profile.assigned_account_types.length === 0) missing.push("account_ownership");
  const accountOwnership = profile.assigned_account_types.length > 0 && input.account_segment && includesAny(profile.assigned_account_types, [input.account_segment]) ? 1 : input.account_status === "confirmed" ? 0.6 : input.account_status === "probable" ? 0.5 : 0.3;

  if (profile.territories.length === 0) missing.push("territories");
  const territoryFit = profile.territories.length === 0 ? 0.5 : input.account_geography && includesAny(profile.territories, [input.account_geography]) ? 1 : 0.2;

  if (profile.segments.length === 0) missing.push("segments");
  const segmentFit = profile.segments.length === 0 ? 0.5 : input.account_segment && includesAny(profile.segments, [input.account_segment]) ? 1 : 0.2;

  if (profile.specialties.length === 0) missing.push("specialties");
  const specialtyFit = profile.specialties.length === 0 ? 0.5 : overlapRatio(input.matched_category_ids, profile.specialties) || (includesAny(profile.specialties, input.matched_category_ids) ? 0.6 : 0.2);

  if (profile.product_domains.length === 0) missing.push("product_domains");
  const productDomainFit = profile.product_domains.length === 0 ? 0.5 : overlapRatio(input.matched_category_ids, profile.product_domains) || (includesAny(profile.product_domains, input.matched_category_ids) ? 0.6 : 0.2);

  if (profile.measurement_metrics.length === 0) missing.push("measurement_metrics");
  const measurementTypes = objectives.flatMap((o) => o.measurement_types);
  const measurementAlignment = profile.measurement_metrics.length === 0 ? 0.5 : overlapRatio(profile.measurement_metrics, measurementTypes) || 0.4;

  const sizeBand = (input.strategic_size_band || "unknown").toLowerCase();
  const opportunitySizeAlignment = (() => {
    const big = prioritizesLargeAccounts(profile);
    if (sizeBand === "strategic" || sizeBand === "large") return big ? 1 : 0.6;
    if (sizeBand === "small") return big ? 0.3 : 0.6;
    return 0.5;
  })();

  const timingAlignment = (() => {
    switch (input.action.due_basis) {
      case "customer_commitment":
        return 0.85;
      case "renewal":
      case "operational_urgency":
        return 0.8;
      case "planning_boundary":
        return 0.7;
      case "procurement":
        return 0.6;
      default:
        return input.action.recommended_timing ? 0.55 : 0.4;
    }
  })();

  const actionability = input.action.actionable ? (input.action.primary_owner ? 1 : 0.6) : 0;
  const novelty = clamp01(extras.novelty ?? 1);
  const evidenceConfidence = clamp01(input.overall_confidence || input.action.confidence);

  const dims: Record<string, { score: number; reason: string; evidence_ids: string[] }> = {
    goal_alignment: { score: goalDim, reason: goalDim > 0 ? "Opportunity aligns with the seller's active goals." : "No configured goal matches this opportunity motion.", evidence_ids: input.matched_evidence_ids.slice(0, 4) },
    account_ownership: { score: accountOwnership, reason: `Account "${input.account_name ?? "unresolved"}" ownership fit (${input.account_status}).`, evidence_ids: [] },
    product_domain_fit: { score: productDomainFit, reason: "Match between the seller's product domains and the opportunity motion.", evidence_ids: [] },
    actionability: { score: actionability, reason: input.action.actionable ? "A specific, owned next action exists." : "No actionable next step.", evidence_ids: [] },
    role_fit: { score: roleFit, reason: `Role family/lane fit for a ${profile.role_family} (${profile.lane}).`, evidence_ids: [] },
    territory_fit: { score: territoryFit, reason: "Territory fit vs the account geography.", evidence_ids: [] },
    lane_fit: { score: laneFit, reason: `Lane fit (action owner lane ${input.action.owner_lane || "n/a"}).`, evidence_ids: [] },
    specialty_fit: { score: specialtyFit, reason: "Specialty fit vs the opportunity motion.", evidence_ids: [] },
    timing_alignment: { score: timingAlignment, reason: `Timing basis: ${input.action.due_basis || "none"}.`, evidence_ids: [] },
    measurement_alignment: { score: measurementAlignment, reason: "Fit between how the seller is measured and the goal's measurement types.", evidence_ids: [] },
    segment_fit: { score: segmentFit, reason: "Market-segment fit vs the account.", evidence_ids: [] },
    opportunity_size_alignment: { score: opportunitySizeAlignment, reason: `Opportunity size band: ${sizeBand}.`, evidence_ids: [] },
    evidence_confidence: { score: evidenceConfidence, reason: "Confidence in the underlying evidence.", evidence_ids: [] },
    novelty: { score: novelty, reason: novelty >= 1 ? "New opportunity for this recipient." : "Previously seen — reduced novelty.", evidence_ids: [] }
  };

  // --- weighted sum ---
  const factors: PersonalRelevanceFactor[] = [];
  let total = 0;
  for (const [dimension, weight] of Object.entries(config.weights)) {
    const d = dims[dimension] ?? { score: 0, reason: "not evaluated", evidence_ids: [] };
    const contribution = weight * d.score * 100;
    total += contribution;
    factors.push({ dimension, score: Math.round(d.score * 100) / 100, weight, contribution: Math.round(contribution * 100) / 100, reason: d.reason, evidence_ids: d.evidence_ids });
  }

  // --- penalties ---
  const penaltiesApplied: string[] = [];
  let penalty = 0;
  const addPenalty = (code: string) => {
    const amount = config.penalties[code] ?? 0;
    if (amount > 0) {
      penalty += amount;
      penaltiesApplied.push(code);
    }
  };
  if (input.account_status !== "confirmed" && input.account_status !== "probable") addPenalty("unresolved_account");
  if (!input.action.actionable) addPenalty("no_clear_action");
  if (input.action.actionable && !input.action.primary_owner) addPenalty("missing_recipient");
  if (extras.duplicate) addPenalty("duplicate_alert");
  if (extras.stale) addPenalty("stale_opportunity");
  if (goalDim < 0.05) addPenalty("no_goal_alignment");
  if (input.goal_impact_status === "unavailable") addPenalty("unverifiable_opportunity_size");
  if (evidenceConfidence < 0.4) addPenalty("low_evidence_quality");
  penalty = Math.min(penalty, config.penalties.max_total);

  const score = Math.max(0, Math.round(total - penalty));
  const band: PersonalRelevance["band"] = score >= config.bands.high ? "high" : score >= config.bands.medium ? "medium" : "low";

  // --- confidence from present inputs ---
  const presentInputs = config.inputs_for_confidence.filter((key) => {
    switch (key) {
      case "role_family":
        return Boolean(profile.role_family);
      case "lane":
        return Boolean(profile.lane);
      case "territories":
        return profile.territories.length > 0;
      case "segments":
        return profile.segments.length > 0;
      case "specialties":
        return profile.specialties.length > 0;
      case "product_domains":
        return profile.product_domains.length > 0;
      case "goals":
        return profile.goals.length > 0;
      case "measurement_metrics":
        return profile.measurement_metrics.length > 0;
      case "account_ownership":
        return profile.assigned_account_types.length > 0;
      default:
        return false;
    }
  }).length;
  const confidence = Math.max(config.confidence.min, Math.min(config.confidence.max, config.confidence.base + config.confidence.per_present_input * presentInputs));

  return {
    score,
    confidence: Math.round(confidence * 100) / 100,
    band,
    factors,
    missing_inputs: Array.from(new Set(missing)),
    goal_alignment: goalAlignment,
    penalties_applied: penaltiesApplied
  };
}
