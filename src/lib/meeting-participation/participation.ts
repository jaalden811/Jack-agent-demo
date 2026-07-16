import { matchRosterMember, type Roster, loadRoster } from "@/lib/team-routing/roster";

/**
 * Meeting participation matrix (Phase 5). Evidence precedence, strongest first:
 *   manual correction > Webex attendance metadata > transcript speaker > invitation/listing.
 *
 * Rules (never violated):
 *  - a transcript proves who SPOKE, not the full attendee list;
 *  - an invitation/listing does not prove attendance;
 *  - absence from the transcript does not prove absence from the meeting;
 *  - a manual correction outranks all other evidence;
 *  - Webex metadata outranks transcript inference;
 *  - with no usable evidence, attendance stays UNKNOWN.
 *
 * Circuit may interpret roles but may NEVER invent attendance.
 */

export type AttendanceState =
  /** Transcript shows this person spoke (proves speaking; strong presence signal). */
  | "SPOKE"
  /** Webex/manual confirms present AND they spoke. */
  | "CONFIRMED_PRESENT"
  /** Webex/manual confirms present but they did not speak. */
  | "CONFIRMED_PRESENT_SILENT"
  /** On the invitation/participant list; attendance not confirmed. */
  | "INVITED_NOT_CONFIRMED"
  /** Webex/manual confirms absent. */
  | "CONFIRMED_ABSENT"
  /** No usable evidence either way. */
  | "UNKNOWN";

export type InternalExternal = "internal" | "customer" | "partner" | "unknown";

export type ParticipationEntry = {
  person_id: string | null;
  display_name: string;
  email: string | null;
  organization: string | null;
  internal_external: InternalExternal;
  roster_match: "confirmed" | "probable" | "ambiguous" | "none";
  spoke: boolean;
  attendance_status: AttendanceState;
  /** Ranked evidence sources that produced attendance_status (strongest first). */
  sources: string[];
  confidence: number;
  evidence_ids: string[];
};

export type ParticipationMatrix = {
  meeting_id: string | null;
  participants: ParticipationEntry[];
  attendance_data_complete: boolean;
  issues: string[];
};

export type TranscriptParticipant = { name: string; title?: string | null; classification: string; turnCount: number };
export type AttendanceCorrection = { name?: string | null; email?: string | null; attendance_status: AttendanceState };
export type WebexAttendee = { name?: string | null; email?: string | null; attended: boolean };

const SIDE_MAP: Record<string, InternalExternal> = { customer: "customer", vendor: "internal", internal: "internal", partner: "partner", unknown: "unknown" };

type Resolution = { state: AttendanceState; source: string; confidence: number };

/**
 * Resolves a single person's attendance state by the fixed precedence order.
 * `listed` means the person appears on the transcript participant/invitation
 * list (an invitation-level signal that never, by itself, proves attendance).
 */
function resolveAttendance(params: { spoke: boolean; listed: boolean; webex?: WebexAttendee; correction?: AttendanceCorrection }): Resolution {
  if (params.correction) return { state: params.correction.attendance_status, source: "manual_correction", confidence: 1 };
  if (params.webex) {
    if (params.webex.attended) return { state: params.spoke ? "CONFIRMED_PRESENT" : "CONFIRMED_PRESENT_SILENT", source: "webex_attendance", confidence: 0.9 };
    return { state: "CONFIRMED_ABSENT", source: "webex_attendance", confidence: 0.9 };
  }
  if (params.spoke) return { state: "SPOKE", source: "transcript_speaker", confidence: 0.8 };
  if (params.listed) return { state: "INVITED_NOT_CONFIRMED", source: "invitation_listing", confidence: 0.4 };
  return { state: "UNKNOWN", source: "no_evidence", confidence: 0.3 };
}

export function buildParticipationMatrix(
  params: {
    meeting_id?: string | null;
    transcript_participants: TranscriptParticipant[];
    webex_attendees?: WebexAttendee[];
    corrections?: AttendanceCorrection[];
    invited_names?: string[];
  },
  roster: Roster = loadRoster()
): ParticipationMatrix {
  const issues: string[] = [];
  const corrections = params.corrections ?? [];
  const webex = params.webex_attendees ?? [];
  const entries: ParticipationEntry[] = [];

  const correctionFor = (name: string, email: string | null): AttendanceCorrection | undefined =>
    corrections.find((c) => (c.email && email && c.email.toLowerCase() === email.toLowerCase()) || (c.name && c.name.toLowerCase() === name.toLowerCase()));
  const webexFor = (name: string, email: string | null): WebexAttendee | undefined =>
    webex.find((w) => (w.email && email && w.email.toLowerCase() === email.toLowerCase()) || (w.name && w.name.toLowerCase() === name.toLowerCase()));

  for (const p of params.transcript_participants) {
    const spoke = p.turnCount > 0;
    const rosterMember = matchRosterMember({ name: p.name }, roster);
    const email = rosterMember?.webex_email ?? rosterMember?.emails[0] ?? null;

    // Every transcript participant is at least "listed" (appeared on the
    // meeting's participant list) — an invitation-level signal.
    const { state, source, confidence } = resolveAttendance({ spoke, listed: true, webex: webexFor(p.name, email), correction: correctionFor(p.name, email) });

    entries.push({
      person_id: rosterMember?.person_id ?? null,
      display_name: p.name,
      email,
      organization: rosterMember ? "internal" : null,
      internal_external: SIDE_MAP[p.classification] ?? "unknown",
      roster_match: rosterMember ? "confirmed" : "none",
      spoke,
      attendance_status: state,
      sources: [source],
      confidence,
      evidence_ids: []
    });
  }

  // Invited-but-not-in-transcript names (invitation/roster only — never proves attendance).
  for (const invited of params.invited_names ?? []) {
    if (entries.some((e) => e.display_name.toLowerCase() === invited.toLowerCase())) continue;
    const rosterMember = matchRosterMember({ name: invited }, roster);
    const email = rosterMember?.webex_email ?? rosterMember?.emails[0] ?? null;
    const { state, source, confidence } = resolveAttendance({ spoke: false, listed: true, webex: webexFor(invited, email), correction: correctionFor(invited, email) });
    entries.push({
      person_id: rosterMember?.person_id ?? null,
      display_name: invited,
      email,
      organization: rosterMember ? "internal" : null,
      internal_external: rosterMember ? "internal" : "unknown",
      roster_match: rosterMember ? "confirmed" : "none",
      spoke: false,
      attendance_status: state,
      sources: [source],
      confidence,
      evidence_ids: []
    });
  }

  const attendanceComplete = webex.length > 0 || corrections.length > 0;
  if (!attendanceComplete) issues.push("attendance metadata unavailable — transcript proves speakers only; silent/absent attendees stay INVITED_NOT_CONFIRMED / UNKNOWN");

  return { meeting_id: params.meeting_id ?? null, participants: entries, attendance_data_complete: attendanceComplete, issues };
}
