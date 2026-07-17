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
    providers: { embeddings_used: false, synthesis_used: false, fallback_reason: null, semantic_mode: "deterministic", analysis_mode: "deterministic" },
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
    ai_processing: buildDefaultAiProcessing(false, "deterministic-local", "circuit"),
    analysis_link: noLink,
    transcript_diagnostics: { raw_characters: 0, raw_lines: 0, speaker_headers_detected: 0, turns_parsed: 0, sentences_parsed: 0, participants: [], rejected_header_candidates: [] },
    generic_diagnostics: { parser: { turns: 0, sentences: 0, participants: [], warning: null }, signals: { commercial: [], technical: [], ownership: [], next_steps: [] }, category_scores: [] },
    serpapi_signals: buildDefaultSerpApiSignals(),
    opportunity_scoring: buildDefaultOpportunityScoring(),
    buying_committee: { roles: [], economic_authority: { status: "missing", named_person: null, role_candidates: [], approval_paths: [], confidence: 0, known: [], gaps: [], next_question: "" } },
    ...emptyActionAndHandoffFields("run-1"),
    // A HIGH_INTENT run has an ACTIVE next best action (not the empty "hold"
    // default) — so the message builder exercises the pursue path.
    next_best_action: {
      ...emptyActionAndHandoffFields("run-1").next_best_action,
      action_type: "architecture_workshop",
      title: "Run a scenario-design workshop for Acme Retail",
      summary: "Run a 90-minute scenario-design workshop to validate the fragmented-network-operations motion.",
      owner_lane: "technical",
      primary_owner: "Jack Alden",
      recommended_timing: "this quarter",
      why_now: ["Architecture decision needed this quarter."],
      success_criteria: ["Agreed success criteria for the first scenario"]
    }
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
    // Both lanes are concise + action-first: account, why-you, why-now, ONE
    // recommended action, expected outcome.
    expect(salesMessage.markdown).toContain("— commercial");
    expect(salesMessage.markdown).toContain("**Why you:**");
    expect(salesMessage.markdown).toContain("**Recommended action:**");
    expect(technicalMessage.markdown).toContain("— technical");
    expect(technicalMessage.markdown).toContain("**Environment:**");
    expect(technicalMessage.markdown).toContain("**Recommended action:**");
    // The sales lane carries the commercial pursuit line; the technical lane
    // leads with environment/motion and never carries the commercial score.
    expect(salesMessage.markdown).not.toContain("**Environment:**");
    expect(technicalMessage.markdown).not.toContain("**Pursuit:**");
    // The push message is a concise nudge — no MEDDPICC dump / thesis / long
    // stakeholder lists (those live in the app).
    expect(salesMessage.markdown).not.toContain("MEDDPICC");
    expect(salesMessage.markdown.length).toBeLessThanOrEqual(1100);
    expect(technicalMessage.markdown.length).toBeLessThanOrEqual(1100);
  });

  it("surfaces deal intelligence (deal shape + watch-out) in both lanes when present", () => {
    const result = buildResult();
    result.deal_intelligence = {
      deal_shape: { label: "Expansion / land-and-expand · Consolidation / cross-domain correlation", tags: ["expansion", "consolidation"], rationale: "We have Splunk in pockets." },
      momentum: [{ id: "requested_next_step", label: "Customer asked for the next step", evidence: "Let's do a working session.", speaker: "Jordan" }],
      risks: [{ id: "no_single_eb", label: "No single economic buyer — budgets are separate", evidence: "There may not be one person.", speaker: "Jordan" }],
      value_hypothesis: 'Frame value in their words: "hundreds of specialists unable to work"',
      power_map: [{ name: "Jordan", role_id: "business_champion", role_label: "Business champion", stance: "supportive", play: "Arm them with exec-legible business-risk framing.", evidence: "I'd like a working session." }],
      public_context: [{ id: "public_0", label: "AECOM is a global infrastructure firm expanding its AI portfolio", evidence: "investors.aecom.com", speaker: null }],
      headline_metric: "96 → under 30 minutes",
      timing: { label: "Committee memo is due September 4 (decision boundary, not procurement)", is_procurement: false, evidence: "committee memo is due September fourth" },
      headline: "Expansion play at Acme Retail — customer asked for the next step; watch: no single economic buyer."
    };
    const sales = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    const technical = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });
    expect(sales.markdown).toContain("**Deal shape:**");
    expect(sales.markdown).toContain("**Watch-out:**");
    expect(sales.markdown).toContain("**Champion:** Jordan");
    // Distilled public research surfaces as one punchy commercial account line.
    expect(sales.markdown).toContain("**Account intel:**");
    expect(technical.markdown).toContain("**Deal shape:**");
    // The champion + account-intel lines are commercial-only.
    expect(technical.markdown).not.toContain("**Champion:**");
    expect(technical.markdown).not.toContain("**Account intel:**");
    // Still concise.
    expect(sales.markdown.length).toBeLessThanOrEqual(1100);
    expect(technical.markdown.length).toBeLessThanOrEqual(1100);
  });

  it("renders a clean expected outcome (no lead-in filler, no mid-sentence cut) and never splices a non-date quote into the action", () => {
    const result = buildResult();
    result.next_best_action = {
      ...result.next_best_action,
      title: "Scope a proof of value for Acme Retail",
      // A raw quote that merely contains a dollar amount must NOT be appended as
      // "timing" onto the action.
      recommended_timing: "But $116,000 of that is committed-capacity cost we pay even if data is deleted",
      success_criteria: [
        "For success criteria, I suggest 95 percent end-to-end trace continuity, less than two percent application overhead, detection of a seeded public-journey failure within three minutes, and diagnosis in under 15 minutes."
      ]
    };
    const sales = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    const outcomeLine = sales.markdown.split("\n").find((l) => l.startsWith("**Expected outcome:**"))!;
    // Conversational lead-in stripped; complete clause (no mid-sentence "in").
    expect(outcomeLine).not.toContain("For success criteria, I suggest");
    expect(outcomeLine).toContain("diagnosis in under 15 minutes");
    expect(outcomeLine.trim().endsWith(" in")).toBe(false);
    // The cost quote never becomes part of the action line.
    const actionLine = sales.markdown.split("\n").find((l) => l.startsWith("**Recommended action:**"))!;
    expect(actionLine).not.toContain("$116,000");
    expect(actionLine).toContain("Scope a proof of value for Acme Retail");
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
    expect(salesMessage.markdown).toMatch(/\*\*Why you:\*\* Commercial owner/);
    expect(technicalMessage.markdown).toMatch(/\*\*Why you:\*\* Technical owner/);
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

  it("threads goal-aligned framing + owner-only goal/quota hook into the delivered message", () => {
    const result = buildResult();
    const teaser = (over: Record<string, unknown>) => ({
      headline: "x", account: "Acme Retail", signal_label: "REVIEW · signal 80%", why_you: "You are the routed owner for this account.",
      why_now: "n", goal_alignment: null, goal_impact: null, recommended_action: "a", expected_output: "e",
      evidence_points: [], confidence: 0.8, limitation: null, cta_labels: [], ...over
    });
    result.personalization = {
      ...(result.personalization ?? ({} as NonNullable<typeof result.personalization>)),
      recipient_teasers: {
        sales: teaser({ why_you: "This fits your goal to grow strategic accounts and your sales focus.", goal_alignment: "Supports: Grow strategic accounts, Expand security portfolio.", goal_impact: "$1.20M ≈ 24% of your annual target" }),
        technical: teaser({ why_you: "Technical owner: environment + workshop scope.", goal_alignment: "Supports: Expand security portfolio.", goal_impact: null }),
        leadership: teaser({})
      }
    } as NonNullable<typeof result.personalization>;
    const sales = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    // Goal-aligned why-you + the owner's quota hook are in the delivered comms.
    expect(sales.markdown).toContain("This fits your goal to grow strategic accounts");
    expect(sales.markdown).toContain("**Goal impact:** $1.20M ≈ 24% of your annual target");
    // The concrete goals this advances are named (Oscar's "speak to my goals"),
    // with the "Supports:" prefix stripped.
    expect(sales.markdown).toContain("**Goal fit:** Grow strategic accounts, Expand security portfolio.");
    // The technical recipient is not the owner → NO quota leak (but goal fit is fine).
    const tech = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });
    expect(tech.markdown).not.toContain("Goal impact:");
    expect(tech.markdown).not.toContain("24% of your annual target");
    expect(tech.markdown).toContain("**Goal fit:** Expand security portfolio.");
  });

  it("a NOISE/suppress result produces an honest 'no action' message (not a pursue nudge) with the customer's boundary", () => {
    const result = buildResult();
    result.executive_summary.verdict = "NOISE";
    result.next_best_action = {
      ...result.next_best_action,
      action_type: "suppress",
      title: "Suppress — no internal action",
      summary: "The transcript did not produce a qualified opportunity signal; no specialist action is recommended.",
      owner_lane: "shared"
    };
    result.decision_packet = {
      ...(result.decision_packet ?? ({} as NonNullable<typeof result.decision_packet>)),
      objections: [
        { objection_id: "ob_1", type: "disqualifier", label: "Not a buying motion / out of scope", statement: "We are not evaluating replacements or a new analytics layer.", speaker: "Dana", suggested_response: "Respect the boundary.", evidence_ids: ["ev_1"] }
      ]
    } as NonNullable<typeof result.decision_packet>;
    const sales = buildSalesMessage({ result, decision: salesDecision, runId: "run-1", analysisLink: noLink });
    expect(sales.markdown).toContain("no action recommended");
    expect(sales.markdown).toContain("not a qualified sales opportunity");
    expect(sales.markdown).toContain("We are not evaluating replacements");
    // Never a fabricated pursue nudge.
    expect(sales.markdown).not.toContain("**Why you:**");
    expect(sales.markdown).not.toContain("Pursuit:");
    const tech = buildTechnicalMessage({ result, decision: technicalDecision, runId: "run-1", analysisLink: noLink });
    expect(tech.markdown).toContain("no action recommended");
    expect(tech.markdown).not.toContain("**Recommended action:** Run");
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
