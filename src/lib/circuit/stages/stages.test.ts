import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractJsonObject } from "@/lib/circuit/stages/jsonParser";
import { invalidEvidenceIds, invalidUrls, collectEvidenceIdReferences } from "@/lib/circuit/stages/evidenceValidator";
import { stageASchema, runStageA, allowedStageAEvidenceIds, type StageAInput, type StageAOutput } from "@/lib/circuit/stages/stageA";

vi.mock("@/lib/circuit/client", () => ({ circuitGenerate: vi.fn() }));
import { circuitGenerate } from "@/lib/circuit/client";

/**
 * Shared stage runner + Stage A coverage (Phases 1-2). No live Circuit —
 * circuitGenerate is mocked. Verifies JSON parsing, evidence integrity,
 * schema tolerance, one-repair, and deterministic fallback.
 */

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

const deterministic: StageAOutput = {
  organization_candidates: [{ name: "Meridian", confidence: 0.8, evidence_ids: [] }],
  speaker_classifications: [{ speaker: "Jordan", side: "customer", rationale: "", evidence_ids: [] }],
  customer_facts: [{ statement: "det fact", evidence_ids: ["gs_1"] }],
  customer_pain: [],
  customer_commitments: [],
  vendor_questions: [],
  vendor_recommendations: [],
  stakeholders: [{ name: "Jordan", role: "Lead", side: "customer", evidence_ids: [] }],
  answered_questions: [],
  open_questions: [],
  contradictions: []
};

const input: StageAInput = {
  run_id: "run_1",
  transcript_hash: "hash",
  transcript_turns: [{ id: "t0", speaker: "Jordan", side_hint: "customer", text: "our environment is complex" }],
  account_candidates: [{ name: "Meridian", confidence: 0.8 }],
  evidence: [{ evidence_id: "gs_1", text: "det fact", category: "current_environment" }],
  deterministic
};

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  vi.mocked(circuitGenerate).mockReset();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("extractJsonObject", () => {
  it("parses pure JSON, fenced JSON, and JSON embedded in prose", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('Here you go: {"a":3} thanks')).toEqual({ a: 3 });
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("evidence integrity", () => {
  it("flags invented evidence ids and URLs", () => {
    const out = { customer_facts: [{ statement: "x", evidence_ids: ["gs_1", "made_up"] }], public: [{ url: "https://real.com" }, { url: "https://invented.com" }] };
    expect(collectEvidenceIdReferences(out)).toContain("made_up");
    expect(invalidEvidenceIds(out, ["gs_1"])).toEqual(["made_up"]);
    expect(invalidUrls(out, ["https://real.com"])).toEqual(["https://invented.com"]);
  });
});

describe("Stage A schema tolerance", () => {
  it("accepts alias field names ({name,type} -> speaker/side) and coerces evidence_ids", () => {
    const raw = {
      organization_candidates: [{ organization: "Meridian", confidence: 80, evidence_ids: "t0" }],
      speaker_classifications: [{ name: "Jordan", type: "customer", evidence_ids: ["t0"] }],
      customer_facts: [{ text: "a fact", evidence: ["gs_1"] }],
      customer_pain: [],
      customer_commitments: [],
      vendor_questions: [],
      vendor_recommendations: [],
      stakeholders: [{ name: "Jordan", title: "Lead", evidence_ids: [] }],
      answered_questions: [],
      open_questions: [],
      contradictions: []
    };
    const parsed = stageASchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.organization_candidates[0].confidence).toBeLessThanOrEqual(1);
      expect(parsed.data.speaker_classifications[0].speaker).toBe("Jordan");
      expect(parsed.data.speaker_classifications[0].side).toBe("customer");
      expect(parsed.data.customer_facts[0].statement).toBe("a fact");
    }
  });
});

describe("runStageA", () => {
  it("returns the Circuit output when the call + validation succeed", async () => {
    configure();
    const modelOutput = {
      organization_candidates: [{ name: "Meridian", confidence: 0.9, evidence_ids: ["t0"] }],
      speaker_classifications: [{ speaker: "Jordan", side: "customer", evidence_ids: ["t0"] }],
      customer_facts: [{ statement: "our environment is complex", evidence_ids: ["t0"] }],
      customer_pain: [], customer_commitments: [], vendor_questions: [], vendor_recommendations: [],
      stakeholders: [], answered_questions: [], open_questions: [], contradictions: []
    };
    vi.mocked(circuitGenerate).mockResolvedValue({ ok: true, text: JSON.stringify(modelOutput), model: "google/test-model", finish_reason: "stop", usage: null, request_id: "rid", http_status: 200, duration_ms: 5, error: null });
    const { output, trace } = await runStageA(input);
    expect(trace.succeeded).toBe(true);
    expect(trace.fallback_used).toBe(false);
    expect(trace.model_returned).toBe("google/test-model");
    expect(output.customer_facts[0].statement).toContain("environment");
  });

  it("rejects invented evidence ids -> repair -> deterministic fallback", async () => {
    configure();
    const bad = { ...deterministic, customer_facts: [{ statement: "x", evidence_ids: ["INVENTED"] }] };
    vi.mocked(circuitGenerate).mockResolvedValue({ ok: true, text: JSON.stringify(bad), model: "google/test-model", finish_reason: "stop", usage: null, request_id: "rid", http_status: 200, duration_ms: 5, error: null });
    const { output, trace } = await runStageA(input);
    expect(trace.repair_attempted).toBe(true);
    expect(trace.fallback_used).toBe(true);
    expect(trace.safe_error_code).toBe("CIRCUIT_SCHEMA_VALIDATION_FAILED");
    // Fallback = deterministic output.
    expect(output.customer_facts[0].statement).toBe("det fact");
  });

  it("falls back deterministically (no repair) when Circuit errors", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue({ ok: false, text: null, model: null, finish_reason: null, usage: null, request_id: null, http_status: 500, duration_ms: 5, error: { code: "CIRCUIT_SERVER_ERROR", message: "server", retryable: true, http_status: 500, request_id: null } });
    const { output, trace } = await runStageA(input);
    expect(trace.fallback_used).toBe(true);
    expect(trace.repair_attempted).toBe(false);
    expect(trace.safe_error_code).toBe("CIRCUIT_SERVER_ERROR");
    expect(output).toEqual(deterministic);
  });

  it("allowedStageAEvidenceIds includes turn ids + evidence ids", () => {
    const ids = allowedStageAEvidenceIds(input);
    expect(ids.has("t0")).toBe(true);
    expect(ids.has("gs_1")).toBe(true);
  });
});
