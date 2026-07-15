import { describe, expect, it } from "vitest";
import { parseRoster, matchRosterMember, activeMembers, type Roster } from "@/lib/team-routing/roster";
import { buildParticipationMatrix } from "@/lib/meeting-participation/participation";
import { routeActions, type RequiredRole } from "@/lib/team-routing/routing";

/**
 * Roster + participation + attendance-aware routing (Phases 4-6, tests
 * 10-24). Generic — no fixture person/account is in production logic.
 */

const roster: Roster = {
  members: [
    { person_id: "p1", name: "Alex Sales", emails: ["alex@vendor.com"], webex_email: "alex@vendor.com", title: "AE", role_family: "commercial", lane: "sales", specialties: ["negotiation"], product_domains: ["observability"], accounts: ["Acme"], territories: [], manager_person_id: null, fallback_queue: "sales-q", notification_channels: ["webex"], default_webex_room_id: null, active: true },
    { person_id: "p2", name: "Sam Tech", emails: ["sam@vendor.com"], webex_email: "sam@vendor.com", title: "SE", role_family: "technical", lane: "technical", specialties: ["architecture", "security"], product_domains: ["security"], accounts: [], territories: [], manager_person_id: null, fallback_queue: "tech-q", notification_channels: ["webex", "outlook"], default_webex_room_id: null, active: true },
    { person_id: "p3", name: "Pat Inactive", emails: ["pat@vendor.com"], webex_email: null, title: "SE", role_family: "technical", lane: "technical", specialties: ["architecture"], product_domains: ["security"], accounts: [], territories: [], manager_person_id: null, fallback_queue: "tech-q", notification_channels: ["webex"], default_webex_room_id: null, active: false }
  ]
};

describe("roster parsing (Tests 10-12)", () => {
  it("parses JSON and detects duplicate ids/emails + invalid email", () => {
    const { members, issues } = parseRoster({
      members: [
        { person_id: "a", name: "A", emails: ["a@x.com"], lane: "sales" },
        { person_id: "a", name: "Dup", emails: ["a@x.com"], lane: "sales" },
        { person_id: "b", name: "B", emails: ["not-an-email"], lane: "technical" }
      ]
    });
    expect(members).toHaveLength(2);
    expect(issues.some((i) => i.includes("duplicate person_id"))).toBe(true);
    expect(issues.some((i) => i.toLowerCase().includes("invalid email"))).toBe(true);
  });

  it("activeMembers excludes inactive people (Test 12)", () => {
    expect(activeMembers(roster).map((m) => m.person_id)).toEqual(["p1", "p2"]);
  });

  it("matchRosterMember matches by email then name", () => {
    expect(matchRosterMember({ email: "sam@vendor.com" }, roster)?.person_id).toBe("p2");
    expect(matchRosterMember({ name: "Alex Sales" }, roster)?.person_id).toBe("p1");
    expect(matchRosterMember({ name: "Nobody" }, roster)).toBeNull();
  });
});

describe("participation matrix (Tests 14-17)", () => {
  const transcriptParticipants = [
    { name: "Jordan", classification: "customer", turnCount: 5 },
    { name: "Maya", classification: "customer", turnCount: 0 }
  ];

  it("Test 14: a transcript speaker is marked spoke / confirmed_present", () => {
    const m = buildParticipationMatrix({ transcript_participants: transcriptParticipants }, roster);
    const jordan = m.participants.find((p) => p.display_name === "Jordan")!;
    expect(jordan.spoke).toBe(true);
    expect(jordan.attendance_status).toBe("confirmed_present");
    expect(jordan.presence_detail).toBe("speaker");
  });

  it("Test 15/16: a silent/invited person's presence is unknown without metadata", () => {
    const m = buildParticipationMatrix({ transcript_participants: transcriptParticipants, invited_names: ["Casey"] }, roster);
    expect(m.participants.find((p) => p.display_name === "Maya")!.attendance_status).toBe("unknown");
    expect(m.participants.find((p) => p.display_name === "Casey")!.attendance_status).toBe("invited_not_confirmed");
    expect(m.attendance_data_complete).toBe(false);
  });

  it("Test 17: a manual correction wins over transcript inference", () => {
    const m = buildParticipationMatrix({ transcript_participants: transcriptParticipants, corrections: [{ name: "Jordan", attendance_status: "confirmed_absent" }] }, roster);
    const jordan = m.participants.find((p) => p.display_name === "Jordan")!;
    expect(jordan.attendance_status).toBe("confirmed_absent");
    expect(jordan.presence_detail).toBe("manually_confirmed");
  });

  it("Webex attendance metadata outranks transcript inference", () => {
    const m = buildParticipationMatrix({ transcript_participants: [{ name: "Maya", classification: "customer", turnCount: 0 }], webex_attendees: [{ name: "Maya", attended: true }] }, roster);
    expect(m.participants[0].attendance_status).toBe("confirmed_present");
    expect(m.attendance_data_complete).toBe(true);
  });
});

describe("attendance-aware routing (Tests 13, 18-24)", () => {
  const roles: RequiredRole[] = [
    { required_role: "technical_specialist", lane: "technical", specialties: ["architecture"], product_domains: ["security"], account: "Acme" },
    { required_role: "account_executive", lane: "sales", account: "Acme" }
  ];
  const participation = buildParticipationMatrix({ transcript_participants: [{ name: "Sam Tech", classification: "vendor", turnCount: 3 }] }, roster);

  it("Test 18/19: selects roster people by lane/specialty/account", () => {
    const result = routeActions({ requiredRoles: roles, participation, roster });
    const tech = result.routing_decisions.find((d) => d.required_role === "technical_specialist")!;
    expect(tech.recipient_person_id).toBe("p2");
    expect(tech.selection_reasons.some((r) => r.includes("lane match") || r.includes("specialty"))).toBe(true);
    const ae = result.routing_decisions.find((d) => d.required_role === "account_executive")!;
    expect(ae.recipient_person_id).toBe("p1");
    expect(ae.selection_reasons).toContain("account ownership");
  });

  it("Test 21: a role with no active match becomes an unfilled role with fallback", () => {
    const result = routeActions({ requiredRoles: [{ required_role: "legal", lane: "operations" }], participation, roster });
    expect(result.routing_decisions).toHaveLength(0);
    expect(result.unfilled_roles).toHaveLength(1);
    expect(result.human_review_required).toBe(true);
  });

  it("Test 22/24: attendance drives the message mode", () => {
    const result = routeActions({ requiredRoles: roles, participation, roster });
    // Sam Tech spoke -> present -> action delta; Alex (no participation) -> unknown.
    expect(result.routing_decisions.find((d) => d.recipient_person_id === "p2")!.message_mode).toBe("ATTENDEE_ACTION_DELTA");
    expect(result.routing_decisions.find((d) => d.recipient_person_id === "p1")!.message_mode).toBe("UNKNOWN_CONTEXTUAL_HANDOFF");
  });

  it("Test 13: a customer participant is never selected as a recipient", () => {
    // Even if a customer shares a name with a role need, routing only picks
    // from the internal roster; customers are never recipients.
    const custParticipation = buildParticipationMatrix({ transcript_participants: [{ name: "Jordan", classification: "customer", turnCount: 4 }] }, roster);
    const result = routeActions({ requiredRoles: roles, participation: custParticipation, roster });
    for (const d of result.routing_decisions) {
      expect(["p1", "p2"]).toContain(d.recipient_person_id);
      expect(d.recipient_name).not.toBe("Jordan");
    }
  });
});
