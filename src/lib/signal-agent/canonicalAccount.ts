import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * The single canonical account accessor (Phase 3). Every downstream
 * user-facing surface — executive summary, sales/technical messages,
 * emails, delivery records, result header — must resolve the account
 * name through THIS function, never by independently reading one field.
 *
 * Invariant: when account_resolution.status is confirmed/probable and a
 * name exists, no user-facing field may say "Unknown"/"Not resolved"/
 * "Not identified". Ambiguous/conflicting/unresolved states have no
 * trusted single name and fall through to the resolution-required label.
 */

export type CanonicalAccount = {
  /** The trusted account name, or null when none can be trusted yet. */
  name: string | null;
  /** A UI/message-safe label — the name when trusted, otherwise a
   * resolution-required message (never "Unknown account"). */
  label: string;
  /** A clean IN-SENTENCE form — the name when trusted, otherwise "this account"
   * (never the resolution-required banner spliced into prose like
   * "…opportunity at Account not resolved — confirm before writeback"). */
  prose: string;
  status: string;
  confidence: number;
};

const RESOLUTION_REQUIRED_LABEL = "Account not resolved — confirm before writeback";

export function getCanonicalAccount(result: Pick<SecureNetworkingTriageResult, "account_resolution" | "executive_summary">): CanonicalAccount {
  const resolution = result.account_resolution;
  if (resolution && (resolution.status === "confirmed" || resolution.status === "probable") && resolution.name) {
    return { name: resolution.name, label: resolution.name, prose: resolution.name, status: resolution.status, confidence: resolution.confidence };
  }
  // Fall back to the raw executive-summary/transcript account label only
  // when the resolver itself did not produce a trusted name.
  const execAccount = result.executive_summary.account;
  if (execAccount && execAccount.trim().length > 0) {
    return { name: execAccount, label: execAccount, prose: execAccount, status: resolution?.status ?? "unresolved", confidence: resolution?.confidence ?? 0 };
  }
  return { name: null, label: RESOLUTION_REQUIRED_LABEL, prose: "this account", status: resolution?.status ?? "unresolved", confidence: resolution?.confidence ?? 0 };
}
