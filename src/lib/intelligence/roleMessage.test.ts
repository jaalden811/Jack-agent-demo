import { describe, expect, it } from "vitest";
import type { IntelligencePacket } from "@/lib/intelligence/types";
import { generateRoleMessage, renderWebexMessage, renderEmailMessage, renderInAppTeaser } from "@/lib/intelligence/roleMessage";
import { buildIntelligencePacket } from "@/lib/intelligence/intelligencePacket";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

function makePacket(over: Partial<IntelligencePacket> = {}): IntelligencePacket {
  const base: IntelligencePacket = {
    identity: { run_id: "r1", account: "Acme Retail", account_label: "Acme Retail", account_prose: "Acme Retail", account_resolved: true, account_confidence: 0.9, participant_count: 4 },
    opportunity: { verdict: "REVIEW", signal_strength: 72, signal_band: "HIGH", pursuit_decision: "PURSUE_WITH_DISCOVERY", pursuit_score: 72, pursuit_confidence: 0.8, deal_maturity: "SOLUTION_DISCOVERY", primary_opportunity: "cross-domain observability and incident correlation", primary_solution_motion: "Splunk ITSI", is_actionable: true },
    customer_evidence: { pains: [], business_impacts: [{ statement: "hundreds of specialists unable to work when incidents hit", speaker: null, evidence_ids: [] }], objections: [], explicit_negations: ["not a SIEM replacement"], do_not_reask: [] },
    qualification: { meddpicc: { identify_pain: "CONFIRMED", metrics: "CONFIRMED" }, decision_criteria: [] },
    stakeholders: [{ name: "Jordan", role_label: "Business champion", stance: "supportive", play: "Arm them with exec-legible business-risk framing.", evidence: "I'd like a working session." }],
    deal_intelligence: {
      deal_shape: "Expansion / land-and-expand", deal_shape_tags: ["expansion"], why_real: [], momentum: [{ id: "requested_next_step", label: "Customer asked for the next step", evidence: null, speaker: "Jordan" }],
      landmines: [{ id: "not_a_competition", label: "Do NOT frame this as a competitive replacement", evidence: null, speaker: "Maya" }], top_landmine: null,
      value_hypothesis: 'Frame value in their words: "explain business exposure sooner with evidence"', headline_metric: null, timing_driver: null, existing_footprint: true, exec_program: true
    },
    next_action: { primary_action: "Run a two-scenario working session", primary_action_type: "architecture_workshop", owner_lane: "technical", summary: "Run a scenario-design workshop.", success_criteria: ["Agree data sources and success criteria"], why_now: [], recommended_timing: null, evidence_ids: ["E1"] },
    workshop: { requested: true, format: "working session", scenarios: ["degraded engineering service", "suspicious identity activity"], data_sources: [], success_criteria: ["Agree data sources and success criteria"] },
    public_context: [],
    personalization: { profile_present: false, recipient_teasers: {} },
    provenance: { analysis_mode: "deterministic", message_source: "deterministic_fallback", limitations: [] }
  };
  return { ...base, ...over };
}

describe("generateRoleMessage — canonical content decision", () => {
  it("the recommended action is the canonical Next Best Action, not a generic gap action", () => {
    const rm = generateRoleMessage(makePacket(), "sales");
    expect(rm.action).toContain("Run a two-scenario working session");
    expect(rm.action).not.toMatch(/validate the executive sponsor/i);
  });

  it("sales and technical messages are materially different", () => {
    const p = makePacket();
    const sales = renderWebexMessage(generateRoleMessage(p, "sales"));
    const tech = renderWebexMessage(generateRoleMessage(p, "technical"));
    expect(sales).not.toEqual(tech);
    expect(sales).toContain("— commercial");
    expect(tech).toContain("— technical");
    // Champion is a commercial-only element; environment is technical-only.
    expect(sales).toContain("**Champion:**");
    expect(tech).not.toContain("**Champion:**");
    expect(tech).toContain("**Environment:**");
  });

  it("why-now is a concrete timing driver, else the customer-requested step — never a hedged impact quote", () => {
    const hedged = makePacket({ deal_intelligence: { ...makePacket().deal_intelligence, timing_driver: { label: "It may be a deadline becoming harder to meet", is_procurement: false } } });
    expect(generateRoleMessage(hedged, "sales").why_now).not.toMatch(/it may be|becoming harder/i);
    const real = makePacket({ deal_intelligence: { ...makePacket().deal_intelligence, timing_driver: { label: "Committee memo is due September 4", is_procurement: false } } });
    expect(generateRoleMessage(real, "sales").why_now).toContain("September 4");
  });

  it("does not fabricate goal personalization when no seller profile exists", () => {
    const rm = generateRoleMessage(makePacket(), "sales");
    expect(rm.goal_impact).toBeNull();
    expect(rm.goal_alignment).toBeNull();
    expect(renderWebexMessage(rm)).not.toContain("Goal impact");
  });

  it("surfaces the owner-only quota hook + named goals when a profile teaser exists", () => {
    const p = makePacket({ personalization: { profile_present: true, recipient_teasers: { sales: { why_you: "x", goal_alignment: "Supports: Expand observability", goal_impact: "$300K ≈ 25% of your annual target" }, technical: { why_you: "y", goal_alignment: "Supports: Expand observability", goal_impact: null } } } });
    const sales = renderWebexMessage(generateRoleMessage(p, "sales"));
    expect(sales).toContain("**Goal impact:** $300K ≈ 25% of your annual target");
    expect(sales).toContain("**Goal fit:** Expand observability");
    // Non-owner lane carries no quota hook.
    expect(renderWebexMessage(generateRoleMessage(p, "technical"))).not.toContain("Goal impact");
  });

  it("a non-actionable (suppress/hold) packet yields an honest no-action message", () => {
    const p = makePacket({ opportunity: { ...makePacket().opportunity, is_actionable: false }, next_action: { ...makePacket().next_action, primary_action: null, primary_action_type: "suppress" }, customer_evidence: { ...makePacket().customer_evidence, explicit_negations: ["we are not evaluating replacements"] } });
    const rm = generateRoleMessage(p, "sales");
    expect(rm.kind).toBe("no_action");
    expect(rm.action).toMatch(/no sales outreach/i);
    const md = renderWebexMessage(rm);
    expect(md).toContain("no action recommended");
    expect(md).toContain("Customer boundary");
  });

  it("every channel renders the SAME content decision (no re-interpretation)", () => {
    const rm = generateRoleMessage(makePacket(), "sales");
    const webex = renderWebexMessage(rm);
    const email = renderEmailMessage(rm);
    const teaser = renderInAppTeaser(rm);
    // The one action appears identically across channels.
    expect(webex).toContain(rm.action);
    expect(email.body).toContain(rm.action);
    expect(teaser.action).toBe(rm.action);
    expect(teaser.why_now).toBe(rm.why_now);
  });
});

describe("buildIntelligencePacket — customer/vendor separation (end-to-end)", () => {
  it("keeps vendor speakers out of the customer buying committee", async () => {
    clearCatalogCache();
    clearAccountsCache();
    const transcript = [
      "Rachel — Vendor, Account Executive",
      "Rachel: I cover Acme for our company. A possible path is to validate the platform.",
      "Dana — Customer, Director of Reliability",
      "Dana: I run reliability at Acme. Our incident correlation is broken; hundreds of engineers stall during outages. I'd like a scenario-design working session.",
      "Sam — Vendor, Solutions Engineer",
      "Sam: Splunk can derive relationships from telemetry and query data across environments; it provides security detections too."
    ].join("\n");
    const result = await runSignalAgent({ customTranscript: transcript });
    const packet = buildIntelligencePacket(result);
    const names = packet.stakeholders.map((s) => s.name.toLowerCase());
    expect(names).not.toContain("rachel");
    expect(names).not.toContain("sam");
  });
});
