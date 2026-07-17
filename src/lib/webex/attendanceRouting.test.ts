import { describe, expect, it } from "vitest";
import {
  buildMeetingParticipation,
  laneAttendanceFor,
  applyAttendanceFraming,
  orderLanesByAttendance,
  annotateDeliveryAttendance
} from "@/lib/webex/attendanceRouting";
import type { LaneAttendance } from "@/lib/webex/attendanceRouting";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { ChannelDeliveryResult, EmailMessagePreview, LaneRoutingDecision, WebexLane, WebexMessagePreview } from "@/lib/webex/types";

/**
 * Phase 7b: attendance-aware message routing. Recipient SELECTION is unchanged
 * (the routed lanes decide who); attendance only sets the message MODE (delta
 * vs full/contextual handoff), the framing header, and the send order. A
 * transcript proves speakers only — absence is never inferred.
 */

function resultWith(participants: Array<{ name: string; classification: string; turnCount: number }>): SecureNetworkingTriageResult {
  return {
    run_id: "run_1",
    stakeholder_analysis: {
      participants: participants.map((p) => ({ name: p.name, title: null, organization: null, classification: p.classification, turnCount: p.turnCount, firstEvidenceIndex: null, lastEvidenceIndex: null })),
      named_stakeholders: [],
      functional_owners: []
    }
  } as unknown as SecureNetworkingTriageResult;
}

function decision(lane: "sales" | "technical", name: string, email: string | null): LaneRoutingDecision {
  return { lane, recipient_name: name, recipient_email: email, assigned_role: "", reason: [], actions: [], signal_types: [], lifecycle_stage: "LAND", automatic_delivery: true };
}

function webexPreview(lane: "sales" | "technical", markdown: string): WebexMessagePreview {
  return { lane, recipient_name: lane === "sales" ? "Bella Robinson" : "Jack Alden", recipient_email: null, subject: "s", markdown, character_count: markdown.length, synthesized_by_ai: false };
}

function emailPreview(lane: "sales" | "technical"): EmailMessagePreview {
  return { lane, recipient_name: lane === "sales" ? "Bella Robinson" : "Jack Alden", recipient_email: null, subject: "s", html: "<p>body</p>", text: "body", synthesized_by_ai: false };
}

describe("buildMeetingParticipation", () => {
  it("marks a transcript speaker matched to the roster as SPOKE", () => {
    const matrix = buildMeetingParticipation(resultWith([{ name: "Bella Robinson", classification: "vendor", turnCount: 3 }]));
    const bella = matrix.participants.find((p) => p.display_name === "Bella Robinson");
    expect(bella?.spoke).toBe(true);
    expect(bella?.attendance_status).toBe("SPOKE");
    // Transcript-only source -> attendance data is flagged incomplete.
    expect(matrix.attendance_data_complete).toBe(false);
  });
});

describe("laneAttendanceFor", () => {
  it("gives a present (speaking) recipient ATTENDEE_ACTION_DELTA and an absent-from-transcript recipient a contextual handoff", () => {
    const result = resultWith([{ name: "Bella Robinson", classification: "vendor", turnCount: 2 }]);
    const matrix = buildMeetingParticipation(result);
    const routing = [decision("sales", "Bella Robinson", "belrobin@cisco.com"), decision("technical", "Jack Alden", "jaalden@cisco.com")];
    const byLane = laneAttendanceFor(routing, matrix);
    expect(byLane.get("sales")?.message_mode).toBe("ATTENDEE_ACTION_DELTA");
    expect(byLane.get("sales")?.spoke).toBe(true);
    // Jack never appeared in the transcript -> attendance unknown, full context.
    expect(byLane.get("technical")?.message_mode).toBe("UNKNOWN_CONTEXTUAL_HANDOFF");
    expect(byLane.get("technical")?.spoke).toBe(false);
  });
});

describe("applyAttendanceFraming", () => {
  it("prepends a mode header and attaches attendance metadata without losing the body", () => {
    const byLane = new Map<WebexLane, LaneAttendance>([
      ["sales", { lane: "sales", attendance_status: "SPOKE", spoke: true, message_mode: "ATTENDEE_ACTION_DELTA" }],
      ["technical", { lane: "technical", attendance_status: "UNKNOWN", spoke: false, message_mode: "UNKNOWN_CONTEXTUAL_HANDOFF" }]
    ]);
    const { messages, emails } = applyAttendanceFraming(
      [webexPreview("sales", "SALES-BODY"), webexPreview("technical", "TECH-BODY")],
      [emailPreview("sales")],
      byLane
    );
    const sales = messages.find((m) => m.lane === "sales");
    expect(sales?.markdown).toContain("You were in this meeting");
    expect(sales?.markdown).toContain("SALES-BODY");
    expect(sales?.message_mode).toBe("ATTENDEE_ACTION_DELTA");
    expect(sales?.character_count).toBe(sales?.markdown.length);
    const tech = messages.find((m) => m.lane === "technical");
    // Attendance-unconfirmed adds NO leading caveat — the message opens with the
    // opportunity body; the state is tracked in message_mode + the delivery card.
    expect(tech?.markdown).not.toContain("attendance unconfirmed");
    expect(tech?.markdown.startsWith("TECH-BODY")).toBe(true);
    expect(tech?.message_mode).toBe("UNKNOWN_CONTEXTUAL_HANDOFF");
    const salesEmail = emails.find((e) => e.lane === "sales");
    expect(salesEmail?.html.startsWith("<p><em>")).toBe(true);
    expect(salesEmail?.text).toContain("body");
    expect(salesEmail?.message_mode).toBe("ATTENDEE_ACTION_DELTA");
  });
});

describe("orderLanesByAttendance", () => {
  it("orders present-attendee deltas before contextual/absent handoffs", () => {
    const byLane = new Map<WebexLane, LaneAttendance>([
      ["technical", { lane: "technical", attendance_status: "UNKNOWN", spoke: false, message_mode: "UNKNOWN_CONTEXTUAL_HANDOFF" }],
      ["sales", { lane: "sales", attendance_status: "SPOKE", spoke: true, message_mode: "ATTENDEE_ACTION_DELTA" }]
    ]);
    const ordered = orderLanesByAttendance([webexPreview("technical", "T"), webexPreview("sales", "S")], byLane);
    expect(ordered.map((m) => m.lane)).toEqual(["sales", "technical"]);
  });
});

describe("annotateDeliveryAttendance", () => {
  it("attaches attendance_status + message_mode to delivery results by lane", () => {
    const byLane = new Map<WebexLane, LaneAttendance>([["sales", { lane: "sales", attendance_status: "SPOKE", spoke: true, message_mode: "ATTENDEE_ACTION_DELTA" }]]);
    const items: ChannelDeliveryResult[] = [
      { lane: "sales", channel: "webex", recipient_name: "Bella Robinson", recipient_email: null, applicable: true, attempted: true, delivered: true, message_id: "m", status_code: 200, error: null, error_code: null, sent_at: null, delivery_key: "k" }
    ];
    const annotated = annotateDeliveryAttendance(items, byLane);
    expect(annotated[0].message_mode).toBe("ATTENDEE_ACTION_DELTA");
    expect(annotated[0].attendance_status).toBe("SPOKE");
  });
});
