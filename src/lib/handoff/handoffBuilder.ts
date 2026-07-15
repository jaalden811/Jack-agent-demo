import { createHash } from "node:crypto";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { Meddpicc } from "@/lib/qualification/types";
import type { NextBestAction } from "@/lib/action-intelligence/types";
import type { HandoffProductRole, HandoffPublicContext, HandoffStakeholder, QuestionIndex, SpecialistHandoffPacket } from "@/lib/handoff/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import { buildQuestionIndex, doNotReaskTopics } from "@/lib/handoff/questionIndex";
import { buildMeetingPacket } from "@/lib/handoff/meetingBrief";
import { computeHandoffReadiness } from "@/lib/handoff/handoffReadiness";

/**
 * Deterministic Specialist Handoff Packet builder (Sections 3, 6). Bella
 * (sales/commercial) and Jack (technical) receive materially DIFFERENT
 * packets, both assembled from evidence the pipeline already produced — a
 * specialist can act from the packet alone. Nothing is hard-coded to a
 * company/product/transcript.
 */

function uniq(values: Array<string | null | undefined>, limit?: number): string[] {
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

function genericTexts(result: SecureNetworkingTriageResult, bucket: "commercial" | "technical" | "ownership" | "next_steps", categories: string[], limit: number): string[] {
  const signals = result.generic_diagnostics?.signals[bucket] ?? [];
  return uniq(signals.filter((s) => categories.includes(s.category)).map((s) => s.text), limit);
}

function currentEnvironment(result: SecureNetworkingTriageResult): string[] {
  const retained = result.matches[0]?.solution_decision.retained_existing_platforms ?? [];
  const envSignals = genericTexts(result, "technical", ["current_environment", "integration_requirement"], 4);
  return uniq([...retained, ...envSignals], 6);
}

function customerCommitments(result: SecureNetworkingTriageResult): string[] {
  return genericTexts(result, "next_steps", ["working_session", "workshop", "pilot", "proof_of_value", "next_step_commitment"], 4);
}

function rejectedOptions(result: SecureNetworkingTriageResult): string[] {
  const match = result.matches[0];
  if (!match) return [];
  const excluded = match.solution_decision.adjacent_solutions_considered.filter((a) => a.decision === "exclude").map((a) => `${a.solution}: ${a.reason}`);
  const contradicted = match.solution_decision.do_not_choose_conflicts.filter((c) => c.status === "contradicted").map((c) => c.rule);
  return uniq([...excluded, ...contradicted], 4);
}

function productRoles(result: SecureNetworkingTriageResult): HandoffProductRole[] {
  const roles = result.solution_architecture ?? [];
  return uniq(roles.map((r) => `${r.product}`), 8).map((product) => {
    const entry = roles.find((r) => r.product === product)!;
    return { product, role: entry.role, reason: entry.layer };
  });
}

function stakeholderMap(result: SecureNetworkingTriageResult): HandoffStakeholder[] {
  const named = (result.stakeholder_analysis?.named_stakeholders ?? []).map<HandoffStakeholder>((s) => ({
    name: s.name,
    role: s.function_or_role,
    status: "named",
    confidence: s.confidence,
    evidence: uniq([s.evidence], 2),
    next_question: null
  }));
  const committee = (result.buying_committee?.roles ?? []).map<HandoffStakeholder>((r) => ({
    name: r.name,
    role: r.role_label,
    status: r.status,
    confidence: r.confidence,
    evidence: uniq(r.behavioral_evidence, 2),
    next_question: r.next_question
  }));
  // Prefer named individuals; add committee role inferences that aren't already named.
  const namedRoles = new Set(named.map((n) => n.role.toLowerCase()));
  return [...named, ...committee.filter((c) => !namedRoles.has(c.role.toLowerCase()))].slice(0, 8);
}

function publicContext(result: SecureNetworkingTriageResult): HandoffPublicContext[] {
  // Section 12: a public signal enters the handoff only if it is
  // narrative-eligible (account-matched + transcript-aligned + credible).
  const signals = (result.serpapi_signals?.signals ?? []).filter((s) => s.narrative_eligible).slice(0, 3);
  return signals.map((s) => ({
    public_fact: s.claim,
    handoff_implication: `Aligns with the customer's ${s.category.replace(/_/g, " ")}; use to frame the recommended action.`,
    action_effect: "Sharpens why-now and workshop framing.",
    limitation: s.limitations[0] ?? "Public signal — does not prove any private budget, stage, or renewal.",
    source_url: s.source_url,
    evidence_ids: [s.signal_id]
  }));
}

function meddpiccSummary(meddpicc: Meddpicc | undefined): Record<string, { status: string; summary: string }> {
  if (!meddpicc) return {};
  const out: Record<string, { status: string; summary: string }> = {};
  (Object.keys(meddpicc) as Array<keyof Meddpicc>).forEach((k) => {
    out[k] = { status: meddpicc[k].status, summary: meddpicc[k].summary };
  });
  return out;
}

export function buildSpecialistHandoff(params: {
  result: SecureNetworkingTriageResult;
  lane: "sales" | "technical";
  recipient: { name: string; role: string };
  action: NextBestAction;
  questionIndex?: QuestionIndex;
}): SpecialistHandoffPacket {
  const { result, lane, recipient, action } = params;
  const account = getCanonicalAccount(result);
  const index = params.questionIndex ?? buildQuestionIndex(result);
  const problem = result.executive_summary.business_problem || "Not explicitly stated in the transcript.";
  const commitments = customerCommitments(result);
  const env = currentEnvironment(result);
  const rejected = rejectedOptions(result);
  const constraints = genericTexts(result, "technical", ["risk"], 4);
  const objections = uniq([...(result.matches[0]?.negative_cues ?? []).map((n) => n.context || n.phrase), ...rejected], 4);

  // Lane-filtered remaining questions: sales sees sales+shared; technical sees technical+shared.
  const laneQuestions = index.open.filter((q) => q.owner_lane === lane || q.owner_lane === "shared");

  const meeting = buildMeetingPacket({ result, action, questionIndex: index });

  const businessContext = uniq([
    result.executive_summary.business_impact,
    ...result.commercial_signals.quantified_impact.slice(0, 2),
    ...genericTexts(result, "commercial", ["funding", "financial_impact", "budget_ownership", "executive_sponsorship"], 3)
  ], 5);
  const technicalContext = uniq([
    ...result.matches.slice(0, 2).map((m) => m.pain_category),
    ...genericTexts(result, "technical", ["technical_requirement", "integration_requirement"], 3)
  ], 5);

  const ninetySecond =
    lane === "sales"
      ? `${account.name ?? "This account"} (${account.status}) — ${result.opportunity_scoring?.decision?.replace(/_/g, " ") ?? "review"} at ${result.opportunity_scoring?.deal_maturity ?? "discovery"}. ${problem} ${commitments[0] ? `Customer committed to: ${commitments[0]}` : "No firm next step yet."} Your job: ${action.summary}`
      : `${account.name ?? "This account"} — ${problem} Current environment already known: ${env.slice(0, 3).join("; ") || "not yet captured"}. ${commitments[0] ? `Accepted next step: ${commitments[0]}` : ""} Your job: ${action.summary}`;

  const talkingPoints =
    lane === "sales"
      ? uniq([
          result.opportunity_scoring ? `Lead with the accepted next step and business impact, not a product pitch.` : null,
          commitments[0] ? `Reference the commitment already made: ${commitments[0]}` : null,
          businessContext[0] ? `Anchor on impact: ${businessContext[0]}` : null,
          `Confirm funding authority and timing without re-asking what's already known.`
        ], 4)
      : uniq([
          `Open on the customer's own problem, not the platform.`,
          env[0] ? `Acknowledge the known environment (${env.slice(0, 2).join(", ")}) so no one re-explains it.` : null,
          commitments[0] ? `Drive toward the agreed next step: ${commitments[0]}` : null,
          `Confirm authoritative data sources and what remains in existing systems.`
        ], 4);

  const packet: SpecialistHandoffPacket = {
    handoff_id: `hop_${createHash("sha256").update(`${result.run_id}:${lane}`).digest("hex").slice(0, 12)}`,
    run_id: result.run_id,
    account: { name: account.name, confidence: account.confidence, status: account.status },
    recipient: { lane, name: recipient.name, role: recipient.role },
    ninety_second_brief: ninetySecond.replace(/\s+/g, " ").trim(),
    customer_problem: problem,
    business_context: businessContext,
    technical_context: technicalContext,
    current_environment: env,
    customer_goals: genericTexts(result, "commercial", ["success_metric"], 3).concat(genericTexts(result, "next_steps", ["success_metric"], 2)),
    customer_constraints: constraints,
    customer_objections: objections,
    customer_commitments: commitments,
    decisions_already_made: uniq(commitments, 3),
    explicitly_rejected_options: rejected,
    product_roles: productRoles(result),
    stakeholder_map: stakeholderMap(result),
    meddpicc_summary: meddpiccSummary(result.meddpicc),
    public_context: publicContext(result),
    recommended_action: action,
    meeting_or_workshop_plan: meeting,
    questions_already_answered: index.answered,
    questions_not_to_reask: doNotReaskTopics(index, 8),
    remaining_questions: laneQuestions,
    sensitive_or_declined_questions: index.declined_or_sensitive,
    recommended_opening:
      lane === "sales"
        ? `Thanks for the time last session. Based on what you shared${commitments[0] ? ` — including ${commitments[0].toLowerCase()}` : ""}, here's what we'd propose next.`
        : `Building on your team's input, I've reviewed the environment and the scenarios you raised so we can go straight to design rather than re-covering discovery.`,
    recommended_talking_points: talkingPoints,
    things_not_to_say: uniq([
      ...rejected.map((r) => `Do not position: ${r}`),
      ...index.declined_or_sensitive.slice(0, 2).map((d) => `Do not re-raise (customer declined): ${d.what_was_declined}`)
    ], 5),
    assets_to_prepare: meeting ? meeting.prework : [`${recipient.name} reviews this packet before customer contact.`],
    expected_deliverables: meeting ? meeting.deliverables : action.success_criteria.length > 0 ? [`Outcome measured against: ${action.success_criteria.join("; ")}`] : ["Documented outcome and agreed next step"],
    success_criteria: action.success_criteria,
    evidence_ids: uniq([...action.evidence_ids, ...index.answered.flatMap((a) => a.evidence_ids)], 20),
    readiness_score: 0,
    readiness_status: "blocked"
  };

  const readiness = computeHandoffReadiness(packet);
  packet.readiness_score = readiness.score;
  packet.readiness_status = readiness.status;
  return packet;
}
