import { getConfig } from "@/lib/config";
import { describeOpenAiFailure } from "@/lib/signal-agent/openaiStatus";
import type { MatchOutput } from "@/lib/signal-agent/types";

/**
 * Optional OpenAI synthesis (Section 10): when configured and enabled,
 * ask the model for a tighter executive summary, internal brief, and
 * discovery questions — grounded ONLY in the transcript excerpt and the
 * taxonomy entries the deterministic engine already selected. The model
 * is never given the full 34-category catalog and is explicitly told not
 * to introduce a product that isn't already in the supplied matches, so
 * it cannot select an arbitrary product outside the loaded taxonomy.
 *
 * Any failure (no key, disabled, timeout, malformed response) returns
 * `used: false` with a specific `fallback_reason` — the caller always
 * retains its deterministic extraction and scoring; this module can only
 * add polish, never change the verdict or confidence.
 */

export type SynthesisOutput = {
  business_problem: string;
  business_impact: string;
  urgency: string;
  recommended_next_action: string;
  internal_brief: string;
  discovery_questions: string[];
};

export type SynthesisResult = {
  used: boolean;
  fallback_reason: string | null;
  output: SynthesisOutput | null;
};

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export async function synthesizeExecutiveBrief(params: {
  transcriptExcerpt: string;
  matches: MatchOutput[];
  useSynthesis: boolean;
}): Promise<SynthesisResult> {
  const { transcriptExcerpt, matches, useSynthesis } = params;
  const config = getConfig();

  if (!useSynthesis) return { used: false, fallback_reason: "synthesis disabled by user", output: null };
  if (!config.OPENAI_API_KEY) return { used: false, fallback_reason: "no configured key", output: null };
  if (matches.length === 0) return { used: false, fallback_reason: "no taxonomy matches to summarize", output: null };

  const matchSummaries = matches.map((match) => ({
    pain_category: match.pain_category,
    domain: match.domain,
    relationship: match.relationship,
    confidence: match.confidence,
    recommended_solutions: match.recommended_solutions,
    choose_when_evidence: match.solution_decision.choose_when_evidence,
    do_not_choose_conflicts: match.solution_decision.do_not_choose_conflicts,
    adjacent_solutions_considered: match.solution_decision.adjacent_solutions_considered
  }));

  const prompt = [
    "You are drafting an internal-only sales engineering brief. Never invent facts not present in the transcript excerpt or the taxonomy matches below.",
    "You MUST NOT recommend any product that is not already listed in recommended_solutions/adjacent_solutions_considered for the matches provided — do not introduce products from outside this list.",
    "Return strict JSON with keys: business_problem, business_impact, urgency, recommended_next_action, internal_brief, discovery_questions (array of strings, max 5).",
    "",
    `Transcript excerpt:\n${truncate(transcriptExcerpt, 6000)}`,
    "",
    `Taxonomy matches (already selected by a deterministic engine — do not add or remove categories):\n${JSON.stringify(matchSummaries, null, 2)}`
  ].join("\n");

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 15000, maxRetries: 0 });
    // Synthesis (text generation) always uses OPENAI_SYNTHESIS_MODEL via
    // the Responses API — never the embedding model/endpoint.
    const response = await client.responses.create({
      model: config.OPENAI_SYNTHESIS_MODEL,
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 900,
      temperature: 0.2
    });

    const text = response.output_text || "{}";
    const parsed = JSON.parse(text) as Partial<SynthesisOutput>;

    if (
      typeof parsed.business_problem !== "string" ||
      typeof parsed.business_impact !== "string" ||
      typeof parsed.urgency !== "string" ||
      typeof parsed.recommended_next_action !== "string" ||
      typeof parsed.internal_brief !== "string"
    ) {
      return { used: false, fallback_reason: "model returned an incomplete response", output: null };
    }

    return {
      used: true,
      fallback_reason: null,
      output: {
        business_problem: parsed.business_problem,
        business_impact: parsed.business_impact,
        urgency: parsed.urgency,
        recommended_next_action: parsed.recommended_next_action,
        internal_brief: parsed.internal_brief,
        discovery_questions: Array.isArray(parsed.discovery_questions) ? parsed.discovery_questions.filter((q): q is string => typeof q === "string").slice(0, 5) : []
      }
    };
  } catch (error) {
    console.warn("Signal agent: OpenAI synthesis unavailable, retaining deterministic brief.");
    const reason = error instanceof SyntaxError ? "model returned malformed JSON" : describeOpenAiFailure(error);
    return { used: false, fallback_reason: reason, output: null };
  }
}
