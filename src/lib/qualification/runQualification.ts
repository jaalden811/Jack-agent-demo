import { getCircuitConfig, isCircuitConfigured } from "@/lib/circuit/config";
import { resolveAccountIdentity } from "@/lib/qualification/accountResolution";
import { buildDeterministicMeddpicc, mergePublicEvidenceIntoMeddpicc } from "@/lib/qualification/meddpiccMerge";
import { extractEnumeratedDecisionCriteria } from "@/lib/qualification/decisionCriteria";
import { buildDefaultPublicEnrichment } from "@/lib/qualification/defaults";
import { gateSearchEnrichment, runSerpApiEnrichment } from "@/lib/connectors/serpapi/runEnrichment";
import { runSerpApiSignalSearch, buildTranscriptOpportunitySignals, buildGateInputs, detectExplicitNotPursuingStatement } from "@/lib/opportunity-fit/runOpportunityFit";
import { computeTranscriptOpportunityScore, computeQualificationCompletenessScore, computeExternalFitScore } from "@/lib/opportunity-fit/opportunityFit";
import { buildPursuitRecommendation, evaluateHardGates } from "@/lib/opportunity-fit/pursueDecision";
import { classifyDealMaturity, signalStrengthBand, detectMaturityLimitingEvidence } from "@/lib/opportunity-fit/dealMaturity";
import { inferAuthorityGraph, type AuthorityGraph } from "@/lib/stakeholder-intelligence/authorityGraph";
import type { AccountCandidate, AccountResolution, AiProcessingStatus, ClassifiedPublicResult, Meddpicc, PublicEnrichmentStatus } from "@/lib/qualification/types";
import type { OpportunityScoringResult, SerpApiSignalsResult } from "@/lib/opportunity-fit/types";
import type { BuyingIntentEvidence, IngestedTranscript, MatchOutput, StakeholderRecord } from "@/lib/signal-agent/types";
import type { QueryPlannerInput } from "@/lib/connectors/serpapi/types";

/**
 * Orchestrates account resolution, SerpAPI enrichment (query planning
 * -> execution -> normalization -> acceptance), OpenAI Stage A
 * (transcript evidence extraction) and Stage B (public evidence
 * classification), the deterministic Stage C MEDDPICC merge, and the
 * independent opportunity-fit/pursuit-recommendation scoring model —
 * the full qualification layer that sits alongside (never replaces)
 * the existing deterministic taxonomy scoring/routing pipeline.
 */

export type QualificationPipelineResult = {
  account_resolution: AccountResolution;
  meddpicc: Meddpicc;
  public_enrichment: PublicEnrichmentStatus;
  ai_processing: AiProcessingStatus;
  named_stakeholders_for_messaging: StakeholderRecord[];
  serpapi_signals: SerpApiSignalsResult;
  opportunity_scoring: OpportunityScoringResult;
  buying_committee: AuthorityGraph;
};

export async function runQualificationPipeline(params: {
  transcript: IngestedTranscript;
  accountMatchedInCrm: boolean;
  webexMeetingTitle: string | null;
  intentEvidence: BuyingIntentEvidence[];
  namedStakeholders: StakeholderRecord[];
  quantifiedImpact: string[];
  businessProblem: string;
  renewalEvents: string[];
  purchaseLanguage: string[];
  /** Deterministic, always-available budget/timeline evidence (see
   * @/lib/signal-agent/commercialSignals) — used directly for the
   * transcript-opportunity score so funding/urgency detection never
   * silently depends on OpenAI being configured. */
  budget: string | null;
  timeline: string | null;
  matches: MatchOutput[];
  verdict: "HIGH_INTENT" | "REVIEW" | "NOISE";
  lifecycleStageGuess: "LAND" | "ADOPT" | "EXPAND" | "RENEW";
  enrichPublicSignals: boolean;
  /** When true, the objective-aware planner drives live SerpAPI enrichment in
   * runAgent, so the legacy generic opportunity-fit execution is skipped here
   * (no duplicate queries). */
  objectivePlannerHandlesEnrichment?: boolean;
  useQualification: boolean;
  userEnteredAccount?: string | null;
  /** Real generic next-step evidence (workshops, pilots, PoV/PoC,
   * "let's schedule a follow-up", etc.) — genuinely present-or-absent,
   * never a placeholder that is unconditionally true. */
  nextStepSignals?: string[];
}): Promise<QualificationPipelineResult> {
  let fallbackReason: string | null = null;

  // Stage A (transcript/evidence interpretation) is deterministic. Circuit
  // provides an ADDITIVE interpretation on result.ai_trace (@/lib/signal-agent/
  // aiEnhancement); it never feeds the authoritative qualification below, so the
  // deterministic path here stands alone. `extraction` is a null-result stand-in
  // (result is always null) so every `extraction.result?.…` access resolves to
  // its deterministic branch.
  const extraction: {
    used: false;
    result: {
      account_candidates: AccountCandidate[];
      commercial_signals: { competitor_mentions: string[]; timeline: string[]; budget: string[] };
      preliminary_meddpicc: Meddpicc;
    } | null;
    fallback_reason: string | null;
  } = { used: false, result: null, fallback_reason: null };

  // Account resolution — Section 2/7 priority order.
  const dialogueMention = extraction.result?.account_candidates.find((c) => c.confidence >= 0.5)?.name ?? null;
  const accountResolution = await resolveAccountIdentity({
    transcriptAccountLine: params.transcript.account,
    transcriptAccountMatchedInCrm: params.accountMatchedInCrm,
    userEnteredAccount: params.userEnteredAccount ?? null,
    webexMeetingTitle: params.webexMeetingTitle,
    outlookCalendarSubject: null,
    attendeeEmailDomains: [],
    uploadedAccountContextName: null,
    dialogueMentionedCompany: dialogueMention,
    aiAccountCandidates: extraction.result?.account_candidates ?? [],
    // Scan ALL sentences (not only customer-attributed) for the org-
    // entity parser — an organization can be named in any turn, including
    // inside a negated commercial claim.
    transcriptDialogueText: params.transcript.sentences.map((s) => s.text),
    // Data-driven product/vendor stoplist from the taxonomy matches so a
    // product name (e.g. the recommended solutions) is never treated as
    // the account.
    productStoplist: Array.from(new Set(params.matches.flatMap((m) => [...m.recommended_solutions, m.pain_category]))),
    participantFirstNames: params.transcript.participantRecords.map((p) => p.name.split(/\s+/)[0]).filter(Boolean),
    // ONLY customer-side participant orgs are account candidates — a vendor's own
    // org (e.g. the seller's company named in "Name (Vendor Account Executive)")
    // must never be resolved as the customer account. Vendor-side records are
    // excluded; unknown-side records are kept (behavior may confirm them later).
    participantOrganizations: params.transcript.participantRecords
      .filter((p) => p.classification !== "vendor")
      .map((p) => p.organization)
      .filter((o): o is string => Boolean(o))
  });

  // Search-enrichment decision logic (Section 2/6).
  const gate = gateSearchEnrichment({
    enrichmentEnabled: params.enrichPublicSignals,
    verdict: params.verdict,
    accountCandidateName: accountResolution.name,
    hasStakeholderCandidate: params.namedStakeholders.length > 0
  });

  let publicEnrichment: PublicEnrichmentStatus;
  // Public-evidence classification is handled ADDITIVELY by Circuit Stage B
  // (@/lib/circuit/stages/stageB) on result.ai_trace; the authoritative
  // deterministic MEDDPICC below uses accepted enrichment directly.
  const classifiedPublicResults: ClassifiedPublicResult[] = [];
  const usedPublicClassification = false;

  if (gate.allowed && accountResolution.confidence >= 0.65 && accountResolution.name) {
    const detectedProducts = Array.from(new Set(params.matches.flatMap((m) => m.recommended_solutions)));
    const plannerInput: QueryPlannerInput = {
      account_candidates: [{ name: accountResolution.name, domain: accountResolution.domain, confidence: accountResolution.confidence }],
      company_domains: accountResolution.domain ? [accountResolution.domain] : [],
      stakeholders: params.namedStakeholders.filter((s) => s.name).map((s) => ({ name: s.name as string, title: s.function_or_role ?? null })),
      selected_taxonomy_entries: params.matches.slice(0, 3).map((m) => m.pain_category),
      detected_products: detectedProducts,
      buying_signals: params.intentEvidence.map((e) => e.text),
      commercial_signals: [...params.renewalEvents, ...params.purchaseLanguage],
      lifecycle_stage: params.lifecycleStageGuess,
      meddpicc_gaps: [],
      mentions_incident: params.intentEvidence.some((e) => e.type === "impact" && /outage|incident|breach|disruption/i.test(e.text)),
      mentions_competitor: (extraction.result?.commercial_signals.competitor_mentions.length ?? 0) > 0,
      location: null
    };

    publicEnrichment = await runSerpApiEnrichment({ ...plannerInput, accountName: accountResolution.name, accountDomain: accountResolution.domain });
    fallbackReason = fallbackReason ?? publicEnrichment.fallback_reason;
  } else {
    publicEnrichment = buildDefaultPublicEnrichment(gate.reason);
  }

  // Stage C (deterministic): baseline MEDDPICC, then merge accepted
  // public evidence into only the fields it may ever influence.
  const baseMeddpicc =
    extraction.used && extraction.result
      ? (extraction.result.preliminary_meddpicc as Meddpicc)
      : buildDeterministicMeddpicc({
          intentEvidence: params.intentEvidence,
          quantifiedImpact: params.quantifiedImpact,
          namedStakeholders: params.namedStakeholders
            .filter((s): s is typeof s & { name: string } => s.name !== null)
            .map((s) => ({ name: s.name, role: s.function_or_role, ownership_type: s.ownership_type })),
          businessProblem: params.businessProblem,
          renewalEvents: params.renewalEvents,
          purchaseLanguage: params.purchaseLanguage,
          primaryMatchedText: params.matches[0]?.matched_text,
          explicitDecisionCriteria: extractEnumeratedDecisionCriteria(
            params.transcript.sentences.filter((s) => s.isCustomer).map((s) => s.text)
          ),
          competitorMentions: extraction.result?.commercial_signals.competitor_mentions
        });
  const meddpicc = classifiedPublicResults.length > 0 ? mergePublicEvidenceIntoMeddpicc(baseMeddpicc, classifiedPublicResults) : baseMeddpicc;

  // ─── Buying-committee / authority graph (Phases 10-13) ────────────────────
  // Evidence-backed role inference from customer-side behavior, plus a
  // distributed-economic-authority model. Overrides a MISSING/HYPOTHESIS
  // economic_buyer with a DISTRIBUTED interpretation when the transcript
  // shows multiple funding paths and no single approver — never fabricates
  // a named buyer or private budget certainty.
  const customerSentences = params.transcript.sentences.filter((s) => s.isCustomer);
  const authorityGraph = inferAuthorityGraph({
    stakeholderTurns: customerSentences.map((s) => ({ name: s.speaker, text: s.text })),
    allCustomerText: customerSentences.map((s) => s.text)
  });
  if ((meddpicc.economic_buyer.status === "MISSING" || meddpicc.economic_buyer.status === "HYPOTHESIS") && authorityGraph.economic_authority.status !== "missing") {
    const ea = authorityGraph.economic_authority;
    meddpicc.economic_buyer = {
      status: ea.status === "distributed" ? "DISTRIBUTED" : ea.status === "confirmed" ? "CONFIRMED" : "PARTIAL",
      summary:
        ea.status === "distributed"
          ? `Economic authority is distributed / not yet confirmed. ${ea.known[0] ?? ""} Probable approval lanes: ${ea.approval_paths.join("; ")}.`
          : ea.named_person
            ? `${ea.named_person} shows explicit budget/approval-authority language.`
            : "Partial economic-authority evidence.",
      confidence: ea.confidence,
      evidence_ids: [],
      gaps: ea.gaps,
      next_question: ea.next_question
    };
  }

  const aiProcessing: AiProcessingStatus = {
    // The qualification pipeline is deterministic; Circuit enhancement is
    // additive on result.ai_trace and never feeds this authoritative path.
    ai_provider_configured: isCircuitConfigured(getCircuitConfig()),
    transcript_extraction_used: extraction.used,
    public_evidence_classification_used: usedPublicClassification,
    qualification_synthesis_used: extraction.used,
    message_synthesis_used: false,
    embedding_model: "deterministic-local",
    synthesis_model: "circuit",
    fallback_reason: fallbackReason
  };

  // ─── Opportunity-fit / pursuit-recommendation scoring (Sections 4-10) ─────
  // Independent of MEDDPICC and the legacy public_enrichment pass above —
  // its own SerpAPI signal search, gated the same way (enrichment
  // enabled, account confirmed/probable, SerpAPI configured), and its
  // own deterministic scoring arithmetic, entirely config-driven.
  const detectedTechnologies = Array.from(new Set(params.matches.flatMap((m) => m.recommended_solutions)));
  const namedCompetitors = extraction.result?.commercial_signals.competitor_mentions ?? [];
  const mentionsUrgency = params.renewalEvents.length > 0 || Boolean(extraction.result?.commercial_signals.timeline?.length);

  const serpapiSignals = await runSerpApiSignalSearch({
    accountResolution,
    transcriptSignals: params.intentEvidence.map((e) => e.text),
    detectedTechnologies,
    namedCompetitors,
    mentionsUrgency,
    enrichmentEnabled: params.enrichPublicSignals,
    // When the objective-aware planner will drive live SerpAPI execution
    // (a seller profile is active), skip the legacy generic opportunity-fit
    // execution so there are no duplicate independent queries.
    objectivePlannerHandlesEnrichment: params.objectivePlannerHandlesEnrichment ?? false
  });

  // "executive" and "finance_vendor_management" (procurement/vendor
  // management/budget authority) are the two generic ownership
  // categories that represent real purchasing decision authority,
  // independent of any specific transcript, company, or product.
  const hasNamedDecisionAuthority = params.namedStakeholders.some((s) => s.ownership_type === "executive" || s.ownership_type === "finance_vendor_management");
  const transcriptOpportunitySignals = buildTranscriptOpportunitySignals({
    commercialSignals: {
      // Deterministic evidence first (always available); the OpenAI
      // extraction, when configured, can surface additional signal
      // but must never be the *only* path to a real, already-detected
      // budget/timeline fact.
      budget: params.budget ?? extraction.result?.commercial_signals.budget[0] ?? null,
      timeline: params.timeline ?? extraction.result?.commercial_signals.timeline[0] ?? null,
      renewal_events: params.renewalEvents,
      quantified_impact: params.quantifiedImpact,
      purchase_language: params.purchaseLanguage
    },
    meddpicc,
    primaryMatch: params.matches[0],
    hasNamedDecisionAuthority,
    nextStepSignals: params.nextStepSignals ?? []
  });
  const transcriptScore = computeTranscriptOpportunityScore(transcriptOpportunitySignals);
  const qualificationScore = computeQualificationCompletenessScore(meddpicc);
  const externalFit = computeExternalFitScore({
    signals: serpapiSignals.signals,
    accountResolutionAvailable: accountResolution.status === "confirmed" || accountResolution.status === "probable",
    searchRan: serpapiSignals.status === "completed" || serpapiSignals.status === "partial",
    failureReason: serpapiSignals.reason
  });

  const customerDialogueText = params.transcript.sentences.filter((s) => s.isCustomer).map((s) => s.text);
  const gates = evaluateHardGates(
    buildGateInputs({
      verdict: params.verdict,
      explicitNotPursuing: detectExplicitNotPursuingStatement(customerDialogueText),
      categoryOutOfScope: false,
      businessProblem: params.businessProblem,
      accountResolution
    })
  );

  const missingInformation = Object.entries(meddpicc)
    .filter(([, field]) => field.status === "MISSING")
    .map(([key]) => `${key.replace(/_/g, " ")} is not yet established.`);

  const positiveFactors = [
    ...(transcriptOpportunitySignals.hasQuantifiedImpact ? [{ factor: "Quantified business impact stated", score_contribution: 14, evidence_ids: [] }] : []),
    ...(transcriptOpportunitySignals.hasFunding ? [{ factor: "Funding/budget language present", score_contribution: 12, evidence_ids: [] }] : []),
    ...(externalFit.available && (externalFit.score ?? 0) >= 65 ? [{ factor: "Strong external account-fit signals", score_contribution: Math.round((externalFit.score ?? 0) * 0.25), evidence_ids: externalFit.factors.flatMap((f) => f.evidence_ids) }] : [])
  ];
  const negativeFactors = [
    ...(meddpicc.economic_buyer.status === "MISSING" ? [{ factor: "Economic Buyer not yet identified", score_contribution: -5, evidence_ids: [] }] : []),
    ...(meddpicc.champion.status === "MISSING" ? [{ factor: "Champion not yet identified", score_contribution: -5, evidence_ids: [] }] : []),
    ...(!externalFit.available ? [{ factor: `External account fit unavailable (${externalFit.reason})`, score_contribution: 0, evidence_ids: [] }] : [])
  ];

  // Score dimensions are kept explicitly separate (Section 5): signal
  // strength = "is the conversation important" (the transcript
  // opportunity score); qualification completeness = "how much do we
  // understand"; deal maturity = "how far along is the deal"; pursuit =
  // "what should we do now".
  const hasEvaluationOrPov = (params.nextStepSignals ?? []).length > 0 || transcriptOpportunitySignals.hasEvaluationLanguage;
  const hasPurchaseOrRenewalMomentum = params.purchaseLanguage.length > 0 || params.renewalEvents.length > 0;
  const hasLimitingEvidence = detectMaturityLimitingEvidence(customerDialogueText);
  const dealMaturity = classifyDealMaturity({ meddpicc, hasEvaluationOrPov, hasPurchaseOrRenewalMomentum, hasLimitingEvidence });
  const painPresent = meddpicc.identify_pain.status === "CONFIRMED" || meddpicc.identify_pain.status === "PARTIAL";
  const hasPainOrImpact = painPresent || transcriptOpportunitySignals.hasQuantifiedImpact;

  const decisionRuleInputs = {
    signalStrength: transcriptScore,
    hasPainOrImpact,
    momentum: {
      next_step: transcriptOpportunitySignals.hasNextSteps,
      timing: transcriptOpportunitySignals.hasUrgencyOrDeadline || transcriptOpportunitySignals.hasRenewal,
      funding: transcriptOpportunitySignals.hasFunding,
      evaluation: transcriptOpportunitySignals.hasEvaluationLanguage
    },
    nurtureEvidence: {
      weak_timing: !transcriptOpportunitySignals.hasUrgencyOrDeadline && !transcriptOpportunitySignals.hasRenewal,
      no_next_step: !transcriptOpportunitySignals.hasNextSteps,
      low_commitment: !transcriptOpportunitySignals.hasEvaluationLanguage && !transcriptOpportunitySignals.hasFunding,
      future_interest_only: params.verdict === "REVIEW" && !transcriptOpportunitySignals.hasUrgencyOrDeadline,
      no_material_impact: !transcriptOpportunitySignals.hasQuantifiedImpact && !painPresent
    }
  };

  const pursuit = buildPursuitRecommendation({
    transcriptScore,
    qualificationScore,
    externalFitScore: externalFit.score,
    accountResolutionConfidence: accountResolution.confidence,
    positiveFactors,
    negativeFactors,
    missingInformation,
    recommendedNextAction:
      accountResolution.status === "unresolved"
        ? "Resolve the account identity before further qualification."
        : missingInformation.length > 0
          ? `Address the top qualification gap: ${missingInformation[0]}`
          : "Proceed with the recommended next steps from the qualification brief.",
    gates,
    doNotPursueGuardInputs: {
      strongNegativeTranscriptEvidence: gates.some((g) => g.gate === "explicit_not_pursuing_statement" && g.triggered),
      explicitCustomerDisqualification: gates.some((g) => g.gate === "explicit_not_pursuing_statement" && g.triggered),
      confirmedNoFitTaxonomyCondition: false,
      strongCrmDisqualification: false,
      multipleHighAuthorityNegativeSignalsWithWeakTranscriptIntent: false
    },
    evidenceCount: serpapiSignals.signals.length,
    decisionRuleInputs
  });

  const opportunityScoring: OpportunityScoringResult = {
    transcript_score: transcriptScore,
    qualification_score: qualificationScore,
    external_fit_score: externalFit.score,
    account_confidence_score: Math.round(accountResolution.confidence * 100),
    final_pursuit_score: pursuit.score,
    decision: pursuit.decision,
    confidence: pursuit.confidence,
    score_version: pursuit.score_version,
    weights: pursuit.weights,
    factors: [...pursuit.positive_factors, ...pursuit.negative_factors],
    gates: pursuit.gates,
    signal_strength: { score: transcriptScore, band: signalStrengthBand(transcriptScore) },
    deal_maturity: dealMaturity,
    qualification_completeness: qualificationScore
  };

  return {
    account_resolution: accountResolution,
    meddpicc,
    public_enrichment: publicEnrichment,
    ai_processing: aiProcessing,
    named_stakeholders_for_messaging: params.namedStakeholders,
    serpapi_signals: serpapiSignals,
    opportunity_scoring: opportunityScoring,
    buying_committee: authorityGraph
  };
}
