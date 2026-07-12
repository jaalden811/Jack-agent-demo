import { readFileSync } from "node:fs";
import path from "node:path";
import { getCatalog } from "@/lib/signal-agent/loadCatalog";
import { ingestTranscript } from "@/lib/signal-agent/transcript";
import { findAccount } from "@/lib/signal-agent/accountContext";
import { embedTranscript, prefetchCueEmbeddings } from "@/lib/signal-agent/semanticMatch";
import { evaluateEntry, selectMultiLabelEvaluations, toSignalAgentLabel } from "@/lib/signal-agent/scoring";
import { buildRouting } from "@/lib/signal-agent/routing";
import { draftNotification } from "@/lib/signal-agent/notification";
import { appendAuditRecord, AUDIT_LOG_RELATIVE_PATH } from "@/lib/signal-agent/auditLog";
import type { RunRequest, SignalAgentRunResult } from "@/lib/signal-agent/types";

/**
 * Orchestrates the full spine end to end:
 * transcript -> pain classification -> portfolio validation -> scoring
 * -> specialist routing -> internal notification -> audit log.
 *
 * This file wires the generic modules together; it still contains zero
 * category- or product-specific logic itself.
 */

const DEMO_TRANSCRIPT_FILES: Record<string, string> = {
  high_intent: "data/transcripts/high_intent_orchestrator.txt",
  noise: "data/transcripts/noise_general_interest.txt"
};

function resolveTranscriptText(request: RunRequest): string {
  if (request.customTranscript && request.customTranscript.trim().length > 0) {
    return request.customTranscript;
  }
  const key = request.transcriptId ?? "high_intent";
  const relativePath = DEMO_TRANSCRIPT_FILES[key];
  const fullPath = path.join(process.cwd(), "signal-agent-poc", relativePath);
  return readFileSync(fullPath, "utf8");
}

export async function runSignalAgent(request: RunRequest): Promise<SignalAgentRunResult> {
  const transcriptText = resolveTranscriptText(request);
  const transcript = ingestTranscript(transcriptText);
  const catalog = getCatalog();
  const account = findAccount(transcript.account);

  const useOpenAI = request.options?.useOpenAIEmbeddings ?? true;
  const embeddingBundle = await embedTranscript(transcript, useOpenAI);

  const prefetchSucceeded = await prefetchCueEmbeddings(catalog.entries, embeddingBundle);
  const effectiveBundle = prefetchSucceeded
    ? embeddingBundle
    : { ...embeddingBundle, mode: "fallback" as const, warning: "Semantic matching unavailable; using deterministic fallback." };

  const evaluations = await Promise.all(
    catalog.entries.map((entry) =>
      evaluateEntry({
        entry,
        transcript,
        account,
        embeddingBundle: effectiveBundle,
        genericNegationPhrases: catalog.genericNegationPhrases,
        config: catalog.matchingConfig
      })
    )
  );

  const maxLabels = request.options?.maxLabels ?? catalog.matchingConfig.multiLabel.maxLabels;
  const selected = selectMultiLabelEvaluations(evaluations, {
    ...catalog.matchingConfig,
    multiLabel: { ...catalog.matchingConfig.multiLabel, maxLabels }
  });

  const primaryEvaluation = selected[0];
  const additionalEvaluations = selected.slice(1);
  const routing = buildRouting(primaryEvaluation);

  const notificationText = routing.shouldNotify
    ? draftNotification({ evaluation: primaryEvaluation, account, routing })
    : null;

  const timestamp = new Date().toISOString();

  const result: SignalAgentRunResult = {
    account: account.matched ? account.account : transcript.account,
    pain_category: primaryEvaluation.entry.id,
    pain_category_label: primaryEvaluation.entry.painCategory,
    domain: primaryEvaluation.entry.domain || null,
    confidence: Math.round(primaryEvaluation.confidence * 1000) / 1000,
    intent_label: primaryEvaluation.intentLabel,
    matched_text: primaryEvaluation.matchedText,
    matched_keywords: primaryEvaluation.matchedKeywords,
    matched_semantic_cues: primaryEvaluation.matchedSemanticCues,
    negative_cues: [...primaryEvaluation.domainNegativeCuesHit, ...primaryEvaluation.genericNegationHit],
    corroboration: primaryEvaluation.corroboration,
    recommended_solution: routing.shouldNotify ? routing.recommendedSolution : [],
    primary_solutions: routing.primarySolutions,
    adjacent_solutions: routing.adjacentSolutions,
    why_this_solution: routing.whyThisSolution,
    why_not_adjacent_solution: routing.whyNotAdjacentSolution,
    recommended_specialist: routing.shouldNotify ? routing.recommendedSpecialist : null,
    next_best_action: routing.nextBestAction,
    notification_text: notificationText,
    semantic_mode: effectiveBundle.mode,
    additional_labels: additionalEvaluations.map(toSignalAgentLabel),
    audit: { logged: false, path: AUDIT_LOG_RELATIVE_PATH, warning: effectiveBundle.warning },
    timestamp
  };

  const auditOutcome = await appendAuditRecord(result);
  result.audit = {
    logged: auditOutcome.logged,
    path: AUDIT_LOG_RELATIVE_PATH,
    warning: auditOutcome.warning ?? effectiveBundle.warning
  };

  return result;
}
