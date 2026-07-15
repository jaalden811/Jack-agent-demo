import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enhanceWithCircuit } from "@/lib/signal-agent/aiEnhancement";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

vi.mock("@/lib/circuit/stages/stageA", () => ({ runStageA: vi.fn() }));
vi.mock("@/lib/circuit/stages/stageC", () => ({ runStageC: vi.fn() }));
import { runStageA } from "@/lib/circuit/stages/stageA";
import { runStageC } from "@/lib/circuit/stages/stageC";

/**
 * The Circuit AI-enhancement is ADDITIVE and gated: a no-op (no network)
 * when Circuit is unconfigured, so the deterministic pipeline is
 * unaffected. Runs Stages A+C only when configured + contract-confirmed.
 */

const ENV = ["AI_PROVIDER", "CIRCUIT_CLIENT_ID", "CIRCUIT_CLIENT_SECRET", "CIRCUIT_TOKEN_URL", "CIRCUIT_INFERENCE_URL", "CIRCUIT_MODEL", "CIRCUIT_APP_KEY", "CIRCUIT_CONTRACT_CONFIRMED"] as const;
const saved: Record<string, string | undefined> = {};

const result = { run_id: "r1", account_resolution: { name: "Acme" }, generic_diagnostics: { signals: { commercial: [], technical: [], ownership: [], next_steps: [] } }, transcript_meta: { raw_text: "" }, stakeholder_analysis: { participants: [], named_stakeholders: [], functional_owners: [] }, stakeholders: [], question_index: { answered: [], open: [], declined_or_sensitive: [], contradictory: [] }, matches: [], serpapi_signals: { signals: [] }, opportunity_scoring: {}, executive_summary: {}, meddpicc: undefined, next_best_action: { action_type: "hold" }, specialist_handoffs: {} } as unknown as SecureNetworkingTriageResult;

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  vi.mocked(runStageA).mockReset();
  vi.mocked(runStageC).mockReset();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks();
});

describe("enhanceWithCircuit gating", () => {
  it("is a no-op (no Circuit calls) when Circuit is not configured", async () => {
    const trace = await enhanceWithCircuit(result);
    expect(trace.enhanced).toBe(false);
    expect(trace.provider).toBe("circuit");
    expect(runStageA).not.toHaveBeenCalled();
    expect(runStageC).not.toHaveBeenCalled();
  });

  it("is a no-op when configured but the contract is NOT confirmed", async () => {
    process.env.AI_PROVIDER = "circuit";
    process.env.CIRCUIT_CLIENT_ID = "id";
    process.env.CIRCUIT_CLIENT_SECRET = "secret";
    process.env.CIRCUIT_TOKEN_URL = "https://t/token";
    process.env.CIRCUIT_INFERENCE_URL = "https://i/{model}";
    process.env.CIRCUIT_MODEL = "m";
    process.env.CIRCUIT_APP_KEY = "k";
    // CIRCUIT_CONTRACT_CONFIRMED intentionally unset.
    const trace = await enhanceWithCircuit(result);
    expect(trace.enhanced).toBe(false);
    expect(runStageA).not.toHaveBeenCalled();
  });

  it("runs Stages A+C when configured + confirmed, attaching safe trace + outputs", async () => {
    process.env.AI_PROVIDER = "circuit";
    process.env.CIRCUIT_CLIENT_ID = "id";
    process.env.CIRCUIT_CLIENT_SECRET = "secret";
    process.env.CIRCUIT_TOKEN_URL = "https://t/token";
    process.env.CIRCUIT_INFERENCE_URL = "https://i/{model}";
    process.env.CIRCUIT_MODEL = "m";
    process.env.CIRCUIT_APP_KEY = "k";
    process.env.CIRCUIT_CONTRACT_CONFIRMED = "true";
    vi.mocked(runStageA).mockResolvedValue({ output: { organization_candidates: [], speaker_classifications: [], customer_facts: [], customer_pain: [], customer_commitments: [], vendor_questions: [], vendor_recommendations: [], stakeholders: [], answered_questions: [], open_questions: [], contradictions: [] }, trace: { stage: "A", attempted: true, succeeded: true, model_configured: "m", model_returned: "google/m", duration_ms: 5, request_id: "r", schema_version: "1.0", repair_attempted: false, fallback_used: false, safe_error_code: null } });
    vi.mocked(runStageC).mockResolvedValue({ output: { facts: [], inferences: [], missing_information: [], meddpicc: {}, opportunity_thesis: "", deal_maturity_interpretation: "", product_role_narrative: [], risks: [], next_best_action: { action_type: "x", title: "", summary: "s", owner_role: "", timing_basis: "", success_criteria: [], evidence_ids: [] }, commercial_handoff: { summary: "c", key_points: [], remaining_questions: [], evidence_ids: [] }, technical_handoff: { summary: "t", key_points: [], remaining_questions: [], evidence_ids: [] }, do_not_reask: [], remaining_questions: [] }, trace: { stage: "C", attempted: true, succeeded: true, model_configured: "m", model_returned: "google/m", duration_ms: 5, request_id: "r", schema_version: "1.0", repair_attempted: false, fallback_used: false, safe_error_code: null } });
    const trace = await enhanceWithCircuit(result);
    expect(trace.enhanced).toBe(true);
    expect(trace.stages).toHaveLength(2);
    expect(trace.stage_a).not.toBeNull();
    expect(trace.stage_c).not.toBeNull();
    // Safe trace never carries a token/secret.
    expect(JSON.stringify(trace)).not.toContain("secret");
  });
});
