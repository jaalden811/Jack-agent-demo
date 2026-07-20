import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractJsonObject } from "@/lib/circuit/stages/jsonParser";
import { invalidEvidenceIds, invalidUrls, collectEvidenceIdReferences } from "@/lib/circuit/stages/evidenceValidator";
import { stageASchema, runStageA, allowedStageAEvidenceIds, type StageAInput, type StageAOutput } from "@/lib/circuit/stages/stageA";
import { stageBSchema, runStageB, allowedStageBUrls, type StageBInput, type StageBOutput } from "@/lib/circuit/stages/stageB";
import { runStageC, type StageCInput, type StageCOutput } from "@/lib/circuit/stages/stageC";
import { runStageD, type StageDInput, type StageDOutput } from "@/lib/circuit/stages/stageD";

vi.mock("@/lib/circuit/client", () => ({ circuitGenerate: vi.fn() }));
import { circuitGenerate } from "@/lib/circuit/client";

function circuitOk(obj: unknown) {
  return { ok: true as const, text: JSON.stringify(obj), model: "google/test-model", finish_reason: "stop", usage: null, request_id: "rid", http_status: 200, duration_ms: 5, error: null };
}

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

const stageBDeterministic: StageBOutput = {
  classified_sources: [{ source_id: "s1", entity_match: 0.9, source_authority: 0.9, transcript_relevance: 0.6, signal_category: "strategic_objective", public_fact: "official site", implication: "", limitation: "public only", account_context_eligible: true, narrative_eligible: true, scoring_eligible: false, supports: [], contradicts: [], evidence_ids: ["s1"] }],
  distilled_signals: [],
  rejected_sources: [{ source_id: "s2", reason: "irrelevant" }]
};

const stageBInput: StageBInput = {
  run_id: "run_1",
  account: "Meridian",
  sources: [
    { source_id: "s1", title: "Meridian site", url: "https://meridian.com/about", domain: "meridian.com", snippet: "official", account_candidate: "Meridian" },
    { source_id: "s2", title: "Unrelated", url: "https://blog.example.com/x", domain: "blog.example.com", snippet: "noise" }
  ],
  deterministic: stageBDeterministic
};

describe("Stage B schema tolerance + integrity", () => {
  it("accepts alias fields and coerces score/list types", () => {
    const raw = {
      classified_sources: [{ id: "s1", entityMatch: 90, authority: 0.8, relevance: 0.7, category: "strategic_objective", fact: "x", implication: "y", limitation: "z", accountContextEligible: true, narrativeEligible: true, scoringEligible: false, supports: "a, b", contradicts: [], evidence: ["s1"] }],
      distilled_signals: [],
      rejected_sources: [{ id: "s2", reason: "noise" }]
    };
    const parsed = stageBSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.classified_sources[0].source_id).toBe("s1");
      expect(parsed.data.classified_sources[0].entity_match).toBeLessThanOrEqual(1);
      expect(parsed.data.classified_sources[0].supports).toEqual(["a", "b"]);
      expect(parsed.data.rejected_sources[0].source_id).toBe("s2");
    }
  });
});

describe("runStageB", () => {
  it("returns Circuit output when valid (no invented URLs / source ids)", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      classified_sources: [{ source_id: "s1", entity_match: 0.9, source_authority: 0.9, transcript_relevance: 0.6, signal_category: "strategic_objective", public_fact: "official site", implication: "", limitation: "public only", account_context_eligible: true, narrative_eligible: true, scoring_eligible: false, supports: [], contradicts: [], evidence_ids: ["s1"] }],
      distilled_signals: [],
      rejected_sources: [{ source_id: "s2", reason: "irrelevant" }]
    }));
    const { output, trace } = await runStageB(stageBInput);
    expect(trace.succeeded).toBe(true);
    expect(trace.fallback_used).toBe(false);
    expect(output.classified_sources[0].source_id).toBe("s1");
  });

  it("rejects an invented URL -> repair -> deterministic fallback", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      classified_sources: [{ source_id: "s1", entity_match: 0.9, source_authority: 0.9, transcript_relevance: 0.6, signal_category: "x", public_fact: "see https://invented-source.com/page", implication: "", limitation: "", account_context_eligible: true, narrative_eligible: false, scoring_eligible: false, supports: [], contradicts: [], evidence_ids: ["s1"] }],
      distilled_signals: [],
      rejected_sources: []
    }));
    const { output, trace } = await runStageB(stageBInput);
    expect(trace.repair_attempted).toBe(true);
    expect(trace.fallback_used).toBe(true);
    expect(output).toEqual(stageBDeterministic);
  });

  it("rejects a referenced source_id not in input", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      classified_sources: [{ source_id: "NOT_A_SOURCE", entity_match: 0.5, source_authority: 0.5, transcript_relevance: 0.5, signal_category: "x", public_fact: "y", implication: "", limitation: "", account_context_eligible: true, narrative_eligible: false, scoring_eligible: false, supports: [], contradicts: [], evidence_ids: [] }],
      distilled_signals: [],
      rejected_sources: []
    }));
    const { trace } = await runStageB(stageBInput);
    expect(trace.fallback_used).toBe(true);
  });

  it("allowedStageBUrls collects the input source URLs", () => {
    expect(allowedStageBUrls(stageBInput).has("https://meridian.com/about")).toBe(true);
  });
});

const stageCDeterministic: StageCOutput = {
  facts: [{ statement: "det fact", evidence_ids: ["gs_1"] }],
  inferences: [],
  missing_information: ["what is the budget authority?"],
  meddpicc: { identify_pain: { status: "CONFIRMED", summary: "pain", evidence_ids: ["gs_1"], next_question: "" } },
  opportunity_thesis: "thesis",
  deal_maturity_interpretation: "SOLUTION_DISCOVERY",
  product_role_narrative: [],
  risks: [],
  next_best_action: { action_type: "architecture_workshop", title: "Run workshop", summary: "Lead a scenario workshop with the customer to validate two scenarios.", owner_role: "technical", timing_basis: "customer_commitment", success_criteria: ["criteria agreed"], evidence_ids: ["gs_1"] },
  commercial_handoff: { summary: "commercial brief", key_points: ["impact"], remaining_questions: ["budget?"], evidence_ids: [] },
  technical_handoff: { summary: "technical brief", key_points: ["environment"], remaining_questions: ["data sources?"], evidence_ids: [] },
  do_not_reask: ["current environment"],
  remaining_questions: ["what is the budget authority?"]
};

const stageCInput: StageCInput = {
  run_id: "run_1",
  account: "Meridian",
  existing_scores: { signal_strength: 60, qualification: 40, external_fit: null, pursuit_decision: "PURSUE_WITH_DISCOVERY", deal_maturity: "SOLUTION_DISCOVERY" },
  stage_a_summary: null,
  stage_b_summary: null,
  evidence: [{ evidence_id: "gs_1", text: "the environment is complex" }],
  taxonomy_candidates: ["observability"],
  deterministic: stageCDeterministic
};

describe("runStageC", () => {
  it("returns Circuit output when valid; scores are never part of the output", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      facts: [{ statement: "circuit fact", evidence_ids: ["gs_1"] }],
      inferences: [],
      missing_information: ["x"],
      meddpicc: { identify_pain: { status: "CONFIRMED", summary: "pain", evidence_ids: ["gs_1"], next_question: "" } },
      opportunity_thesis: "circuit thesis",
      deal_maturity_interpretation: "SOLUTION_DISCOVERY",
      product_role_narrative: [],
      risks: [],
      next_best_action: { action_type: "architecture_workshop", title: "t", summary: "Lead a specific scenario workshop with named participants.", owner_role: "technical", timing_basis: "customer_commitment", success_criteria: ["c"], evidence_ids: ["gs_1"] },
      commercial_handoff: { summary: "commercial", key_points: [], remaining_questions: [], evidence_ids: [] },
      technical_handoff: { summary: "technical", key_points: [], remaining_questions: [], evidence_ids: [] },
      do_not_reask: [],
      remaining_questions: []
    }));
    const { output, trace } = await runStageC(stageCInput);
    expect(trace.succeeded).toBe(true);
    expect(output.opportunity_thesis).toBe("circuit thesis");
    // Scores are never in the Stage C output shape (deterministic-only).
    expect(output as unknown as Record<string, unknown>).not.toHaveProperty("existing_scores");
    expect(output as unknown as Record<string, unknown>).not.toHaveProperty("pursuit_decision");
  });

  it("rejects invented evidence ids -> repair -> deterministic fallback", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({ ...stageCDeterministic, facts: [{ statement: "x", evidence_ids: ["INVENTED"] }] }));
    const { output, trace } = await runStageC(stageCInput);
    expect(trace.fallback_used).toBe(true);
    expect(output).toEqual(stageCDeterministic);
  });

  it("rejects identical commercial and technical handoffs", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      ...stageCDeterministic,
      commercial_handoff: { summary: "same", key_points: [], remaining_questions: [], evidence_ids: [] },
      technical_handoff: { summary: "same", key_points: [], remaining_questions: [], evidence_ids: [] }
    }));
    const { trace } = await runStageC(stageCInput);
    expect(trace.fallback_used).toBe(true);
  });
});

const stageDDeterministic: StageDOutput = {
  sales_webex: "**Commercial action — Meridian**\n\nCommercial brief and next action.",
  technical_webex: "**Technical action — Meridian**\n\nTechnical brief and workshop plan.",
  sales_email: { subject: "Commercial action — Meridian", body: "commercial" },
  technical_email: { subject: "Technical action — Meridian", body: "technical" }
};

const stageDInput: StageDInput = {
  run_id: "run_1",
  account: "Meridian",
  channel_byte_budget: 6400,
  allowed_urls: ["https://meridian.com/about"],
  brief: {
    opportunity_thesis: "A credible opportunity centered on unified operations.",
    why_now: ["Board approved a $1.4M budget", "Renewal window in Q3", "Purchase intent this quarter"],
    meddpicc_lines: ["EB — Confirmed: CIO owns the budget", "DC — Partial: pilot metrics"],
    stakeholder_lines: ["CIO — executive sponsor"],
    top_risks: ["Economic buyer not yet confirmed"],
    do_not_reask: ["current environment"],
    timing: "Purchase intent this quarter; renewal in Q3",
    sales_lane: {
      role_label: "Commercial / Sales owner",
      why_selected: "You own the commercial lane for Meridian.",
      collaborator: "Technical / Specialist owner (paired technical lane)",
      actions: ["Validate the budget owner", "Anchor the business case", "Map the procurement path"],
      remaining_questions: ["Confirm procurement steps"],
      expected_output: "A confirmed commercial next step."
    },
    technical_lane: {
      role_label: "Technical / Specialist owner",
      why_selected: "You own the technical lane for Meridian.",
      collaborator: "Commercial / Sales owner (paired commercial lane)",
      actions: ["Define the target architecture", "Scope a proof-of-value", "Confirm integrations"],
      remaining_questions: ["Confirm data sources"],
      expected_output: "A scoped technical validation."
    }
  },
  deterministic: stageDDeterministic
};

describe("runStageD", () => {
  it("returns distinct Circuit messages using the canonical account + required sections", async () => {
    configure();
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      sales_webex: "**Account:** Meridian\n**Why you:** Commercial owner.\n**Why now:** Budget approved this quarter.\n**Your move (internal):** Align with the technical owner before the customer review.\n**Loop in the technical owner:** They shape the validation. Ask them to prepare: architecture boundaries.\n**Customer next step:** Book the executive business review.\n**Expected outcome:** A confirmed owner and next step.",
      technical_webex: "**Account:** Meridian\n**Why you:** Technical owner.\n**Why now:** Customer requested a scoped proof-of-value.\n**Your move (internal):** Define the validation architecture and sync with the commercial owner.\n**Loop in the commercial owner:** They own commercial progression. Ask them to prepare: the business case.\n**Customer next step:** Scope a proof-of-value with success criteria.\n**Expected outcome:** Validated architecture and data sources.",
      sales_email: { subject: "Commercial — Meridian", body: "b" },
      technical_email: { subject: "Technical — Meridian", body: "b" }
    }));
    const { output, trace } = await runStageD(stageDInput);
    expect(trace.succeeded).toBe(true);
    expect(output.sales_webex).not.toEqual(output.technical_webex);
    expect(output.sales_webex).toContain("Meridian");
    expect(output.sales_webex.toLowerCase()).toContain("customer next step");
    expect(output.sales_webex.toLowerCase()).toContain("your move");
    expect(output.technical_webex.toLowerCase()).toContain("why now");
  });

  it("rejects identical messages / missing account / invented URL / ellipsis -> fallback", async () => {
    configure();
    // Identical + missing account + invented URL + ellipsis all violate.
    vi.mocked(circuitGenerate).mockResolvedValue(circuitOk({
      sales_webex: "Same message with https://invented.com and an ellipsis…",
      technical_webex: "Same message with https://invented.com and an ellipsis…",
      sales_email: { subject: "s", body: "b" },
      technical_email: { subject: "t", body: "b" }
    }));
    const { output, trace } = await runStageD(stageDInput);
    expect(trace.fallback_used).toBe(true);
    expect(output).toEqual(stageDDeterministic);
  });
});
