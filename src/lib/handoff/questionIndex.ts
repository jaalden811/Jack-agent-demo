import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { Meddpicc, MeddpiccField } from "@/lib/qualification/types";
import type { GenericSignalCategory } from "@/lib/qualification/genericSignalExtraction";
import type { ActionOwnerLane } from "@/lib/action-intelligence/types";
import type { AnsweredQuestion, ContradictoryAnswer, DeclinedQuestion, OpenQuestion, QuestionIndex } from "@/lib/handoff/types";

/**
 * Builds the "do not re-ask" index (Section 4) from evidence the pipeline
 * already assembled — generic signals, MEDDPICC, commercial signals,
 * retained platforms. The rules:
 *
 *  - an answered topic never appears as an open discovery question;
 *  - a PARTIAL answer becomes a targeted clarification (not repeated
 *    discovery);
 *  - explicit customer refusals are preserved as sensitive/declined;
 *  - seller questions and hypotheses are NOT treated as answered facts
 *    (that filtering already happened upstream in intent/generic
 *    extraction).
 *
 * Everything is generic — topic labels come from a fixed taxonomy of
 * linguistic categories, never a company/product/transcript.
 */

// Generic topic taxonomy for the transcript's structured signal
// categories — a linguistic classification, not a product list.
const CATEGORY_TOPIC: Record<GenericSignalCategory, string> = {
  financial_impact: "business impact",
  funding: "funding context",
  deadline: "timing / deadline",
  renewal: "renewal",
  executive_sponsorship: "executive sponsorship",
  budget_ownership: "budget ownership",
  procurement_criteria: "decision / procurement criteria",
  workshop: "agreed next step",
  working_session: "agreed next step",
  pilot: "agreed next step",
  proof_of_value: "agreed next step",
  success_metric: "success criteria",
  next_step_commitment: "agreed next step",
  technical_requirement: "technical requirements",
  integration_requirement: "integrations",
  current_environment: "current environment",
  risk: "risk / constraint"
};

type MeddpiccKey = keyof Meddpicc;
const MEDDPICC_META: Record<MeddpiccKey, { topic: string; owner_lane: ActionOwnerLane }> = {
  metrics: { topic: "business impact / metrics", owner_lane: "shared" },
  economic_buyer: { topic: "economic buyer / funding authority", owner_lane: "sales" },
  decision_criteria: { topic: "decision criteria", owner_lane: "shared" },
  decision_process: { topic: "decision process", owner_lane: "shared" },
  paper_process: { topic: "procurement / paper process", owner_lane: "sales" },
  identify_pain: { topic: "customer problem / pain", owner_lane: "technical" },
  champion: { topic: "champion", owner_lane: "sales" },
  competition: { topic: "competition / alternatives", owner_lane: "shared" }
};

// Generic decline/sensitivity phrasing — a customer explicitly withholding
// or bounding information. Never a company/topic-specific string.
const DECLINE_PATTERNS: RegExp[] = [
  /\b(prefer not to|rather not|not (?:comfortable|prepared|going|willing) to (?:share|say|disclose|discuss))\b/i,
  /\b(can(?:'|no)t (?:share|disclose|discuss|say)|won'?t share|not (?:able|at liberty) to (?:share|disclose))\b/i,
  /\b(don'?t want (?:that|this|it) (?:interpreted|treated|taken)|do not want (?:that|this|it) (?:interpreted|treated))\b/i,
  /\b(under nda|confidential(?:ity)?|off the record|not for (?:external|wider) sharing)\b/i
];

function statusToAnswer(field: MeddpiccField): AnsweredQuestion["answer_status"] {
  if (field.status === "CONFLICTING") return "conflicting";
  if (field.status === "PARTIAL" || field.status === "HYPOTHESIS" || field.status === "DISTRIBUTED") return "partial";
  return "complete";
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

export function buildQuestionIndex(result: SecureNetworkingTriageResult): QuestionIndex {
  const answered: AnsweredQuestion[] = [];
  const open: OpenQuestion[] = [];
  const declined: DeclinedQuestion[] = [];
  const contradictory: ContradictoryAnswer[] = [];

  // Track answered topics so the same topic never becomes an open question.
  const answeredTopics = new Map<string, AnsweredQuestion["answer_status"]>();
  const noteAnswered = (topic: string, status: AnsweredQuestion["answer_status"]) => {
    const existing = answeredTopics.get(topic);
    // "complete" is the strongest; never downgrade it to "partial".
    if (existing === "complete") return;
    answeredTopics.set(topic, status);
  };

  // 1) Answered topics from the transcript's structured generic signals.
  const buckets = result.generic_diagnostics?.signals;
  const allGeneric = buckets ? [...buckets.commercial, ...buckets.technical, ...buckets.ownership, ...buckets.next_steps] : [];
  const seenGenericTopic = new Set<string>();
  for (const signal of allGeneric) {
    const topic = CATEGORY_TOPIC[signal.category] ?? signal.category;
    // One answered entry per topic (the first/most representative quote),
    // so the index is scannable, not a raw signal dump.
    if (seenGenericTopic.has(topic)) continue;
    seenGenericTopic.add(topic);
    answered.push({
      topic,
      question: `What is known about ${topic}?`,
      answer: signal.text,
      answer_status: "partial",
      speaker: null,
      evidence_ids: [signal.evidence_id],
      safe_to_restate: true,
      follow_up_allowed: null
    });
    noteAnswered(topic, "partial");
  }

  // 2) Answered/contradictory/open from MEDDPICC — the authoritative
  //    qualification view. CONFIRMED/PARTIAL/DISTRIBUTED are answered;
  //    CONFLICTING is contradictory; MISSING/HYPOTHESIS become open
  //    questions (unless already answered elsewhere).
  const meddpicc = result.meddpicc;
  if (meddpicc) {
    (Object.keys(MEDDPICC_META) as MeddpiccKey[]).forEach((key) => {
      const field = meddpicc[key];
      const meta = MEDDPICC_META[key];
      if (field.status === "CONFLICTING") {
        contradictory.push({
          topic: meta.topic,
          conflicting_statements: field.gaps.length > 0 ? field.gaps : [field.summary],
          evidence_ids: field.evidence_ids,
          resolution_question: field.next_question || `Resolve the conflicting evidence on ${meta.topic}.`
        });
        noteAnswered(meta.topic, "conflicting");
        return;
      }
      if (field.status === "CONFIRMED" || field.status === "PARTIAL" || field.status === "DISTRIBUTED") {
        answered.push({
          topic: meta.topic,
          question: `What is known about ${meta.topic}?`,
          answer: field.summary,
          answer_status: statusToAnswer(field),
          speaker: null,
          evidence_ids: field.evidence_ids,
          safe_to_restate: true,
          // A PARTIAL/DISTRIBUTED answer becomes a targeted clarification,
          // never a repeated open discovery question.
          follow_up_allowed: field.status === "CONFIRMED" ? null : field.next_question || null
        });
        noteAnswered(meta.topic, statusToAnswer(field));
        // Partial answers additionally produce a targeted (non-blocking)
        // clarification, grounded in what is already known.
        if (field.status !== "CONFIRMED" && field.next_question) {
          open.push({
            question: field.next_question,
            purpose: `Clarify the partial answer on ${meta.topic}`,
            owner_lane: meta.owner_lane,
            priority: "medium",
            blocking: false,
            what_is_already_known: field.summary,
            why_the_gap_matters: `${meta.topic} is only partially established; a targeted clarification advances qualification without repeating discovery.`,
            evidence_ids: field.evidence_ids
          });
        }
        return;
      }
      // MISSING / HYPOTHESIS -> genuinely open, unless the transcript
      // already answers the same topic through a generic signal.
      const priorStatus = answeredTopics.get(meta.topic);
      if (priorStatus === "complete" || priorStatus === "partial") return;
      if (!field.next_question) return;
      open.push({
        question: field.next_question,
        purpose: `Establish ${meta.topic}`,
        owner_lane: meta.owner_lane,
        priority: key === "identify_pain" || key === "economic_buyer" ? "high" : "medium",
        blocking: field.status === "MISSING" && (key === "identify_pain" || key === "economic_buyer" || key === "decision_criteria"),
        what_is_already_known: field.summary || "Not yet established in the transcript.",
        why_the_gap_matters: field.gaps[0] ?? `${meta.topic} is required to advance the recommended action.`,
        evidence_ids: field.evidence_ids
      });
    });
  }

  // 3) Explicit customer refusals / sensitive boundaries — preserved so a
  //    specialist never re-asks something the customer declined.
  const declineTopicSeen = new Set<string>();
  for (const sentence of splitSentences(result.transcript_meta?.raw_text ?? "")) {
    if (DECLINE_PATTERNS.some((re) => re.test(sentence))) {
      const key = sentence.slice(0, 60).toLowerCase();
      if (declineTopicSeen.has(key)) continue;
      declineTopicSeen.add(key);
      declined.push({
        topic: "customer-declined / sensitive",
        what_was_declined: sentence,
        evidence_ids: [],
        reraise_condition: "Only re-raise if the recommended action explains why this information is now necessary."
      });
    }
  }

  return { answered, open, declined_or_sensitive: declined, contradictory };
}

/** The compact "do not re-ask" list (topics + short answers) for messages. */
export function doNotReaskTopics(index: QuestionIndex, limit = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of index.answered) {
    if (seen.has(a.topic)) continue;
    seen.add(a.topic);
    out.push(a.topic);
    if (out.length >= limit) break;
  }
  return out;
}
