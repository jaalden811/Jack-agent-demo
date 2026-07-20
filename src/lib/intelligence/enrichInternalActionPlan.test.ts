import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntelligencePacket, InternalActionPlan } from "@/lib/intelligence/types";
import { buildInternalActionPlan } from "@/lib/intelligence/internalActionPlan";
import { enrichInternalActionPlan } from "@/lib/intelligence/enrichInternalActionPlan";

vi.mock("@/lib/circuit/client", () => ({ circuitGenerate: vi.fn() }));
import { circuitGenerate } from "@/lib/circuit/client";

function circuitOk(obj: unknown) {
  return { ok: true as const, text: JSON.stringify(obj), model: "google/test-model", finish_reason: "stop", usage: null, request_id: "rid", http_status: 200, duration_ms: 5, error: null };
}

const ENV = ["AI_PROVIDER", "CIRCUIT_CLIENT_ID", "CIRCUIT_CLIENT_SECRET", "CIRCUIT_TOKEN_URL", "CIRCUIT_INFERENCE_URL", "CIRCUIT_MODEL", "CIRCUIT_APP_KEY", "CIRCUIT_CONTRACT_CONFIRMED"] as const;
const saved: Record<string, string | undefined> = {};
function configure() {
  process.env.AI_PROVIDER = "circuit";
  process.env.CIRCUIT_CLIENT_ID = "id";
  process.env.CIRCUIT_CLIENT_SECRET = "secret";
  process.env.CIRCUIT_TOKEN_URL = "https://t.example/token";
  process.env.CIRCUIT_INFERENCE_URL = "https://i.example/openai/deployments/{model}/chat/completions";
  process.env.CIRCUIT_MODEL = "test-model";
  process.env.CIRCUIT_APP_KEY = "app-key";
  process.env.CIRCUIT_CONTRACT_CONFIRMED = "true";
}
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  vi.mocked(circuitGenerate).mockReset();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function makePacket(): IntelligencePacket {
  return {
    identity: { run_id: "r1", account: "Acme Retail", account_label: "Acme Retail", account_prose: "Acme Retail", account_resolved: true, account_confidence: 0.9, participant_count: 4 },
    owners: { sales: { name: "Bella Robinson", role: "Sales / Commercial owner" }, technical: { name: "Jack Alden", role: "Technical / Specialist owner" } },
    executive_trigger: null,
    opportunity: { verdict: "REVIEW", signal_strength: 72, signal_band: "HIGH", pursuit_decision: "PURSUE_WITH_DISCOVERY", pursuit_score: 72, pursuit_confidence: 0.8, deal_maturity: "SOLUTION_DISCOVERY", primary_opportunity: "observability", primary_solution_motion: "Splunk ITSI", is_actionable: true, matched_category_ids: [] },
    customer_evidence: { pains: [], business_impacts: [{ statement: "incident investigation takes three hours", speaker: null, evidence_ids: [] }], objections: [], explicit_negations: [], do_not_reask: [] },
    qualification: { meddpicc: { economic_buyer: "CONFIRMED" }, decision_criteria: [] },
    current_environment: ["ServiceNow", "CrowdStrike"],
    stakeholders: [{ name: "Jordan", role_label: "Business champion", stance: "supportive", play: "Arm them.", evidence: null }],
    deal_intelligence: { deal_shape: "Expansion", deal_shape_tags: [], why_real: [], momentum: [], landmines: [], top_landmine: null, value_hypothesis: null, headline_metric: null, timing_driver: null, existing_footprint: true, exec_program: false },
    next_action: { primary_action: "Run a validation workshop", primary_action_type: "architecture_workshop", owner_lane: "technical", summary: "Workshop.", success_criteria: [], why_now: [], recommended_timing: null, evidence_ids: [] },
    workshop: { requested: true, format: "working session", scenarios: ["identity correlation"], data_sources: ["telemetry"], success_criteria: [] },
    public_context: [],
    personalization: { profile_present: false, goal_ids_by_lane: {}, profile_source_by_lane: {}, recipient_teasers: {} },
    provenance: { analysis_mode: "deterministic", message_source: "deterministic_fallback", limitations: [] }
  };
}

function deterministicPlan(): InternalActionPlan {
  return buildInternalActionPlan(makePacket(), "sales")!;
}

describe("enrichInternalActionPlan", () => {
  it("returns the deterministic plan unchanged (source deterministic) when Circuit is not configured", async () => {
    for (const k of ENV) delete process.env[k];
    const det = deterministicPlan();
    const out = await enrichInternalActionPlan(det, makePacket());
    expect(out.source).toBe("deterministic");
    expect(out.your_move).toBe(det.your_move);
    expect(out.coordinate_with).toEqual(det.coordinate_with);
    expect(out.suggested_coordination).toBeUndefined();
    expect(circuitGenerate).not.toHaveBeenCalled();
  });

  it("merges Circuit's deal-specific why/prepare + advisory suggestions, preserving owners/lanes", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      your_move: "Align with Jack on whether CrowdStrike + ServiceNow telemetry can be correlated before booking the workshop.",
      coordinate_with: [
        { lane: "technical", why: "The customer needs identity correlation validated across CrowdStrike and ServiceNow.", prepare: ["Confirm ServiceNow ticket-creation integration", "Test identity correlation feasibility"] }
      ],
      suggested_coordination: [
        { role: "Legal / Contract Specialist", why: "Data-processing terms will gate the pilot.", trigger: "Customer raised data-handling constraints." }
      ]
    }));
    const det = deterministicPlan();
    const out = await enrichInternalActionPlan(det, makePacket());
    expect(out.source).toBe("circuit");
    // Deal-specific narrative applied.
    expect(out.your_move).toMatch(/CrowdStrike|ServiceNow/);
    const tech = out.coordinate_with.find((c) => c.lane === "technical")!;
    expect(tech.name).toBe("Jack Alden"); // owner identity preserved (authoritative)
    expect(tech.why).toMatch(/identity correlation/i);
    expect(tech.prepare).toContain("Confirm ServiceNow ticket-creation integration");
    // Advisory suggestion surfaced (role-only, from the allow-list).
    expect(out.suggested_coordination?.[0].role).toBe("Legal / Contract Specialist");
  });

  it("rejects an invented internal owner lane and falls back to deterministic", async () => {
    configure();
    // 'finance' is not one of the fixed partner lanes → invalid both times → fallback.
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      your_move: "Loop in everyone.",
      coordinate_with: [{ lane: "finance", why: "invented", prepare: ["x"] }]
    }));
    const det = deterministicPlan();
    const out = await enrichInternalActionPlan(det, makePacket());
    expect(out.source).toBe("deterministic");
    expect(out.coordinate_with).toEqual(det.coordinate_with);
  });

  it("cannot elevate a conditional funding-gate step to required, add a named internal owner, or change timing", async () => {
    configure();
    const distributed = { ...makePacket(), qualification: { meddpicc: { economic_buyer: "DISTRIBUTED" }, decision_criteria: [] } };
    const det = buildInternalActionPlan(distributed, "sales")!;
    expect(det.coordinate_with.find((c) => c.lane === "executive")!.requirement).toBe("conditional");
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      coordinate_with: [
        { lane: "technical", why: "Validate correlation feasibility.", prepare: ["Confirm integrations"] },
        { lane: "executive", why: "Escalate to leadership immediately to unblock funding now.", prepare: ["brief the VP"] }
      ]
    }));
    const out = await enrichInternalActionPlan(det, distributed);
    const afterExec = out.coordinate_with.find((c) => c.lane === "executive")!;
    // Timing/requirement/trigger stay deterministic; owner stays a role-only slot.
    expect(afterExec.requirement).toBe("conditional");
    expect(afterExec.timing).toBe("at_funding_gate");
    expect(afterExec.trigger_code).toBe("COMMITTEE_FUNDING_GATE");
    expect(afterExec.name).toBeNull();
  });

  it("drops a suggested role that is not in the allow-list", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      coordinate_with: [{ lane: "technical", why: "Validate correlation.", prepare: ["Confirm integration"] }],
      suggested_coordination: [{ role: "Chief Vibes Officer", why: "nope", trigger: "nope" }]
    }));
    const det = deterministicPlan();
    const out = await enrichInternalActionPlan(det, makePacket());
    // The invented role fails validation → repair → fallback (deterministic).
    expect(out.source).toBe("deterministic");
  });
});
