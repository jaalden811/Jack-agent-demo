import { keywords, retrieveEvidence, validateCitedIds } from "@/lib/run-assistant/evidenceRetriever";
import type { AssistantAnswer, RunAssistantContext } from "@/lib/run-assistant/types";

/**
 * Deterministic, grounded run-assistant. Answers ONLY from the run's own
 * evidence — it never answers from generic model knowledge, never invents
 * facts, never mutates scores/routing, and always identifies missing
 * information. (A Circuit synthesis pass could rewrite the grounded answer
 * later; the grounded evidence + citations remain authoritative.)
 */

type IntentHandler = { test: RegExp; build: (ctx: RunAssistantContext) => { text: string | null; source: string } };

const INTENT_HANDLERS: IntentHandler[] = [
  { test: /(why).*(sent|routed|me)|why me/i, build: (ctx) => ({ text: ctx.personal_relevance_summary, source: "personal_relevance" }) },
  { test: /(not to ?ask|already (told|answered|know)|re-?ask)/i, build: (ctx) => ({ text: ctx.do_not_reask.length ? `Do not re-ask: ${ctx.do_not_reask.join("; ")}.` : null, source: "do_not_reask" }) },
  { test: /(next action|what should i do|next step|recommend)/i, build: (ctx) => ({ text: ctx.next_action_summary, source: "next_action" }) },
  { test: /(goal|quota|target|my number)/i, build: (ctx) => ({ text: ctx.goal_alignment_summary, source: "goal_alignment" }) },
  { test: /(gap|unknown|unresolved|still need|missing)/i, build: (ctx) => ({ text: ctx.open_questions.length ? `Biggest open questions: ${ctx.open_questions.slice(0, 4).join("; ")}.` : null, source: "open_questions" }) }
];

export function answerRunQuestion(question: string, context: RunAssistantContext, opts: { research?: boolean } = {}): AssistantAnswer {
  const research_used = false; // deterministic path never auto-searches the web
  const kws = keywords(question);

  // Intent shortcuts pull from canonical, already-evidenced fields.
  for (const handler of INTENT_HANDLERS) {
    if (handler.test.test(question) && handler.build(context).text) {
      const built = handler.build(context);
      const supporting = retrieveEvidence(question, context, 2);
      return {
        answer: built.text as string,
        evidence: supporting.map((s) => ({ evidence_id: s.item.evidence_id, source_type: s.item.source_type, label: s.item.text.slice(0, 80) })),
        confidence: 0.7,
        missing_information: [],
        suggested_follow_up: opts.research ? "Run objective-aware research to add external context." : null,
        research_used
      };
    }
  }

  const matches = retrieveEvidence(question, context, 3);
  if (matches.length === 0) {
    return {
      answer: "The run evidence doesn't cover that. Nothing in this meeting's transcript or accepted public evidence answers it.",
      evidence: [],
      confidence: 0.2,
      missing_information: [kws.length ? `No evidence for: ${kws.join(", ")}` : "Question could not be interpreted."],
      suggested_follow_up: "Ask for more research to gather external context, or rephrase using terms from the call.",
      research_used
    };
  }

  const citedIds = matches.map((m) => m.item.evidence_id);
  const validation = validateCitedIds(citedIds, context);
  const safeMatches = validation.valid ? matches : matches.filter((m) => !validation.unknown.includes(m.item.evidence_id));

  const answerText = `Based on the meeting evidence: ${safeMatches.map((m) => m.item.text.trim().replace(/\s+/g, " ")).join(" ")}`.slice(0, 700);
  const strongest = safeMatches[0]?.score ?? 0;
  return {
    answer: answerText,
    evidence: safeMatches.map((m) => ({ evidence_id: m.item.evidence_id, source_type: m.item.source_type, label: m.item.text.slice(0, 80) })),
    confidence: Math.max(0.3, Math.min(0.85, 0.3 + strongest * 0.15)),
    missing_information: strongest < 2 ? ["Only a partial match — confirm with the customer."] : [],
    suggested_follow_up: opts.research ? "Run objective-aware research to add external context." : null,
    research_used
  };
}
