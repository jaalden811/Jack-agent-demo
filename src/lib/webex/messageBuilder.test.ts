import { describe, expect, it } from "vitest";
import { buildSalesMessage, buildTechnicalMessage, buildSalesEmail, buildTechnicalEmail } from "@/lib/webex/messageBuilder";
import { buildDefaultAccountResolution, buildDefaultAiProcessing, buildDefaultMeddpicc, buildDefaultPublicEnrichment } from "@/lib/qualification/defaults";
import { buildDefaultOpportunityScoring, buildDefaultSerpApiSignals } from "@/lib/opportunity-fit/defaults";
import type { AnalysisLink } from "@/lib/qualification/types";
import type { LaneRoutingDecision } from "@/lib/webex/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { emptyActionAndHandoffFields } from "@/lib/handoff/defaults";

const noLink: AnalysisLink = { included: false, url: null, reason: "no_public_base_url", expires_at: null };
const includedLink: AnalysisLink = { included: true, url: "https://app.example.com/signal-agent/results/run-1?token=abc.def", reason: "public_url_ready", expires_at: new Date(Date.now() + 3600_000).toISOString() };

function buildResult(): SecureNetworkingTriageResult {
  return {
    use_case: "secure_networking_deal_signal_triage",
    executive_summary: {
      verdict: "HIGH_INTENT",
      confidence: 0.85,
      account: "Acme Retail",
      business_problem: "Fragmented network operations across 83 locations.",
      business_impact: "$180,000 lost per incident.",
      urgency: "Architecture decision needed this quarter.",
      primary_opportunity: "Fragmented network operations",
      secondary_opportunities: [],
      recommended_next_action: "Schedule an architecture workshop."
    },
    stakeholders: [],
    stakeholder_analysis: { participants: [], named_stakeholders: [], functional_owners: [] },
    commercial_signals: {
      budget: "$1.4M approved budget",
      timeline: "this quarter",
      renewal_events: ["SD-WAN renewal in 5 months"],
      quantified_impact: ["$180,000 lost per incident"],
      evaluation_stage: "actively evaluating",
      purchase_language: ["prepared to purchase this quarter"]
    },
    matches: [
      {
        entry_id: "cross_domain_network_operations",
        pain_category: "Fragmented network operations",
        domain: "Networking",
        confidence: 0.85,
        rank: 1,
        relationship: "primary",
        matched_text: ["We have too many consoles.", "The fault domain is unclear."],
        matched_keywords: ["too many consoles"],
        semantic_evidence: [],
        intent_evidence: [],
        corroboration: [],
        negative_cues: [],
        recommended_solutions: ["Cisco Networking Platform"],
        recommended_specialist: "Enterprise Networking specialist",
        solution_decision: {
          recommended: ["Cisco Networking Platform"],
          supporting_products: [],
          retained_existing_platforms: ["Catalyst Center"],
          choose_when_evidence: [],
          do_not_choose_conflicts: [],
          adjacent_solutions_considered: []
        },
        score_breakdown: {
          keyword_score: 0.8,
          keyword_weight: 0.2,
          semantic_score: 0.8,
          semantic_weight: 0.45,
          intent_score: 0.8,
          intent_weight: 0.1,
          structured_account_score: 0.8,
          structured_account_weight: 0.25,
          penalty: 0,
          final: 0.85
        }
      }
    ],
    solution_architecture: [],
    recommended_specialists: ["Enterprise Networking specialist"],
    discovery_questions: [],
    internal_brief: "",
    notification_text: null,
    providers: { embeddings_used: false, synthesis_used: false, fallback_reason: null, semantic_mode: "fallback", analysis_mode: "deterministic" },
    reference_pack: {
      taxonomy_file: "",
      taxonomy_version: "1.0",
      taxonomy_as_of: null,
      taxonomy_scope: null,
      category_count: 34,
      final_formula: null,
      multi_label_policy: null,
      notification_gates: { high_intent: null, review: null, noise: null },
      report_file: "",
      report_loaded: true
    },
    corroboration_summary: {
      transcript_score: 0.8,
      structured_account_score: 0,
      combined_score: 0.4,
      transcript_signals: [],
      structured_signals: [],
      structured_account_available: false
    },
    public_signals: [],
    audit: { logged: false, path: "", warning: null },
    transcript_meta: { title: "Test meeting", account: "Acme Retail", participant_count: 5, sentence_count: 20, raw_text: "" },
    timestamp: new Date().toISOString(),
    run_id: "test-run-id",
    account_resolution: { ...buildDefaultAccountResolution(), name: "Acme Retail", status: "confirmed", confidence: 0.95, action_required: null },
    meddpicc: buildDefaultMeddpicc(),
    public_enrichment: buildDefaultPublicEnrichment(),
    ai_processing: buildDefaultAiProcessing(false, "text-embedding-3-small", "gpt-4o-mini"),
    analysis_link: noLink,
    transcript_diagnostics: { raw_characters: 0, raw_lines: 0, speaker_headers_detected: 0, turns_parsed: 0, sentences_parsed: 0, participants: [], rejected_header_candidates: [] },
    generic_diagnostics: { parser: { turns: 0, sentences: 0, participants: [], warning: null }, signals: { commercial: [], technical: [], ownership: [], next_steps: [] }, category_scores: [] },
    serpapi_signals: buildDefaultSerpApiSignals(),
    opportunity_scoring: buildDefaultOpportunityScoring(),
    buying_committee: { roles: [], economic_authority: { status: "missing", named_person: null, role_candidates: [], approval_paths: [], confidence: 0, known: [], gaps: [], next_question: "" } },
    ...emptyActionAndHandoffFields("run-1")
  };
}

const salesDecision: LaneRoutingDecision = {
  lane: "sales",
  recipient_name: "Bella Robinson",
  recipient_email: "belrobin@cisco.com",
  assigned_role: "Sales / Commercial owner",
  reason: ["Detected signal: budget"],
  actions: ["Confirm and track budget/funding status"],
  signal_types: ["budget", "timeline"],
  lifecycle_stage: "LAND",
  automatic_delivery: true
};

const technicalDecision: LaneRoutingDecision = {
  ...salesDecision,
  lane: "technical",
  recipient_name: "Jack Alden",
  recipient_email: "jaalden@cisco.com",
  assigned_role: "Technical / Specialist owner",
  actions: ["Schedule architecture/discovery workshop"],
  signal_types: ["architecture_workshop"]
};

describe("Webex message templates", () => {
  it("sales and technical messages contain different, tailored content", () => {
    const result = buildResult();
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    const technicalMessage = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });

    expect(salesMessage.markdown).not.toEqual(technicalMessage.markdown);
    expect(salesMessage.markdown).toContain("Commercial action");
    expect(salesMessage.markdown).toContain("Opportunity thesis");
    expect(salesMessage.markdown).toContain("Bella next");
    expect(salesMessage.markdown).toContain("Technical counterpart");
    expect(technicalMessage.markdown).toContain("Technical action");
    expect(technicalMessage.markdown).toContain("Current environment");
    expect(technicalMessage.markdown).toContain("Jack next");
    // The sales lane leads with the commercial thesis + MEDDPICC; the
    // technical lane leads with pain + environment + architecture — and
    // never carries the commercial pursuit score.
    expect(salesMessage.markdown).not.toContain("Current environment");
    expect(technicalMessage.markdown).not.toContain("**Pursuit:**");
  });

  it("never pastes the full transcript into a message", () => {
    const result = buildResult();
    result.transcript_meta.raw_text = "SENTENCE-MARKER-XYZ ".repeat(500);
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    expect(salesMessage.markdown).not.toContain("SENTENCE-MARKER-XYZ");
  });

  it("keeps each message within the Webex channel ceiling while allowing a rich brief", () => {
    const result = buildResult();
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    const technicalMessage = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });
    expect(salesMessage.character_count).toBeLessThanOrEqual(2400);
    expect(technicalMessage.character_count).toBeLessThanOrEqual(2400);
  });

  it("explains why the recipient received the message", () => {
    const result = buildResult();
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    const technicalMessage = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });
    expect(salesMessage.markdown).toContain("Sales / Commercial action for the Peachtree Select pilot");
    expect(technicalMessage.markdown).toContain("Technical / Specialist action for the Peachtree Select pilot");
  });

  it("never renders a hyperlink when no valid public analysis link exists (Section 11)", () => {
    const result = buildResult();
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    expect(salesMessage.markdown).not.toContain("[Open full analysis]");
    expect(salesMessage.markdown).toContain("Analysis reference:** Run `run-1`");
  });

  it("renders a real hyperlink only when a valid public link was constructed", () => {
    const result = buildResult();
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: includedLink });
    expect(salesMessage.markdown).toContain(`[Open full analysis](${includedLink.url})`);
    expect(salesMessage.markdown).not.toContain("localhost");
  });

  it("Test 30: Bella's message includes the pursuit recommendation only when it is genuinely available", () => {
    const result = buildResult();
    result.opportunity_scoring = {
      transcript_score: 82,
      qualification_score: 60,
      external_fit_score: 75,
      account_confidence_score: 95,
      final_pursuit_score: 78,
      decision: "PURSUE_WITH_DISCOVERY",
      confidence: 0.8,
      score_version: "opportunity-fit-v1",
      weights: { transcript_opportunity_score: 0.5, qualification_quality_score: 0.2, external_fit_score: 0.25, account_resolution_confidence: 0.05 },
      factors: [
        { factor: "Strong transcript intent and quantified impact", score_contribution: 20, evidence_ids: [] },
        { factor: "Economic Buyer not yet identified", score_contribution: -5, evidence_ids: [] }
      ],
      gates: [],
      signal_strength: { score: 82, band: "HIGH" },
      deal_maturity: "SOLUTION_DISCOVERY",
      qualification_completeness: 60
    };
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    expect(salesMessage.markdown).toContain("Pursuit:");
    expect(salesMessage.markdown).toContain("PURSUE_WITH_DISCOVERY");
    expect(salesMessage.markdown).toContain("78/100");
  });

  it("Phase 3: uses the canonical resolved account name (never 'Unknown'/'Not resolved') when resolution is probable/confirmed", () => {
    const result = buildResult();
    // Resolved via extraction (probable), with NO transcript/CRM account label.
    result.account_resolution = { ...result.account_resolution, name: "Northgate Materials", status: "probable", confidence: 0.82, action_required: null };
    result.executive_summary.account = null;
    const sales = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    const technical = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });
    expect(sales.markdown).toContain("Northgate Materials");
    expect(sales.markdown).not.toContain("Not resolved");
    expect(sales.subject).not.toContain("Unknown account");
    expect(technical.markdown).toContain("Northgate Materials");
  });

  it("Phase 13: messages contain no truncation ellipsis and stay within the Webex byte budget", () => {
    const result = buildResult();
    const sales = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    const technical = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });
    for (const m of [sales, technical]) {
      expect(m.markdown).not.toContain("…");
      expect(new TextEncoder().encode(m.markdown).length).toBeLessThanOrEqual(7439);
    }
  });

  it("never overloads Jack's technical message with the commercial pursuit score", () => {
    const result = buildResult();
    result.opportunity_scoring = {
      transcript_score: 82,
      qualification_score: 60,
      external_fit_score: 75,
      account_confidence_score: 95,
      final_pursuit_score: 78,
      decision: "PURSUE_WITH_DISCOVERY",
      confidence: 0.8,
      score_version: "opportunity-fit-v1",
      weights: {},
      factors: [],
      gates: [],
      signal_strength: { score: 82, band: "HIGH" },
      deal_maturity: "SOLUTION_DISCOVERY",
      qualification_completeness: 60
    };
    const technicalMessage = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });
    expect(technicalMessage.markdown).not.toContain("Pursuit recommendation");
    expect(technicalMessage.markdown).not.toContain("78/100");
  });
});

describe("Outlook email templates", () => {
  it("builds distinct sales and technical emails with the required subject format", () => {
    const result = buildResult();
    const salesEmail = buildSalesEmail({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    const technicalEmail = buildTechnicalEmail({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });

    expect(salesEmail.subject).toBe("[HIGH_INTENT] Sales action — Acme Retail — Fragmented network operations");
    expect(technicalEmail.subject).toBe("[HIGH_INTENT] Technical action — Acme Retail — Fragmented network operations");
    expect(salesEmail.html).not.toEqual(technicalEmail.html);
    expect(salesEmail.text).toContain("Recommended sales action");
    expect(technicalEmail.text).toContain("Recommended action");
    expect(technicalEmail.text).toContain("Technical evidence");
  });

  it("never pastes the full transcript into an email", () => {
    const result = buildResult();
    result.transcript_meta.raw_text = "SENTENCE-MARKER-XYZ ".repeat(500);
    const salesEmail = buildSalesEmail({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    expect(salesEmail.text).not.toContain("SENTENCE-MARKER-XYZ");
    expect(salesEmail.html).not.toContain("SENTENCE-MARKER-XYZ");
  });
});
