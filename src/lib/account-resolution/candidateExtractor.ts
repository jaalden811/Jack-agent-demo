import { validateAccountCandidateName } from "@/lib/account-resolution/accountValidation";

/**
 * Extracts account-name candidates from free transcript dialogue
 * (Section 1, priority #8/#9). Deliberately conservative: a candidate
 * is only promoted from prose when it is explicitly introduced as a
 * company (e.g. "we are Acme Retail", "our company is Acme Retail",
 * "at Acme Retail we..."), never from an arbitrary capitalized noun
 * phrase — this is what keeps an internal application/service name
 * ("we're migrating RetailConnect to...") from ever being mistaken for
 * a company name, since it is never introduced with company-framing
 * language.
 */

export type DialogueAccountCandidate = { name: string; evidence_text: string; confidence: number };

// The introductory phrase's leading letter is matched in either case
// (it may or may not begin a sentence), but — deliberately without a
// global `i` flag — the captured name itself must still start with a
// literal capital letter. That is what keeps an ordinary lowercase
// word immediately following the phrase ("we are happy to...") from
// ever being captured as a company name.
const NAME_CAPTURE = "([A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,4})";
const COMPANY_INTRODUCTION_PATTERNS: RegExp[] = [
  new RegExp(`\\b[Ww]e(?:'re| are)\\s+${NAME_CAPTURE}\\b`, "g"),
  new RegExp(`\\b[Oo]ur company(?:'s| is)?\\s*,?\\s*${NAME_CAPTURE}\\b`, "g"),
  new RegExp(`\\b[Aa]t\\s+${NAME_CAPTURE}\\s*,?\\s+we\\b`, "g"),
  new RegExp(`\\b[Tt]his is\\s+${NAME_CAPTURE}\\s+calling\\b`, "g"),
  new RegExp(`\\b[Oo]n behalf of\\s+${NAME_CAPTURE}\\b`, "g")
];

const DOMAIN_MENTION_RE = /\b([a-z0-9-]+\.(?:com|net|org|io|co|health|biz))\b/gi;

export function extractDialogueAccountCandidates(dialogueText: string[]): DialogueAccountCandidate[] {
  const candidates: DialogueAccountCandidate[] = [];
  const seen = new Set<string>();

  for (const sentence of dialogueText) {
    for (const pattern of COMPANY_INTRODUCTION_PATTERNS) {
      for (const match of sentence.matchAll(pattern)) {
        const raw = match[1]?.trim();
        if (!raw) continue;
        const validation = validateAccountCandidateName(raw);
        if (!validation.valid) continue;
        const key = raw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ name: raw, evidence_text: sentence, confidence: 0.6 });
      }
    }
  }

  return candidates;
}

export function extractDomainMentions(dialogueText: string[]): Array<{ domain: string; evidence_text: string }> {
  const mentions: Array<{ domain: string; evidence_text: string }> = [];
  const seen = new Set<string>();
  for (const sentence of dialogueText) {
    for (const match of sentence.matchAll(DOMAIN_MENTION_RE)) {
      const domain = match[1].toLowerCase();
      if (seen.has(domain)) continue;
      seen.add(domain);
      mentions.push({ domain, evidence_text: sentence });
    }
  }
  return mentions;
}
