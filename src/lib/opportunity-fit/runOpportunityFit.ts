import { createHash } from "node:crypto";
import { getConfig } from "@/lib/config";
import { executeSerpApiSearch } from "@/lib/connectors/serpapi/client";
import { SerpApiError, type RawSerpApiResponse } from "@/lib/connectors/serpapi/types";
import {
  planStrategicObjectiveQueries,
  planExecutivePriorityQueries,
  planTriggerEventQueries,
  planTechnologyAlignmentQueries,
  planCompetitionQueries,
  planTimingQueries
} from "@/lib/opportunity-fit/signalCatalog";
import { buildNormalizedSignal, deduplicateSignals, acceptedSignals } from "@/lib/opportunity-fit/signalScoring";
import type { TranscriptOpportunitySignals } from "@/lib/opportunity-fit/opportunityFit";
import type { GateConditionInputs } from "@/lib/opportunity-fit/pursueDecision";
import type { AccountResolution, Meddpicc } from "@/lib/qualification/types";
import type { NormalizedPublicSignal, PublicSignalCategory, QueryPurpose, SerpApiSignalQueryTrace, SerpApiSignalsResult } from "@/lib/opportunity-fit/types";
import type { MatchOutput } from "@/lib/signal-agent/types";

/**
 * Orchestrates the full opportunity-fit pass (Sections 4-10, 15): plans
 * category-specific SerpAPI queries only when transcript evidence
 * supports them, executes and normalizes results, computes the three
 * independent scores, applies hard gates, and produces the final
 * pursuit recommendation. Every step degrades safely — a SerpAPI
 * failure or an unresolved account never blocks the deterministic
 * transcript/MEDDPICC scores.
 */

const MAX_QUERIES = 8;

function queryIdFor(purpose: string, index: number): string {
  return `sf_${createHash("sha256").update(`${purpose}:${index}`).digest("hex").slice(0, 8)}`;
}

export async function runSerpApiSignalSearch(params: {
  accountResolution: AccountResolution;
  transcriptSignals: string[];
  detectedTechnologies: string[];
  namedCompetitors: string[];
  mentionsUrgency: boolean;
  enrichmentEnabled: boolean;
}): Promise<SerpApiSignalsResult> {
  const config = getConfig();
  const accountAvailable = params.accountResolution.status === "confirmed" || params.accountResolution.status === "probable";

  if (!params.enrichmentEnabled) {
    return { status: "not_run", reason: "public enrichment disabled by user", queries: [], signals: [], strong_signal_count: 0, supporting_signal_count: 0, weak_signal_count: 0, rejected_result_count: 0 };
  }
  if (!accountAvailable) {
    return { status: "not_run", reason: "ACCOUNT_UNRESOLVED", queries: [], signals: [], strong_signal_count: 0, supporting_signal_count: 0, weak_signal_count: 0, rejected_result_count: 0 };
  }
  if (!config.hasSerpApi) {
    return { status: "not_run", reason: "SerpAPI is not configured", queries: [], signals: [], strong_signal_count: 0, supporting_signal_count: 0, weak_signal_count: 0, rejected_result_count: 0 };
  }

  const company = params.accountResolution.name as string;
  const domain = params.accountResolution.domain;

  const planned: Array<{ purpose: QueryPurpose; category: PublicSignalCategory; subcategory: string; query: string }> = [];
  for (const q of planStrategicObjectiveQueries(company, params.transcriptSignals)) planned.push({ purpose: "strategic_objective", category: "strategic_objective", subcategory: q.subcategory, query: q.query });
  for (const q of planExecutivePriorityQueries(company, domain)) planned.push({ purpose: "executive_priority", category: "executive_priority", subcategory: q.subcategory, query: q.query });
  for (const q of planTriggerEventQueries(company, params.transcriptSignals)) planned.push({ purpose: "trigger_event", category: "trigger_event", subcategory: q.subcategory, query: q.query });
  for (const q of planTechnologyAlignmentQueries(company, domain, params.detectedTechnologies)) planned.push({ purpose: "technology_alignment", category: "technology_alignment", subcategory: q.subcategory, query: q.query });
  for (const q of planCompetitionQueries(company, domain, params.namedCompetitors)) planned.push({ purpose: "competition", category: "competition", subcategory: q.subcategory, query: q.query });
  for (const q of planTimingQueries(company, params.mentionsUrgency)) planned.push({ purpose: "timing", category: "timing", subcategory: q.subcategory, query: q.query });

  const limited = planned.slice(0, MAX_QUERIES);
  const traces: SerpApiSignalQueryTrace[] = [];
  const allSignals: NormalizedPublicSignal[] = [];
  let rejectedCount = 0;
  let anyFailed = false;

  for (let i = 0; i < limited.length; i += 1) {
    const plan = limited[i];
    const startedAt = Date.now();
    const queryId = queryIdFor(plan.purpose, i);
    try {
      const raw: RawSerpApiResponse = await executeSerpApiSearch({ query: plan.query });
      const organic = raw.organic_results ?? [];
      const normalized = organic
        .filter((r) => r.title && r.link)
        .slice(0, 5)
        .map((r) =>
          buildNormalizedSignal({
            accountName: company,
            accountDomain: domain,
            category: plan.category,
            subcategory: plan.subcategory,
            title: r.title as string,
            url: r.link as string,
            snippet: r.snippet ?? "",
            publishedAt: r.date ?? null,
            transcriptSignals: params.transcriptSignals
          })
        );
      const accepted = acceptedSignals(normalized);
      rejectedCount += normalized.length - accepted.length;
      allSignals.push(...accepted);
      traces.push({
        query_id: queryId,
        purpose: plan.purpose,
        query: plan.query,
        transcript_evidence_ids: [],
        results_returned: organic.length,
        results_accepted: accepted.length,
        cache_hit: false,
        duration_ms: Date.now() - startedAt,
        error_code: null
      });
    } catch (error) {
      anyFailed = true;
      const errorCode = error instanceof SerpApiError ? error.code : "SERPAPI_NETWORK_FAILURE";
      traces.push({
        query_id: queryId,
        purpose: plan.purpose,
        query: plan.query,
        transcript_evidence_ids: [],
        results_returned: 0,
        results_accepted: 0,
        cache_hit: false,
        duration_ms: Date.now() - startedAt,
        error_code: errorCode
      });
    }
  }

  const deduped = deduplicateSignals(allSignals);
  const strong = deduped.filter((s) => s.evidence_class === "confirmed_public_fact").length;
  const supporting = deduped.filter((s) => s.evidence_class === "probable_public_signal").length;
  const weak = deduped.filter((s) => s.evidence_class === "weak_signal").length;

  return {
    status: limited.length === 0 ? "not_run" : anyFailed && deduped.length === 0 ? "failed" : anyFailed ? "partial" : "completed",
    reason: limited.length === 0 ? "no targeted queries were generated from the available evidence" : null,
    queries: traces,
    signals: deduped,
    strong_signal_count: strong,
    supporting_signal_count: supporting,
    weak_signal_count: weak,
    rejected_result_count: rejectedCount
  };
}

export function buildTranscriptOpportunitySignals(params: {
  commercialSignals: { budget: string | null; timeline: string | null; renewal_events: string[]; quantified_impact: string[]; purchase_language: string[] };
  meddpicc: Meddpicc;
  primaryMatch: MatchOutput | undefined;
  hasNamedDecisionAuthority: boolean;
  /** Real, generically-detected next-step evidence (workshop, pilot,
   * PoV/PoC, explicit "next steps"/follow-up commitment language) —
   * empty when the transcript contains no such evidence, never an
   * unconditional placeholder. */
  nextStepSignals: string[];
}): TranscriptOpportunitySignals {
  return {
    hasQuantifiedImpact: params.commercialSignals.quantified_impact.length > 0,
    hasFunding: Boolean(params.commercialSignals.budget),
    hasUrgencyOrDeadline: Boolean(params.commercialSignals.timeline),
    hasRenewal: params.commercialSignals.renewal_events.length > 0,
    hasEvaluationLanguage: params.commercialSignals.purchase_language.length > 0,
    hasSuccessCriteria: (params.primaryMatch?.intent_evidence.length ?? 0) > 0,
    hasNextSteps: params.nextStepSignals.length > 0,
    hasNamedDecisionAuthority: params.hasNamedDecisionAuthority,
    identifyPainStatus: params.meddpicc.identify_pain.status,
    primarySolutionFitConfidence: params.primaryMatch?.confidence ?? 0
  };
}

// Generic phrasing for an explicit customer disqualification — never
// tied to one product/company; matched against the full transcript's
// customer-attributed dialogue only.
const NOT_PURSUING_PATTERNS = [
  /\bnot pursuing\b/i,
  /\bnot moving forward with\b/i,
  /\bno longer (?:interested|considering)\b/i,
  /\boff the table\b/i,
  /\bwe(?:'re| are) not going to (?:move forward|proceed|pursue)\b/i,
  /\bdecided not to\b/i,
  /\bwe(?:'re| are) putting (?:this|that) on hold indefinitely\b/i
];

export function detectExplicitNotPursuingStatement(customerDialogueText: string[]): boolean {
  return customerDialogueText.some((sentence) => NOT_PURSUING_PATTERNS.some((pattern) => pattern.test(sentence)));
}

export function buildGateInputs(params: {
  verdict: "HIGH_INTENT" | "REVIEW" | "NOISE";
  explicitNotPursuing: boolean;
  categoryOutOfScope: boolean;
  businessProblem: string;
  accountResolution: AccountResolution;
}): GateConditionInputs {
  return {
    transcriptVerdict: params.verdict,
    explicitNotPursuing: params.explicitNotPursuing,
    categoryOutOfScope: params.categoryOutOfScope,
    hasPainEvidence: Boolean(params.businessProblem) && params.businessProblem !== "No dominant pain category was matched.",
    accountUnresolved: params.accountResolution.status === "unresolved",
    crmClosedLostDuplicate: false
  };
}
