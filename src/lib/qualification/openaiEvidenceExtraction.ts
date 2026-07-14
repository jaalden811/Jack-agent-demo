import { getConfig } from "@/lib/config";
import { getOpenAIClient } from "@/lib/openai/client";
import { withOpenAiRetry } from "@/lib/openai/errorMapping";
import { normalizeOpenAiError } from "@/lib/openai/errorNormalizer";
import { qualificationExtractionSchema } from "@/lib/qualification/schemas";
import { buildDefaultMeddpicc } from "@/lib/qualification/defaults";
import type { EvidenceExtractionResult } from "@/lib/qualification/types";
import type { EvidenceItem } from "@/lib/qualification/types";

/**
 * OpenAI Stage A — converts the normalized transcript (plus Webex/
 * account-context metadata already collected deterministically) into a
 * structured, evidence-linked opportunity record. Uses OPENAI_SYNTHESIS_MODEL
 * via the Responses API with strict Structured Outputs. Never sends
 * environment variables, API keys, or the full 34-category taxonomy —
 * only the already-selected candidate categories.
 */

const SYSTEM_INSTRUCTION = `You are the evidence-extraction engine for a Cisco/Splunk opportunity-triage application.
Extract only information supported by the supplied evidence.
Every material field must reference one or more evidence IDs.
Do not infer an account, title, buying role, budget authority, champion status, opportunity stage, product deployment, or procurement state without evidence.
Use these distinctions:
CONFIRMED: Directly stated by a reliable source.
PARTIAL: Some required elements are supported, but the field is incomplete.
HYPOTHESIS: A reasonable possibility that requires validation.
MISSING: No supporting evidence exists.
CONFLICTING: Available evidence disagrees.
A job title does not automatically prove Economic Buyer or Champion status.
A public executive title does not prove involvement in this opportunity.
A product mention does not prove deployment.
A meeting participant is not automatically a decision maker.
Return only the structured response required by the schema.`;

export type EvidenceExtractionOutcome = {
  used: boolean;
  fallback_reason: string | null;
  result: EvidenceExtractionResult | null;
};

export type EvidenceExtractionInput = {
  evidence_items: EvidenceItem[];
  webex_meeting_title: string | null;
  webex_meeting_date: string | null;
  webex_host: string | null;
  user_entered_account: string | null;
  uploaded_account_context: Record<string, unknown> | null;
  deterministic_intent_signals: string[];
  deterministic_negative_cues: string[];
  selected_taxonomy_candidates: Array<{ id: string; pain_category: string }>;
  lifecycle_candidate: string;
};

function fallbackResult(): EvidenceExtractionResult {
  return {
    account_candidates: [],
    stakeholders: [],
    commercial_signals: { budget: [], timeline: [], renewal: [], procurement: [], business_impact: [], purchase_language: [], competitor_mentions: [] },
    technical_signals: { current_environment: [], architecture: [], integrations: [], operational_gaps: [], success_criteria: [], pilot_or_workshop_requests: [], risks: [] },
    preliminary_meddpicc: buildDefaultMeddpicc(),
    search_plan_inputs: {
      account_queries_needed: false,
      stakeholder_queries_needed: false,
      initiative_queries_needed: false,
      competition_queries_needed: false,
      incident_queries_needed: false
    },
    missing_information: [],
    contradictions: []
  };
}

export async function extractTranscriptEvidence(input: EvidenceExtractionInput, enabled: boolean): Promise<EvidenceExtractionOutcome> {
  const config = getConfig();
  if (!enabled || !config.OPENAI_QUALIFICATION_ENABLED) {
    return { used: false, fallback_reason: "qualification extraction disabled", result: fallbackResult() };
  }
  if (!config.OPENAI_API_KEY) {
    return { used: false, fallback_reason: "no configured key", result: fallbackResult() };
  }
  if (input.evidence_items.length === 0) {
    return { used: false, fallback_reason: "no transcript evidence to extract", result: fallbackResult() };
  }

  try {
    const client = await getOpenAIClient();
    const response = await withOpenAiRetry(() =>
      client.responses.create({
        model: config.OPENAI_SYNTHESIS_MODEL,
        store: config.OPENAI_STORE_RESPONSES,
        input: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          {
            role: "user",
            content: JSON.stringify({
              evidence_items: input.evidence_items,
              webex_meeting_title: input.webex_meeting_title,
              webex_meeting_date: input.webex_meeting_date,
              webex_host: input.webex_host,
              user_entered_account: input.user_entered_account,
              uploaded_account_context: input.uploaded_account_context,
              deterministic_intent_signals: input.deterministic_intent_signals,
              deterministic_negative_cues: input.deterministic_negative_cues,
              selected_taxonomy_candidates: input.selected_taxonomy_candidates,
              lifecycle_candidate: input.lifecycle_candidate
            })
          }
        ],
        text: { format: { type: "json_schema", name: "signal_opportunity_extraction", strict: true, schema: qualificationExtractionSchema } }
      })
    );

    const parsed = JSON.parse(response.output_text) as EvidenceExtractionResult;
    return { used: true, fallback_reason: null, result: parsed };
  } catch (error) {
    const code = normalizeOpenAiError(error, "extraction").safe_classification;
    return { used: false, fallback_reason: code, result: fallbackResult() };
  }
}
