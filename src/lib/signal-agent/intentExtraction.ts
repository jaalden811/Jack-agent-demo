import type { BuyingIntentEvidence, BuyingIntentEvidenceType, IngestedTranscript, Stakeholder } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";
import { classifyOwnership } from "@/lib/signal-agent/stakeholderExtraction";

/**
 * Explicit transcript intent extraction — deterministic, generic, and
 * product-agnostic. Every pattern here detects a *linguistic* signal
 * (budget, timeline, ownership, quantified impact, renewal, active
 * evaluation, next step) that applies to any deal in any taxonomy
 * category; none of these patterns reference a Cisco/Splunk product or
 * taxonomy category id.
 */

type PatternRule = {
  type: BuyingIntentEvidenceType;
  pattern: RegExp;
  scoreContribution: number;
  normalize?: (match: RegExpMatchArray) => string | null;
};

const NEGATED_NEARBY = /\b(not|no|never|isn't|aren't|doesn't|don't|won't|didn't)\s+(\w+\s+){0,3}$/i;

function isPrecededByNegation(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index);
  return NEGATED_NEARBY.test(before);
}

const RULES: PatternRule[] = [
  {
    type: "budget",
    pattern: /\$\s?[\d][\d,.]*\s?(million|billion|thousand|[mkb])?\b/gi,
    scoreContribution: 0.16
  },
  {
    type: "budget",
    pattern: /\b(budget (approved|allocated|secured|earmarked)|approved (capital|budget)|board approval|first[-\s]phase budget|capital budget|fully budgeted)\b/gi,
    scoreContribution: 0.14
  },
  {
    type: "timeline",
    pattern: /\b(this|next) (quarter|year|month|fiscal year)\b/gi,
    scoreContribution: 0.07
  },
  {
    type: "timeline",
    pattern: /\b\d{1,3}[-\s]?(day|days|week|weeks|month|months)\b/gi,
    scoreContribution: 0.06
  },
  {
    type: "timeline",
    pattern: /\bwithin \d+ (business )?days?\b/gi,
    scoreContribution: 0.06
  },
  {
    type: "impact",
    pattern: /\$\s?[\d][\d,.]*\s?(million|billion|thousand|[mkb])?\s?(in )?(lost|impact|cost|revenue)/gi,
    scoreContribution: 0.14
  },
  {
    type: "impact",
    pattern: /\b\d+\s?(locations|sites|stores|branches|offices|users|employees|endpoints)\b/gi,
    scoreContribution: 0.08
  },
  {
    type: "impact",
    pattern: /\b\d+\s?(high[-\s]severity )?incidents?\b/gi,
    scoreContribution: 0.08
  },
  {
    type: "impact",
    pattern: /\b\d+\s?minutes?\b/gi,
    scoreContribution: 0.05
  },
  {
    type: "renewal",
    pattern: /\b(renewal|renews?|renewing)\b[^.]{0,60}/gi,
    scoreContribution: 0.08
  },
  {
    type: "evaluation",
    pattern: /\b(actively evaluat(e|ing)|rfp|request for proposal|procurement|vendor selection|selection window|shortlist)\b/gi,
    scoreContribution: 0.09
  },
  {
    type: "evaluation",
    pattern: /\bpilot\b[^.]{0,60}/gi,
    scoreContribution: 0.08
  },
  {
    type: "evaluation",
    pattern: /\b(prepared to purchase|purchase this quarter|ready to (buy|purchase|move forward))\b/gi,
    scoreContribution: 0.12
  },
  {
    type: "next_step",
    pattern: /\b(architecture|discovery) workshop\b[^.]{0,60}/gi,
    scoreContribution: 0.08
  },
  {
    type: "next_step",
    pattern: /\bwithin \d+ business days?\b/gi,
    scoreContribution: 0.07
  },
  {
    type: "next_step",
    pattern: /\bnext steps?\b[^.]{0,40}/gi,
    scoreContribution: 0.04
  }
];

// Generic limiting/modality qualifiers that must prevent a matched
// commercial-timing / renewal / evaluation phrase from being counted as
// firm buying evidence (Section 7): a planning boundary is not a
// procurement timeline; caveated renewal flexibility is not a confirmed
// renewal; "not a procurement timeline" / "no approved ... project" /
// "not an evaluation yet" are limiting facts, not momentum. Generic —
// never tied to a company/product/transcript.
const TIMING_LIMITING_RE = /\b(planning boundary|not a procurement timeline|not a (commercial|buying) timeline|practical boundary)\b/i;
const RENEWAL_HYPOTHETICAL_RE = /\b(renewal-related flexibility|may have|might have|could have|not confirmed|possible|possibly|potential(ly)?|some flexibility|would not build a plan)\b/i;
const EVALUATION_LIMITING_RE = /\b(not (an|a) (evaluation|formal evaluation|competition|selection)|no approved (replacement )?(project|program)|not running a (siem )?competition|no formal (evaluation|competition))\b/i;

/** Applies generic modality/limiting-qualifier filtering to raw intent
 * evidence so caveated or explicitly-limited statements are not counted
 * as firm timing / renewal / evaluation momentum (Section 7). */
function refineIntentEvidence(evidence: BuyingIntentEvidence[]): BuyingIntentEvidence[] {
  return evidence.filter((item) => {
    if (item.type === "timeline" && TIMING_LIMITING_RE.test(item.text)) return false;
    if (item.type === "renewal" && RENEWAL_HYPOTHETICAL_RE.test(item.text)) return false;
    if (item.type === "evaluation" && EVALUATION_LIMITING_RE.test(item.text)) return false;
    return true;
  });
}

export function extractBuyingIntentEvidence(transcript: IngestedTranscript): BuyingIntentEvidence[] {
  const sentences = selectRelevantChunks(transcript);
  const evidence: BuyingIntentEvidence[] = [];
  const seenTextByType = new Set<string>();

  for (const sentence of sentences) {
    for (const rule of RULES) {
      const matches = sentence.text.matchAll(rule.pattern);
      for (const match of matches) {
        if (match.index === undefined) continue;
        if (isPrecededByNegation(sentence.text, match.index)) continue;

        const dedupeKey = `${rule.type}::${sentence.text}`;
        if (seenTextByType.has(dedupeKey)) continue;
        seenTextByType.add(dedupeKey);

        evidence.push({
          type: rule.type,
          text: sentence.text,
          normalized_value: rule.normalize ? rule.normalize(match) : match[0].trim(),
          score_contribution: rule.scoreContribution
        });
      }
    }
  }

  return refineIntentEvidence(evidence);
}

/** Total intent-evidence score, capped at 1.0 and de-duplicated per
 * evidence type so many small matches of the same type don't dominate. */
export function scoreBuyingIntentEvidence(evidence: BuyingIntentEvidence[]): number {
  const byType = new Map<BuyingIntentEvidenceType, number>();
  for (const item of evidence) {
    byType.set(item.type, (byType.get(item.type) ?? 0) + item.score_contribution);
  }
  const total = Array.from(byType.values()).reduce((sum, value) => sum + Math.min(value, 0.3), 0);
  return Math.min(1, total);
}

/** Legacy, simple stakeholder list (name/role/ownership_type only) used
 * for corroboration scoring and the `stakeholders` result field. Reads
 * from the transcript's structural participant records — built purely
 * from transcript text (headers, the legacy Participants: line, or
 * dialogue turns), never invented. Only customer-side participants with
 * a discernible role are included; vendor-side (e.g. Cisco seller)
 * participants are excluded regardless of how often they spoke. See
 * @/lib/signal-agent/stakeholderExtraction for the richer three-tier
 * (participants / named stakeholders / inferred functional owners) model. */
export function extractStakeholders(transcript: IngestedTranscript): Stakeholder[] {
  const stakeholders: Stakeholder[] = [];
  for (const record of transcript.participantRecords) {
    if (record.classification !== "customer") continue;
    // A customer-side participant is a stakeholder if they either have a
    // discernible role/title (from a header/Participants: line) OR
    // actually spoke on the call (turnCount > 0) — a dialogue-only
    // transcript (e.g. "00:00 — Erin: ...") has no per-speaker title
    // yet the speakers are unambiguously real named stakeholders, so
    // requiring a title silently dropped every one of them. When no
    // explicit title exists, a neutral generic role is used (never a
    // fabricated title).
    if (!record.title && record.turnCount === 0) continue;
    const role = record.title ?? "Customer stakeholder";
    stakeholders.push({ name: record.name, role, ownership_type: classifyOwnership(role) });
  }
  return stakeholders;
}
