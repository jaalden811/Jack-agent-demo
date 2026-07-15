import { describe, expect, it } from "vitest";
import { buildLaneRouting, classifyLifecycle, detectSignalTypes, loadRoutingConfig, getRoutingConfigPath, getRecipientEmail } from "@/lib/webex/peachtreeRouting";
import { buildDefaultAccountResolution, buildDefaultAiProcessing, buildDefaultMeddpicc, buildDefaultPublicEnrichment } from "@/lib/qualification/defaults";
import { buildDefaultOpportunityScoring, buildDefaultSerpApiSignals } from "@/lib/opportunity-fit/defaults";
import type { SecureNetworkingTriageResult, MatchOutput } from "@/lib/signal-agent/types";

/** Minimal, type-valid fixture builder — lets each test override only the
 * fields that matter to routing/lifecycle logic, without hand-rolling the
 * entire (large) SecureNetworkingTriageResult shape every time. */
function buildResult(overrides: {
  verdict?: "HIGH_INTENT" | "REVIEW" | "NOISE";
  businessProblem?: string;
  businessImpact?: string;
  matchedKeywords?: string[];
  matchedText?: string[];
  budget?: string | null;
  timeline?: string | null;
  renewalEvents?: string[];
  recommendedSolutions?: string[];
}): SecureNetworkingTriageResult {
  const match: MatchOutput = {
    entry_id: "test_entry",
    pain_category: "Test category",
    domain: "Networking",
    confidence: 0.8,
    rank: 1,
    relationship: "primary",
    matched_text: overrides.matchedText ?? [],
    matched_keywords: overrides.matchedKeywords ?? [],
    semantic_evidence: [],
    intent_evidence: [],
    corroboration: [],
    negative_cues: [],
    recommended_solutions: overrides.recommendedSolutions ?? [],
    recommended_specialist: null,
    solution_decision: {
      recommended: [],
      supporting_products: [],
      retained_existing_platforms: [],
      choose_when_evidence: [],
      do_not_choose_conflicts: [],
      adjacent_solutions_considered: []
    },
    score_breakdown: {
      keyword_score: 0,
      keyword_weight: 0,
      semantic_score: 0,
      semantic_weight: 0,
      intent_score: 0,
      intent_weight: 0,
      structured_account_score: 0,
      structured_account_weight: 0,
      penalty: 0,
      final: 0.8
    }
  };

  return {
    use_case: "secure_networking_deal_signal_triage",
    executive_summary: {
      verdict: overrides.verdict ?? "HIGH_INTENT",
      confidence: 0.8,
      account: "Test Account",
      business_problem: overrides.businessProblem ?? "",
      business_impact: overrides.businessImpact ?? "",
      urgency: "",
      primary_opportunity: "Test category",
      secondary_opportunities: [],
      recommended_next_action: ""
    },
    stakeholders: [],
    stakeholder_analysis: { participants: [], named_stakeholders: [], functional_owners: [] },
    commercial_signals: {
      budget: overrides.budget ?? null,
      timeline: overrides.timeline ?? null,
      renewal_events: overrides.renewalEvents ?? [],
      quantified_impact: [],
      evaluation_stage: null,
      purchase_language: []
    },
    matches: [match],
    solution_architecture: [],
    recommended_specialists: [],
    discovery_questions: [],
    internal_brief: "",
    notification_text: null,
    providers: { embeddings_used: false, synthesis_used: false, fallback_reason: null, semantic_mode: "fallback", analysis_mode: "deterministic" },
    reference_pack: {
      taxonomy_file: "",
      taxonomy_version: "1.0",
      taxonomy_as_of: null,
      taxonomy_scope: null,
      category_count: 0,
      final_formula: null,
      multi_label_policy: null,
      notification_gates: { high_intent: null, review: null, noise: null },
      report_file: "",
      report_loaded: true
    },
    corroboration_summary: {
      transcript_score: 0,
      structured_account_score: 0,
      combined_score: 0,
      transcript_signals: [],
      structured_signals: [],
      structured_account_available: false
    },
    public_signals: [],
    audit: { logged: false, path: "", warning: null },
    transcript_meta: { title: null, account: "Test Account", participant_count: 1, sentence_count: 1, raw_text: "" },
    timestamp: new Date().toISOString(),
    run_id: "test-run-id",
    account_resolution: { ...buildDefaultAccountResolution(), name: "Test Account", status: "confirmed", confidence: 0.9, action_required: null },
    meddpicc: buildDefaultMeddpicc(),
    public_enrichment: buildDefaultPublicEnrichment(),
    ai_processing: buildDefaultAiProcessing(false, "text-embedding-3-small", "gpt-4o-mini"),
    analysis_link: { included: false, url: null, reason: "no_public_base_url", expires_at: null },
    transcript_diagnostics: { raw_characters: 0, raw_lines: 0, speaker_headers_detected: 0, turns_parsed: 0, sentences_parsed: 0, participants: [], rejected_header_candidates: [] },
    generic_diagnostics: { parser: { turns: 0, sentences: 0, participants: [], warning: null }, signals: { commercial: [], technical: [], ownership: [], next_steps: [] }, category_scores: [] },
    serpapi_signals: buildDefaultSerpApiSignals(),
    opportunity_scoring: buildDefaultOpportunityScoring(),
    buying_committee: { roles: [], economic_authority: { status: "missing", named_person: null, role_candidates: [], approval_paths: [], confidence: 0, known: [], gaps: [], next_question: "" } }
  };
}

function lanesFor(result: SecureNetworkingTriageResult): string[] {
  const config = loadRoutingConfig();
  const lifecycle = classifyLifecycle(result);
  const routing = buildLaneRouting(result, config, lifecycle);
  return routing.map((item) => item.lane).sort();
}

describe("Peachtree routing config loading", () => {
  it("loads dynamically from signal-agent-poc/config/peachtree_pilot_routing.json", () => {
    const config = loadRoutingConfig();
    expect(getRoutingConfigPath()).toContain("peachtree_pilot_routing.json");
    expect(config.metadata.team).toBe("Peachtree Select Commercial");
    expect(config.recipients.sales.name).toBe("Bella Robinson");
    expect(config.recipients.technical.name).toBe("Jack Alden");
  });

  it("loads Bella's (sales) email directly as a data field — no environment variable required", () => {
    const config = loadRoutingConfig();
    expect(config.recipients.sales.email).toBe("belrobin@cisco.com");
    expect(getRecipientEmail("sales", config)).toBe("belrobin@cisco.com");
  });

  it("loads Jack's (technical) email directly as a data field — no environment variable required", () => {
    const config = loadRoutingConfig();
    expect(config.recipients.technical.email).toBe("jaalden@cisco.com");
    expect(getRecipientEmail("technical", config)).toBe("jaalden@cisco.com");
  });
});

describe("Peachtree lane routing rules", () => {
  it("a budget signal alone routes to sales only", () => {
    const result = buildResult({ budget: "We have approved budget for this initiative." });
    expect(lanesFor(result)).toEqual(["sales"]);
  });

  it("technical architecture alone routes to technical only", () => {
    const result = buildResult({ businessProblem: "The customer needs an architecture workshop to validate the design." });
    expect(lanesFor(result)).toEqual(["technical"]);
  });

  it("network refresh routes to both lanes", () => {
    const result = buildResult({ businessProblem: "The switches are aging and need a hardware refresh across all sites." });
    expect(lanesFor(result)).toEqual(["sales", "technical"]);
  });

  it("Splunk opportunity routes to both lanes", () => {
    const result = buildResult({ recommendedSolutions: ["Splunk Enterprise Security"], businessProblem: "Evaluating Splunk for SOC consolidation." });
    expect(lanesFor(result)).toEqual(["sales", "technical"]);
  });

  it("software buying without a technical request routes to sales only", () => {
    const result = buildResult({ businessProblem: "We need to restructure our licensing and enterprise agreement this year." });
    expect(lanesFor(result)).toEqual(["sales"]);
  });

  it("software buying with a proof-of-concept request routes to both lanes", () => {
    const result = buildResult({
      businessProblem: "We need to restructure our enterprise agreement licensing, and we'd like a proof of concept before committing."
    });
    expect(lanesFor(result)).toEqual(["sales", "technical"]);
  });

  it("REVIEW defaults to technical review", () => {
    const result = buildResult({ verdict: "REVIEW" });
    expect(lanesFor(result)).toEqual(["technical"]);
  });

  it("NOISE sends nothing", () => {
    const result = buildResult({ verdict: "NOISE", budget: "approved budget", businessProblem: "architecture workshop" });
    const config = loadRoutingConfig();
    const lifecycle = classifyLifecycle(result);
    const routing = buildLaneRouting(result, config, lifecycle);
    expect(routing).toEqual([]);
  });
});

describe("Signal type detection", () => {
  it("detects budget and timeline generically from commercial_signals", () => {
    const result = buildResult({ budget: "budget approved", timeline: "this quarter" });
    const signals = detectSignalTypes(result);
    expect(signals).toContain("budget");
    expect(signals).toContain("timeline");
  });

  it("detects a renewal event from commercial_signals.renewal_events", () => {
    const result = buildResult({ renewalEvents: ["contract renews in 3 months"] });
    expect(detectSignalTypes(result)).toContain("renewal");
  });
});

describe("LAER lifecycle classification", () => {
  it("classifies LAND for a new/competitor-displacement opportunity", () => {
    const result = buildResult({ businessProblem: "This is a new opportunity replacing our incumbent competitor." });
    expect(classifyLifecycle(result).lifecycle_stage).toBe("LAND");
  });

  it("classifies ADOPT for implementation/enablement language", () => {
    const result = buildResult({ businessProblem: "We are struggling with onboarding and enablement during implementation." });
    expect(classifyLifecycle(result).lifecycle_stage).toBe("ADOPT");
  });

  it("classifies EXPAND for additional-sites/adjacent language", () => {
    const result = buildResult({ businessProblem: "We want to expand to additional sites and adjacent business units." });
    expect(classifyLifecycle(result).lifecycle_stage).toBe("EXPAND");
  });

  it("classifies RENEW when a renewal event is present", () => {
    const result = buildResult({ renewalEvents: ["Our license renewal window opens next month."] });
    expect(classifyLifecycle(result).lifecycle_stage).toBe("RENEW");
  });

  it("defaults to LAND when no lifecycle language is detected at all", () => {
    const result = buildResult({});
    expect(classifyLifecycle(result).lifecycle_stage).toBe("LAND");
  });
});
