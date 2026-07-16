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

export type RequiredRole = { required_role: string; lane: RosterLane; product_domains?: string[]; specialties?: string[]; account?: string | null; territories?: string[] };
export type MessageMode = "ATTENDEE_ACTION_DELTA" | "ABSENT_FULL_HANDOFF" | "UNKNOWN_CONTEXTUAL_HANDOFF" | "LEADER_SUMMARY";

export type RoutingAlternative = { person_id: string; name: string; score: number; reasons: string[] };

export type RoutingDecision = {
  recipient_person_id: string;
  recipient_name: string;
  recipient_role: string;
  recipient_email: string | null;
  lane: string;
  required_role: string;
  selection_status: "selected" | "ambiguous" | "unresolved";
  selection_confidence: number;
  selection_reasons: string[];
  /** Real alternative candidates (next-best qualified people) for a
   * human to override with — non-empty when the choice was ambiguous. */
  alternatives: RoutingAlternative[];
  /** Whether the recipient has a usable delivery channel (Webex identity or a
   * configured notification channel). */
  delivery_available: boolean;
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

/** A member is "delivery available" when there is a real channel to reach them
 * — a Webex identity or at least one configured notification channel. */
export function hasDeliveryChannel(member: RosterMember): boolean {
  return Boolean(member.webex_email) || member.notification_channels.length > 0;
}

function scoreCandidate(member: RosterMember, role: RequiredRole): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  // Role-relevance score first: a candidate must be relevant to the role
  // (lane / account / specialty / product domain / territory) to be eligible.
  let roleScore = 0;
  if (member.lane === role.lane) {
    roleScore += 3;
    reasons.push(`lane match (${role.lane})`);
  }
  if (role.account && member.accounts.map((a) => a.toLowerCase()).includes(role.account.toLowerCase())) {
    roleScore += 4;
    reasons.push("account ownership");
  }
  for (const s of role.specialties ?? []) {
    if (member.specialties.map((x) => x.toLowerCase()).includes(s.toLowerCase())) {
      roleScore += 1;
      reasons.push(`specialty: ${s}`);
    }
  }
  for (const d of role.product_domains ?? []) {
    if (member.product_domains.map((x) => x.toLowerCase()).includes(d.toLowerCase())) {
      roleScore += 1;
      reasons.push(`product domain: ${d}`);
    }
  }
  for (const t of role.territories ?? []) {
    if (member.territories.map((x) => x.toLowerCase()).includes(t.toLowerCase())) {
      roleScore += 1;
      reasons.push(`territory: ${t}`);
    }
  }
  // A member with no role relevance is never eligible — delivery availability
  // is only ever a TIE-BREAKER among already-qualified candidates, never a
  // qualification by itself.
  if (roleScore === 0) return { score: 0, reasons: [] };
  if (hasDeliveryChannel(member)) {
    reasons.push("delivery channel available");
    return { score: roleScore + 1, reasons };
  }
  return { score: roleScore, reasons };
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

    // Ambiguous when the next candidate ties the top score; surface real
    // alternatives (next-best qualified people) for a human override.
    const ambiguous = ranked.length > 1 && ranked[1].score === best.score;
    const alternatives: RoutingAlternative[] = ranked
      .slice(1, 4)
      .map((c) => ({ person_id: c.member.person_id, name: c.member.name, score: c.score, reasons: c.reasons }));

    routing_decisions.push({
      recipient_person_id: best.member.person_id,
      recipient_name: best.member.name,
      recipient_role: best.member.title,
      recipient_email: best.member.webex_email ?? best.member.emails[0] ?? null,
      lane: best.member.lane,
      required_role: role.required_role,
      selection_status: ambiguous ? "ambiguous" : "selected",
      selection_confidence: Math.min(1, best.score / 10),
      selection_reasons: best.reasons,
      alternatives,
      delivery_available: hasDeliveryChannel(best.member),
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
