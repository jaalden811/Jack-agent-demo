import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { NormalizedPublicSignal } from "@/lib/opportunity-fit/types";
import type { StageBInput, StageBOutput, StageBSource } from "@/lib/circuit/stages/stageB";

/**
 * Builds a Stage B input (+ deterministic-fallback output) from an
 * already-computed run's normalized SerpAPI signals. Circuit re-classifies
 * these; if Circuit is unavailable/invalid, the existing deterministic
 * classification (which already carries the three eligibility levels) is
 * used verbatim. No URL or source is ever invented — the input source set
 * is authoritative.
 */

function toSource(signal: NormalizedPublicSignal, transcriptThemes: string[]): StageBSource {
  return {
    source_id: signal.signal_id,
    query_purpose: signal.subcategory,
    title: signal.source_title,
    url: signal.source_url,
    domain: signal.source_domain,
    snippet: signal.claim,
    published_at: signal.published_at,
    account_candidate: signal.account_name,
    transcript_themes: transcriptThemes,
    source_authority: signal.source_authority
  };
}

function toClassified(signal: NormalizedPublicSignal): StageBOutput["classified_sources"][number] {
  return {
    source_id: signal.signal_id,
    entity_match: signal.entity_match,
    source_authority: signal.source_authority,
    transcript_relevance: signal.transcript_relevance,
    signal_category: signal.category,
    public_fact: signal.claim,
    implication: signal.supports.length > 0 ? `Supports ${signal.supports.join(", ")}.` : "",
    limitation: signal.limitations[0] ?? "Public signal — does not prove any private budget, stage, or renewal.",
    account_context_eligible: signal.account_context_eligible,
    narrative_eligible: signal.narrative_eligible,
    scoring_eligible: signal.scoring_eligible,
    supports: signal.supports,
    contradicts: [],
    evidence_ids: [signal.signal_id]
  };
}

export function buildStageBInput(result: SecureNetworkingTriageResult): StageBInput {
  const signals = result.serpapi_signals?.signals ?? [];
  const transcriptThemes = result.matches.slice(0, 3).map((m) => m.pain_category).filter(Boolean);

  const sources = signals.map((s) => toSource(s, transcriptThemes));

  const deterministic: StageBOutput = {
    classified_sources: signals.map(toClassified),
    distilled_signals: signals
      .filter((s) => s.narrative_eligible)
      .map((s) => ({
        claim: s.claim,
        category: s.category,
        strength: s.scoring_eligible ? "strong" : s.narrative_eligible ? "supporting" : "weak",
        primary_source_id: s.signal_id,
        corroborating_source_ids: [],
        implication: s.supports.length > 0 ? `Supports ${s.supports.join(", ")}.` : "",
        limitation: s.limitations[0] ?? ""
      })),
    rejected_sources: signals
      .filter((s) => s.rejection_reasons.length > 0 && !s.account_context_eligible && !s.narrative_eligible)
      .map((s) => ({ source_id: s.signal_id, reason: s.rejection_reasons[0] }))
  };

  return { run_id: result.run_id, account: result.account_resolution?.name ?? null, sources, deterministic };
}
