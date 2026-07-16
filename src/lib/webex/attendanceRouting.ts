import { buildParticipationMatrix, type ParticipationMatrix, type TranscriptParticipant } from "@/lib/meeting-participation/participation";
import { matchRosterMember, loadRoster } from "@/lib/team-routing/roster";
import { attendanceModeFor, type MessageMode } from "@/lib/team-routing/routing";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { ChannelDeliveryResult, EmailMessagePreview, LaneRoutingDecision, WebexLane, WebexMessagePreview } from "@/lib/webex/types";

/**
 * Attendance-aware routing for message delivery (Phase 7b). Uses the meeting
 * participation matrix (@/lib/meeting-participation) and the team roster
 * (@/lib/team-routing) to derive, per routed lane recipient, an attendance
 * status and message MODE — then frames each delivered message accordingly and
 * orders the sends. This is ADDITIVE and non-authoritative for recipient
 * SELECTION: the pilot's lane recipients still come from the Peachtree routing
 * config; attendance only changes HOW each recipient is addressed (a delta for
 * someone who was in the meeting vs a full handoff for someone who was not) and
 * the send order. A transcript proves speakers only — absence is never inferred.
 */

export type LaneAttendance = {
  lane: WebexLane;
  attendance_status: string;
  spoke: boolean;
  message_mode: MessageMode;
};

const MODE_HEADER: Record<MessageMode, string> = {
  ATTENDEE_ACTION_DELTA: "_You were in this meeting — action delta and next step below._",
  ABSENT_FULL_HANDOFF: "_You were not in this meeting — full handoff below._",
  UNKNOWN_CONTEXTUAL_HANDOFF: "_Meeting attendance unconfirmed — full context handoff below._",
  LEADER_SUMMARY: "_Leadership summary below._"
};

const MODE_HEADER_HTML: Record<MessageMode, string> = {
  ATTENDEE_ACTION_DELTA: "<p><em>You were in this meeting — action delta and next step below.</em></p>",
  ABSENT_FULL_HANDOFF: "<p><em>You were not in this meeting — full handoff below.</em></p>",
  UNKNOWN_CONTEXTUAL_HANDOFF: "<p><em>Meeting attendance unconfirmed — full context handoff below.</em></p>",
  LEADER_SUMMARY: "<p><em>Leadership summary below.</em></p>"
};

// Present attendees (need a quick action delta) are notified before absent /
// unconfirmed recipients (who receive a full handoff); leadership summaries last.
const MODE_PRIORITY: Record<MessageMode, number> = {
  ATTENDEE_ACTION_DELTA: 0,
  ABSENT_FULL_HANDOFF: 1,
  UNKNOWN_CONTEXTUAL_HANDOFF: 2,
  LEADER_SUMMARY: 3
};

export function attendanceModeHeader(mode: MessageMode): string {
  return MODE_HEADER[mode];
}

export function attendanceSendPriority(mode: MessageMode): number {
  return MODE_PRIORITY[mode] ?? MODE_PRIORITY.UNKNOWN_CONTEXTUAL_HANDOFF;
}

/** Builds the meeting participation matrix from the run result. Only the
 * transcript-derived speakers are known here (no Webex attendee metadata flows
 * into delivery yet), so silent/absent attendees remain "unknown". */
export function buildMeetingParticipation(result: SecureNetworkingTriageResult): ParticipationMatrix {
  const transcript_participants: TranscriptParticipant[] = (result.stakeholder_analysis?.participants ?? []).map((p) => ({
    name: p.name,
    title: p.title,
    classification: p.classification,
    turnCount: p.turnCount
  }));
  return buildParticipationMatrix({ meeting_id: result.run_id ?? null, transcript_participants });
}

/** Resolves the attendance status + message mode for each routed lane
 * recipient. Recipients are matched to the roster (by email, then name); a
 * recipient who was not a meeting participant is "unknown" → a full contextual
 * handoff. Never asserts presence that the evidence does not support. */
export function laneAttendanceFor(routing: LaneRoutingDecision[], matrix: ParticipationMatrix): Map<WebexLane, LaneAttendance> {
  const roster = loadRoster();
  const byLane = new Map<WebexLane, LaneAttendance>();
  for (const decision of routing) {
    const member = matchRosterMember({ name: decision.recipient_name, email: decision.recipient_email }, roster);
    const entry = matrix.participants.find((p) =>
      (member && p.person_id === member.person_id) ||
      p.display_name.toLowerCase() === decision.recipient_name.toLowerCase() ||
      (member && p.display_name.toLowerCase() === member.name.toLowerCase())
    );
    const attendance_status = entry?.attendance_status ?? "unknown";
    const spoke = entry?.spoke ?? false;
    const rosterLane = member?.lane ?? decision.lane;
    byLane.set(decision.lane, { lane: decision.lane, attendance_status, spoke, message_mode: attendanceModeFor(attendance_status, rosterLane) });
  }
  return byLane;
}

/** Applies attendance framing (a mode header) + attaches attendance_status /
 * message_mode to each message + email. Additive: the underlying brief content
 * is unchanged; only a one-line mode header is prepended. */
export function applyAttendanceFraming(
  messages: WebexMessagePreview[],
  emails: EmailMessagePreview[],
  byLane: Map<WebexLane, LaneAttendance>
): { messages: WebexMessagePreview[]; emails: EmailMessagePreview[] } {
  const framedMessages = messages.map((m) => {
    const att = byLane.get(m.lane);
    if (!att) return m;
    const markdown = `${MODE_HEADER[att.message_mode]}\n\n${m.markdown}`;
    return { ...m, markdown, character_count: markdown.length, attendance_status: att.attendance_status, message_mode: att.message_mode };
  });
  const framedEmails = emails.map((e) => {
    const att = byLane.get(e.lane);
    if (!att) return e;
    return {
      ...e,
      html: `${MODE_HEADER_HTML[att.message_mode]}${e.html}`,
      text: `${MODE_HEADER[att.message_mode].replace(/^_|_$/g, "")}\n\n${e.text}`,
      attendance_status: att.attendance_status,
      message_mode: att.message_mode
    };
  });
  return { messages: framedMessages, emails: framedEmails };
}

/** Orders lanes for auto-send by attendance mode priority (present-attendee
 * action deltas first, then full/contextual handoffs, leadership last). Stable
 * for equal priority. */
export function orderLanesByAttendance<T extends { lane: WebexLane }>(items: T[], byLane: Map<WebexLane, LaneAttendance>): T[] {
  return [...items].sort((a, b) => {
    const pa = byLane.get(a.lane) ? attendanceSendPriority(byLane.get(a.lane)!.message_mode) : 99;
    const pb = byLane.get(b.lane) ? attendanceSendPriority(byLane.get(b.lane)!.message_mode) : 99;
    return pa - pb;
  });
}

/** Annotates delivery results with the recipient's attendance status + message
 * mode (additive; never changes delivery outcome). */
export function annotateDeliveryAttendance(items: ChannelDeliveryResult[], byLane: Map<WebexLane, LaneAttendance>): ChannelDeliveryResult[] {
  return items.map((item) => {
    const att = byLane.get(item.lane);
    return att ? { ...item, attendance_status: att.attendance_status, message_mode: att.message_mode } : item;
  });
}
