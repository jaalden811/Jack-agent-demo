import { validateAccountCandidateName } from "@/lib/account-resolution/accountValidation";
import { extractDialogueAccountCandidates, extractDomainMentions } from "@/lib/account-resolution/candidateExtractor";
import { disambiguateAccount } from "@/lib/account-resolution/accountDisambiguation";
import { parseOrganizationEntities } from "@/lib/account-resolution/organizationEntityParser";
import { resolveDomainFromEmails } from "@/lib/account-resolution/domainResolver";
import type { AccountCandidate, AccountResolutionInputs, AccountResolutionResult, AccountResolutionStatus } from "@/lib/account-resolution/types";

// Generic meeting-title/calendar-subject cleanup — strips common
// scheduling/connective words and vendor names so "Acme Corp Discovery
// Call" or "Cisco <> Acme Corp Sync" yields "Acme Corp" rather than
// treating the whole scheduling phrase as the account name. Never a
// lookup against one known company.
const MEETING_TITLE_NOISE_RE = /\b(discovery|call|meeting|sync|check-?in|kickoff|review|demo|intro|workshop|session)\b/gi;

export function cleanMeetingTitleForAccountName(title: string | null): string | null {
  if (!title) return null;
  const cleaned = title
    .replace(MEETING_TITLE_NOISE_RE, "")
    .replace(/[<>|/]+/g, " ")
    .replace(/-{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

/**
 * Account recognition (Section 1) — the exact 11-source priority order.
 * Every source contributes a candidate with its own confidence; the
 * highest-confidence valid candidate wins, with every other valid
 * candidate retained as an alternative. Never searches broadly for a
 * generic/unresolved account (enforced by callers checking `status`
 * before invoking @/lib/account-resolution/accountDisambiguation).
 */

function statusForConfidence(confidence: number, hasMultipleClose: boolean, hasConflict: boolean): AccountResolutionStatus {
  if (hasConflict) return "conflicting";
  if (confidence <= 0) return "unresolved";
  if (hasMultipleClose) return "ambiguous";
  if (confidence >= 0.9) return "confirmed";
  if (confidence >= 0.7) return "probable";
  return "unresolved";
}

export function resolveAccount(inputs: AccountResolutionInputs): AccountResolutionResult {
  const candidates: AccountCandidate[] = [];
  const issues: string[] = [];

  function pushIfValid(name: string | null, domain: string | null, confidence: number, source: AccountCandidate["source"], evidenceIds: string[]) {
    if (!name) return;
    const validation = validateAccountCandidateName(name);
    if (!validation.valid) {
      issues.push(`Rejected candidate "${name}" from ${source ?? "unknown source"}: ${validation.reason}`);
      return;
    }
    candidates.push({ name: name.trim(), domain, confidence, evidence_ids: evidenceIds, source });
  }

  // Priority order, highest first — each source's base confidence
  // reflects how reliable that evidence type is in isolation.
  pushIfValid(inputs.transcriptAccountField, null, 0.95, "transcript", ["transcript_account_field"]);
  pushIfValid(inputs.userEnteredAccount, null, 0.97, "user_input", ["user_entered_account"]);
  if (inputs.uploadedAccountRecord) {
    pushIfValid(inputs.uploadedAccountRecord.name, inputs.uploadedAccountRecord.domain, 0.93, "crm", ["uploaded_account_record"]);
  }
  if (inputs.crmMatch) {
    pushIfValid(inputs.crmMatch.name, inputs.crmMatch.domain, Math.max(0.85, inputs.crmMatch.confidence), "crm", ["crm_match"]);
  }
  pushIfValid(cleanMeetingTitleForAccountName(inputs.webexMeetingTitle), null, 0.7, "webex", ["webex_meeting_title"]);
  pushIfValid(cleanMeetingTitleForAccountName(inputs.outlookEventSubject), null, 0.68, "outlook", ["outlook_event_subject"]);

  const { domain: emailDomain, guessedName } = resolveDomainFromEmails(inputs.customerParticipantEmailDomains);
  if (emailDomain) pushIfValid(guessedName, emailDomain, 0.6, "email_domain", ["attendee_email_domain"]);

  const dialogueCandidates = extractDialogueAccountCandidates(inputs.transcriptDialogueText);
  for (const candidate of dialogueCandidates) {
    pushIfValid(candidate.name, null, candidate.confidence, "transcript", ["dialogue_mention"]);
  }

  // Generic organization-entity extraction (independent of opportunity-
  // claim polarity): an org named inside a negated commercial claim
  // (e.g. "saying <Org> is running a SIEM competition") still yields an
  // account candidate. Product/vendor names, apps, services, and
  // placeholders are rejected by the parser + validation.
  const orgEntities = parseOrganizationEntities(inputs.transcriptDialogueText, {
    productStoplist: inputs.productStoplist,
    participantFirstNames: inputs.participantFirstNames
  });
  for (const org of orgEntities.organization_candidates) {
    pushIfValid(org.name, null, org.confidence, "transcript", ["organization_entity"]);
  }

  const domainMentions = extractDomainMentions(inputs.transcriptDialogueText);
  for (const mention of domainMentions) {
    const base = mention.domain.split(".")[0];
    const guessed = base.charAt(0).toUpperCase() + base.slice(1);
    pushIfValid(guessed, mention.domain, 0.55, "transcript", ["domain_mention"]);
  }

  for (const aiCandidate of inputs.aiAccountCandidates) {
    pushIfValid(aiCandidate.name, aiCandidate.domain, Math.min(0.65, aiCandidate.confidence), "combined", aiCandidate.evidence_ids);
  }

  if (candidates.length === 0) {
    return { status: "unresolved", name: null, domain: null, confidence: 0, source: null, evidence_ids: [], alternatives: [], issues };
  }

  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];

  // Conflict detection: two distinct names both from otherwise-reliable,
  // independent sources (confidence >= 0.85) that disagree.
  const highConfidenceNames = new Set(sorted.filter((c) => c.confidence >= 0.85).map((c) => c.name.toLowerCase()));
  const hasConflict = highConfidenceNames.size > 1;

  // Ambiguity detection: multiple distinct names within a narrow band
  // of the top score.
  const distinctNamesNearTop = new Set(sorted.filter((c) => best.confidence - c.confidence <= 0.08).map((c) => c.name.toLowerCase()));
  const hasMultipleClose = distinctNamesNearTop.size > 1;

  const status = statusForConfidence(best.confidence, hasMultipleClose, hasConflict);
  // "unresolved" means no credible match — the underlying weak
  // candidate is still surfaced as an alternative (for the UI's
  // account-correction control) but is never presented as the
  // resolved name itself. Same for "ambiguous"/"conflicting", where by
  // definition no single candidate may be trusted as *the* answer.
  const nameIsNulled = status === "ambiguous" || status === "conflicting" || status === "unresolved";
  const alternativeSource = nameIsNulled ? sorted : sorted.filter((c) => c.name.toLowerCase() !== best.name.toLowerCase());
  const alternatives = alternativeSource
    .reduce<AccountCandidate[]>((unique, candidate) => {
      if (!unique.some((u) => u.name.toLowerCase() === candidate.name.toLowerCase())) unique.push(candidate);
      return unique;
    }, [])
    .map((c) => ({ name: c.name, domain: c.domain, confidence: c.confidence, evidence_ids: c.evidence_ids }));

  return {
    status,
    name: nameIsNulled ? null : best.name,
    domain: nameIsNulled ? null : best.domain,
    confidence: nameIsNulled ? 0 : best.confidence,
    source: nameIsNulled ? null : best.source,
    evidence_ids: nameIsNulled ? [] : best.evidence_ids,
    alternatives,
    issues
  };
}

/**
 * The full resolution flow (Section 1 + 2 combined): computes the base
 * result via `resolveAccount`, then — only for a "probable" result
 * (name present, 0.70-0.89 confidence) — runs limited SerpAPI
 * disambiguation and upgrades to "confirmed" only when a single
 * high-authority source (official site, investor relations, gov/
 * regulatory, business directory, major news) confirms the same
 * candidate. Never runs disambiguation for "confirmed"/"unresolved",
 * and for "ambiguous" only records that disambiguation was attempted
 * without resolving it — the UI still requires user selection.
 */
export async function resolveAccountWithDisambiguation(
  inputs: AccountResolutionInputs,
  context: { knownGeography?: string | null; knownProductOrService?: string | null } = {}
): Promise<AccountResolutionResult> {
  const base = resolveAccount(inputs);
  if (base.status !== "probable" && base.status !== "ambiguous") return base;

  const candidateName = base.name ?? base.alternatives[0]?.name ?? null;
  if (!candidateName) return base;

  const disambiguation = await disambiguateAccount({
    candidateName,
    candidateDomain: base.domain,
    knownGeography: context.knownGeography ?? null,
    knownProductOrService: context.knownProductOrService ?? null,
    status: base.status
  });

  if (!disambiguation.ran) {
    return disambiguation.reason ? { ...base, issues: [...base.issues, `Account disambiguation not run: ${disambiguation.reason}`] } : base;
  }

  if (base.status === "probable" && disambiguation.confirmed_domain && !disambiguation.remains_ambiguous) {
    return {
      ...base,
      status: "confirmed",
      confidence: Math.max(base.confidence, 0.9),
      domain: base.domain ?? disambiguation.confirmed_domain,
      source: "combined",
      issues: [...base.issues, `Confirmed via SerpAPI disambiguation (${disambiguation.evidence.length} high-authority source(s)).`]
    };
  }

  return { ...base, issues: [...base.issues, "SerpAPI disambiguation did not confirm a single high-authority match — user selection required."] };
}
