import { normalizeScopes } from "@/lib/webex/scopes";

/**
 * Splits Webex OAuth scopes into a required "core" set (identity +
 * outbound messaging + meeting schedule access) and one optional
 * capability (meeting transcript read). Core scopes must always be
 * sufficient for a fully usable Webex connection on their own — the
 * transcript scope is a separately-enabled capability, requested only
 * when the user explicitly asks for it, so an Integration that hasn't
 * had `meeting:transcripts_read` enabled/saved yet can still connect.
 */

export const TRANSCRIPT_SCOPE = "meeting:transcripts_read";

export const DEFAULT_CORE_SCOPES = ["spark:people_read", "spark:messages_write", "meeting:schedules_read"];

/** The configured WEBEX_SCOPES value, minus the transcript scope —
 * used for the "Connect Webex" flow. Falls back to the documented
 * default core set if the configured value normalizes to nothing. */
export function getCoreScopes(configuredRaw: string): string[] {
  const configured = normalizeScopes(configuredRaw).filter((scope) => scope !== TRANSCRIPT_SCOPE);
  return configured.length > 0 ? configured : DEFAULT_CORE_SCOPES;
}

/** Core scopes plus the transcript scope — used only by the "Enable
 * transcript access" flow, never by the default "Connect Webex" flow. */
export function getTranscriptEnabledScopes(configuredRaw: string): string[] {
  return Array.from(new Set([...getCoreScopes(configuredRaw), TRANSCRIPT_SCOPE]));
}
