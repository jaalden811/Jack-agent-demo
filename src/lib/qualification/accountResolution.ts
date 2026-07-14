import { isGenericAccountName } from "@/lib/connectors/serpapi/queryPlanner";
import { buildDefaultAccountResolution } from "@/lib/qualification/defaults";
import type { AccountCandidate, AccountResolution, AccountResolutionSource } from "@/lib/qualification/types";

/**
 * Resolves account identity in the priority order from Section 2/7:
 * (1) explicit transcript Account: line, (2) user-entered/CRM-override
 * account, (3) Webex meeting title, (4) Outlook calendar subject,
 * (5) attendee email domains, (6) uploaded account context,
 * (7) a company name mentioned in dialogue, (8) an OpenAI-extracted
 * probable candidate. Never claims "resolved" for a generic/demo name.
 */

export type AccountResolutionInput = {
  transcriptAccountLine: string | null;
  transcriptAccountMatchedInCrm: boolean;
  userEnteredAccount: string | null;
  webexMeetingTitle: string | null;
  outlookCalendarSubject: string | null;
  attendeeEmailDomains: string[];
  uploadedAccountContextName: string | null;
  dialogueMentionedCompany: string | null;
  openAiAccountCandidates: AccountCandidate[];
};

function tryCandidate(name: string | null, source: AccountResolutionSource, confidence: number, domain: string | null = null): AccountResolution | null {
  if (!name || isGenericAccountName(name)) return null;
  const status = confidence >= 0.85 ? "resolved" : confidence >= 0.65 ? "probable" : "unresolved";
  return {
    name,
    domain,
    status,
    confidence,
    source,
    alternatives: [],
    action_required:
      status === "resolved"
        ? null
        : status === "probable"
          ? `Account identity is probable (${Math.round(confidence * 100)}% confidence, via ${source.replace(/_/g, " ")}) — confirm before CRM writeback.`
          : `Account not identified in the available evidence. Associate this meeting with the correct account before CRM writeback.`
  };
}

export function resolveAccountIdentity(input: AccountResolutionInput): AccountResolution {
  const attempts: Array<AccountResolution | null> = [
    tryCandidate(input.transcriptAccountLine, "transcript_account_line", input.transcriptAccountMatchedInCrm ? 0.97 : 0.8),
    tryCandidate(input.userEnteredAccount, "user_entered", 0.95),
    tryCandidate(extractCompanyFromTitle(input.webexMeetingTitle), "webex_meeting_title", 0.7),
    tryCandidate(extractCompanyFromTitle(input.outlookCalendarSubject), "outlook_calendar_subject", 0.68),
    tryCandidate(domainToCompanyGuess(input.attendeeEmailDomains), "attendee_email_domain", 0.62, input.attendeeEmailDomains[0] ?? null),
    tryCandidate(input.uploadedAccountContextName, "account_context", 0.75),
    tryCandidate(input.dialogueMentionedCompany, "dialogue_mention", 0.55)
  ];

  const best = attempts.filter((a): a is AccountResolution => a !== null).sort((a, b) => b.confidence - a.confidence)[0];
  if (best) {
    const alternatives = input.openAiAccountCandidates.filter((c) => c.name.toLowerCase() !== best.name?.toLowerCase());
    return { ...best, alternatives };
  }

  const openAiCandidate = input.openAiAccountCandidates.find((c) => !isGenericAccountName(c.name));
  if (openAiCandidate) {
    const resolved = tryCandidate(openAiCandidate.name, "openai_candidate", Math.min(0.6, openAiCandidate.confidence), openAiCandidate.domain);
    if (resolved) return { ...resolved, alternatives: input.openAiAccountCandidates.filter((c) => c.name !== openAiCandidate.name) };
  }

  return { ...buildDefaultAccountResolution(), alternatives: input.openAiAccountCandidates };
}

function extractCompanyFromTitle(title: string | null): string | null {
  if (!title) return null;
  // Heuristic only: "Acme Corp <> Cisco" / "Cisco - Acme Corp Discovery" /
  // "Acme Corp Discovery Call" — strip common connective/meeting words,
  // never fabricates a name that isn't literally present in the title.
  const cleaned = title
    .replace(/\bcisco\b/gi, "")
    .replace(/\bsplunk\b/gi, "")
    .replace(/\b(discovery|call|meeting|sync|check-?in|kickoff|review|demo|intro)\b/gi, "")
    .replace(/[<>|/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : null;
}

function domainToCompanyGuess(domains: string[]): string | null {
  const external = domains.find((d) => !["gmail.com", "outlook.com", "cisco.com", "splunk.com", "yahoo.com", "hotmail.com"].includes(d.toLowerCase()));
  if (!external) return null;
  const base = external.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}
