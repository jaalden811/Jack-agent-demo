import { matchRosterMember, type Roster, loadRoster } from "@/lib/team-routing/roster";

/**
 * Meeting participation matrix (Phase 5). A transcript proves who SPOKE;
 * it does not prove the full attendee list, and absence from the
 * transcript does not prove absence from the meeting. Confirmed attendance
 * comes only from stronger sources (manual correction > Webex attendance
 * metadata > transcript speaker > invitation roster). Circuit may
 * interpret roles but may not invent attendance.
 */

export type AttendanceStatus = "confirmed_present" | "confirmed_absent" | "invited_not_confirmed" | "unknown";
export type PresenceDetail = "speaker" | "silent_attendee" | "invited_only" | "manually_confirmed" | "unknown";
export type InternalExternal = "internal" | "customer" | "partner" | "unknown";

export type ParticipationEntry = {
  person_id: string | null;
  display_name: string;
  email: string | null;
  organization: string | null;
  internal_external: InternalExternal;
  roster_match: "confirmed" | "probable" | "ambiguous" | "none";
  spoke: boolean;
  attendance_status: AttendanceStatus;
  presence_detail: PresenceDetail;
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
export type AttendanceCorrection = { name?: string | null; email?: string | null; attendance_status: AttendanceStatus };
export type WebexAttendee = { name?: string | null; email?: string | null; attended: boolean };

const SIDE_MAP: Record<string, InternalExternal> = { customer: "customer", vendor: "internal", internal: "internal", partner: "partner", unknown: "unknown" };

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

    let attendance: AttendanceStatus;
    let detail: PresenceDetail;
    const sources: string[] = [];

    const correction = correctionFor(p.name, email);
    const webexRecord = webexFor(p.name, email);
    if (correction) {
      attendance = correction.attendance_status;
      detail = "manually_confirmed";
      sources.push("manual_correction");
    } else if (webexRecord) {
      attendance = webexRecord.attended ? "confirmed_present" : "confirmed_absent";
      detail = webexRecord.attended ? (spoke ? "speaker" : "silent_attendee") : "unknown";
      sources.push("webex_attendance");
    } else if (spoke) {
      attendance = "confirmed_present";
      detail = "speaker";
      sources.push("transcript_speaker");
    } else {
      // Named but never spoke, no metadata: presence is genuinely unknown.
      attendance = "unknown";
      detail = "unknown";
      sources.push("transcript_participant");
    }

    entries.push({
      person_id: rosterMember?.person_id ?? null,
      display_name: p.name,
      email,
      organization: rosterMember ? "internal" : null,
      internal_external: SIDE_MAP[p.classification] ?? "unknown",
      roster_match: rosterMember ? "confirmed" : "none",
      spoke,
      attendance_status: attendance,
      presence_detail: detail,
      sources,
      confidence: correction ? 1 : webexRecord ? 0.9 : spoke ? 0.8 : 0.3,
      evidence_ids: []
    });
  }

  // Invited-but-not-in-transcript names (roster/invitation only).
  for (const invited of params.invited_names ?? []) {
    if (entries.some((e) => e.display_name.toLowerCase() === invited.toLowerCase())) continue;
    const rosterMember = matchRosterMember({ name: invited }, roster);
    const correction = correctionFor(invited, rosterMember?.emails[0] ?? null);
    entries.push({
      person_id: rosterMember?.person_id ?? null,
      display_name: invited,
      email: rosterMember?.webex_email ?? rosterMember?.emails[0] ?? null,
      organization: rosterMember ? "internal" : null,
      internal_external: rosterMember ? "internal" : "unknown",
      roster_match: rosterMember ? "confirmed" : "none",
      spoke: false,
      attendance_status: correction?.attendance_status ?? "invited_not_confirmed",
      presence_detail: correction ? "manually_confirmed" : "invited_only",
      sources: correction ? ["manual_correction"] : ["invitation_roster"],
      confidence: correction ? 1 : 0.4,
      evidence_ids: []
    });
  }

  const attendanceComplete = webex.length > 0 || corrections.length > 0;
  if (!attendanceComplete) issues.push("attendance metadata unavailable — transcript proves speakers only; silent/absent attendees are unknown");

  return { meeting_id: params.meeting_id ?? null, participants: entries, attendance_data_complete: attendanceComplete, issues };
}
