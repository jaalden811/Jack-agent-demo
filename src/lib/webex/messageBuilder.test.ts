import { describe, expect, it } from "vitest";
import { buildSalesMessage, buildTechnicalMessage } from "@/lib/webex/messageBuilder";
import type { LaneRoutingDecision } from "@/lib/webex/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

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
    providers: { embeddings_used: false, synthesis_used: false, fallback_reason: null, semantic_mode: "fallback" },
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
    timestamp: new Date().toISOString()
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
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", baseUrl: null });
    const technicalMessage = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", baseUrl: null });

    expect(salesMessage.markdown).not.toEqual(technicalMessage.markdown);
    expect(salesMessage.markdown).toContain("Sales signal");
    expect(salesMessage.markdown).toContain("Buying signals");
    expect(technicalMessage.markdown).toContain("Technical action");
    expect(technicalMessage.markdown).toContain("Current environment");
    expect(salesMessage.markdown).not.toContain("Current environment");
    expect(technicalMessage.markdown).not.toContain("Buying signals");
  });

  it("never pastes the full transcript into a message", () => {
    const result = buildResult();
    result.transcript_meta.raw_text = "SENTENCE-MARKER-XYZ ".repeat(500);
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", baseUrl: null });
    expect(salesMessage.markdown).not.toContain("SENTENCE-MARKER-XYZ");
  });

  it("keeps each message under ~1,200 characters", () => {
    const result = buildResult();
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", baseUrl: null });
    const technicalMessage = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", baseUrl: null });
    expect(salesMessage.character_count).toBeLessThanOrEqual(1200);
    expect(technicalMessage.character_count).toBeLessThanOrEqual(1200);
  });

  it("explains why the recipient received the message", () => {
    const result = buildResult();
    const salesMessage = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", baseUrl: null });
    const technicalMessage = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", baseUrl: null });
    expect(salesMessage.markdown).toContain("sales action for the Peachtree Select pilot");
    expect(technicalMessage.markdown).toContain("technical action for the Peachtree Select pilot");
  });
});
