import { describe, expect, it } from "vitest";
import type { IntelligencePacket, MessageLane } from "@/lib/intelligence/types";
import { buildInternalActionPlan } from "@/lib/intelligence/internalActionPlan";
import { generateRoleMessage, renderWebexMessage } from "@/lib/intelligence/roleMessage";

/**
 * Invariants for the INTERNAL action plan — the "conversation → internal
 * coordination → customer action" spine. Every check is generic (no company /
 * product / person literal): owners come from the routing config, coordination
 * partners are never customer participants, and no internal owner is invented.
 */

function makePacket(over: Partial<IntelligencePacket> = {}): IntelligencePacket {
  const base: IntelligencePacket = {
    identity: { run_id: "r1", account: "Acme Retail", account_label: "Acme Retail", account_prose: "Acme Retail", account_resolved: true, account_confidence: 0.9, participant_count: 4 },
    owners: { sales: { name: "Bella Robinson", role: "Sales / Commercial owner" }, technical: { name: "Jack Alden", role: "Technical / Specialist owner" } },
    executive_trigger: null,
    opportunity: { verdict: "REVIEW", signal_strength: 72, signal_band: "HIGH", pursuit_decision: "PURSUE_WITH_DISCOVERY", pursuit_score: 72, pursuit_confidence: 0.8, deal_maturity: "SOLUTION_DISCOVERY", primary_opportunity: "cross-domain observability", primary_solution_motion: "Splunk ITSI", is_actionable: true, matched_category_ids: ["cloud_native_observability"] },
    customer_evidence: { pains: [], business_impacts: [], objections: [], explicit_negations: [], do_not_reask: [] },
    qualification: { meddpicc: { economic_buyer: "CONFIRMED" }, decision_criteria: [] },
    current_environment: ["ServiceNow", "Okta", "CrowdStrike"],
    stakeholders: [
      { name: "Jordan", role_label: "Business champion", stance: "supportive", play: "Arm them with exec-legible framing.", evidence: "I'd like a working session." },
      { name: "Maya", role_label: "Technical evaluator", stance: "neutral", play: "Bring architecture proof.", evidence: null }
    ],
    deal_intelligence: {
      deal_shape: "Expansion", deal_shape_tags: ["expansion"], why_real: [], momentum: [{ id: "requested_next_step", label: "Customer asked for the next step", evidence: null, speaker: "Jordan" }],
      landmines: [], top_landmine: null, value_hypothesis: null, headline_metric: null, timing_driver: null, existing_footprint: true, exec_program: false
    },
    next_action: { primary_action: "Run a two-scenario validation workshop", primary_action_type: "architecture_workshop", owner_lane: "technical", summary: "Run a scenario-design workshop.", success_criteria: ["Agree data sources"], why_now: [], recommended_timing: null, evidence_ids: ["E1"] },
    workshop: { requested: true, format: "working session", scenarios: ["degraded engineering service"], data_sources: ["telemetry"], success_criteria: [] },
    public_context: [],
    personalization: { profile_present: false, goal_ids_by_lane: {}, profile_source_by_lane: {}, recipient_teasers: {} },
    provenance: { analysis_mode: "deterministic", message_source: "deterministic_fallback", limitations: [] }
  };
  return { ...base, ...over };
}

const OWNER_NAMES = new Set(["Bella Robinson", "Jack Alden"]);

describe("buildInternalActionPlan", () => {
  it("every routed (actionable) opportunity produces an internal action plan", () => {
    for (const lane of ["sales", "technical"] as MessageLane[]) {
      const plan = buildInternalActionPlan(makePacket(), lane);
      expect(plan).not.toBeNull();
      expect(plan!.your_move.length).toBeGreaterThan(10);
      expect(plan!.customer_engagement.next_step.length).toBeGreaterThan(5);
    }
  });

  it("a non-actionable opportunity yields no internal plan", () => {
    const p = makePacket({ opportunity: { ...makePacket().opportunity, is_actionable: false } });
    expect(buildInternalActionPlan(p, "sales")).toBeNull();
  });

  it("the internal move is different from the customer next step", () => {
    const plan = buildInternalActionPlan(makePacket(), "sales")!;
    expect(plan.your_move).not.toEqual(plan.customer_engagement.next_step);
    // The internal move is about coordination; the customer step is the NBA.
    expect(plan.customer_engagement.next_step).toContain("Run a two-scenario validation workshop");
  });

  it("the commercial owner loops in the technical owner with technical tasks (technical motion)", () => {
    const plan = buildInternalActionPlan(makePacket(), "sales")!;
    const tech = plan.coordinate_with.find((c) => c.lane === "technical");
    expect(tech).toBeDefined();
    expect(tech!.name).toBe("Jack Alden");
    // Technical tasks — architecture/validation/data, never commercial framing.
    expect(tech!.prepare.join(" ").toLowerCase()).toMatch(/architecture|validation|data source|integration|scenario/);
  });

  it("the technical owner loops in the commercial owner with commercial tasks", () => {
    const plan = buildInternalActionPlan(makePacket(), "technical")!;
    const sales = plan.coordinate_with.find((c) => c.lane === "sales");
    expect(sales).toBeDefined();
    expect(sales!.name).toBe("Bella Robinson");
    expect(sales!.prepare.join(" ").toLowerCase()).toMatch(/commercial|business case|budget|procurement|alignment/);
  });

  it("does NOT create an exec step for an exec-sponsored program alone (an exec sponsor existing is not a trigger)", () => {
    const p = makePacket({ deal_intelligence: { ...makePacket().deal_intelligence, exec_program: true }, qualification: { meddpicc: { economic_buyer: "CONFIRMED" }, decision_criteria: [] } });
    const plan = buildInternalActionPlan(p, "sales")!;
    expect(plan.coordinate_with.some((c) => c.lane === "executive")).toBe(false);
  });

  it("distributed/committee authority alone produces a CONDITIONAL funding-gate note, never an immediate step", () => {
    const p = makePacket({ qualification: { meddpicc: { economic_buyer: "DISTRIBUTED" }, decision_criteria: [] } });
    const plan = buildInternalActionPlan(p, "sales")!;
    const exec = plan.coordinate_with.find((c) => c.lane === "executive")!;
    expect(exec).toBeDefined();
    expect(exec.requirement).toBe("conditional");
    expect(exec.timing).toBe("at_funding_gate");
    expect(exec.trigger_code).toBe("COMMITTEE_FUNDING_GATE");
    // Restrained, evidence-safe language — no "air cover" / "unblock funding" claim.
    expect(exec.why.toLowerCase()).toMatch(/committee|no single approver/);
    expect(exec.why.toLowerCase()).not.toContain("air cover");
    expect(exec.why.toLowerCase()).not.toContain("unblock funding");
    // The immediate technical step is REQUIRED and outranks the conditional gate.
    const tech = plan.coordinate_with.find((c) => c.lane === "technical")!;
    expect(tech.requirement).toBe("required");
  });

  it("creates an IMMEDIATE (recommended) exec step ONLY on an explicit evidence trigger", () => {
    const p = makePacket({
      qualification: { meddpicc: { economic_buyer: "DISTRIBUTED" }, decision_criteria: [] },
      executive_trigger: { code: "EXEC_MEETING_REQUESTED", description: "The customer requested exec engagement." }
    });
    const plan = buildInternalActionPlan(p, "sales")!;
    const exec = plan.coordinate_with.find((c) => c.lane === "executive")!;
    expect(exec).toBeDefined();
    expect(exec.requirement).toBe("recommended");
    expect(exec.timing).toBe("before_customer_meeting");
    expect(exec.trigger_code).toBe("EXEC_MEETING_REQUESTED");
  });

  it("an EXEC_ALIGNMENT_BLOCKED trigger yields an if_blocked recommended step", () => {
    const p = makePacket({ executive_trigger: { code: "EXEC_ALIGNMENT_BLOCKED", description: "Blocked at leadership." } });
    const exec = buildInternalActionPlan(p, "sales")!.coordinate_with.find((c) => c.lane === "executive")!;
    expect(exec.timing).toBe("if_blocked");
    expect(exec.requirement).toBe("recommended");
  });

  it("renders immediate coordination and conditional gates in SEPARATE sections (later never do-now)", () => {
    const p = makePacket({ qualification: { meddpicc: { economic_buyer: "DISTRIBUTED" }, decision_criteria: [] } });
    const md = renderWebexMessage(generateRoleMessage(p, "sales"));
    // Immediate technical loop-in appears as a "Loop in" line.
    expect(md).toContain("**Loop in Jack Alden:**");
    // The conditional committee gate renders as a subordinate "Later —" line, after the immediate work.
    expect(md).toMatch(/\*\*Later — [^:]*:\*\*/);
    expect(md.indexOf("Loop in Jack Alden")).toBeLessThan(md.indexOf("Later —"));
    // It is never framed as a "Loop in" do-now step.
    expect(md).not.toMatch(/Loop in Internal sales leader/);
  });

  it("a customer executive sponsor is surfaced under customer engagement, never as an internal coordination party", () => {
    const p = makePacket({
      qualification: { meddpicc: { economic_buyer: "DISTRIBUTED" }, decision_criteria: [] },
      stakeholders: [
        { name: "Dara", role_label: "Business champion", stance: "supportive", play: "Owns the recommendation.", evidence: null },
        { name: "Eze", role_label: "Executive sponsor", stance: "neutral", play: "Chairs the committee.", evidence: null }
      ]
    });
    const plan = buildInternalActionPlan(p, "sales")!;
    // The customer exec is in the customer engagement plan...
    expect(plan.customer_engagement.stakeholders.map((s) => s.name)).toContain("Eze");
    // ...and NEVER an internal coordination party (all internal parties are owners/role slots).
    for (const c of plan.coordinate_with) {
      expect(c.name).not.toBe("Eze");
      expect(c.name).not.toBe("Dara");
    }
  });

  it("does NOT add executive coordination merely because the EB is unknown early in discovery", () => {
    // EB MISSING + no exec program + no distributed authority → an exec loop-in
    // would be constant noise; only a real exec/committee signal warrants it.
    const p = makePacket({
      qualification: { meddpicc: { economic_buyer: "MISSING" }, decision_criteria: [] },
      deal_intelligence: { ...makePacket().deal_intelligence, exec_program: false, momentum: [] }
    });
    const plan = buildInternalActionPlan(p, "sales")!;
    expect(plan.coordinate_with.some((c) => c.lane === "executive")).toBe(false);
  });

  it("never routes a customer participant as an internal owner or coordination partner", () => {
    const plan = buildInternalActionPlan(makePacket(), "technical")!;
    const internalNames = plan.coordinate_with.map((c) => c.name).filter(Boolean) as string[];
    for (const n of internalNames) expect(OWNER_NAMES.has(n)).toBe(true);
    // Jordan/Maya are customer participants — they only ever appear as the
    // customer champion under customer_engagement, never as internal coordination.
    expect(internalNames).not.toContain("Jordan");
    expect(internalNames).not.toContain("Maya");
    expect(plan.primary_owner.name === null || OWNER_NAMES.has(plan.primary_owner.name)).toBe(true);
  });

  it("surfaces the customer champion under customer engagement (kept separate from internal work)", () => {
    const plan = buildInternalActionPlan(makePacket(), "sales")!;
    expect(plan.customer_engagement.champion?.name).toBe("Jordan");
    expect(plan.customer_engagement.champion?.role).toMatch(/champion/i);
  });

  it("never invents an internal owner: role-only slot when the routing config has no name", () => {
    const p = makePacket({ owners: { sales: { name: null, role: "Sales / Commercial owner" }, technical: { name: null, role: "Technical / Specialist owner" } } });
    const plan = buildInternalActionPlan(p, "sales")!;
    for (const c of plan.coordinate_with) {
      // name is null (role-only) — never a fabricated or customer name.
      expect(c.name).toBeNull();
      expect(c.role.length).toBeGreaterThan(0);
    }
    expect(plan.primary_owner.name).toBeNull();
  });

  it("a purely commercial motion still yields commercial coordination (no forced technical loop-in)", () => {
    const p = makePacket({
      workshop: { requested: false, format: null, scenarios: [], data_sources: [], success_criteria: [] },
      next_action: { primary_action: "Confirm budget owner and decision timeline", primary_action_type: "commercial_qualification", owner_lane: "sales", summary: "Confirm the buying path.", success_criteria: [], why_now: [], recommended_timing: null, evidence_ids: [] },
      opportunity: { ...makePacket().opportunity, primary_solution_motion: "renewal", matched_category_ids: [] }
    });
    const plan = buildInternalActionPlan(p, "sales")!;
    // No technical shaping required → no technical loop-in forced.
    expect(plan.coordinate_with.some((c) => c.lane === "technical")).toBe(false);
    expect(plan.your_move.toLowerCase()).toMatch(/commercial|business case|decision path/);
  });
});
