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
// Title-case token run, allowing "&"/"and" connectors WITHIN a company name
// ("Acme Water & Power", "Barnes and Noble", "AT&T") while still requiring
// each part to start capitalized (so a trailing lowercase word is never pulled
// into the name).
const NAME_CAPTURE = "([A-Z][\\w&.'-]*(?:\\s+(?:&\\s+|and\\s+)?[A-Z][\\w&.'-]*){0,4})";
const COMPANY_INTRODUCTION_PATTERNS: RegExp[] = [
  new RegExp(`\\b[Ww]e(?:'re| are)\\s+${NAME_CAPTURE}\\b`, "g"),
  new RegExp(`\\b[Oo]ur company(?:'s| is)?\\s*,?\\s*${NAME_CAPTURE}\\b`, "g"),
  new RegExp(`\\b[Aa]t\\s+${NAME_CAPTURE}\\s*,?\\s+we\\b`, "g"),
  new RegExp(`\\b[Tt]his is\\s+${NAME_CAPTURE}\\s+calling\\b`, "g"),
  new RegExp(`\\b[Oo]n behalf of\\s+${NAME_CAPTURE}\\b`, "g"),
  // Vendor coverage / account-ownership framing — a seller naming the
  // customer account they cover ("I cover Acme Retail for Cisco", "account
  // executive for Acme Retail"). The account name must be immediately
  // followed by "for", which distinguishes "I cover [Acme Retail] for Cisco"
  // (Acme Retail = account) from "I cover the [Cisco] renewal for Acme" (here
  // the token after "cover" is the vendor/product, not the account, so it is
  // correctly skipped).
  new RegExp(`\\b[Ii] (?:cover|look after|handle|carry|own|manage|support)\\s+${NAME_CAPTURE}\\s+(?:commercially|technically|directly|globally|regionally|nationally|strategically\\s+)?(?:commercially\\s+)?for\\b`, "g"),
  // "I cover <Account> commercially/technically." with no trailing "for" — the
  // adverb after the full account name still identifies the covered account.
  new RegExp(`\\b[Ii] (?:cover|look after|handle|carry|own|manage|support)\\s+${NAME_CAPTURE}\\s+(?:commercially|technically|directly|globally|regionally|nationally|strategically)\\b`, "g"),
  new RegExp(`\\baccount (?:executive|manager|owner|lead|director)\\s+for\\s+${NAME_CAPTURE}`, "g"),
  // A customer stating their own employer, first-person singular OR plural
  // ("I lead cyber operations for Acme", "We run nine member journeys for Acme
  // Health", "I work at Acme Retail") — the org after for/at is the account. The
  // object between the verb and for/at can be a longish noun phrase, so allow up
  // to ~60 chars (still anchored by a Title-Case org name after for/at).
  new RegExp(`\\b(?:[Ii]|[Ww]e) (?:lead|run|operate|manage|head|oversee|direct|support|work in|work at|work for)\\s+[\\w\\s,'&.-]{2,60}?\\s(?:for|at)\\s+${NAME_CAPTURE}`, "g")
];

// Explicit canonical-account declarations — the strongest dialogue signal
// ("Acme Retail is the account", "the account is Acme Retail", "canonical
// scope … is Acme Retail"). Confident enough to override a parent-company or
// partial candidate.
const EXPLICIT_ACCOUNT_PATTERNS: RegExp[] = [
  new RegExp(`${NAME_CAPTURE}\\s+is\\s+(?:the|our)\\s+(?:canonical\\s+|scoped\\s+)?account\\b`, "g"),
  new RegExp(`\\bthe\\s+(?:canonical\\s+|scoped\\s+)?account\\s+(?:is|should be)\\s+${NAME_CAPTURE}`, "g"),
  new RegExp(`\\bcanonical\\s+(?:account|scope)[\\w\\s]{0,25}?\\bis\\s+${NAME_CAPTURE}`, "g"),
  // Operating / contracting entity declarations — a customer naming the legal
  // operating or contracting entity that owns the work/subscription ("the
  // operating utility is Acme Water & Power", "the contracting entity is
  // Acme Retail"). As strong as an explicit account declaration.
  new RegExp(`\\bthe\\s+(?:operating|contracting|prospective(?:\\s+contracting)?|legal|scoped|canonical)\\s+(?:account|entity|company|utility|business|customer|organi[sz]ation|org|party|subsidiary)\\s+(?:is|should be|will be|remains?)\\s+${NAME_CAPTURE}`, "g")
];

const DOMAIN_MENTION_RE = /\b([a-z0-9-]+\.(?:com|net|org|io|co|health|biz))\b/gi;

export function extractDialogueAccountCandidates(dialogueText: string[]): DialogueAccountCandidate[] {
  const candidates: DialogueAccountCandidate[] = [];
  const seen = new Set<string>();

  const collect = (patterns: RegExp[], confidence: number) => {
    for (const sentence of dialogueText) {
      for (const pattern of patterns) {
        for (const match of sentence.matchAll(pattern)) {
          // Strip trailing sentence punctuation the capture may include
          // ("Acme." → "Acme"); internal dots (St. Jude) are kept.
          // Also cut a trailing "<connector> <pronoun/aux>…" run the greedy
          // name capture may absorb ("Acme Freight and I've got sign-off"
          // → "Acme Freight"), while preserving real connective company
          // names ("Water & Power", "Johnson and Johnson") whose next token is
          // a proper noun, not a pronoun. Generic (pronoun-based), not company-
          // specific.
          const raw = match[1]
            ?.trim()
            .replace(/\s+(?:and|&)\s+(?:i|i['’]ve|i['’]m|i['’]ll|i['’]d|we|we['’]ve|we['’]re|we['’]ll|they|he|she|it|you|our|my|the)\b.*$/i, "")
            .replace(/[.,;:]+$/, "")
            .trim();
          if (!raw) continue;
          const validation = validateAccountCandidateName(raw);
          if (!validation.valid) continue;
          const key = raw.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ name: raw, evidence_text: sentence, confidence });
        }
      }
    }
  };

  // Explicit declarations first (highest confidence, override parent/partial),
  // then self-identification / coverage framing (probable on its own).
  collect(EXPLICIT_ACCOUNT_PATTERNS, 0.92);
  collect(COMPANY_INTRODUCTION_PATTERNS, 0.72);

  return candidates;
}

// Title-Case proper-noun run (1-3 tokens), reused for sub-entity detection.
const SUBENT_NAME = "([A-Z][A-Za-z0-9&.'-]+(?:\\s+[A-Z][A-Za-z0-9&.'-]+){0,2})";
// A candidate NAMED as a subordinate entity — an acquired estate, a division, a
// subsidiary, or a business unit — is NOT the canonical account (the account is
// the PARENT that owns it). Generic structural markers only; never a company
// literal. Both orders are covered: "<Name> acquisition/division/subsidiary…"
// and "acquired/subsidiary … <Name>", plus "<Name>, one of the N divisions".
const SUBENTITY_PATTERNS: RegExp[] = [
  new RegExp(`\\b${SUBENT_NAME}\\s+(?:acquisition|division|subsidiary|business unit|estate|unit)\\b`, "g"),
  new RegExp(`\\b(?:acquired|acquisition of|subsidiary|division|business unit)\\b[\\w\\s,'-]{0,20}?\\b${SUBENT_NAME}\\b`, "g"),
  new RegExp(`\\b${SUBENT_NAME},?\\s+(?:one|each|another)\\s+of\\s+(?:the\\s+)?(?:\\w+\\s+){0,2}(?:divisions?|subsidiar(?:y|ies)|units?|business units?)\\b`, "g")
];

/** Names the transcript explicitly frames as a subordinate entity (acquired
 * estate / division / subsidiary / business unit). The resolver demotes these
 * so a sub-entity mentioned frequently in dialogue never outranks the parent
 * account it belongs to. Returns lowercased names. */
export function extractSubEntityNames(dialogueText: string[]): Set<string> {
  const names = new Set<string>();
  for (const sentence of dialogueText) {
    for (const re of SUBENTITY_PATTERNS) {
      for (const m of sentence.matchAll(re)) {
        // Strip a leading determiner ("The Meadowbrook subsidiary" -> "Meadowbrook")
        // so the demoted name matches the extracted org candidate exactly.
        const name = (m[1] ?? "")
          .trim()
          .replace(/^(?:the|a|an|our|their|its)\s+/i, "")
          .replace(/[.,;:]+$/, "");
        if (name) names.add(name.toLowerCase());
      }
    }
  }
  return names;
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
