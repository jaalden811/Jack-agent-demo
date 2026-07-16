import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enhanceWithCircuit } from "@/lib/signal-agent/aiEnhancement";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

vi.mock("@/lib/circuit/stages/stageA", () => ({ runStageA: vi.fn() }));
vi.mock("@/lib/circuit/stages/stageB", () => ({ runStageB: vi.fn() }));
vi.mock("@/lib/circuit/stages/stageC", () => ({ runStageC: vi.fn() }));
vi.mock("@/lib/circuit/stages/stageD", () => ({ runStageD: vi.fn() }));
// The Stage D adapter builds the deterministic brief from the full result; this
// test uses a minimal fixture and exercises stage orchestration only, so the
// adapter is stubbed (its correctness is covered by stages/automation tests).
vi.mock("@/lib/circuit/stages/stageDAdapter", () => ({
  buildStageDInput: vi.fn(() => ({
    run_id: "r1",
    account: "Acme",
    channel_byte_budget: 6400,
    allowed_urls: [],
    brief: { opportunity_thesis: "", why_now: [], meddpicc_lines: [], stakeholder_lines: [], sales_actions: [], technical_actions: [], top_risks: [], do_not_reask: [] },
    deterministic: { sales_webex: "", technical_webex: "", sales_email: { subject: "", body: "" }, technical_email: { subject: "", body: "" } }
  }))
}));
import { runStageA } from "@/lib/circuit/stages/stageA";
import { runStageB } from "@/lib/circuit/stages/stageB";
import { runStageC } from "@/lib/circuit/stages/stageC";
import { runStageD } from "@/lib/circuit/stages/stageD";

const stageDOk = {
  output: {
    sales_webex: "Commercial action — Acme",
    technical_webex: "Technical action — Acme",
    sales_email: { subject: "Commercial action — Acme", body: "Commercial action — Acme" },
    technical_email: { subject: "Technical action — Acme", body: "Technical action — Acme" }
  },
  trace: { stage: "D" as const, attempted: true, succeeded: true, model_configured: "m", model_returned: "google/m", duration_ms: 5, request_id: "r", schema_version: "1.0", repair_attempted: false, fallback_used: false, safe_error_code: null }
};

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
  vi.mocked(runStageB).mockReset();
  vi.mocked(runStageC).mockReset();
  vi.mocked(runStageD).mockReset();
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
    expect(trace.stage_d).toBeNull();
    expect(runStageA).not.toHaveBeenCalled();
    expect(runStageC).not.toHaveBeenCalled();
    expect(runStageD).not.toHaveBeenCalled();
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

  it("runs Stages A+C+D when configured + confirmed, attaching safe trace + outputs", async () => {
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
    vi.mocked(runStageD).mockResolvedValue(stageDOk);
    const trace = await enhanceWithCircuit(result);
    expect(trace.enhanced).toBe(true);
    // No public sources on this result -> Stage B is skipped (A + C + D).
    expect(trace.stages).toHaveLength(3);
    expect(trace.stage_a).not.toBeNull();
    expect(trace.stage_b).toBeNull();
    expect(trace.stage_c).not.toBeNull();
    expect(trace.stage_d).not.toBeNull();
    expect(runStageB).not.toHaveBeenCalled();
    expect(runStageD).toHaveBeenCalledTimes(1);
    // Safe trace never carries a token/secret.
    expect(JSON.stringify(trace)).not.toContain("secret");
  });

  it("runs Stage B too when public sources exist (A + B + C)", async () => {
    process.env.AI_PROVIDER = "circuit";
    process.env.CIRCUIT_CLIENT_ID = "id";
    process.env.CIRCUIT_CLIENT_SECRET = "secret";
    process.env.CIRCUIT_TOKEN_URL = "https://t/token";
    process.env.CIRCUIT_INFERENCE_URL = "https://i/{model}";
    process.env.CIRCUIT_MODEL = "m";
    process.env.CIRCUIT_APP_KEY = "k";
    process.env.CIRCUIT_CONTRACT_CONFIRMED = "true";
    const withSources = { ...result, serpapi_signals: { signals: [{ signal_id: "sig1", source_url: "https://x.com", source_title: "t", source_domain: "x.com", claim: "c", account_name: "Acme", category: "strategic_objective", subcategory: "s", published_at: null, source_authority: 0.9, entity_match: 0.9, recency: 0.5, transcript_relevance: 0.6, signal_strength: 0.7, confidence: 0.7, evidence_class: "probable_public_signal", account_context_eligible: true, narrative_eligible: true, scoring_eligible: false, rejection_reasons: [], supports: [], limitations: [], corroborating_urls: [] }] } } as unknown as SecureNetworkingTriageResult;
    const okA = { output: { organization_candidates: [], speaker_classifications: [], customer_facts: [], customer_pain: [], customer_commitments: [], vendor_questions: [], vendor_recommendations: [], stakeholders: [], answered_questions: [], open_questions: [], contradictions: [] }, trace: { stage: "A" as const, attempted: true, succeeded: true, model_configured: "m", model_returned: "google/m", duration_ms: 5, request_id: "r", schema_version: "1.0", repair_attempted: false, fallback_used: false, safe_error_code: null } };
    vi.mocked(runStageA).mockResolvedValue(okA);
    vi.mocked(runStageB).mockResolvedValue({ output: { classified_sources: [], distilled_signals: [], rejected_sources: [] }, trace: { stage: "B", attempted: true, succeeded: true, model_configured: "m", model_returned: "google/m", duration_ms: 5, request_id: "r", schema_version: "1.0", repair_attempted: false, fallback_used: false, safe_error_code: null } });
    vi.mocked(runStageC).mockResolvedValue({ output: { facts: [], inferences: [], missing_information: [], meddpicc: {}, opportunity_thesis: "", deal_maturity_interpretation: "", product_role_narrative: [], risks: [], next_best_action: { action_type: "x", title: "", summary: "s", owner_role: "", timing_basis: "", success_criteria: [], evidence_ids: [] }, commercial_handoff: { summary: "c", key_points: [], remaining_questions: [], evidence_ids: [] }, technical_handoff: { summary: "t", key_points: [], remaining_questions: [], evidence_ids: [] }, do_not_reask: [], remaining_questions: [] }, trace: { stage: "C", attempted: true, succeeded: true, model_configured: "m", model_returned: "google/m", duration_ms: 5, request_id: "r", schema_version: "1.0", repair_attempted: false, fallback_used: false, safe_error_code: null } });
    vi.mocked(runStageD).mockResolvedValue(stageDOk);
    const trace = await enhanceWithCircuit(withSources);
    expect(runStageB).toHaveBeenCalledTimes(1);
    // A + B + C + D
    expect(trace.stages).toHaveLength(4);
    expect(trace.stage_b).not.toBeNull();
    expect(trace.stage_d).not.toBeNull();
  });
});
