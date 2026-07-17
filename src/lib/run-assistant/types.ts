/** Run-scoped assistant types. The assistant answers ONLY from the run's own
 * evidence (transcript-derived signals, accepted public evidence, canonical
 * result fields) — never from generic model knowledge, and it never mutates
 * scores or routing. */

export type AssistantEvidenceItem = {
  evidence_id: string;
  source_type: "transcript" | "public" | "account_context" | "user_profile";
  text: string;
};

export type RunAssistantContext = {
  run_id: string;
  account: string | null;
  transcript_text: string;
  evidence_items: AssistantEvidenceItem[];
  next_action_summary: string | null;
  open_questions: string[];
  do_not_reask: string[];
  personal_relevance_summary: string | null;
  goal_alignment_summary: string | null;
};

export type AssistantAnswerEvidence = {
  evidence_id: string;
  source_type: AssistantEvidenceItem["source_type"];
  label: string;
};

export type AssistantAnswer = {
  answer: string;
  evidence: AssistantAnswerEvidence[];
  confidence: number;
  missing_information: string[];
  suggested_follow_up: string | null;
  research_used: boolean;
  /** True when Circuit rewrote the grounded answer prose (evidence/confidence
   * remain the deterministic, authoritative values). Additive/optional. */
  synthesized_by_ai?: boolean;
};

export type AssistantExchange = {
  exchange_id: string;
  run_id: string;
  question: string;
  answer: AssistantAnswer;
  timestamp: string;
};

/** Suggested grounded questions surfaced in the UI (generic, not hard-coded
 * per transcript). */
export const SUGGESTED_QUESTIONS: string[] = [
  "Did the customer mention budget?",
  "What did they say about timing?",
  "Who should I engage?",
  "What should I not ask again?",
  "Why was this sent to me?",
  "What is the next action?",
  "What are the biggest gaps?",
  "Did they mention a competitor?"
];
