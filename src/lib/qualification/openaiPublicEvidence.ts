import { getConfig } from "@/lib/config";
import { getOpenAIClient } from "@/lib/openai/client";
import { withOpenAiRetry, classifyOpenAiError } from "@/lib/openai/errorMapping";
import { publicEvidenceClassificationSchema } from "@/lib/qualification/schemas";
import type { ClassifiedPublicResult } from "@/lib/qualification/types";
import type { NormalizedSerpResult } from "@/lib/connectors/serpapi/types";

/**
 * OpenAI Stage B — classifies normalized SerpAPI candidate results.
 * Never receives the raw SerpAPI response; only normalized candidate
 * fields (title/URL/domain/snippet/date/purpose/account/stakeholder/
 * transcript signal). The model may not invent or modify URLs — only
 * the URLs already present in the input may appear in the output.
 */

const SYSTEM_INSTRUCTION = `Classify public search results for an opportunity-triage application.
A public result may support public account identity, industry, public executive title, public strategy, public incident, public initiative, technology footprint, or competition.
A public result cannot confirm internal budget, private opportunity stage, private renewal date, procurement status, internal decision process, economic authority, champion status, or private install base.
Use only the supplied URLs. Never generate or modify URLs.
Reject results that do not confidently match the same company or person.
Return unsupported or ambiguous claims separately.`;

export type PublicEvidenceClassificationOutcome = {
  used: boolean;
  fallback_reason: string | null;
  classified: ClassifiedPublicResult[];
};

export async function classifyPublicEvidence(
  candidates: NormalizedSerpResult[],
  context: { account_candidate: string | null; transcript_signal: string | null },
  enabled: boolean
): Promise<PublicEvidenceClassificationOutcome> {
  const config = getConfig();
  if (!enabled || !config.OPENAI_PUBLIC_EVIDENCE_CLASSIFICATION_ENABLED) {
    return { used: false, fallback_reason: "public evidence classification disabled", classified: [] };
  }
  if (!config.OPENAI_API_KEY) {
    return { used: false, fallback_reason: "no configured key", classified: [] };
  }
  if (candidates.length === 0) {
    return { used: false, fallback_reason: "no public candidates to classify", classified: [] };
  }

  const validUrls = new Set(candidates.map((c) => c.url));

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
              results: candidates.map((c) => ({
                source_id: c.source_id,
                query_purpose: c.purpose,
                title: c.title,
                url: c.url,
                domain: c.domain,
                snippet: c.snippet,
                published_at: c.published_at,
                account_candidate: context.account_candidate,
                transcript_signal: context.transcript_signal
              }))
            })
          }
        ],
        text: { format: { type: "json_schema", name: "public_evidence_classification", strict: true, schema: publicEvidenceClassificationSchema } }
      })
    );

    const parsed = JSON.parse(response.output_text) as { classified_results: ClassifiedPublicResult[] };
    // Defense in depth: never trust the model to have respected "never
    // generate or modify URLs" — drop any classification whose
    // source_id does not correspond to a URL we actually supplied.
    const validSourceIds = new Set(candidates.map((c) => c.source_id));
    const filtered = parsed.classified_results.filter((item) => validSourceIds.has(item.source_id));
    void validUrls; // retained for potential future direct-URL validation
    return { used: true, fallback_reason: null, classified: filtered };
  } catch (error) {
    const code = classifyOpenAiError(error);
    return { used: false, fallback_reason: code, classified: [] };
  }
}
