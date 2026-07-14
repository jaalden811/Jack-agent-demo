import { getConfig } from "@/lib/config";
import { getOpenAIClient } from "@/lib/openai/client";
import { withOpenAiRetry, classifyOpenAiError } from "@/lib/openai/errorMapping";
import { messageSynthesisSchema } from "@/lib/qualification/schemas";
import type { AnalysisLink, Meddpicc, SynthesizedMessages } from "@/lib/qualification/types";
import type { AccountResolution } from "@/lib/qualification/types";
import type { SecureNetworkingTriageResult, StakeholderRecord } from "@/lib/signal-agent/types";

/**
 * OpenAI Stage D — drafts the four lane-specific messages from the
 * structured qualification object (not the raw transcript). Sales and
 * technical content must be materially different; the model receives
 * the channel character limit and must include a link only when
 * analysis_link.included is true.
 */

const SALES_SYSTEM_INSTRUCTION = `Write for Bella Robinson, the Sales / Commercial owner, and Jack Alden, the Technical / Specialist owner — two DIFFERENT people receiving two DIFFERENT messages per channel.
Sales messages (Webex + email) focus on: opportunity thesis, at least three evidence-backed why-now signals, business impact, budget, timing, renewal, procurement, competition, a compact MEDDPICC snapshot (all eight dimensions), stakeholder coverage with functional AND buying roles, and at least three specific commercial next actions. Do not turn technical details into a long architecture report. Target a rich but scannable Webex message up to the supplied channel character limit.
Technical messages (Webex + email) focus on: customer pain, current architecture, products/platforms mentioned, integrations, operational gaps, technical decision criteria, success metrics, at least three specific workshop/POV/architecture next actions, risks, technical discovery questions, evidence excerpts. Do not merely restate the sales message. Never include the commercial pursuit score. Target a rich but scannable Webex message up to the supplied channel character limit.
Do not call someone an Economic Buyer or Champion unless the supplied structured record's status for that field is CONFIRMED.
Only cite a public source URL that is explicitly supplied in the input — never invent or modify a URL.
Include the supplied analysis link only when analysis_link.included is true; otherwise use the supplied plain-text run reference and do not render any link.
Never introduce a product that is not already present in the supplied recommended_solutions.
Return only the structured response required by the schema.`;

export type MessageSynthesisOutcome = {
  used: boolean;
  fallback_reason: string | null;
  messages: SynthesizedMessages | null;
};

export async function synthesizeQualifiedMessages(params: {
  result: SecureNetworkingTriageResult;
  meddpicc: Meddpicc;
  accountResolution: AccountResolution;
  namedStakeholders: StakeholderRecord[];
  salesRecipientName: string;
  technicalRecipientName: string;
  analysisLink: AnalysisLink;
  runId: string;
  webexCharLimit: number;
  publicEvidenceSummaries: Array<{ title: string; url: string; summary: string }>;
  enabled: boolean;
  /** Validation failures from a prior attempt — when present, the model
   * is explicitly told what to fix (Section 15 retry-once). */
  validationFeedback?: string[];
}): Promise<MessageSynthesisOutcome> {
  const config = getConfig();
  if (!params.enabled || !config.OPENAI_MESSAGE_SYNTHESIS_ENABLED) {
    return { used: false, fallback_reason: "message synthesis disabled", messages: null };
  }
  if (!config.OPENAI_API_KEY) {
    return { used: false, fallback_reason: "no configured key", messages: null };
  }

  try {
    const client = await getOpenAIClient();
    const response = await withOpenAiRetry(() =>
      client.responses.create({
        model: config.OPENAI_SYNTHESIS_MODEL,
        store: config.OPENAI_STORE_RESPONSES,
        input: [
          { role: "system", content: SALES_SYSTEM_INSTRUCTION },
          ...(params.validationFeedback && params.validationFeedback.length > 0
            ? [{ role: "system" as const, content: `Your previous draft failed these quality checks — fix ALL of them: ${params.validationFeedback.join("; ")}` }]
            : []),
          {
            role: "user",
            content: JSON.stringify({
              sales_recipient: params.salesRecipientName,
              technical_recipient: params.technicalRecipientName,
              verdict: params.result.executive_summary.verdict,
              confidence: params.result.executive_summary.confidence,
              opportunity_motion: params.result.executive_summary.primary_opportunity,
              recommended_solutions: params.result.matches[0]?.recommended_solutions ?? [],
              meddpicc: params.meddpicc,
              account_resolution: params.accountResolution,
              named_stakeholders: params.namedStakeholders,
              commercial_signals: params.result.commercial_signals,
              business_problem: params.result.executive_summary.business_problem,
              business_impact: params.result.executive_summary.business_impact,
              next_actions: params.result.recommended_specialists,
              qualification_gaps: params.result.discovery_questions,
              channel_character_limit: params.webexCharLimit,
              analysis_link: params.analysisLink,
              run_id: params.runId,
              public_evidence: params.publicEvidenceSummaries
            })
          }
        ],
        text: { format: { type: "json_schema", name: "lane_message_synthesis", strict: true, schema: messageSynthesisSchema } }
      })
    );

    const parsed = JSON.parse(response.output_text) as SynthesizedMessages;
    return { used: true, fallback_reason: null, messages: parsed };
  } catch (error) {
    const code = classifyOpenAiError(error);
    return { used: false, fallback_reason: code, messages: null };
  }
}
