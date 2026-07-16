import { describe, expect, it } from "vitest";
import { parseRoster, parseRosterCsv, matchRosterMember, activeMembers, type Roster } from "@/lib/team-routing/roster";
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

  it("parseRosterCsv imports CSV (multi-value cols ';'-separated), excludes inactive, validates like JSON", () => {
    const csv = [
      "person_id,name,emails,webex_email,title,role_family,lane,specialties,product_domains,accounts,territories,notification_channels,active",
      "c1,Casey CSV,casey@vendor.com,casey@vendor.com,AE,commercial,sales,negotiation;discovery,observability;security,Globex;Initech,NA-East,webex;outlook,true",
      "c2,Dana CSV,dana@vendor.com,,SE,technical,technical,architecture,security,,EMEA,webex,false",
      "c3,Bad Email,not-an-email,,SE,technical,technical,,,,,,true"
    ].join("\n");
    const { members, issues } = parseRosterCsv(csv);
    expect(members).toHaveLength(3);
    const casey = members.find((m) => m.person_id === "c1")!;
    expect(casey.specialties).toEqual(["negotiation", "discovery"]);
    expect(casey.accounts).toEqual(["Globex", "Initech"]);
    expect(casey.notification_channels).toEqual(["webex", "outlook"]);
    expect(members.find((m) => m.person_id === "c2")!.active).toBe(false);
    expect(activeMembers({ members }).map((m) => m.person_id)).toEqual(["c1", "c3"]);
    expect(issues.some((i) => i.toLowerCase().includes("invalid email"))).toBe(true);
  });
});

describe("participation matrix — 6-state model (Tests 14-17)", () => {
  const transcriptParticipants = [
    { name: "Jordan", classification: "customer", turnCount: 5 },
    { name: "Maya", classification: "customer", turnCount: 0 }
  ];

  it("Test 14: a transcript speaker is SPOKE (transcript proves speaking)", () => {
    const m = buildParticipationMatrix({ transcript_participants: transcriptParticipants }, roster);
    const jordan = m.participants.find((p) => p.display_name === "Jordan")!;
    expect(jordan.spoke).toBe(true);
    expect(jordan.attendance_status).toBe("SPOKE");
    expect(jordan.sources).toContain("transcript_speaker");
  });

  it("Test 15/16: silent/invited people are INVITED_NOT_CONFIRMED (invitation never proves attendance)", () => {
    const m = buildParticipationMatrix({ transcript_participants: transcriptParticipants, invited_names: ["Casey"] }, roster);
    expect(m.participants.find((p) => p.display_name === "Maya")!.attendance_status).toBe("INVITED_NOT_CONFIRMED");
    expect(m.participants.find((p) => p.display_name === "Casey")!.attendance_status).toBe("INVITED_NOT_CONFIRMED");
    expect(m.attendance_data_complete).toBe(false);
  });

  it("Test 17: a manual correction outranks all other evidence", () => {
    const m = buildParticipationMatrix({ transcript_participants: transcriptParticipants, corrections: [{ name: "Jordan", attendance_status: "CONFIRMED_ABSENT" }] }, roster);
    const jordan = m.participants.find((p) => p.display_name === "Jordan")!;
    expect(jordan.attendance_status).toBe("CONFIRMED_ABSENT");
    expect(jordan.sources).toContain("manual_correction");
  });

  it("Webex metadata outranks transcript inference: attended + silent -> CONFIRMED_PRESENT_SILENT", () => {
    const m = buildParticipationMatrix({ transcript_participants: [{ name: "Maya", classification: "customer", turnCount: 0 }], webex_attendees: [{ name: "Maya", attended: true }] }, roster);
    expect(m.participants[0].attendance_status).toBe("CONFIRMED_PRESENT_SILENT");
    expect(m.attendance_data_complete).toBe(true);
  });

  it("Webex attended + spoke -> CONFIRMED_PRESENT; Webex absent -> CONFIRMED_ABSENT", () => {
    const present = buildParticipationMatrix({ transcript_participants: [{ name: "Jordan", classification: "customer", turnCount: 2 }], webex_attendees: [{ name: "Jordan", attended: true }] }, roster);
    expect(present.participants[0].attendance_status).toBe("CONFIRMED_PRESENT");
    const absent = buildParticipationMatrix({ transcript_participants: [{ name: "Jordan", classification: "customer", turnCount: 2 }], webex_attendees: [{ name: "Jordan", attended: false }] }, roster);
    // Webex outranks the transcript speaker signal.
    expect(absent.participants[0].attendance_status).toBe("CONFIRMED_ABSENT");
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

describe("routing selection factors: territory, delivery availability, alternatives", () => {
  const emptyParticipation = buildParticipationMatrix({ transcript_participants: [] });

  const scoringRoster: Roster = {
    members: [
      { person_id: "t1", name: "Terri Territory", emails: ["terri@vendor.com"], webex_email: "terri@vendor.com", title: "SE", role_family: "technical", lane: "technical", specialties: ["architecture"], product_domains: ["security"], accounts: [], territories: ["NA-East"], manager_person_id: null, fallback_queue: "tech-q", notification_channels: ["webex"], default_webex_room_id: null, active: true },
      { person_id: "t2", name: "Neil NoTerritory", emails: ["neil@vendor.com"], webex_email: "neil@vendor.com", title: "SE", role_family: "technical", lane: "technical", specialties: ["architecture"], product_domains: ["security"], accounts: [], territories: ["EMEA"], manager_person_id: null, fallback_queue: "tech-q", notification_channels: ["webex"], default_webex_room_id: null, active: true }
    ]
  };

  it("territory match breaks a tie between equally-qualified members", () => {
    const result = routeActions({ requiredRoles: [{ required_role: "se", lane: "technical", specialties: ["architecture"], product_domains: ["security"], territories: ["NA-East"] }], participation: emptyParticipation, roster: scoringRoster });
    const d = result.routing_decisions[0];
    expect(d.recipient_person_id).toBe("t1");
    expect(d.selection_reasons).toContain("territory: NA-East");
    // The equally-qualified out-of-territory SE is surfaced as an alternative.
    expect(d.alternatives.map((a) => a.person_id)).toContain("t2");
  });

  it("prefers a delivery-available candidate and flags delivery_available", () => {
    const deliverRoster: Roster = {
      members: [
        { person_id: "d1", name: "Reachable", emails: ["r@vendor.com"], webex_email: "r@vendor.com", title: "SE", role_family: "technical", lane: "technical", specialties: ["architecture"], product_domains: [], accounts: [], territories: [], manager_person_id: null, fallback_queue: null, notification_channels: ["webex"], default_webex_room_id: null, active: true },
        { person_id: "d2", name: "Unreachable", emails: [], webex_email: null, title: "SE", role_family: "technical", lane: "technical", specialties: ["architecture"], product_domains: [], accounts: [], territories: [], manager_person_id: null, fallback_queue: null, notification_channels: [], default_webex_room_id: null, active: true }
      ]
    };
    const result = routeActions({ requiredRoles: [{ required_role: "se", lane: "technical", specialties: ["architecture"] }], participation: emptyParticipation, roster: deliverRoster });
    const d = result.routing_decisions[0];
    expect(d.recipient_person_id).toBe("d1");
    expect(d.delivery_available).toBe(true);
    expect(d.selection_reasons).toContain("delivery channel available");
  });

  it("an exact tie is marked ambiguous with alternatives", () => {
    const result = routeActions({ requiredRoles: [{ required_role: "se", lane: "technical", specialties: ["architecture"], product_domains: ["security"] }], participation: emptyParticipation, roster: scoringRoster });
    const d = result.routing_decisions[0];
    expect(d.selection_status).toBe("ambiguous");
    expect(d.alternatives.length).toBeGreaterThan(0);
  });
});
