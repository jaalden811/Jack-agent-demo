import { readFileSync } from "node:fs";
import path from "node:path";
import { getCatalog } from "@/lib/signal-agent/loadCatalog";
import { ingestTranscript, selectRelevantChunks } from "@/lib/signal-agent/transcript";
import { findAccount, applyAccountOverride } from "@/lib/signal-agent/accountContext";
import { embedTranscript, prefetchCueEmbeddings } from "@/lib/signal-agent/semanticMatch";
import { evaluateEntry, selectMultiLabelEvaluations } from "@/lib/signal-agent/scoring";
import { buildRouting } from "@/lib/signal-agent/routing";
import { draftNotification } from "@/lib/signal-agent/notification";
import { appendAuditRecord, AUDIT_LOG_RELATIVE_PATH } from "@/lib/signal-agent/auditLog";
import { extractBuyingIntentEvidence, extractStakeholders } from "@/lib/signal-agent/intentExtraction";
import { extractNamedStakeholders, inferFunctionalOwners } from "@/lib/signal-agent/stakeholderExtraction";
import { buildCommercialSignals } from "@/lib/signal-agent/commercialSignals";
import { synthesizeExecutiveBrief } from "@/lib/signal-agent/openaiSynthesis";
import { fetchPublicSignals } from "@/lib/signal-agent/publicSignals";
import { randomUUID } from "node:crypto";
import { runQualificationPipeline } from "@/lib/qualification/runQualification";
import { extractGenericSignals, groupGenericSignalsByBucket } from "@/lib/qualification/genericSignalExtraction";
import { buildCategoryScores } from "@/lib/signal-agent/dominance";
import { buildNextBestAction, type ActionOwners } from "@/lib/action-intelligence/nextBestAction";
import { buildQuestionIndex } from "@/lib/handoff/questionIndex";
import { buildSpecialistHandoff } from "@/lib/handoff/handoffBuilder";
import { enhanceWithCircuit } from "@/lib/signal-agent/aiEnhancement";
import { loadRoutingConfig } from "@/lib/webex/peachtreeRouting";
import type {
  CorroborationSummary,
  EntryEvaluation,
  MatchOutput,
  MatchRelationship,
  ReferencePack,
  RunRequest,
  SecureNetworkingTriageResult
} from "@/lib/signal-agent/types";
import { TranscriptParseIncompleteError } from "@/lib/signal-agent/types";

/** Action owners come from the routing config recipients (config-driven,
 * never hard-coded), with a safe generic fallback so the action layer
 * always has an owner to name. */
function resolveActionOwners(): ActionOwners {
  try {
    const config = loadRoutingConfig();
    return {
      sales: { name: config.recipients.sales.name, role: config.recipients.sales.assignment_label },
      technical: { name: config.recipients.technical.name, role: config.recipients.technical.assignment_label }
    };
  } catch {
    return {
      sales: { name: "the commercial owner", role: "Sales / Commercial" },
      technical: { name: "the technical specialist", role: "Technical / Specialist" }
    };
  }
}

/**
 * Orchestrates the full "secure_networking_deal_signal_triage" spine:
 * transcript -> signal extraction -> pain classification (multi-label)
 * -> portfolio validation -> scoring -> specialist routing -> internal
 * notification -> audit log. This file wires the generic modules
 * together; it still contains zero category- or product-specific logic
 * itself — every category/product/specialist name flows from the loaded
 * catalog and the transcript, never from a literal here.
 */

const DEMO_TRANSCRIPT_FILES: Record<string, string> = {
  high_intent: "data/transcripts/high_intent_orchestrator.txt",
  noise: "data/transcripts/noise_general_interest.txt",
  secure_networking_triage: "data/transcripts/secure_networking_deal_signal.txt",
  cross_domain_data_platform: "data/transcripts/cross_domain_data_platform_deal_signal.txt"
};

function resolveTranscriptText(request: RunRequest): string {
  if (request.customTranscript && request.customTranscript.trim().length > 0) {
    return request.customTranscript;
  }
  const key = request.transcriptId ?? "secure_networking_triage";
  const relativePath = DEMO_TRANSCRIPT_FILES[key];
  const fullPath = path.join(process.cwd(), "signal-agent-poc", relativePath);
  return readFileSync(fullPath, "utf8");
}

function computeAnalysisMode(embeddingsUsed: boolean, synthesisUsed: boolean): SecureNetworkingTriageResult["providers"]["analysis_mode"] {
  if (embeddingsUsed && synthesisUsed) return "embeddings_and_synthesis";
  if (embeddingsUsed) return "embeddings_assisted";
  if (synthesisUsed) return "synthesis_assisted";
  return "deterministic";
}

function relationshipForRank(rank: number): MatchRelationship {
  if (rank === 1) return "primary";
  if (rank === 2) return "secondary";
  return "supporting";
}

function buildReferencePack(catalog: ReturnType<typeof getCatalog>): ReferencePack {
  const rawConfig = catalog.rawMatchingConfig as
    | { final_formula?: string; multi_label_policy?: { selection_rule?: string }; notification_gates?: { HIGH_INTENT?: string; REVIEW?: string; NOISE?: string } }
    | null;

  return {
    taxonomy_file: catalog.sourcePath,
    taxonomy_version: catalog.metadata?.version ?? "unknown",
    taxonomy_as_of: catalog.metadata?.asOf ?? null,
    taxonomy_scope: catalog.metadata?.scope ?? null,
    category_count: catalog.entries.length,
    final_formula: rawConfig?.final_formula ?? null,
    multi_label_policy: rawConfig?.multi_label_policy?.selection_rule ?? null,
    notification_gates: {
      high_intent: rawConfig?.notification_gates?.HIGH_INTENT ?? null,
      review: rawConfig?.notification_gates?.REVIEW ?? null,
      noise: rawConfig?.notification_gates?.NOISE ?? null
    },
    report_file: "signal-agent-poc/docs/cisco_portfolio_painpoint_mapping_report.md",
    report_loaded: catalog.source === "cisco_mapping"
  };
}

function buildBusinessNarrative(evaluations: EntryEvaluation[]) {
  const primary = evaluations[0];
  const impactEvidence = primary.intentEvidence.filter((item) => item.type === "impact");
  const timelineEvidence = primary.intentEvidence.filter((item) => item.type === "timeline");

  const businessProblem = primary
    ? `Customer describes ${primary.entry.painCategory.toLowerCase()}.${primary.matchedText[0] ? ` "${primary.matchedText[0]}"` : ""}`
    : "No dominant pain category was matched.";

  const businessImpact =
    impactEvidence.length > 0
      ? impactEvidence.map((item) => item.text).slice(0, 2).join(" ")
      : "No quantified business impact was stated in the transcript.";

  const urgency =
    timelineEvidence.length > 0
      ? timelineEvidence.map((item) => item.text).slice(0, 2).join(" ")
      : "No explicit timeline was stated in the transcript.";

  return { businessProblem, businessImpact, urgency };
}

const PARSE_INCOMPLETE_MIN_CHARS = 5000;
const PARSE_INCOMPLETE_MIN_SENTENCES = 20;

export async function runSignalAgent(request: RunRequest): Promise<SecureNetworkingTriageResult> {
  const transcriptText = resolveTranscriptText(request);
  const transcript = ingestTranscript(transcriptText);
  // Guard against a parser regression producing a confident wrong
  // result: a substantial transcript that yields implausibly few
  // sentences is refused outright rather than silently scored and
  // (potentially) auto-sent.
  if (transcript.diagnostics.raw_characters > PARSE_INCOMPLETE_MIN_CHARS && transcript.diagnostics.sentences_parsed < PARSE_INCOMPLETE_MIN_SENTENCES) {
    throw new TranscriptParseIncompleteError(transcript.diagnostics);
  }
  const catalog = getCatalog();

  const baseAccount = findAccount(transcript.account);
  const account = applyAccountOverride(baseAccount, request.accountOverride);

  const intentEvidence = extractBuyingIntentEvidence(transcript);
  const stakeholders = extractStakeholders(transcript);
  const namedStakeholders = extractNamedStakeholders(transcript);
  const functionalOwners = inferFunctionalOwners(transcript, namedStakeholders);

  const useOpenAI = request.options?.useOpenAIEmbeddings ?? true;
  const embeddingBundle = await embedTranscript(transcript, useOpenAI);

  const prefetchSucceeded = await prefetchCueEmbeddings(catalog.entries, embeddingBundle);
  const effectiveBundle = prefetchSucceeded
    ? embeddingBundle
    : { ...embeddingBundle, mode: "fallback" as const, warning: "Semantic matching unavailable; using deterministic fallback." };

  const genericSignals = extractGenericSignals(transcript);

  const evaluations = await Promise.all(
    catalog.entries.map((entry) =>
      evaluateEntry({
        entry,
        transcript,
        account,
        embeddingBundle: effectiveBundle,
        negationConfig: catalog.negationConfig,
        config: catalog.matchingConfig,
        intentEvidence,
        stakeholders
      })
    )
  );

  const maxLabels = request.options?.maxLabels ?? catalog.matchingConfig.multiLabel.maxLabels;
  const selected = selectMultiLabelEvaluations(evaluations, {
    ...catalog.matchingConfig,
    multiLabel: { ...catalog.matchingConfig.multiLabel, maxLabels }
  });

  const primaryEvaluation = selected[0];
  const matches: MatchOutput[] = selected.map((evaluation, index) => {
    const routing = buildRouting(evaluation, transcript, catalog.entries);
    const weights = evaluation.transcriptOnlyMode
      ? {
          keyword: catalog.matchingConfig.transcriptOnlyMode.weights.keyword,
          semantic: catalog.matchingConfig.transcriptOnlyMode.weights.semantic,
          corroboration: 0.25,
          intent: 0.15
        }
      : {
          keyword: catalog.matchingConfig.weights.keyword,
          semantic: catalog.matchingConfig.weights.semantic,
          corroboration: catalog.matchingConfig.weights.corroboration,
          intent: catalog.matchingConfig.weights.specificityIntent
        };
    const structuredScore = evaluation.transcriptOnlyMode ? evaluation.transcriptCorroborationScore : evaluation.corroborationScore;

    return {
      entry_id: evaluation.entry.id,
      pain_category: evaluation.entry.painCategory,
      domain: evaluation.entry.domain,
      confidence: Math.round(evaluation.confidence * 1000) / 1000,
      rank: index + 1,
      relationship: relationshipForRank(index + 1),
      matched_text: evaluation.matchedText,
      matched_keywords: evaluation.matchedKeywords,
      semantic_evidence: evaluation.matchedSemanticCues,
      intent_evidence: evaluation.intentEvidence,
      corroboration: [...evaluation.corroboration, ...evaluation.transcriptCorroboration],
      negative_cues: evaluation.negativeCueResults,
      recommended_solutions: routing.shouldNotify ? routing.recommendedSolution : [],
      recommended_specialist: routing.shouldNotify ? routing.recommendedSpecialist : null,
      solution_decision: routing.solutionDecision,
      score_breakdown: {
        keyword_score: Math.round(evaluation.keywordScore * 1000) / 1000,
        keyword_weight: weights.keyword,
        semantic_score: Math.round(evaluation.semanticScore * 1000) / 1000,
        semantic_weight: weights.semantic,
        intent_score: Math.round(evaluation.specificityIntentScore * 1000) / 1000,
        intent_weight: weights.intent,
        structured_account_score: Math.round(structuredScore * 1000) / 1000,
        structured_account_weight: weights.corroboration,
        penalty: Math.round(evaluation.penalty * 1000) / 1000,
        final: Math.round(evaluation.confidence * 1000) / 1000
      }
    };
  });

  const primaryRouting = buildRouting(primaryEvaluation, transcript, catalog.entries);
  const notificationText = primaryRouting.shouldNotify
    ? draftNotification({
        evaluation: primaryEvaluation,
        account,
        routing: primaryRouting,
        budget: intentEvidence.find((item) => item.type === "budget")?.text ?? null,
        timeline: intentEvidence.find((item) => item.type === "timeline")?.text ?? null
      })
    : null;

  const commercialSignals = buildCommercialSignals(intentEvidence);
  const { businessProblem, businessImpact, urgency } = buildBusinessNarrative(selected);

  const recommendedSpecialists = Array.from(
    new Set(
      matches
        .filter((match) => match.recommended_specialist)
        .map((match) => match.recommended_specialist as string)
    )
  );

  const solutionArchitecture = matches
    .filter((match) => match.recommended_solutions.length > 0)
    .flatMap((match) =>
      match.solution_decision.recommended.map((product, index) => ({
        layer: match.pain_category,
        product,
        role:
          catalog.entries.find((entry) => entry.id === match.entry_id)?.primarySolutions[index]?.role ??
          "Role not specified in taxonomy"
      }))
    );

  const deterministicNextAction = primaryRouting.shouldNotify
    ? primaryEvaluation.intentLabel === "HIGH_INTENT"
      ? `Schedule an architecture and discovery workshop; route to ${primaryRouting.recommendedSpecialist ?? "the appropriate specialist"}.`
      : `Needs human review — validate evidence with ${primaryRouting.recommendedSpecialist ?? "a specialist"} before acting.`
    : "Suppressed — no internal action recommended.";

  const deterministicDiscoveryQuestions = buildDiscoveryQuestions(matches);

  const useSynthesis = request.options?.useOpenAISynthesis ?? true;
  const synthesis = await synthesizeExecutiveBrief({
    transcriptExcerpt: transcript.rawText,
    matches,
    useSynthesis
  });

  const finalExecutiveSummary = synthesis.used && synthesis.output
    ? synthesis.output
    : {
        business_problem: businessProblem,
        business_impact: businessImpact,
        urgency,
        recommended_next_action: deterministicNextAction,
        internal_brief: buildDeterministicBrief(matches, commercialSignals, recommendedSpecialists, deterministicNextAction),
        discovery_questions: deterministicDiscoveryQuestions
      };

  const enrichPublicSignals = request.options?.enrichPublicSignals ?? false;
  const publicSignals = await fetchPublicSignals(account.matched ? account.account : transcript.account, enrichPublicSignals);

  const useQualification = request.options?.useQualification ?? true;
  const lifecycleStageGuess = commercialSignals.renewal_events.length > 0 ? "RENEW" : "ADOPT";
  const qualification = await runQualificationPipeline({
    transcript,
    accountMatchedInCrm: account.matched,
    webexMeetingTitle: request.webexSource?.meetingTitle ?? null,
    intentEvidence,
    namedStakeholders,
    quantifiedImpact: commercialSignals.quantified_impact,
    businessProblem: finalExecutiveSummary.business_problem,
    renewalEvents: commercialSignals.renewal_events,
    purchaseLanguage: commercialSignals.purchase_language,
    budget: commercialSignals.budget,
    timeline: commercialSignals.timeline,
    matches,
    verdict: primaryEvaluation.intentLabel,
    lifecycleStageGuess,
    enrichPublicSignals,
    useQualification,
    userEnteredAccount: request.userEnteredAccount ?? null,
    nextStepSignals: genericSignals.filter((s) => s.bucket === "next_steps").map((s) => s.text)
  });

  const corroborationSummary: CorroborationSummary = {
    transcript_score: Math.round(primaryEvaluation.transcriptCorroborationScore * 1000) / 1000,
    structured_account_score: Math.round(primaryEvaluation.corroborationScore * 1000) / 1000,
    combined_score: Math.round((primaryEvaluation.transcriptCorroborationScore * 0.5 + primaryEvaluation.corroborationScore * 0.5) * 1000) / 1000,
    transcript_signals: primaryEvaluation.transcriptCorroboration,
    structured_signals: primaryEvaluation.corroboration,
    structured_account_available: account.matched
  };

  const timestamp = new Date().toISOString();

  const result: SecureNetworkingTriageResult = {
    use_case: "secure_networking_deal_signal_triage",
    executive_summary: {
      verdict: primaryEvaluation.intentLabel,
      confidence: Math.round(primaryEvaluation.confidence * 1000) / 1000,
      account: account.matched ? account.account : transcript.account,
      business_problem: finalExecutiveSummary.business_problem,
      business_impact: finalExecutiveSummary.business_impact,
      urgency: finalExecutiveSummary.urgency,
      primary_opportunity: matches[0]?.pain_category ?? null,
      secondary_opportunities: matches.slice(1).map((match) => match.pain_category),
      recommended_next_action: finalExecutiveSummary.recommended_next_action
    },
    stakeholders,
    stakeholder_analysis: {
      participants: transcript.participantRecords,
      named_stakeholders: namedStakeholders,
      functional_owners: functionalOwners
    },
    commercial_signals: commercialSignals,
    matches,
    solution_architecture: solutionArchitecture,
    recommended_specialists: recommendedSpecialists,
    discovery_questions: finalExecutiveSummary.discovery_questions,
    internal_brief: finalExecutiveSummary.internal_brief,
    notification_text: notificationText,
    providers: {
      embeddings_used: effectiveBundle.mode === "openai_embeddings",
      synthesis_used: synthesis.used,
      fallback_reason: !synthesis.used ? synthesis.fallback_reason : effectiveBundle.mode === "fallback" ? (effectiveBundle.warning ?? "deterministic fallback") : null,
      semantic_mode: effectiveBundle.mode,
      analysis_mode: computeAnalysisMode(effectiveBundle.mode === "openai_embeddings", synthesis.used)
    },
    reference_pack: buildReferencePack(catalog),
    corroboration_summary: corroborationSummary,
    public_signals: publicSignals,
    audit: { logged: false, path: AUDIT_LOG_RELATIVE_PATH, warning: effectiveBundle.warning },
    transcript_meta: {
      title: request.transcriptId ?? (request.customTranscript ? "Custom transcript" : null),
      account: transcript.account,
      participant_count: transcript.participants.length,
      sentence_count: selectRelevantChunks(transcript).length,
      raw_text: transcript.rawText
    },
    timestamp,
    run_id: randomUUID(),
    account_resolution: qualification.account_resolution,
    meddpicc: qualification.meddpicc,
    public_enrichment: qualification.public_enrichment,
    ai_processing: qualification.ai_processing,
    // Built (and persisted) once messages exist — see
    // @/lib/webex/automation.ts#resolveAnalysisLink. Not yet known here.
    analysis_link: { included: false, url: null, reason: "no_public_base_url", expires_at: null },
    transcript_diagnostics: transcript.diagnostics,
    generic_diagnostics: {
      parser: {
        turns: transcript.diagnostics.turns_parsed,
        sentences: transcript.diagnostics.sentences_parsed,
        participants: transcript.diagnostics.participants,
        warning:
          transcript.diagnostics.raw_characters > PARSE_INCOMPLETE_MIN_CHARS && transcript.diagnostics.sentences_parsed < PARSE_INCOMPLETE_MIN_SENTENCES
            ? "parser_warning: sentence count is implausibly low for this transcript length"
            : null
      },
      signals: groupGenericSignalsByBucket(genericSignals),
      category_scores: buildCategoryScores(evaluations, genericSignals)
    },
    serpapi_signals: qualification.serpapi_signals,
    opportunity_scoring: qualification.opportunity_scoring,
    buying_committee: qualification.buying_committee,
    // Placeholders — replaced immediately below once the full result
    // (including run_id) exists; the action/handoff layer reads from the
    // assembled result rather than re-deriving evidence.
    next_best_action: {} as SecureNetworkingTriageResult["next_best_action"],
    specialist_handoffs: {} as SecureNetworkingTriageResult["specialist_handoffs"],
    question_index: { answered: [], open: [], declined_or_sensitive: [], contradictory: [] },
    ai_trace: { provider: "circuit", enhanced: false, stages: [], stage_a: null, stage_b: null, stage_c: null, stage_d: null }
  };

  // Action-intelligence + specialist-handoff layer (the defining output):
  // one specific Next Best Action, a do-not-re-ask index, and lane-
  // specific handoff packets — all derived from the assembled evidence.
  // Owners are config-driven (routing recipients), never hard-coded.
  const actionOwners = resolveActionOwners();
  result.question_index = buildQuestionIndex(result);
  result.next_best_action = buildNextBestAction(result, actionOwners);
  result.specialist_handoffs = {
    sales: buildSpecialistHandoff({ result, lane: "sales", recipient: actionOwners.sales, action: result.next_best_action, questionIndex: result.question_index }),
    technical: buildSpecialistHandoff({ result, lane: "technical", recipient: actionOwners.technical, action: result.next_best_action, questionIndex: result.question_index })
  };

  // Circuit AI-enhancement (additive; deterministic result is
  // authoritative and complete without it). No-op when Circuit is
  // unconfigured/unavailable — never throws, never changes scores.
  result.ai_trace = await enhanceWithCircuit(result);

  const auditOutcome = await appendAuditRecord(result);
  result.audit = { logged: auditOutcome.logged, path: AUDIT_LOG_RELATIVE_PATH, warning: auditOutcome.warning ?? effectiveBundle.warning };

  return result;
}

function buildDiscoveryQuestions(matches: MatchOutput[]): string[] {
  const questions: string[] = [];
  for (const match of matches) {
    for (const decision of match.solution_decision.adjacent_solutions_considered) {
      if (decision.decision === "needs_discovery") {
        questions.push(`For ${match.pain_category}: is ${decision.solution} still in scope, or fully out of scope?`);
      }
    }
  }
  return Array.from(new Set(questions)).slice(0, 5);
}

function buildDeterministicBrief(
  matches: MatchOutput[],
  commercialSignals: ReturnType<typeof buildCommercialSignals>,
  specialists: string[],
  nextAction: string
): string {
  const primary = matches[0];
  if (!primary) return "No taxonomy category matched with sufficient confidence to draft a brief.";

  const lines = [
    `What happened: the transcript describes ${primary.pain_category.toLowerCase()}.`,
    `Why this is real: ${primary.matched_keywords.length} keyword match(es), ${primary.semantic_evidence.length} semantic cue match(es), and ${primary.corroboration.length} corroboration signal(s) support this.`,
    `Primary Cisco/Splunk solution motion: ${primary.recommended_solutions.join(", ") || "not routed"}.`,
    matches.length > 1 ? `Secondary/supporting workstreams: ${matches.slice(1).map((match) => match.pain_category).join("; ")}.` : "",
    `Specialist team: ${specialists.join(", ") || "not routed"}.`,
    commercialSignals.budget ? `Budget: ${commercialSignals.budget}` : "",
    commercialSignals.timeline ? `Timeline: ${commercialSignals.timeline}` : "",
    `Next action: ${nextAction}`
  ];

  return lines.filter(Boolean).join("\n");
}
