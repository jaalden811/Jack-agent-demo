/**
 * Account-recognition types (Section 1). Fully generic — no field here
 * ever encodes a specific company, product, or transcript. Confidence
 * bands: confirmed >= 0.90; probable >= 0.70 and < 0.90; ambiguous =
 * multiple similarly-scored candidates; unresolved = no credible
 * match; conflicting = reliable sources disagree.
 */

export type AccountResolutionStatus = "confirmed" | "probable" | "ambiguous" | "unresolved" | "conflicting";

export type AccountEvidenceSource =
  | "user_input"
  | "transcript"
  | "webex"
  | "outlook"
  | "crm"
  | "email_domain"
  | "serpapi"
  | "combined"
  | null;

export type AccountCandidate = {
  name: string;
  domain: string | null;
  confidence: number;
  evidence_ids: string[];
  source: AccountEvidenceSource;
};

export type AccountResolutionResult = {
  status: AccountResolutionStatus;
  name: string | null;
  domain: string | null;
  confidence: number;
  source: AccountEvidenceSource;
  evidence_ids: string[];
  alternatives: Array<{ name: string; domain: string | null; confidence: number; evidence_ids: string[] }>;
  issues: string[];
};

/** Raw inputs the resolver draws from, in the exact Section 1 priority
 * order. Every field is optional — most runs will only populate a
 * handful of these. */
export type AccountResolutionInputs = {
  transcriptAccountField: string | null;
  userEnteredAccount: string | null;
  uploadedAccountRecord: { name: string | null; domain: string | null } | null;
  crmMatch: { name: string; domain: string | null; confidence: number } | null;
  webexMeetingTitle: string | null;
  outlookEventSubject: string | null;
  customerParticipantEmailDomains: string[];
  transcriptDialogueText: string[];
  openAiAccountCandidates: Array<{ name: string; domain: string | null; confidence: number; evidence_ids: string[] }>;
  /** Product/vendor names (from the loaded taxonomy / source catalog)
   * that must never be treated as an account — passed in so the
   * organization-entity parser stays data-driven, not hard-coded. */
  productStoplist?: string[];
  /** Participant first names, so a single-token name that is a known
   * person is not mistaken for an organization. */
  participantFirstNames?: string[];
};

export type AccountOverride = {
  name: string;
  domain: string | null;
  set_by_user: true;
  set_at: string;
};
