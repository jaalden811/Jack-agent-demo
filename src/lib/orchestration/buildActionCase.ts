import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { getCanonicalAccount } from "@/lib/signal-agent/canonicalAccount";
import { buildIntelligencePacket } from "@/lib/intelligence/intelligencePacket";
import { generateRoleMessage, renderWebexMessage } from "@/lib/intelligence/roleMessage";
import type { RoleMessage } from "@/lib/intelligence/types";
import { loadRoster, matchRosterMember, type RosterMember } from "@/lib/team-routing/roster";
import { loadRoutingConfig } from "@/lib/webex/peachtreeRouting";
import type {
  ActionCase,
  ActionGraph,
  ActionLane,
  ActionStep,
  CustomerEngagementPlan,
  GovernedDecision,
  OrchestrationStatus,
  OutcomeEvent,
  OutcomeLedger,
  OwnerResolution,
  ResolvedParty,
  RolePackets
} from "@/lib/orchestration/types";

/**
 * buildActionCase(result) — deterministically assembles the
 * signal-to-action-orchestration-v1 ActionCase from the already-computed
 * analysis result. This is the AUTHORITATIVE producer: run IDs, scores, evidence
 * identity, routing owners, the internal action plan (owners/steps/timing/
 * requirement), opportunity thread, and feedback all come straight from
 * deterministic data. It never invents a person, evidence ID, or outcome, never
 * turns a customer participant into an internal owner, and always preserves
 * human approval. Circuit may only refine safe prose on top of this.
 */

const NEXT_MEASUREMENTS = [
  "Did the owner pursue the recommendation?",
  "Was the technical artifact completed?",
  "Did the customer meeting occur?",
  "Was an opportunity created or did its stage change?",
  "Was known information unnecessarily re-asked?"
];

function personFromRoster(name: string | null, email: string | null): RosterMember | null {
  try {
    return matchRosterMember({ name: name ?? undefined, email: email ?? undefined });
  } catch {
    return null;
  }
}

function routingRecipient(lane: "sales" | "technical"): { name: string | null; email: string | null; role: string } {
  try {
    const r = loadRoutingConfig().recipients?.[lane];
    return { name: r?.name ?? null, email: r?.email ?? null, role: r?.assignment_label ?? (lane === "sales" ? "Sales / Commercial owner" : "Technical / Specialist owner") };
  } catch {
    return { name: null, email: null, role: lane === "sales" ? "Sales / Commercial owner" : "Technical / Specialist owner" };
  }
}

function orchestrationLane(lane: string): ActionLane {
  if (lane === "technical") return "technical";
  if (lane === "leadership" || lane === "executive") return "leadership";
  return "commercial";
}

/** The governed decision, mapped from deterministic verdict / pursuit / evidence.
 * An explicit customer negation → PASS; a NOISE / non-actionable run → NOT_NOW;
 * an actionable run blocked on missing account identity → NEED_MORE_INFORMATION;
 * otherwise PURSUE. Never reverses an explicit rejection. */
function mapDecision(result: SecureNetworkingTriageResult, actionable: boolean, negationIds: string[]): GovernedDecision {
  const pursuit = result.opportunity_scoring?.decision;
  const verdict = result.executive_summary.verdict;
  const nbaType = result.next_best_action?.action_type;
  if (negationIds.length > 0 || (pursuit === "DO_NOT_PURSUE" && negationIds.length > 0)) return "PASS";
  if (!actionable || verdict === "NOISE" || pursuit === "DO_NOT_PURSUE" || pursuit === "HOLD") return "NOT_NOW";
  if (nbaType === "account_confirmation") return "NEED_MORE_INFORMATION";
  return "PURSUE";
}

function resolveParty(lane: "sales" | "technical", perspectiveIsOwner: boolean): ResolvedParty {
  const recip = routingRecipient(lane);
  const member = personFromRoster(recip.name, recip.email);
  const matches: string[] = [];
  const gaps: string[] = [];
  if (member) {
    matches.push(`routing-config owner for the ${lane} lane`);
    if (member.specialties.length) matches.push(`specialties: ${member.specialties.slice(0, 3).join(", ")}`);
    if (!member.active) gaps.push("roster marks this member inactive");
    if (member.notification_channels.length === 0) gaps.push("no delivery channel on record");
  } else {
    gaps.push("no matching active roster member — role-only slot");
  }
  return {
    // A routing-config owner is a locked deterministic assignment → SELECTED.
    status: member ? "SELECTED" : "UNRESOLVED",
    person_id: member?.person_id ?? null,
    required_role: recip.role,
    lane: lane === "technical" ? "technical" : "commercial",
    selection_reasons: member ? [`Locked ${lane} owner from routing policy`, ...(perspectiveIsOwner ? ["Primary owner for this ActionCase"] : ["Required collaborator for the internal work"])] : [`No individual resolved for the ${lane} lane; use the fallback queue`],
    capability_matches: matches,
    capability_gaps: gaps,
    delivery_ready: Boolean(member && member.active && member.notification_channels.length > 0),
    confidence: member ? 0.85 : 0.3,
    advisory_only: !member
  };
}

function buildOwnerResolution(result: SecureNetworkingTriageResult): OwnerResolution {
  const plan = result.internal_action_plan;
  const primaryLane: "sales" | "technical" = plan?.primary_owner.lane === "technical" ? "technical" : "sales";
  const collaboratorLanes = new Set<"sales" | "technical">();
  for (const c of plan?.coordinate_with ?? []) {
    if (c.lane === "technical") collaboratorLanes.add("technical");
    if (c.lane === "sales") collaboratorLanes.add("sales");
  }
  const primary = resolveParty(primaryLane, true);
  const collaborators: ResolvedParty[] = [...collaboratorLanes].filter((l) => l !== primaryLane).map((l) => resolveParty(l, false));
  const unfilled: OwnerResolution["unfilled_roles"] = [];
  // A conditional executive step is a role-only requirement — never an invented person.
  const execStep = (plan?.coordinate_with ?? []).find((c) => c.lane === "executive");
  if (execStep) unfilled.push({ required_role: execStep.role, reason: "Internal leadership involvement is conditional (funding gate / explicit trigger); no named leader is assigned deterministically.", fallback_queue: null });
  return { primary_owner: primary, collaborators, alternatives: [], unfilled_roles: unfilled };
}

function buildActionGraph(result: SecureNetworkingTriageResult, owner: OwnerResolution, actionCaseId: string | null): ActionGraph {
  const plan = result.internal_action_plan;
  const nba = result.next_best_action;
  const steps: ActionStep[] = [];
  if (!plan || !nba) {
    return { steps, edges: [], next_ready_step_ids: [], blocked_step_ids: [], graph_summary: "No actionable internal work — the run is not a qualified opportunity." };
  }
  const actionStatus = result.feedback?.action_status ?? "recommended";
  const ownerStatus: ActionStep["status"] = actionStatus === "completed" ? "completed" : actionStatus === "in_progress" ? "in_progress" : actionStatus === "accepted" ? "accepted" : "pending";
  const ownerLane = orchestrationLane(plan.primary_owner.lane);

  // Step 1 — the primary owner's immediate internal move.
  const ownerStepId = "owner-move";
  steps.push({
    id: ownerStepId,
    actionCaseId,
    title: `${plan.primary_owner.role}: own the internal next move`,
    lane: ownerLane,
    assigneePersonId: owner.primary_owner.person_id,
    requiredRole: plan.primary_owner.role,
    timing: "immediate",
    requirement: "required",
    description: plan.your_move,
    reason: plan.routed_reason,
    expectedArtifact: "A coordinated internal plan the customer-facing step can build on.",
    dependencyStepIds: [],
    status: ownerStatus,
    dueAt: null,
    customerFacing: false,
    evidenceIds: nba.evidence_ids ?? [],
    policyIds: [],
    failureModeIfSkipped: "The internal work is uncoordinated and the customer step is not credible.",
    confidence: 0.8
  });

  // Immediate collaborator steps (technical/commercial) + conditional later steps.
  const requiredInternalIds: string[] = [ownerStepId];
  let idx = 0;
  const collabIds = new Map<string, string>();
  for (const c of plan.coordinate_with) {
    idx += 1;
    const stepId = `coordinate-${c.lane}-${idx}`;
    const isConditional = c.requirement === "conditional" || c.requirement === "context_only";
    const timing = (["immediate", "before_customer_meeting", "after_validation", "at_funding_gate", "if_blocked"].includes(c.timing) ? c.timing : "before_customer_meeting") as ActionStep["timing"];
    const requirement = (c.requirement === "required" || c.requirement === "recommended" || c.requirement === "conditional" ? c.requirement : "recommended") as ActionStep["requirement"];
    const assignee = c.lane === "technical" ? routingRecipient("technical") : c.lane === "sales" ? routingRecipient("sales") : { name: null, email: null, role: c.role };
    const member = c.lane === "executive" ? null : personFromRoster(assignee.name, assignee.email);
    steps.push({
      id: stepId,
      actionCaseId,
      title: `${c.role}: ${isConditional ? "conditional coordination" : "prepare and coordinate"}`,
      lane: orchestrationLane(c.lane),
      assigneePersonId: member?.person_id ?? null,
      requiredRole: c.role,
      timing,
      requirement,
      description: c.why,
      reason: c.condition ? `Conditional: ${c.condition}.` : c.why,
      expectedArtifact: c.prepare.length > 0 ? c.prepare.join("; ") : "A prepared contribution for the customer step.",
      dependencyStepIds: [],
      status: isConditional ? "pending" : "pending",
      dueAt: null,
      customerFacing: false,
      evidenceIds: [],
      policyIds: c.trigger_code ? [c.trigger_code] : [],
      failureModeIfSkipped: c.condition ? "A later-stage gate is missed if this is skipped when triggered." : "The customer step proceeds without the required preparation.",
      confidence: 0.7
    });
    collabIds.set(c.lane, stepId);
    if (!isConditional && c.lane === "technical") requiredInternalIds.push(stepId);
  }

  // Customer-facing step — becomes ready only AFTER the required internal prep.
  const customerStepId = "customer-step";
  const custDeps = requiredInternalIds;
  steps.push({
    id: customerStepId,
    actionCaseId,
    title: nba.title,
    lane: ownerLane,
    assigneePersonId: owner.primary_owner.person_id,
    requiredRole: plan.primary_owner.role,
    timing: requiredInternalIds.some((id) => id.startsWith("coordinate-technical")) ? "after_validation" : "before_customer_meeting",
    requirement: "required",
    description: plan.customer_engagement.next_step,
    reason: (nba.why_now ?? []).slice(0, 1).join(" ") || "The customer requested a concrete next step.",
    expectedArtifact: (nba.success_criteria ?? []).slice(0, 2).join("; ") || "An agreed customer next step with owner and date.",
    dependencyStepIds: custDeps,
    status: "blocked",
    dueAt: nba.recommended_timing ?? null,
    customerFacing: true,
    evidenceIds: nba.evidence_ids ?? [],
    policyIds: [],
    failureModeIfSkipped: "The opportunity stalls without an agreed customer next step.",
    confidence: 0.75
  });

  const edges = requiredInternalIds.map((fromStepId) => ({ fromStepId, toStepId: customerStepId, condition: "expected artifact completed and accepted" }));

  // Acyclic by construction: internal steps have no deps; the customer step
  // depends only on required internal steps. Ready = required internal steps not
  // yet completed; blocked = steps with an unmet dependency.
  const completed = new Set(steps.filter((s) => s.status === "completed").map((s) => s.id));
  const blocked = steps.filter((s) => s.dependencyStepIds.some((d) => !completed.has(d))).map((s) => s.id);
  const nextReady = steps.filter((s) => s.dependencyStepIds.every((d) => completed.has(d)) && s.status !== "completed" && !s.customerFacing).map((s) => s.id);

  return {
    steps,
    edges,
    next_ready_step_ids: nextReady,
    blocked_step_ids: blocked,
    graph_summary: `${owner.primary_owner.required_role} coordinates the internal work; the customer step (${nba.title}) is ready once the required internal preparation is complete.`
  };
}

function buildCustomerEngagement(result: SecureNetworkingTriageResult): CustomerEngagementPlan {
  const plan = result.internal_action_plan;
  const nba = result.next_best_action;
  const doNotReask = result.specialist_handoffs?.sales?.questions_not_to_reask ?? [];
  const stances = new Set(["supportive", "neutral", "skeptical", "blocker", "unknown"]);
  const powerByName = new Map((result.deal_intelligence?.power_map ?? []).map((p) => [p.name, p]));
  return {
    next_customer_step: {
      title: nba?.title ?? null,
      owner_person_id: null,
      timing: nba?.recommended_timing ?? null,
      expected_outcome: (nba?.success_criteria ?? []).slice(0, 2).join("; ") || null,
      prerequisite_step_ids: nba ? ["owner-move"] : [],
      evidence_ids: nba?.evidence_ids ?? []
    },
    stakeholders: (plan?.customer_engagement.stakeholders ?? []).map((s) => {
      const play = s.name ? powerByName.get(s.name) : undefined;
      const stance = (play?.stance && stances.has(play.stance) ? play.stance : "unknown") as CustomerEngagementPlan["stakeholders"][number]["stance"];
      return {
        person_or_role: s.name ?? s.role,
        buying_role: s.role,
        stance,
        engagement_objective: s.engagement || "Engage on the next step and confirm their part of the decision.",
        do_not_reask: doNotReask.slice(0, 3),
        expected_contribution_or_decision: play?.play ?? "Confirm their contribution to the next step.",
        evidence_ids: play?.evidence ? [play.evidence] : [],
        confidence: play ? 0.6 : 0.5
      };
    })
  };
}

function packetCollaborators(rm: RoleMessage): Array<{ person_id: string | null; role: string; why: string; prepare: string[] }> {
  return (rm.internal_action?.coordinate_with ?? [])
    .filter((c) => c.requirement === "required" || c.requirement === "recommended")
    .map((c) => {
      const member = c.lane === "executive" ? null : personFromRoster(c.name, null);
      return { person_id: member?.person_id ?? null, role: c.role, why: c.why, prepare: c.prepare };
    });
}

function buildRolePackets(result: SecureNetworkingTriageResult, owner: OwnerResolution): RolePackets {
  const plan = result.internal_action_plan;
  if (!plan) return { commercial: null, technical: null, leadership: null, legal: null, services: null };
  const packet = buildIntelligencePacket(result);
  const salesRm = generateRoleMessage(packet, "sales");
  const techRm = generateRoleMessage(packet, "technical");
  const laterOf = (rm: RoleMessage) => (rm.internal_action?.coordinate_with ?? []).find((c) => c.requirement === "conditional")?.condition ?? null;
  const salesPerson = owner.primary_owner.lane === "commercial" ? owner.primary_owner.person_id : owner.collaborators.find((c) => c.lane === "commercial")?.person_id ?? null;
  const techPerson = owner.primary_owner.lane === "technical" ? owner.primary_owner.person_id : owner.collaborators.find((c) => c.lane === "technical")?.person_id ?? null;
  return {
    commercial:
      salesRm.kind === "no_action"
        ? null
        : {
            recipient_person_id: salesPerson,
            your_move_now: salesRm.internal_action?.your_move ?? salesRm.action,
            why_routed_to_you: salesRm.internal_action?.routed_reason ?? "You own the commercial motion for this account.",
            coordinate_with: packetCollaborators(salesRm),
            dependency: salesRm.internal_action?.coordinate_with.some((c) => c.lane === "technical") ? "The customer step is blocked until the technical validation packet is completed." : null,
            customer_next_step: salesRm.internal_action?.customer_engagement.next_step ?? salesRm.action,
            expected_customer_outcome: salesRm.expected_outcome,
            watch_out: salesRm.watch_out,
            later_gate: laterOf(salesRm),
            evidence_ids: salesRm.evidence_ids,
            message_text: renderWebexMessage(salesRm)
          },
    technical:
      techRm.kind === "no_action"
        ? null
        : {
            recipient_person_id: techPerson,
            your_move_now: techRm.internal_action?.your_move ?? techRm.action,
            why_routed_to_you: techRm.internal_action?.routed_reason ?? "You own the technical validation for this account.",
            coordinate_with: packetCollaborators(techRm),
            customer_problem: techRm.why_this_matters,
            known_environment: packet.current_environment,
            required_artifact: "A customer-ready technical validation plan (scenarios, data sources, integrations, pass/fail criteria).",
            dependency: "The commercial agenda is blocked until this validation packet is completed and accepted.",
            customer_next_step: techRm.internal_action?.customer_engagement.next_step ?? techRm.action,
            watch_out: techRm.watch_out,
            later_gate: laterOf(techRm),
            evidence_ids: techRm.evidence_ids,
            message_text: renderWebexMessage(techRm)
          },
    leadership: null,
    legal: null,
    services: null
  };
}

function buildOutcomeLedger(result: SecureNetworkingTriageResult, actionCaseId: string | null, existingEvents: OutcomeEvent[]): OutcomeLedger {
  const proposed: OutcomeLedger["proposed_events"] = [];
  const status = result.feedback?.action_status;
  const now = result.timestamp ?? new Date().toISOString();
  // An observed event already on record must not be re-proposed.
  const recordedTypes = new Set(existingEvents.map((e) => e.type));
  // Only propose events the input actually reports — never because AI acted — and
  // never a type that is already on the append-only ledger.
  if ((status === "accepted" || status === "in_progress" || status === "completed") && !recordedTypes.has("owner_accepted")) {
    proposed.push({
      id: null,
      actionCaseId,
      type: "owner_accepted",
      source: "user",
      observedAt: now,
      baselineValue: null,
      observedValue: null,
      attributionConfidence: 0.9,
      attributionLanguage: "observed after action",
      evidenceIds: [],
      limitations: ["Owner acceptance is recorded from user feedback; downstream customer outcomes are not yet observed."]
    });
  }
  if (status === "completed" && !recordedTypes.has("step_completed")) {
    proposed.push({
      id: null,
      actionCaseId,
      type: "step_completed",
      source: "user",
      observedAt: now,
      baselineValue: null,
      observedValue: null,
      attributionConfidence: 0.85,
      attributionLanguage: "observed after action",
      evidenceIds: [],
      limitations: ["Step completion is user-reported; causation to any revenue outcome is not established."]
    });
  }
  // Summarize observed history WITHOUT claiming causation.
  const observedTypes = existingEvents.map((e) => e.type.replace(/_/g, " "));
  const outcome_summary = existingEvents.length > 0
    ? `${existingEvents.length} observed event(s) on record (${Array.from(new Set(observedTypes)).slice(0, 4).join(", ")}); temporally associated with the ActionCase — causation is not established.`
    : status && status !== "recommended"
      ? `The owner has marked this action ${status.replace(/_/g, " ")}. No customer-facing outcome has been observed yet.`
      : null;
  return {
    existing_event_count: existingEvents.length,
    existing_events: existingEvents,
    proposed_events: proposed,
    outcome_summary,
    next_measurements: NEXT_MEASUREMENTS,
    causation_not_established: true
  };
}

export function buildActionCase(result: SecureNetworkingTriageResult, opts: { existingOutcomeEvents?: OutcomeEvent[] } = {}): ActionCase {
  const account = getCanonicalAccount(result);
  const plan = result.internal_action_plan ?? null;
  const dp = result.decision_packet;
  const actionable = Boolean(plan) && result.next_best_action?.action_type !== "suppress" && result.next_best_action?.action_type !== "hold";

  const negationIds = (dp?.objections ?? []).filter((o) => o.type === "disqualifier").flatMap((o) => o.evidence_ids ?? []);
  const decision = mapDecision(result, actionable, negationIds);

  const thread = result.opportunity_thread ?? null;
  const previousRuns = thread?.previous_run_count ?? 0;
  const materialChanges = (thread?.material_changes ?? []).filter((c) => !/no material change/i.test(c));
  const hasMaterialChange = materialChanges.length > 0;
  const threadId = thread?.thread_id ?? null;

  const mode: ActionCase["mode"] = previousRuns > 0 ? "UPDATE" : "CREATE";
  const status: OrchestrationStatus =
    decision === "PURSUE" ? "READY" : decision === "NEED_MORE_INFORMATION" ? "NEEDS_MORE_INFORMATION" : "NOT_ACTIONABLE";

  const duplicate_status =
    decision === "PASS"
      ? "REJECTED_MOTION"
      : previousRuns === 0
        ? "NEW"
        : hasMaterialChange
          ? "MATERIAL_UPDATE"
          : "REPEATED_NO_CHANGE";
  const recommended_handling =
    duplicate_status === "REJECTED_MOTION"
      ? "SUPPRESS"
      : duplicate_status === "NEW"
        ? "CREATE"
        : duplicate_status === "MATERIAL_UPDATE"
          ? "UPDATE_EXISTING"
          : "SUPPRESS";

  const positiveEvidenceIds = Array.from(new Set([...(result.next_best_action?.evidence_ids ?? []), ...(dp?.decision_criteria ?? []).flatMap((c) => c.evidence_ids ?? [])])).slice(0, 12);
  const riskEvidenceIds = Array.from(new Set((dp?.objections ?? []).filter((o) => o.type !== "disqualifier").flatMap((o) => o.evidence_ids ?? []))).slice(0, 8);

  const owner_resolution = buildOwnerResolution(result);
  const action_graph = buildActionGraph(result, owner_resolution, threadId);
  const customer_engagement_plan = buildCustomerEngagement(result);
  const role_packets = buildRolePackets(result, owner_resolution);
  const outcome_ledger = buildOutcomeLedger(result, threadId, opts.existingOutcomeEvents ?? []);

  // MEDDPICC gaps become the bounded discovery evidence for NEED_MORE_INFORMATION.
  const meddpiccGaps = Object.values(result.meddpicc ?? {})
    .flatMap((f) => (f as { gaps?: string[] }).gaps ?? [])
    .filter(Boolean)
    .slice(0, 5);

  // Deterministic quality gate.
  const stepIds = new Set(action_graph.steps.map((s) => s.id));
  const dependencyIntegrity = action_graph.steps.every((s) => s.dependencyStepIds.every((d) => stepIds.has(d)));
  const acyclic = isAcyclic(action_graph.steps);
  const limitations = [...(dp?.evidence_quality?.limitations ?? [])];
  const missing_inputs: string[] = [];
  if (previousRuns === 0 && !thread) missing_inputs.push("No opportunity-thread history was available for duplicate detection.");
  if (!owner_resolution.primary_owner.person_id) missing_inputs.push("No roster person resolved for the primary owner (role-only slot).");

  return {
    schema_version: "signal-to-action-orchestration-v1",
    status,
    mode,
    run_id: result.run_id,
    action_case: {
      action_case_id: null,
      opportunity_thread_id: threadId,
      title: `${account.label} — ${result.executive_summary.primary_opportunity ?? "opportunity"}`,
      account_id: null,
      account_name: account.name,
      normalized_motion: result.matches?.[0]?.entry_id ?? result.executive_summary.primary_opportunity ?? null,
      current_state: result.feedback?.action_status ?? "proposed",
      recommended_decision: decision,
      requires_human_approval: true,
      decision_reason: buildDecisionReason(result, decision),
      positive_evidence_ids: positiveEvidenceIds,
      risk_evidence_ids: riskEvidenceIds,
      explicit_negation_ids: negationIds.slice(0, 8),
      limitations
    },
    novelty_and_duplication: {
      duplicate_status,
      existing_action_case_id: previousRuns > 0 ? threadId : null,
      material_change: hasMaterialChange,
      material_change_reasons: materialChanges.slice(0, 6),
      evidence_ids: positiveEvidenceIds.slice(0, 6),
      recommended_handling
    },
    human_decision_effects: {
      pursue: { create_or_activate_action_case: true, assign_work: true, start_timing: true, prepare_role_packets: true, allow_delivery_after_approval: true, suppress_duplicate_signals: true },
      need_more_information: { create_bounded_discovery_steps: true, notify_full_team: false, required_evidence: meddpiccGaps, reevaluation_trigger: meddpiccGaps.length > 0 ? "Missing MEDDPICC facts confirmed" : null },
      not_now: { preserve_case: true, suppress_unchanged_signals: true, reevaluation_date: null, reevaluation_condition: "A material change (new commitment, funding, decision date, or stakeholder) appears" },
      pass: { preserve_disqualifying_evidence: true, block_same_rejected_motion: true, route_elsewhere_if_applicable: null }
    },
    owner_resolution,
    action_graph,
    customer_engagement_plan,
    role_packets,
    outcome_ledger,
    quality: {
      evidence_grounded: positiveEvidenceIds.length > 0 || !actionable,
      no_invented_people: true,
      internal_customer_separation_valid: internalCustomerSeparationValid(result, action_graph),
      owner_constraints_preserved: true,
      graph_acyclic: acyclic,
      dependency_integrity_valid: dependencyIntegrity,
      human_approval_preserved: true,
      outcome_attribution_safe: true,
      messages_action_first: true,
      duplicate_policy_respected: true,
      limitations,
      missing_inputs
    },
    source: "deterministic"
  };
}

function buildDecisionReason(result: SecureNetworkingTriageResult, decision: GovernedDecision): string {
  const account = getCanonicalAccount(result).label;
  switch (decision) {
    case "PURSUE":
      return `${account} shows a credible, material opportunity with a real next step; the organization can define useful internal work.`;
    case "NEED_MORE_INFORMATION":
      return `${account} may be credible, but a bounded discovery step is needed before committing internal work.`;
    case "NOT_NOW":
      return `${account} does not currently support action; preserve the case and re-evaluate on a material change.`;
    case "PASS":
      return `The customer explicitly rejected or disqualified this motion for ${account}; do not route pursuit work and keep the rejection on record.`;
    default:
      return "";
  }
}

/** No customer participant may appear as an internal ActionStep assignee. */
function internalCustomerSeparationValid(result: SecureNetworkingTriageResult, graph: ActionGraph): boolean {
  const customerNames = new Set(
    (result.stakeholder_analysis?.participants ?? [])
      .filter((p) => p.classification === "customer" && p.name)
      .map((p) => p.name!.trim().toLowerCase())
  );
  const rosterById = new Map<string, string>();
  try {
    for (const m of loadRoster().members) rosterById.set(m.person_id, m.name.toLowerCase());
  } catch {
    /* roster optional */
  }
  return graph.steps.every((s) => {
    if (!s.assigneePersonId) return true;
    const name = rosterById.get(s.assigneePersonId);
    return !name || !customerNames.has(name);
  });
}

/** Kahn's-algorithm cycle check over the dependency edges. */
function isAcyclic(steps: ActionStep[]): boolean {
  const ids = new Set(steps.map((s) => s.id));
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of steps) indegree.set(s.id, 0);
  for (const s of steps) {
    for (const dep of s.dependencyStepIds) {
      if (!ids.has(dep)) continue;
      adj.set(dep, [...(adj.get(dep) ?? []), s.id]);
      indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
    }
  }
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of adj.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return visited === steps.length;
}
