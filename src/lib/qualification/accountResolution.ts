import { resolveAccountWithDisambiguation } from "@/lib/account-resolution/accountResolver";
import type { AccountResolutionInputs as NewAccountResolutionInputs } from "@/lib/account-resolution/types";
import type { AccountCandidate, AccountResolution, AccountResolutionSource } from "@/lib/qualification/types";

/**
 * Thin adapter over the canonical account-identity resolver
 * (@/lib/account-resolution/accountResolver — Section 1's exact
 * 11-source priority order, generic placeholder/application-name
 * rejection) so the existing qualification pipeline's call sites and
 * result shape stay stable while all resolution logic itself lives in
 * one place. Never duplicates the resolution heuristics here.
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
  /** All transcript sentence texts — scanned by the generic
   * company-introduction + organization-entity parsers (org named in a
   * negated claim still resolves). */
  transcriptDialogueText?: string[];
  /** Product/vendor names from the taxonomy, so they are never treated
   * as an account. */
  productStoplist?: string[];
  participantFirstNames?: string[];
};

function actionRequiredFor(status: AccountResolution["status"], confidence: number, source: AccountResolutionSource): string | null {
  switch (status) {
    case "confirmed":
      return null;
    case "probable":
      return `Account identity is probable (${Math.round(confidence * 100)}% confidence, via ${(source ?? "unknown").replace(/_/g, " ")}) — confirm before CRM writeback.`;
    case "ambiguous":
      return "Multiple plausible accounts were found with similar confidence. Select or enter the correct account before CRM writeback.";
    case "conflicting":
      return "Reliable sources disagree on the account identity. Confirm the correct account before CRM writeback.";
    default:
      return "Account not identified in the available evidence. Associate this meeting with the correct account before CRM writeback.";
  }
}

export async function resolveAccountIdentity(input: AccountResolutionInput): Promise<AccountResolution> {
  const inputs: NewAccountResolutionInputs = {
    transcriptAccountField: input.transcriptAccountLine,
    userEnteredAccount: input.userEnteredAccount,
    uploadedAccountRecord: input.uploadedAccountContextName ? { name: input.uploadedAccountContextName, domain: null } : null,
    crmMatch: input.transcriptAccountMatchedInCrm && input.transcriptAccountLine ? { name: input.transcriptAccountLine, domain: null, confidence: 0.97 } : null,
    webexMeetingTitle: input.webexMeetingTitle,
    outlookEventSubject: input.outlookCalendarSubject,
    customerParticipantEmailDomains: input.attendeeEmailDomains,
    // Raw dialogue text for the generic company-introduction-pattern
    // scanner (@/lib/account-resolution/candidateExtractor) — separate
    // from `dialogueMentionedCompany`, which is already a pre-extracted
    // candidate name (e.g. from OpenAI Stage A) and is passed through
    // via openAiAccountCandidates below instead of being re-scanned.
    transcriptDialogueText: input.transcriptDialogueText ?? [],
    openAiAccountCandidates: [
      ...input.openAiAccountCandidates.map((c) => ({ name: c.name, domain: c.domain, confidence: c.confidence, evidence_ids: c.evidence_ids })),
      ...(input.dialogueMentionedCompany ? [{ name: input.dialogueMentionedCompany, domain: null, confidence: 0.55, evidence_ids: ["dialogue_mention"] }] : [])
    ],
    productStoplist: input.productStoplist,
    participantFirstNames: input.participantFirstNames
  };

  // The transcript account line is already checked against the CRM
  // separately above; avoid resolving it twice through both the
  // "transcript" and "crm" source paths when it matched.
  if (input.transcriptAccountMatchedInCrm) inputs.transcriptAccountField = null;

  const resolved = await resolveAccountWithDisambiguation(inputs);

  return {
    name: resolved.name,
    domain: resolved.domain,
    status: resolved.status,
    confidence: resolved.confidence,
    source: resolved.source,
    alternatives: resolved.alternatives,
    action_required: actionRequiredFor(resolved.status, resolved.confidence, resolved.source)
  };
}
