import type { BuyingIntentEvidence, BuyingIntentEvidenceType, IngestedTranscript, Stakeholder, StakeholderOwnershipType } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";

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

  return evidence;
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

const OWNERSHIP_KEYWORDS: Array<{ type: StakeholderOwnershipType; keywords: string[] }> = [
  { type: "executive", keywords: ["chief", "cio", "cto", "ceo", "cfo", "evp", "svp", "president", "executive"] },
  { type: "security", keywords: ["security", "ciso", "soc"] },
  { type: "application", keywords: ["application", "platform", "product", "app "] },
  { type: "technical", keywords: ["engineer", "architect", "technical", "engineering"] },
  { type: "operational", keywords: ["operations", "vp", "director", "manager", "ops"] }
];

function classifyOwnership(role: string): StakeholderOwnershipType {
  const lower = role.toLowerCase();
  for (const group of OWNERSHIP_KEYWORDS) {
    if (
      group.keywords.some((keyword) => {
        // Require a word boundary immediately before the keyword (but not
        // necessarily after) — this still lets "engineer" match inside
        // "engineering", while preventing short acronym-like keywords
        // (e.g. "cto", "vp") from false-positive matching mid-word
        // substrings such as "director" (which contains the letters
        // "cto" starting mid-word, with no boundary before them).
        const pattern = new RegExp(`\\b${keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
        return pattern.test(lower);
      })
    ) {
      return group.type;
    }
  }
  return "operational";
}

/** Stakeholders are read only from the transcript's own "Participants"
 * line — never invented. A participant explicitly tagged "(Customer, ...)"
 * is included; the role text after the comma drives ownership_type
 * classification generically (keyword groups above), not a hard-coded
 * per-person mapping. */
export function extractStakeholders(transcript: IngestedTranscript): Stakeholder[] {
  const stakeholders: Stakeholder[] = [];
  for (const participant of transcript.participants) {
    const match = participant.match(/^(.+?)\s*\((.+)\)$/);
    if (!match) continue;
    const name = match[1].trim();
    const roleText = match[2].trim();
    if (!roleText.toLowerCase().includes("customer")) continue;
    const role = roleText.replace(/^customer,?\s*/i, "").trim() || "Customer stakeholder";
    stakeholders.push({ name, role, ownership_type: classifyOwnership(role) });
  }
  return stakeholders;
}
