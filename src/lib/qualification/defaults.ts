import type { AccountResolution, AiProcessingStatus, Meddpicc, MeddpiccField, PublicEnrichmentStatus } from "@/lib/qualification/types";

/** Safe, conservative defaults used whenever a qualification stage did
 * not run (disabled, not configured, or failed) — every field starts
 * MISSING/unknown; nothing is ever assumed. */

export function emptyMeddpiccField(): MeddpiccField {
  return { status: "MISSING", summary: "Not yet evaluated.", confidence: 0, evidence_ids: [], gaps: [], next_question: "" };
}

export function buildDefaultMeddpicc(): Meddpicc {
  return {
    metrics: emptyMeddpiccField(),
    economic_buyer: emptyMeddpiccField(),
    decision_criteria: emptyMeddpiccField(),
    decision_process: emptyMeddpiccField(),
    paper_process: emptyMeddpiccField(),
    identify_pain: emptyMeddpiccField(),
    champion: emptyMeddpiccField(),
    competition: emptyMeddpiccField()
  };
}

export function buildDefaultAccountResolution(): AccountResolution {
  return {
    name: null,
    domain: null,
    status: "unresolved",
    confidence: 0,
    source: null,
    alternatives: [],
    action_required: "Account not identified in the available evidence. Associate this meeting with the correct account before CRM writeback."
  };
}

export function buildDefaultPublicEnrichment(fallbackReason: string | null = null): PublicEnrichmentStatus {
  return {
    enabled: false,
    provider: "serpapi",
    configured: false,
    queries: [],
    sources: [],
    accepted_evidence: [],
    rejected_count: 0,
    fallback_reason: fallbackReason
  };
}

export function buildDefaultAiProcessing(openaiConfigured: boolean, embeddingModel: string, synthesisModel: string, fallbackReason: string | null = null): AiProcessingStatus {
  return {
    openai_configured: openaiConfigured,
    transcript_extraction_used: false,
    public_evidence_classification_used: false,
    qualification_synthesis_used: false,
    message_synthesis_used: false,
    embedding_model: embeddingModel,
    synthesis_model: synthesisModel,
    fallback_reason: fallbackReason
  };
}
