import type { OpportunityScoringResult, SerpApiSignalsResult } from "@/lib/opportunity-fit/types";

export function buildDefaultSerpApiSignals(reason: string | null = "not run"): SerpApiSignalsResult {
  return { status: "not_run", reason, queries: [], signals: [], strong_signal_count: 0, supporting_signal_count: 0, weak_signal_count: 0, rejected_result_count: 0 };
}

export function buildDefaultOpportunityScoring(): OpportunityScoringResult {
  return {
    transcript_score: 0,
    qualification_score: 0,
    external_fit_score: null,
    account_confidence_score: 0,
    final_pursuit_score: 0,
    decision: "HOLD",
    confidence: 0,
    score_version: "opportunity-fit-v1",
    weights: {},
    factors: [],
    gates: [],
    signal_strength: { score: 0, band: "LOW" },
    deal_maturity: "PROBLEM_DISCOVERY",
    qualification_completeness: 0
  };
}
