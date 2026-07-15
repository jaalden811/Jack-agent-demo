import { describe, expect, it } from "vitest";
import { inferAuthorityGraph } from "@/lib/stakeholder-intelligence/authorityGraph";

function graph(turns: Array<{ name: string | null; text: string }>) {
  return inferAuthorityGraph({ stakeholderTurns: turns, allCustomerText: turns.map((t) => t.text) });
}

describe("inferAuthorityGraph — evidence-backed roles (Phases 10-13)", () => {
  it("Test 19: explicit budget-control language confirms economic authority", () => {
    const g = graph([{ name: "Dana", text: "I control the budget and I can authorize the spend for this." }]);
    const dana = g.roles.find((r) => r.name === "Dana");
    expect(dana?.role_type).toBe("economic_buyer");
    expect(dana?.status).toBe("confirmed");
    expect(g.economic_authority.status).toBe("confirmed");
  });

  it("Test 20: workshop-control behavior supports decision-process ownership", () => {
    const g = graph([{ name: "Jordan", text: "Let's do a working session. Send the outline to me first, and we'll decide whether to broaden the group." }]);
    const jordan = g.roles.find((r) => r.name === "Jordan");
    expect(jordan?.role_type).toBe("decision_process_owner");
    expect(jordan?.not_proven).toContain("direct budget authority");
  });

  it("Test 22: security-control behavior supports security-gatekeeper status", () => {
    const g = graph([{ name: "Maya", text: "We need data segregation, role-based access, retention control, and audit trails before any broad access." }]);
    expect(g.roles.find((r) => r.name === "Maya")?.role_type).toBe("security_gatekeeper");
  });

  it("Test 24: a public/executive title alone never creates Economic Buyer status (no title input → no confirmed EB)", () => {
    const g = graph([{ name: "Sam", text: "I am the CIO here." }]);
    // Title without authority/ownership language must not confirm economic authority.
    expect(g.economic_authority.status).not.toBe("confirmed");
  });

  it("Test 25: distributed approval paths produce distributed economic authority (not null)", () => {
    const g = graph([
      { name: "Leah", text: "There are multiple spending paths and no single approver; there is a funding placeholder in the resilience program and separate security funding." },
      { name: "Leah", text: "Procurement does not need to join yet." }
    ]);
    expect(g.economic_authority.status).toBe("distributed");
    expect(g.economic_authority.named_person).toBeNull();
    expect(g.economic_authority.approval_paths.length).toBeGreaterThan(0);
    expect(g.economic_authority.next_question).toBeTruthy();
  });

  it("Test 26: a missing named buyer still returns role-level targets", () => {
    const g = graph([{ name: "Pat", text: "We have too many consoles and slow incident correlation." }]);
    expect(g.economic_authority.status).toBe("missing");
    expect(g.economic_authority.role_candidates.length).toBeGreaterThan(0);
  });

  it("Test 30: every inferred role carries behavioral evidence", () => {
    const g = graph([
      { name: "Jordan", text: "Send the outline to me and we'll decide whether to broaden the group; let's schedule a working session." },
      { name: "Maya", text: "Security needs data segregation and access control." }
    ]);
    expect(g.roles.length).toBeGreaterThan(0);
    expect(g.roles.every((r) => r.behavioral_evidence.length > 0)).toBe(true);
  });
});
