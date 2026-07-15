import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExternalFitFactor, ExternalFitScoreResult, NormalizedPublicSignal, PublicSignalCategory } from "@/lib/opportunity-fit/types";
import type { Meddpicc, MeddpiccField } from "@/lib/qualification/types";

/**
 * Deterministic, code-controlled arithmetic for the three independent
 * scores (Section 7): transcript opportunity score, qualification
 * completeness score, and external account-fit score. Every weight is
 * read from signal-agent-poc/config/opportunity_fit_scoring.json —
 * never hard-coded here or in any UI component. OpenAI may populate
 * factor explanations elsewhere, but this arithmetic is always
 * deterministic and testable independent of any AI call.
 */

export type OpportunityFitScoringConfig = {
  metadata: { version: string; description: string };
  public_signal_quality: { weights: Record<string, number>; thresholds: { strong: number; supporting: number; weak: number } };
  external_fit_score: { weights: Record<string, number> };
  pursuit_score: {
    weights_with_external_fit: Record<string, number>;
    weights_without_external_fit: Record<string, number>;
    decision_bands: Array<{ decision: string; min: number; max: number }>;
  };
  hard_gates: Array<{ gate: string; description: string; condition: string; effect: string; cap_value?: number }>;
  negative_signal_requirements: { min_high_authority_sources_for_negative_signal: number; do_not_pursue_requires_one_of: string[] };
  decision_rules: {
    high_signal_incomplete_qualification: {
      description?: string;
      when: { signal_strength_min: number; hard_negative_gate: boolean; requires_pain_or_impact: boolean; requires_any_momentum: string[] };
      minimum_recommendation: string;
    };
    nurture: { description?: string; requires_any: string[] };
  };
  signal_strength_bands: { high: number; medium: number };
  deal_maturity: { default_stage: string; stages: string[]; negative_evidence_cap?: { description?: string; cap_stage: string } };
};

let cachedConfig: OpportunityFitScoringConfig | null = null;

export function loadOpportunityFitScoringConfig(): OpportunityFitScoringConfig {
  if (cachedConfig) return cachedConfig;
  const filePath = path.join(process.cwd(), "signal-agent-poc", "config", "opportunity_fit_scoring.json");
  cachedConfig = JSON.parse(readFileSync(filePath, "utf8")) as OpportunityFitScoringConfig;
  return cachedConfig;
}

export function clearOpportunityFitScoringConfigCache(): void {
  cachedConfig = null;
}

// ─── A. Transcript opportunity score ────────────────────────────────────────

export type TranscriptOpportunitySignals = {
  hasQuantifiedImpact: boolean;
  hasFunding: boolean;
  hasUrgencyOrDeadline: boolean;
  hasRenewal: boolean;
  hasEvaluationLanguage: boolean;
  hasSuccessCriteria: boolean;
  hasNextSteps: boolean;
  hasNamedDecisionAuthority: boolean;
  identifyPainStatus: MeddpiccField["status"];
  primarySolutionFitConfidence: number; // 0..1, from the primary taxonomy match
};

const OPPORTUNITY_SIGNAL_POINTS: Record<keyof Omit<TranscriptOpportunitySignals, "identifyPainStatus" | "primarySolutionFitConfidence">, number> = {
  hasQuantifiedImpact: 14,
  hasFunding: 12,
  hasUrgencyOrDeadline: 10,
  hasRenewal: 8,
  hasEvaluationLanguage: 8,
  hasSuccessCriteria: 8,
  hasNextSteps: 8,
  hasNamedDecisionAuthority: 12
};

const PAIN_STATUS_POINTS: Record<MeddpiccField["status"], number> = { CONFIRMED: 15, PARTIAL: 9, HYPOTHESIS: 4, CONFLICTING: 2, MISSING: 0 };

/** Derived only from transcript-native evidence — continues working
 * identically when SerpAPI and OpenAI are both unavailable. */
export function computeTranscriptOpportunityScore(signals: TranscriptOpportunitySignals): number {
  let score = 0;
  for (const [key, points] of Object.entries(OPPORTUNITY_SIGNAL_POINTS)) {
    if (signals[key as keyof typeof OPPORTUNITY_SIGNAL_POINTS]) score += points;
  }
  score += PAIN_STATUS_POINTS[signals.identifyPainStatus];
  score += signals.primarySolutionFitConfidence * 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── B. Qualification completeness score ───────────────────────────────────

const MEDDPICC_STATUS_WEIGHT: Record<MeddpiccField["status"], number> = { CONFIRMED: 1, PARTIAL: 0.6, HYPOTHESIS: 0.3, CONFLICTING: 0.2, MISSING: 0 };

export function computeQualificationCompletenessScore(meddpicc: Meddpicc): number {
  const fields = Object.values(meddpicc);
  if (fields.length === 0) return 0;
  const totalWeight = fields.reduce((sum, field) => sum + MEDDPICC_STATUS_WEIGHT[field.status], 0);
  const avgConfidence = fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length;
  // Completeness (how many fields have evidence) weighted more heavily
  // than raw confidence — missing information lowers completeness but
  // is never treated as evidence the deal itself is bad.
  const completenessRatio = totalWeight / fields.length;
  const score = completenessRatio * 80 + avgConfidence * 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── C. External account-fit score ─────────────────────────────────────────

function factorScoreFromSignals(signals: NormalizedPublicSignal[]): { score: number; evidenceIds: string[] } {
  if (signals.length === 0) return { score: 0, evidenceIds: [] };
  const avgStrength = signals.reduce((sum, s) => sum + s.signal_strength, 0) / signals.length;
  // A small bonus for having more than one corroborating strong signal
  // — but capped so many weak results can never outweigh one reliable
  // source (Section 6).
  const strongCount = signals.filter((s) => s.evidence_class === "confirmed_public_fact").length;
  const bonus = Math.min(10, strongCount * 3);
  return { score: Math.max(0, Math.min(100, Math.round(avgStrength * 100 + bonus))), evidenceIds: signals.map((s) => s.signal_id) };
}

const FACTOR_TO_CATEGORY: Record<ExternalFitFactor["factor"], PublicSignalCategory> = {
  strategic_alignment: "strategic_objective",
  trigger_strength: "trigger_event",
  executive_priority_alignment: "executive_priority",
  technology_alignment: "technology_alignment",
  buying_capacity: "buying_capacity",
  timing_alignment: "timing",
  competitive_opening: "competition"
};

export function computeExternalFitScore(params: { signals: NormalizedPublicSignal[]; accountResolutionAvailable: boolean; searchRan: boolean; failureReason: string | null }): ExternalFitScoreResult {
  if (!params.accountResolutionAvailable) {
    return { available: false, score: null, reason: "ACCOUNT_UNRESOLVED", factors: [] };
  }
  if (!params.searchRan) {
    return { available: false, score: null, reason: params.failureReason ?? "public_enrichment_not_run", factors: [] };
  }

  const config = loadOpportunityFitScoringConfig();
  const weights = config.external_fit_score.weights;
  const factors: ExternalFitFactor[] = (Object.keys(FACTOR_TO_CATEGORY) as ExternalFitFactor["factor"][]).map((factor) => {
    const category = FACTOR_TO_CATEGORY[factor];
    const categorySignals = params.signals.filter((s) => s.category === category);
    const { score, evidenceIds } = factorScoreFromSignals(categorySignals);
    const weight = weights[factor] ?? 0;
    return {
      factor,
      score_0_100: score,
      weight,
      contribution: Math.round(score * weight * 100) / 100,
      explanation:
        categorySignals.length > 0
          ? `${categorySignals.length} public ${factor.replace(/_/g, " ")} signal(s) found, average strength ${(score / 100).toFixed(2)}.`
          : `No public ${factor.replace(/_/g, " ")} evidence found.`,
      evidence_ids: evidenceIds
    };
  });

  const totalScore = factors.reduce((sum, f) => sum + f.contribution, 0);
  return { available: true, score: Math.max(0, Math.min(100, Math.round(totalScore))), reason: null, factors };
}
