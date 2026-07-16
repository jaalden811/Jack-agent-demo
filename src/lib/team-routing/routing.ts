import { activeMembers, type RosterLane, type RosterMember, type Roster, loadRoster } from "@/lib/team-routing/roster";
import type { ParticipationMatrix } from "@/lib/meeting-participation/participation";

/**
 * Deterministic, attendance-aware routing (Phase 6). Circuit recommends
 * required ROLE FAMILIES; this module selects real, active roster people.
 * Attendance affects the message MODE, not whether expertise is required.
 * Never routes to inactive members, customer participants, or anyone
 * outside the roster; when no qualified person exists it returns an
 * unfilled role + fallback queue / human review — never an arbitrary
 * person.
 */

export type RequiredRole = { required_role: string; lane: RosterLane; product_domains?: string[]; specialties?: string[]; account?: string | null };
export type MessageMode = "ATTENDEE_ACTION_DELTA" | "ABSENT_FULL_HANDOFF" | "UNKNOWN_CONTEXTUAL_HANDOFF" | "LEADER_SUMMARY";

export type RoutingDecision = {
  recipient_person_id: string;
  recipient_name: string;
  recipient_role: string;
  lane: string;
  required_role: string;
  selection_status: "selected" | "alternate" | "unresolved";
  selection_confidence: number;
  selection_reasons: string[];
  attendance_status: string;
  spoke: boolean;
  message_mode: MessageMode;
  channel_plan: string[];
  fallback_recipient: string | null;
  evidence_ids: string[];
};

export type RoutingResult = {
  routing_decisions: RoutingDecision[];
  unfilled_roles: Array<{ required_role: string; lane: string; reason: string; fallback_queue: string | null }>;
  human_review_required: boolean;
};

function scoreCandidate(member: RosterMember, role: RequiredRole): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (member.lane === role.lane) {
    score += 3;
    reasons.push(`lane match (${role.lane})`);
  }
  if (role.account && member.accounts.map((a) => a.toLowerCase()).includes(role.account.toLowerCase())) {
    score += 4;
    reasons.push("account ownership");
  }
  for (const s of role.specialties ?? []) {
    if (member.specialties.map((x) => x.toLowerCase()).includes(s.toLowerCase())) {
      score += 1;
      reasons.push(`specialty: ${s}`);
    }
  }
  for (const d of role.product_domains ?? []) {
    if (member.product_domains.map((x) => x.toLowerCase()).includes(d.toLowerCase())) {
      score += 1;
      reasons.push(`product domain: ${d}`);
    }
  }
  return { score, reasons };
}

export function attendanceModeFor(status: string, lane: RosterLane): MessageMode {
  // Attendance changes the message STYLE, never whether expertise is needed.
  if (lane === "leadership") return "LEADER_SUMMARY";
  // Present in the meeting (spoke or confirmed present) -> a concise action delta.
  if (status === "SPOKE" || status === "CONFIRMED_PRESENT" || status === "CONFIRMED_PRESENT_SILENT") return "ATTENDEE_ACTION_DELTA";
  // Confirmed absent -> a full handoff.
  if (status === "CONFIRMED_ABSENT") return "ABSENT_FULL_HANDOFF";
  // Invited-not-confirmed / unknown -> a contextual handoff (attendance not proven).
  return "UNKNOWN_CONTEXTUAL_HANDOFF";
}

export function routeActions(params: { requiredRoles: RequiredRole[]; participation: ParticipationMatrix; roster?: Roster }): RoutingResult {
  const roster = params.roster ?? loadRoster();
  const candidates = activeMembers(roster); // inactive already excluded
  const routing_decisions: RoutingDecision[] = [];
  const unfilled_roles: RoutingResult["unfilled_roles"] = [];
  const usedPersonIds = new Set<string>();

  for (const role of params.requiredRoles) {
    const ranked = candidates
      .filter((m) => !usedPersonIds.has(m.person_id))
      .map((m) => ({ member: m, ...scoreCandidate(m, role) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) {
      const fallbackQueue = candidates.find((m) => m.lane === role.lane)?.fallback_queue ?? null;
      unfilled_roles.push({ required_role: role.required_role, lane: role.lane, reason: "no active roster member matched this role", fallback_queue: fallbackQueue });
      continue;
    }

    const best = ranked[0];
    usedPersonIds.add(best.member.person_id);

    // Attendance for this person (match by roster person_id or name).
    const entry = params.participation.participants.find((p) => p.person_id === best.member.person_id || p.display_name.toLowerCase() === best.member.name.toLowerCase());
    // Never route to a customer participant (roster members are internal;
    // this is a defensive guard).
    if (entry && entry.internal_external === "customer") {
      unfilled_roles.push({ required_role: role.required_role, lane: role.lane, reason: "best match resolved to a customer participant — excluded", fallback_queue: best.member.fallback_queue });
      continue;
    }
    const attendanceStatus = entry?.attendance_status ?? "UNKNOWN";
    const spoke = entry?.spoke ?? false;

    routing_decisions.push({
      recipient_person_id: best.member.person_id,
      recipient_name: best.member.name,
      recipient_role: best.member.title,
      lane: best.member.lane,
      required_role: role.required_role,
      selection_status: ranked.length > 1 && ranked[1].score === best.score ? "alternate" : "selected",
      selection_confidence: Math.min(1, best.score / 8),
      selection_reasons: best.reasons,
      attendance_status: attendanceStatus,
      spoke,
      message_mode: attendanceModeFor(attendanceStatus, best.member.lane),
      channel_plan: best.member.notification_channels,
      fallback_recipient: best.member.fallback_queue,
      evidence_ids: []
    });
  }

  return { routing_decisions, unfilled_roles, human_review_required: unfilled_roles.length > 0 && routing_decisions.length === 0 };
}
