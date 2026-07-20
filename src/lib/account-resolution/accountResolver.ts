import { validateAccountCandidateName } from "@/lib/account-resolution/accountValidation";
import { extractDialogueAccountCandidates, extractDomainMentions, extractSubEntityNames } from "@/lib/account-resolution/candidateExtractor";
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

  // Participant-descriptor organization: when several speakers carry the SAME
  // "Name — <Org> <role>" org, that org is the customer account ("us"). A clear
  // majority is a strong, honest identity signal; a lone participant org is a
  // weaker hint. Never invents — the org came from a real proper-noun
  // descriptor, and product/vendor names are rejected by validation/stoplist.
  const orgCounts = new Map<string, { display: string; count: number }>();
  for (const org of inputs.participantOrganizations ?? []) {
    const key = org.trim().toLowerCase();
    if (!key) continue;
    const existing = orgCounts.get(key);
    if (existing) existing.count += 1;
    else orgCounts.set(key, { display: org.trim(), count: 1 });
  }
  const stoplistLower = new Set((inputs.productStoplist ?? []).map((p) => p.toLowerCase()));
  const isStoplisted = (name: string) => {
    const l = name.toLowerCase();
    return Array.from(stoplistLower).some((p) => p.length > 2 && (l === p || l.includes(p) || p.includes(l)));
  };
  const rankedOrgs = Array.from(orgCounts.values()).filter((o) => !isStoplisted(o.display)).sort((a, b) => b.count - a.count);
  const topOrg = rankedOrgs[0];
  if (topOrg) {
    const total = inputs.participantOrganizations?.length ?? 0;
    // Shared by a clear majority (>=2 and >=60% of org-bearing participants) →
    // confident; shared by >=2 → probable. A SINGLE customer-side participant
    // naming their own employer in their descriptor ("Sarah (VP, Apex
    // Manufacturing)") is still a direct, first-party identity statement — a
    // reasonable "probable" (vendor orgs are already excluded upstream), not a
    // weak hint that stays unresolved.
    const confidence = topOrg.count >= 2 && total > 0 && topOrg.count / total >= 0.6 ? 0.9 : topOrg.count >= 2 ? 0.82 : 0.72;
    pushIfValid(topOrg.display, null, confidence, "transcript", ["participant_organization"]);
  }

  for (const aiCandidate of inputs.aiAccountCandidates) {
    pushIfValid(aiCandidate.name, aiCandidate.domain, Math.min(0.65, aiCandidate.confidence), "combined", aiCandidate.evidence_ids);
  }

  if (candidates.length === 0) {
    return { status: "unresolved", name: null, domain: null, confidence: 0, source: null, evidence_ids: [], alternatives: [], issues };
  }

  function mergeAliasVariants(cands: AccountCandidate[]): AccountCandidate[] {
    const byLongest = [...cands].sort((a, b) => b.name.length - a.name.length);
    const merged: AccountCandidate[] = [];
    for (const c of byLongest) {
      const cn = c.name.toLowerCase().trim();
      const host = merged.find((m) => {
        const mn = m.name.toLowerCase().trim();
        return mn === cn || mn.startsWith(`${cn} `) || cn.startsWith(`${mn} `) || mn.includes(` ${cn} `) || mn.endsWith(` ${cn}`);
      });
      if (host) {
        host.confidence = Math.max(host.confidence, c.confidence);
        host.domain = host.domain ?? c.domain;
        host.evidence_ids = Array.from(new Set([...host.evidence_ids, ...c.evidence_ids]));
      } else {
        merged.push({ ...c });
      }
    }
    return merged;
  }

  // Sub-entity demotion: a candidate the transcript names as an acquired estate,
  // division, subsidiary, or business unit is NOT the canonical account (the
  // account is the parent that owns it). Such a name is often mentioned MORE
  // than the parent (e.g. "the twelve <Acquired> acquisition sites"), so without
  // this it would win on dialogue frequency. Demote it below any non-sub-entity
  // candidate while keeping it as a fallback if nothing else resolves.
  const subEntities = extractSubEntityNames(inputs.transcriptDialogueText);
  if (subEntities.size > 0) {
    for (const candidate of candidates) {
      if (subEntities.has(candidate.name.trim().toLowerCase())) {
        candidate.confidence = Math.min(candidate.confidence, 0.35);
        candidate.evidence_ids = Array.from(new Set([...candidate.evidence_ids, "sub_entity_demoted"]));
      }
    }
  }

  // Merge alias variants: a shorter name that is a leading word-subset of a
  // longer one ("Acme" vs "Acme Mutual Bank") is the SAME account, not
  // a conflict — prefer the longest explicit declaration and keep the max
  // confidence. Processing longest-first makes the fuller name the canonical one.
  const mergedCandidates = mergeAliasVariants(candidates);

  const sorted = [...mergedCandidates].sort((a, b) => b.confidence - a.confidence);
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

  // Name confirmation (existence via non-conflicting high-authority sources)
  // upgrades status — INDEPENDENT of whether a first-party domain was found.
  // The canonical domain is only ever a verified first-party domain (a
  // third-party directory/news domain like zoominfo.com is never adopted).
  if (base.status === "probable" && !disambiguation.remains_ambiguous && disambiguation.evidence.length > 0) {
    return {
      ...base,
      status: "confirmed",
      confidence: Math.max(base.confidence, 0.9),
      domain: base.domain ?? disambiguation.confirmed_domain,
      source: "combined",
      issues: [
        ...base.issues,
        `Confirmed via SerpAPI disambiguation (${disambiguation.evidence.length} high-authority source(s)).`,
        ...(disambiguation.confirmed_domain ? [] : ["Canonical domain not set: no first-party company domain was verified (third-party listings do not count)."])
      ]
    };
  }

  return { ...base, issues: [...base.issues, "SerpAPI disambiguation did not confirm a single high-authority match — user selection required."] };
}
