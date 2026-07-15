import { createHash } from "node:crypto";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { ActionDueBasis, ActionOwnerLane, ActionPriority, ActionType, NextBestAction } from "@/lib/action-intelligence/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";

/**
 * Deterministic Next Best Action generator (Section 2). Derives ONE
 * specific, evidence-backed action from the assembled run — never a
 * generic "follow up / progress the opportunity". Every string is
 * composed from the run's own evidence; nothing is keyed to a
 * company/product/transcript. OpenAI may later refine the prose, but this
 * deterministic output is complete on its own.
 */

export type ActionOwners = {
  sales: { name: string; role: string };
  technical: { name: string; role: string };
};

function actionId(runId: string, actionType: string): string {
  return `act_${createHash("sha256").update(`${runId}:${actionType}`).digest("hex").slice(0, 12)}`;
}

function uniqueNonEmpty(values: Array<string | null | undefined>, limit?: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (limit && out.length >= limit) break;
  }
  return out;
}

function customerParticipantRoles(result: SecureNetworkingTriageResult): string[] {
  const named = result.stakeholder_analysis?.named_stakeholders ?? [];
  const functional = result.stakeholder_analysis?.functional_owners ?? [];
  return uniqueNonEmpty([...named.map((s) => s.function_or_role), ...functional.map((s) => s.function_or_role)], 6);
}

function scenarioNames(result: SecureNetworkingTriageResult): string[] {
  // Scenario/workshop framing comes from the matched pain categories
  // (concise, transcript-derived labels) — cleaner than raw next-step
  // sentences.
  const painCategories = result.matches.slice(0, 2).map((m) => m.pain_category).filter(Boolean);
  return uniqueNonEmpty(painCategories, 2);
}

function successCriteria(result: SecureNetworkingTriageResult): string[] {
  // Only concrete, quantified success metrics from the transcript become
  // success criteria — never a MEDDPICC prose summary (which reads oddly
  // as a criterion). When none exist, the caller supplies clean workshop
  // defaults.
  const metrics = (result.generic_diagnostics?.signals.technical ?? []).filter((s) => s.category === "success_metric").map((s) => s.text);
  return uniqueNonEmpty(metrics, 4);
}

function whyNow(result: SecureNetworkingTriageResult): string[] {
  const c = result.commercial_signals;
  const out = uniqueNonEmpty(
    [
      ...c.quantified_impact.slice(0, 2),
      result.executive_summary.business_impact,
      c.renewal_events[0] ?? null,
      c.timeline ?? null,
      // An accepted next step is itself a "why now".
      (result.generic_diagnostics?.signals.next_steps ?? []).find((s) => s.category === "working_session" || s.category === "workshop" || s.category === "pilot" || s.category === "proof_of_value")?.text ?? null
    ],
    4
  );
  return out.length > 0 ? out : [result.executive_summary.business_problem].filter(Boolean);
}

function collectEvidenceIds(result: SecureNetworkingTriageResult): string[] {
  const ids: string[] = [];
  const buckets = result.generic_diagnostics?.signals;
  if (buckets) {
    for (const s of [...buckets.commercial, ...buckets.technical, ...buckets.next_steps]) ids.push(s.evidence_id);
  }
  if (result.meddpicc) ids.push(...result.meddpicc.identify_pain.evidence_ids, ...result.meddpicc.decision_criteria.evidence_ids);
  return uniqueNonEmpty(ids, 12);
}

function priorityFor(decision: string, signalBand: string): ActionPriority {
  if (decision === "PURSUE") return "critical";
  if (decision === "PURSUE_WITH_DISCOVERY") return signalBand === "HIGH" ? "critical" : "high";
  if (decision === "NURTURE") return "medium";
  return "low";
}

type ActionShape = { type: ActionType; lane: ActionOwnerLane };

function decideActionShape(result: SecureNetworkingTriageResult): ActionShape {
  const decision = result.opportunity_scoring?.decision;
  const verdict = result.executive_summary.verdict;
  const accountStatus = result.account_resolution?.status;
  const maturity = result.opportunity_scoring?.deal_maturity;
  const nextSteps = result.generic_diagnostics?.signals.next_steps ?? [];
  const hasWorkshop = nextSteps.some((s) => s.category === "working_session" || s.category === "workshop");
  const hasPov = nextSteps.some((s) => s.category === "pilot" || s.category === "proof_of_value");
  const hasRenewal = result.commercial_signals.renewal_events.length > 0;

  if (verdict === "NOISE" || decision === "DO_NOT_PURSUE") return { type: "suppress", lane: "shared" };
  if (decision === "HOLD") return { type: "hold", lane: "shared" };
  // A credible-but-unconfirmed account is the blocking first action.
  if (accountStatus === "ambiguous" || accountStatus === "unresolved") return { type: "account_confirmation", lane: "sales" };

  if (hasWorkshop) return { type: "architecture_workshop", lane: "technical" };
  if (hasPov) return { type: "proof_of_value", lane: "technical" };
  if (hasRenewal) return { type: "renewal_review", lane: "sales" };

  switch (maturity) {
    case "PROBLEM_DISCOVERY":
      return { type: "technical_discovery", lane: "technical" };
    case "SOLUTION_DISCOVERY":
      return { type: "architecture_workshop", lane: "technical" };
    case "VALIDATION":
      return { type: "proof_of_value", lane: "technical" };
    case "COMMERCIAL_EVALUATION":
      return { type: "executive_alignment", lane: "sales" };
    case "PROCUREMENT":
      return { type: "procurement_discovery", lane: "sales" };
    default:
      return { type: "commercial_discovery", lane: "sales" };
  }
}

function composeTitleSummary(params: {
  shape: ActionShape;
  ownerName: string;
  accountLabel: string;
  participants: string[];
  scenarios: string[];
  criteria: string[];
  problem: string;
}): { title: string; summary: string } {
  const { shape, ownerName, accountLabel, participants, scenarios, criteria, problem } = params;
  const participantText = participants.length > 0 ? participants.join(", ") : "the customer's operational and technical stakeholders";
  const scenarioText = scenarios.length > 0 ? scenarios.join(" and ") : "the priority use case";
  const criteriaText = criteria.length > 0 ? criteria.join("; ") : "evidence-quality, integration, access-control, and cost criteria";

  switch (shape.type) {
    case "architecture_workshop":
      return {
        title: `Run a scenario-design workshop for ${accountLabel}`,
        summary: `${ownerName} should lead a 90-minute scenario-design workshop with ${participantText} to validate ${scenarioText}, identify the authoritative data sources and what stays in existing systems, and agree ${criteriaText}.`
      };
    case "proof_of_value":
      return {
        title: `Scope a proof of value for ${accountLabel}`,
        summary: `${ownerName} should define a proof of value covering ${scenarioText} with ${participantText}, agree the data sources and success criteria (${criteriaText}), and confirm the environment access required to run it.`
      };
    case "technical_discovery":
      return {
        title: `Lead technical discovery for ${accountLabel}`,
        summary: `${ownerName} should run a focused technical discovery with ${participantText} to establish the current environment, integrations, and constraints behind ${problem || scenarioText}, and define ${criteriaText}.`
      };
    case "account_confirmation":
      return {
        title: `Confirm the account for ${accountLabel}`,
        summary: `${ownerName} should confirm the customer's legal entity and official domain before broad enrichment or writeback, then re-run enrichment so the opportunity is attached to the correct account.`
      };
    case "executive_alignment":
      return {
        title: `Align executives for ${accountLabel}`,
        summary: `${ownerName} should convene an executive alignment session with ${participantText} to confirm the business case for ${scenarioText}, decision criteria (${criteriaText}), and the funding path.`
      };
    case "procurement_discovery":
      return {
        title: `Map the procurement path for ${accountLabel}`,
        summary: `${ownerName} should map the procurement and paper process with ${participantText}, confirm approval authority for ${scenarioText}, and identify the steps and timing to a commercial decision.`
      };
    case "renewal_review":
      return {
        title: `Run a renewal review for ${accountLabel}`,
        summary: `${ownerName} should review the upcoming renewal with ${participantText}, confirm scope and timing, and position ${scenarioText} against the renewal window.`
      };
    case "commercial_discovery":
      return {
        title: `Lead commercial discovery for ${accountLabel}`,
        summary: `${ownerName} should run commercial discovery with ${participantText} to establish funding authority, timing, and decision criteria (${criteriaText}) for ${scenarioText}.`
      };
    case "hold":
      return {
        title: `Hold ${accountLabel} pending stronger signal`,
        summary: `No confident action yet — the signal or account confidence is insufficient. Monitor for a stronger buying signal before routing a specialist.`
      };
    default:
      return {
        title: `Suppress — no internal action for ${accountLabel}`,
        summary: `The transcript did not produce a qualified opportunity signal; no specialist action is recommended.`
      };
  }
}

export function buildNextBestAction(result: SecureNetworkingTriageResult, owners: ActionOwners): NextBestAction {
  const shape = decideActionShape(result);
  const account = getCanonicalAccount(result);
  const accountLabel = account.name ?? "this account";
  const owner = shape.lane === "technical" ? owners.technical : owners.sales;
  const supporting = shape.lane === "technical" ? owners.sales : owners.technical;
  const participants = customerParticipantRoles(result);
  const scenarios = scenarioNames(result);
  const criteria = successCriteria(result);
  const problem = result.executive_summary.business_problem ?? "";
  const decision = result.opportunity_scoring?.decision ?? "HOLD";
  const signalBand = result.opportunity_scoring?.signal_strength?.band ?? "LOW";

  const { title, summary } = composeTitleSummary({ shape, ownerName: owner.name, accountLabel, participants, scenarios, criteria, problem });

  const isActive = shape.type !== "hold" && shape.type !== "suppress";
  const hasAcceptedNextStep = (result.generic_diagnostics?.signals.next_steps ?? []).length > 0;
  const dueBasis: ActionDueBasis = hasAcceptedNextStep
    ? "customer_commitment"
    : result.commercial_signals.renewal_events.length > 0
      ? "renewal"
      : result.commercial_signals.timeline
        ? "planning_boundary"
        : "none";

  const resolvedCriteria = shape.type === "architecture_workshop" || shape.type === "proof_of_value"
    ? criteria.length > 0
      ? criteria
      : ["Evidence-quality and correlation criteria agreed", "Required data sources and retained systems identified", "Access-control and cost boundaries agreed"]
    : criteria;

  return {
    action_id: actionId(result.run_id, shape.type),
    action_type: shape.type,
    title,
    summary,
    owner_lane: shape.lane,
    primary_owner: owner.name,
    supporting_owners: isActive ? [supporting.name] : [],
    priority: priorityFor(decision, signalBand),
    recommended_timing: result.commercial_signals.timeline ?? (hasAcceptedNextStep ? "Before the agreed next session" : null),
    due_basis: dueBasis,
    why_now: isActive ? whyNow(result) : [],
    customer_value: isActive
      ? `Advances ${accountLabel}'s stated problem toward a validated outcome without re-covering ground already discussed.`
      : "No customer-facing action recommended at this stage.",
    internal_value: isActive
      ? `Gives ${owner.name} a synced, evidence-backed handoff so ${shape.lane === "technical" ? "the technical" : "the commercial"} motion can proceed immediately.`
      : "Avoids low-value outreach on an unqualified signal.",
    evidence_ids: collectEvidenceIds(result),
    preconditions: shape.type === "account_confirmation" ? [] : account.status === "confirmed" || account.status === "probable" ? [] : ["Confirm the account identity before customer contact."],
    dependencies: isActive ? [`${supporting.name} (${shape.lane === "technical" ? "commercial" : "technical"} counterpart) provides their side of the handoff.`] : [],
    risks: uniqueNonEmpty(result.matches[0]?.solution_decision.do_not_choose_conflicts.filter((c) => c.status === "contradicted").map((c) => c.rule), 3),
    success_criteria: resolvedCriteria,
    stop_conditions: shape.type === "architecture_workshop" || shape.type === "proof_of_value"
      ? ["Customer declines to identify data sources or participants", "No agreed success criterion for the first scenario"]
      : [],
    fallback_action: isActive && shape.lane === "technical" ? `${owners.sales.name} confirms commercial sponsorship and timing before the technical session.` : null,
    confidence: result.opportunity_scoring?.confidence ?? 0.5,
    status: "recommended"
  };
}
