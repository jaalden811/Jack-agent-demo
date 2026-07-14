import type { IngestedTranscript } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";

/**
 * Generic, domain-agnostic commercial/technical/ownership/next-step
 * signal extraction (Section 3). Every pattern here detects a
 * *linguistic shape* — a currency amount, a month name, a renewal verb,
 * a sponsorship/ownership phrase, a workshop/pilot/proof-of-value
 * mention, a quantified success-metric phrase, a next-step commitment
 * — never a specific product name, company name, or exact wording from
 * any one transcript. These rules must fire identically on a
 * networking transcript, a security transcript, a collaboration
 * transcript, or any other domain.
 */

export type GenericSignalCategory =
  | "financial_impact"
  | "funding"
  | "deadline"
  | "renewal"
  | "executive_sponsorship"
  | "budget_ownership"
  | "procurement_criteria"
  | "workshop"
  | "pilot"
  | "proof_of_value"
  | "success_metric"
  | "next_step_commitment"
  | "technical_requirement"
  | "integration_requirement"
  | "current_environment"
  | "risk";

export type GenericSignal = {
  evidence_id: string;
  category: GenericSignalCategory;
  bucket: "commercial" | "technical" | "ownership" | "next_steps";
  text: string;
  normalized_value: string | null;
};

const MONTH_NAMES = "january|february|march|april|may|june|july|august|september|october|november|december";

type Rule = { category: GenericSignalCategory; bucket: GenericSignal["bucket"]; pattern: RegExp };

const RULES: Rule[] = [
  // Currency and financial impact — any currency symbol, not just $.
  { category: "financial_impact", bucket: "commercial", pattern: /[$€£¥]\s?[\d][\d,.]*\s?(million|billion|thousand|[mkb])?\b/gi },
  { category: "financial_impact", bucket: "commercial", pattern: /\b\d+(\.\d+)?\s?(percent|%)\b/gi },

  // Funding language — generic verbs/phrases about money being made available.
  { category: "funding", bucket: "commercial", pattern: /\b(funded|funding (approved|allocated|secured|earmarked)|allocated funding|approved budget|earmarked (budget|funding)|budget (approved|allocated|secured))\b/gi },

  // Deadlines — relative time windows and explicit month names/quarters.
  { category: "deadline", bucket: "commercial", pattern: /\b(by|before|within)\s+(Q[1-4]|\d+\s+(days?|weeks?|months?)|the\s+(end of\s+)?(the\s+)?(quarter|year|month))\b/gi },
  { category: "deadline", bucket: "commercial", pattern: new RegExp(`\\b(${MONTH_NAMES})\\b`, "gi") },

  // Renewal language — contract lifecycle verbs, not tied to any product.
  { category: "renewal", bucket: "commercial", pattern: /\b(renew(s|al|ing|ed)?|expir(es?|ing|ation)|contract\s+window|up\s+for\s+renewal)\b/gi },

  // Executive sponsorship and budget ownership — organizational-role language.
  { category: "executive_sponsorship", bucket: "ownership", pattern: /\b(executive\s+sponsor|sponsor(s|ed|ship)?\s+(for|of)?\s*this)\b/gi },
  { category: "budget_ownership", bucket: "ownership", pattern: /\b(owns?\s+the\s+budget|budget\s+(owner|authority|control)|controls?\s+(the\s+|part\s+of\s+the\s+)?budget)\b/gi },

  // Procurement criteria — evaluation/decision-process language.
  { category: "procurement_criteria", bucket: "commercial", pattern: /\b(procurement|rfp|request for proposal|vendor selection|evaluation criteria|decision criteria|selection window|shortlist)\b/gi },

  // Workshops, pilots, and proofs of value — evaluation-scope language.
  { category: "workshop", bucket: "next_steps", pattern: /\b\w*\s?workshop\b/gi },
  { category: "pilot", bucket: "next_steps", pattern: /\bpilot(s|ing)?\b/gi },
  { category: "proof_of_value", bucket: "next_steps", pattern: /\b(proof[-\s]of[-\s]value|proof[-\s]of[-\s]concept|\bpov\b|\bpoc\b)\b/gi },

  // Success metrics — quantified improvement/target language.
  { category: "success_metric", bucket: "technical", pattern: /\breduce\s+[\w\s]{0,20}?\bfrom\s+[\w.%$]+\s+to\s+[\w.%$]+\b/gi },
  { category: "success_metric", bucket: "technical", pattern: /\bunder\s+\d+\s+(minutes?|hours?|seconds?|days?)\b/gi },
  { category: "success_metric", bucket: "technical", pattern: /\bimprove(d|s|ment)?\s+by\s+\d+(\.\d+)?%?\b/gi },
  { category: "success_metric", bucket: "technical", pattern: /\b(reduce|cut|lower)\s+[\w\s]{0,20}?\bby\s+\d+(\.\d+)?%?\b/gi },

  // Next-step commitments — generic follow-up/scheduling language.
  { category: "next_step_commitment", bucket: "next_steps", pattern: /\b(next steps?|follow[-\s]?up|reconvene|schedule\s+(a|the)?\s*(session|meeting|call|workshop|review))\b/gi },

  // Technical/integration requirements and current-environment mentions —
  // generic phrasing, never a specific product name.
  { category: "integration_requirement", bucket: "technical", pattern: /\b(integrat(e|es|ion|ing)\s+with|must\s+support|need(s)?\s+to\s+support|compatible\s+with)\b/gi },
  { category: "current_environment", bucket: "technical", pattern: /\b(currently\s+(use|run|have)|today\s+we\s+(use|run|have)|existing\s+(tool|platform|system|environment))\b/gi },
  { category: "risk", bucket: "technical", pattern: /\b(risk|concern|blocker|gap|limitation)\b/gi }
];

let evidenceCounter = 0;
function nextEvidenceId(): string {
  evidenceCounter += 1;
  return `gs_${String(evidenceCounter).padStart(4, "0")}`;
}

/** Extracts every generic signal from the transcript's customer-
 * attributed text, deduplicated per (category, sentence) pair so a
 * single long sentence matching a pattern twice isn't double-counted. */
export function extractGenericSignals(transcript: IngestedTranscript): GenericSignal[] {
  const chunks = selectRelevantChunks(transcript);
  const signals: GenericSignal[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    for (const rule of RULES) {
      const matches = chunk.text.matchAll(rule.pattern);
      for (const match of matches) {
        const dedupeKey = `${rule.category}::${chunk.index}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        signals.push({
          evidence_id: nextEvidenceId(),
          category: rule.category,
          bucket: rule.bucket,
          text: chunk.text,
          normalized_value: match[0].trim()
        });
      }
    }
  }

  return signals;
}

export function groupGenericSignalsByBucket(signals: GenericSignal[]): {
  commercial: GenericSignal[];
  technical: GenericSignal[];
  ownership: GenericSignal[];
  next_steps: GenericSignal[];
} {
  return {
    commercial: signals.filter((s) => s.bucket === "commercial"),
    technical: signals.filter((s) => s.bucket === "technical"),
    ownership: signals.filter((s) => s.bucket === "ownership"),
    next_steps: signals.filter((s) => s.bucket === "next_steps")
  };
}
