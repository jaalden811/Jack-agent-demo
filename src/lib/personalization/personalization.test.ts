import { describe, expect, it } from "vitest";
import { listObjectives, loadObjectiveCatalog, getObjective } from "@/lib/personalization/objectiveCatalog";
import { normalizeSellerProfile, toSafeProfile, profileIdFor } from "@/lib/personalization/profileSchema";
import { computePersonalRelevance, unavailableRelevance, type RelevanceInput } from "@/lib/personalization/relevanceScore";
import { computeGoalImpact } from "@/lib/personalization/goalImpact";
import { buildOpportunityTeaser, buildRecipientTeasers } from "@/lib/notifications/personalizedTeaser";
import { validateTeaser } from "@/lib/notifications/messageQualityGate";
import { decideNotification } from "@/lib/notifications/notificationPolicy";
import type { SellerProfile } from "@/lib/personalization/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import relevanceConfig from "../../../signal-agent-poc/config/personal_relevance_scoring.json";

function profile(overrides: Record<string, unknown> = {}): SellerProfile {
  return normalizeSellerProfile({
    display_name: "Test Seller",
    email: "seller@example.com",
    role_family: "sales",
    lane: "sales",
    territories: ["NA-West"],
    segments: ["enterprise"],
    specialties: ["security"],
    product_domains: ["soc_detection_response"],
    measurement_metrics: ["software_attach"],
    goals: [{ goal_id: "expand_security_portfolio", weight: 1, target: null, unit: null, timeframe: "year" }],
    ...overrides
  });
}

function relevanceInput(overrides: Partial<RelevanceInput> = {}): RelevanceInput {
  return {
    matched_category_ids: ["soc_detection_response"],
    matched_evidence_ids: ["t1", "t2"],
    verdict: "REVIEW",
    account_name: "Acme",
    account_status: "confirmed",
    account_geography: "NA-West",
    account_segment: "enterprise",
    action: { actionable: true, owner_lane: "sales", primary_owner: "Bella", recommended_timing: "next week", due_basis: "customer_commitment", confidence: 0.7 },
    recommended_specialists: ["SOC specialist"],
    overall_confidence: 0.7,
    goal_impact_status: "qualitative",
    strategic_size_band: "large",
    ...overrides
  };
}

describe("objective catalog (data-driven)", () => {
  it("loads objectives from JSON and references taxonomy ids", () => {
    const catalog = loadObjectiveCatalog();
    expect(catalog.objectives.length).toBeGreaterThan(5);
    expect(listObjectives().every((o) => o.active)).toBe(true);
    const security = getObjective("expand_security_portfolio");
    expect(security?.compatible_taxonomy_categories).toContain("soc_detection_response");
    expect(catalog.measurement_metrics).toContain("software_attach");
  });
});

describe("seller profile schema", () => {
  it("validates, normalizes, computes completeness, and versions", () => {
    const p = profile();
    expect(p.version).toBe("seller-profile-v1");
    expect(p.profile_id).toBe("email:seller@example.com");
    expect(p.profile_completeness).toBeGreaterThan(0.5);
    expect(p.created_at).toBeTruthy();
  });

  it("derives profile_id from person_id when present", () => {
    expect(profileIdFor({ person_id: "roster-7", email: "x@y.com" })).toBe("person:roster-7");
    expect(profileIdFor({ email: "X@Y.com" })).toBe("email:x@y.com");
  });

  it("toSafeProfile strips private compensation context", () => {
    const p = profile({ compensation_context: { annual_target: 1_000_000, current_attainment: 0.5, currency: "USD", pipeline_coverage_target: 3, minimum_opportunity_value: 50000, private: true } });
    const safe = toSafeProfile(p) as Record<string, unknown>;
    expect("compensation_context" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("1000000");
  });

  it("rejects an invalid email", () => {
    expect(() => normalizeSellerProfile({ display_name: "x", email: "not-an-email" })).toThrow();
  });
});

describe("personal relevance (deterministic, config-driven)", () => {
  it("has config weights that sum to 1.0", () => {
    const sum = Object.values(relevanceConfig.weights as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 1000) / 1000).toBe(1);
  });

  it("is 'unavailable' when there is no profile", () => {
    expect(unavailableRelevance().band).toBe("unavailable");
  });

  it("changing goals changes the personal relevance score", () => {
    const input = relevanceInput();
    const security = computePersonalRelevance(input, profile({ goals: [{ goal_id: "expand_security_portfolio", weight: 1, target: null, unit: null, timeframe: "year" }] }));
    const observability = computePersonalRelevance(input, profile({ goals: [{ goal_id: "expand_observability", weight: 1, target: null, unit: null, timeframe: "year" }] }));
    // Security goal matches the soc_detection_response motion; observability does not.
    expect(security.score).toBeGreaterThan(observability.score);
    expect(security.goal_alignment[0].alignment).toBeGreaterThan(observability.goal_alignment[0].alignment);
  });

  it("territory + role fit affect relevance", () => {
    const matched = computePersonalRelevance(relevanceInput({ account_geography: "NA-West" }), profile({ territories: ["NA-West"] }));
    const mismatched = computePersonalRelevance(relevanceInput({ account_geography: "EMEA" }), profile({ territories: ["NA-West"] }));
    expect(matched.score).toBeGreaterThan(mismatched.score);
  });

  it("penalizes no clear action", () => {
    const withAction = computePersonalRelevance(relevanceInput(), profile());
    const noAction = computePersonalRelevance(relevanceInput({ action: { actionable: false, owner_lane: "", primary_owner: "", recommended_timing: null, due_basis: "none", confidence: 0.2 } }), profile());
    expect(noAction.penalties_applied).toContain("no_clear_action");
    expect(noAction.score).toBeLessThan(withAction.score);
  });
});

describe("goal impact (never invents a deal value)", () => {
  it("quantifies quota + remaining contribution when verified value + target exist", () => {
    const p = profile({ compensation_context: { annual_target: 1_000_000, current_attainment: 0.5, currency: "USD", pipeline_coverage_target: null, minimum_opportunity_value: null, private: true } });
    const impact = computeGoalImpact({ profile: p, verifiedOpportunityValue: 250_000, accountStatus: "confirmed" });
    expect(impact.status).toBe("quantified");
    expect(impact.quota_contribution_percent).toBe(25);
    expect(impact.remaining_target_contribution_percent).toBe(50);
  });

  it("is qualitative when a verified value exists but no target", () => {
    const impact = computeGoalImpact({ profile: profile(), verifiedOpportunityValue: 250_000, accountStatus: "confirmed" });
    expect(impact.status).toBe("qualitative");
    expect(impact.strategic_size_band).toBe("large");
    expect(impact.quota_contribution_percent).toBeNull();
  });

  it("is unavailable (with limitations) when no verified value exists", () => {
    const impact = computeGoalImpact({ profile: profile(), verifiedOpportunityValue: null, accountStatus: "confirmed" });
    expect(impact.status).toBe("unavailable");
    expect(impact.verified_opportunity_value).toBeNull();
    expect(impact.limitations.join(" ")).toMatch(/never converted/i);
  });
});

const teaserResult = {
  executive_summary: { verdict: "REVIEW", confidence: 0.62, account: "Acme", primary_opportunity: "SOC detection & response" },
  account_resolution: { name: "Acme", status: "confirmed" },
  matches: [{ entry_id: "soc_detection_response", pain_category: "SOC detection & response" }],
  recommended_specialists: ["SOC specialist"],
  next_best_action: { action_type: "architecture_workshop", summary: "Run a scoped SOC detection workshop with the security team to validate correlation and data sources.", success_criteria: ["Agreed detection scenarios and data sources."], why_now: ["The customer asked for a scenario-based session before their planning cycle."], evidence_ids: ["t10", "t11"], owner_lane: "sales", primary_owner: "Bella", recommended_timing: "next week", due_basis: "customer_commitment", confidence: 0.7 }
} as unknown as SecureNetworkingTriageResult;

describe("opportunity teaser + quality gate", () => {
  it("produces a concise teaser with why-you, why-now, one action, <=3 evidence", () => {
    const rel = computePersonalRelevance(relevanceInput(), profile());
    const teaser = buildOpportunityTeaser({ result: teaserResult, profile: profile(), relevance: rel, goalImpact: computeGoalImpact({ profile: profile(), verifiedOpportunityValue: null, accountStatus: "confirmed" }), forOwner: true });
    expect(teaser.why_you.length).toBeGreaterThan(8);
    expect(teaser.why_now.length).toBeGreaterThan(8);
    expect(teaser.recommended_action.length).toBeGreaterThan(8);
    expect(teaser.evidence_points.length).toBeLessThanOrEqual(3);
    expect(validateTeaser(teaser).valid).toBe(true);
  });

  it("does not expose owner goal impact when built for another recipient", () => {
    const p = profile({ compensation_context: { annual_target: 1_000_000, current_attainment: null, currency: "USD", pipeline_coverage_target: null, minimum_opportunity_value: null, private: true } });
    const rel = computePersonalRelevance(relevanceInput(), p);
    const impact = computeGoalImpact({ profile: p, verifiedOpportunityValue: 250_000, accountStatus: "confirmed" });
    const nonOwner = buildOpportunityTeaser({ result: teaserResult, profile: p, relevance: rel, goalImpact: impact, forOwner: false });
    expect(nonOwner.goal_impact).toBeNull();
    expect(JSON.stringify(nonOwner)).not.toContain("annual target");
  });

  it("teaser signal label uses signal-strength (not classification confidence)", () => {
    const scored = {
      ...teaserResult,
      executive_summary: { ...teaserResult.executive_summary, confidence: 0.66 },
      opportunity_scoring: { signal_strength: { score: 41, band: "LOW" } }
    } as unknown as SecureNetworkingTriageResult;
    const rel = computePersonalRelevance(relevanceInput(), profile());
    const teaser = buildOpportunityTeaser({ result: scored, profile: profile(), relevance: rel, goalImpact: computeGoalImpact({ profile: profile(), verifiedOpportunityValue: null, accountStatus: "confirmed" }), forOwner: true });
    expect(teaser.signal_label).toContain("signal 41%");
    expect(teaser.signal_label).not.toContain("66%");
  });

  it("per-recipient teasers: sales and technical differ; only the owner sees goal impact", () => {
    const p = profile({ lane: "sales", compensation_context: { annual_target: 1_000_000, current_attainment: null, currency: "USD", pipeline_coverage_target: null, minimum_opportunity_value: null, private: true } });
    const rel = computePersonalRelevance(relevanceInput(), p);
    const impact = computeGoalImpact({ profile: p, verifiedOpportunityValue: 250_000, accountStatus: "confirmed" });
    const teasers = buildRecipientTeasers({ result: teaserResult, profile: p, relevance: rel, goalImpact: impact });
    expect(teasers.sales.why_you).not.toEqual(teasers.technical.why_you);
    expect(teasers.sales.goal_impact).not.toBeNull(); // owner lane
    expect(teasers.technical.goal_impact).toBeNull(); // non-owner
    expect(teasers.leadership.goal_impact).toBeNull();
    expect(JSON.stringify(teasers.technical)).not.toContain("annual target");
  });

  it("gate rejects a vague action and missing why-you", () => {
    const rel = computePersonalRelevance(relevanceInput(), profile());
    const good = buildOpportunityTeaser({ result: teaserResult, profile: profile(), relevance: rel, goalImpact: computeGoalImpact({ profile: profile(), verifiedOpportunityValue: null, accountStatus: "confirmed" }), forOwner: true });
    const vague = { ...good, recommended_action: "Follow up with the customer." };
    expect(validateTeaser(vague).valid).toBe(false);
    const noWhyYou = { ...good, why_you: "" };
    expect(validateTeaser(noWhyYou).valid).toBe(false);
  });
});

describe("notification policy (fatigue)", () => {
  const noise = { executive_summary: { verdict: "NOISE", confidence: 0.2 }, next_best_action: { action_type: "suppress" } } as unknown as SecureNetworkingTriageResult;
  const review = { executive_summary: { verdict: "REVIEW", confidence: 0.62 }, next_best_action: { action_type: "architecture_workshop" } } as unknown as SecureNetworkingTriageResult;

  it("suppresses NOISE", () => {
    const d = decideNotification({ result: noise, relevance: computePersonalRelevance(relevanceInput(), profile()), profile: profile() });
    expect(d.decision).toBe("suppress");
    expect(d.reason_codes).toContain("noise_suppressed");
  });

  it("high relevance + clear action -> immediate", () => {
    const rel = computePersonalRelevance(relevanceInput(), profile());
    const highRel = { ...rel, score: 90 };
    const d = decideNotification({ result: review, relevance: highRel, profile: profile() });
    expect(d.decision).toBe("immediate");
  });

  it("low relevance -> digest or in_app_only, with reason codes", () => {
    const rel = computePersonalRelevance(relevanceInput(), profile());
    const lowRel = { ...rel, score: 20 };
    const d = decideNotification({ result: review, relevance: lowRel, profile: profile() });
    expect(["digest", "in_app_only"]).toContain(d.decision);
    expect(d.reason_codes.length).toBeGreaterThan(0);
  });
});
