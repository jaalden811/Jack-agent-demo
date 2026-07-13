/**
 * Incremental scope test sets for the Setup → Webex diagnostic flow.
 * Each set is cumulative — running them in order isolates which single
 * additional scope Webex's `/authorize` endpoint rejects, since Webex
 * validates the requested `scope` list before ever showing a consent
 * screen (an invalid scope in the set fails the whole request).
 */

export type ScopeDiagnosticTest = {
  id: "identity" | "messaging" | "meetings" | "transcripts";
  label: string;
  buttonLabel: string;
  scopes: string[];
};

export const SCOPE_DIAGNOSTIC_TESTS: ScopeDiagnosticTest[] = [
  {
    id: "identity",
    label: "1. Identity only",
    buttonLabel: "Test identity",
    scopes: ["spark:people_read"]
  },
  {
    id: "messaging",
    label: "2. Identity + messaging",
    buttonLabel: "Test messaging",
    scopes: ["spark:people_read", "spark:messages_write"]
  },
  {
    id: "meetings",
    label: "3. Identity + messaging + meetings",
    buttonLabel: "Test meetings",
    scopes: ["spark:people_read", "spark:messages_write", "meeting:schedules_read"]
  },
  {
    id: "transcripts",
    label: "4. Identity + messaging + meetings + transcripts",
    buttonLabel: "Test transcripts",
    scopes: ["spark:people_read", "spark:messages_write", "meeting:schedules_read", "meeting:transcripts_read"]
  }
];

/** The minimal-scope diagnostic (Setup → Webex → "Test basic Webex
 * connection") is exactly the first incremental test — proving Client
 * ID, redirect URI, state handling, and the OAuth callback work
 * independently of any meeting/message scope. */
export const MINIMAL_SCOPE_TEST: ScopeDiagnosticTest = SCOPE_DIAGNOSTIC_TESTS[0];

export function findScopeDiagnosticTest(testId: string): ScopeDiagnosticTest | null {
  return SCOPE_DIAGNOSTIC_TESTS.find((test) => test.id === testId) ?? null;
}
