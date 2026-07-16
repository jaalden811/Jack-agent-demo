import { getObjective } from "@/lib/personalization/objectiveCatalog";
import type { GoalImpact, OpportunityTeaser, PersonalRelevance, SellerProfile } from "@/lib/personalization/types";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Deterministic personalized opportunity teaser — the concise, salient
 * content used for the primary card, Webex/Outlook preview, in-app alert, and
 * digest. Always evidence-backed; ONE recommended action; why-you/why-now.
 * This is a deterministic fallback teaser; Circuit Stage D may later replace
 * the delivered message. Private goal impact is included ONLY for the owner.
 * No hard-coded messages — text is composed from the run + profile + config.
 */

const CTA_LABELS = ["Open brief", "Ask about this call", "Pursue", "Not now"];

function firstSentence(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const m = t.match(/^.*?[.!?](\s|$)/);
  const s = (m ? m[0] : t).trim();
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function whyYou(profile: SellerProfile | null, relevance: PersonalRelevance): string {
  if (!profile) return "You are the routed owner for this account.";
  const top = [...relevance.factors].sort((a, b) => b.contribution - a.contribution)[0];
  const alignedGoal = relevance.goal_alignment.filter((g) => g.alignment >= 0.5).sort((a, b) => b.alignment - a.alignment)[0];
  const goalLabel = alignedGoal ? getObjective(alignedGoal.goal_id)?.label ?? alignedGoal.goal_id : null;
  if (goalLabel) return `This fits your goal to ${goalLabel.toLowerCase()} and your ${profile.role_family} focus.`;
  if (top) return `Routed to you on ${top.dimension.replace(/_/g, " ")} — ${firstSentence(top.reason)}`;
  return `Routed to you as the ${profile.role_family} owner for this account.`;
}

function goalAlignmentText(relevance: PersonalRelevance): string | null {
  const aligned = relevance.goal_alignment.filter((g) => g.alignment >= 0.5).map((g) => getObjective(g.goal_id)?.label ?? g.goal_id);
  if (aligned.length === 0) return null;
  return `Supports: ${aligned.slice(0, 2).join(", ")}.`;
}

export function buildOpportunityTeaser(params: {
  result: SecureNetworkingTriageResult;
  profile: SellerProfile | null;
  relevance: PersonalRelevance;
  goalImpact: GoalImpact;
  forOwner: boolean;
  maxEvidence?: number;
}): OpportunityTeaser {
  const { result, profile, relevance, goalImpact, forOwner } = params;
  const summary = result.executive_summary;
  const nba = result.next_best_action;
  const account = result.account_resolution?.name ?? summary.account ?? "the account";
  const primaryMotion = summary.primary_opportunity ?? result.matches[0]?.pain_category ?? "an opportunity";

  const whyNowSource = (nba?.why_now ?? []).filter(Boolean)[0] ?? summary.urgency ?? "The customer requested a concrete next step.";
  const action = nba?.summary?.trim() ? firstSentence(nba.summary) : "Confirm the account and the next step with the customer.";
  const expected = (nba?.success_criteria ?? [])[0] ?? "A documented outcome and an agreed next step.";

  const evidencePoints = (nba?.evidence_ids ?? []).slice(0, params.maxEvidence ?? 3).map((id) => ({ text: `Evidence ${id}`, evidence_ids: [id] }));

  return {
    headline: `${primaryMotion} at ${account}`,
    account,
    signal_label: `${summary.verdict} · signal ${Math.round((summary.confidence ?? 0) * 100)}%`,
    why_you: whyYou(profile, relevance),
    why_now: firstSentence(whyNowSource),
    goal_alignment: goalAlignmentText(relevance),
    // Owner-only: never leak the owner's quota/goal impact to other recipients.
    goal_impact: forOwner && goalImpact.status !== "unavailable" ? goalImpact.headline : null,
    recommended_action: action,
    expected_output: firstSentence(expected),
    evidence_points: evidencePoints,
    confidence: Math.round((nba?.confidence ?? summary.confidence ?? 0) * 100) / 100,
    limitation: relevance.band === "unavailable" ? "No seller profile — personalization limited." : null,
    cta_labels: CTA_LABELS
  };
}
