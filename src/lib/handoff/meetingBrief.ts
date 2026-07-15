import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { NextBestAction } from "@/lib/action-intelligence/types";
import type { AgendaItem, MeetingPacket, MeetingScenario, QuestionIndex } from "@/lib/handoff/types";
import { doNotReaskTopics } from "@/lib/handoff/questionIndex";

/**
 * Builds a ready-to-run meeting/workshop packet (Section 7) when the
 * recommended action is a workshop, PoV, demo, or discovery session. The
 * packet is usable without reopening the transcript. Every element is
 * derived from run evidence; nothing is hard-coded.
 */

const MEETING_ACTION_TYPES = new Set(["architecture_workshop", "proof_of_value", "demo", "technical_discovery", "commercial_discovery", "executive_alignment", "procurement_discovery"]);

export function isMeetingAction(action: NextBestAction): boolean {
  return MEETING_ACTION_TYPES.has(action.action_type);
}

function scenariosFrom(result: SecureNetworkingTriageResult, index: QuestionIndex): MeetingScenario[] {
  // Prefer concise pain-category labels as scenario names (a raw
  // "let's run a working session..." sentence reads poorly as a name).
  const painCategories = result.matches.slice(0, 2).map((m) => m.pain_category).filter(Boolean);

  const dataSources = (result.generic_diagnostics?.signals.technical ?? [])
    .filter((s) => s.category === "current_environment" || s.category === "integration_requirement")
    .map((s) => s.text)
    .slice(0, 4);
  const constraints = (result.generic_diagnostics?.signals.technical ?? [])
    .filter((s) => s.category === "risk")
    .map((s) => s.text)
    .slice(0, 3);
  const successCriteria = (result.generic_diagnostics?.signals.technical ?? [])
    .filter((s) => s.category === "success_metric")
    .map((s) => s.text)
    .slice(0, 3);

  const names = painCategories.length > 0 ? painCategories : ["Priority use case"];
  const knownContext = doNotReaskTopics(index, 4);

  return names.slice(0, 3).map((name, i) => ({
    name: name.length > 90 ? `${name.slice(0, 87)}...` : name,
    business_question: `What outcome must this scenario prove for ${result.executive_summary.account ?? "the account"}?`,
    known_context: knownContext,
    data_sources: dataSources,
    constraints,
    success_criteria: successCriteria.length > 0 ? successCriteria : ["Agree the pass/fail criterion for this scenario before the session."],
    human_approval_points: i === 0 ? ["Customer confirms the authoritative data sources", "Customer agrees what remains in existing systems"] : []
  }));
}

export function buildMeetingPacket(params: {
  result: SecureNetworkingTriageResult;
  action: NextBestAction;
  questionIndex: QuestionIndex;
}): MeetingPacket | null {
  const { result, action, questionIndex } = params;
  if (!isMeetingAction(action)) return null;

  const participantRoles = [
    ...(result.stakeholder_analysis?.named_stakeholders ?? []).map((s) => ({ role: s.function_or_role, reason: s.why_it_matters })),
    ...(result.stakeholder_analysis?.functional_owners ?? []).map((s) => ({ role: s.function_or_role, reason: s.why_it_matters }))
  ].slice(0, 6);

  const duration = action.action_type === "architecture_workshop" ? 90 : action.action_type === "proof_of_value" ? 60 : 45;
  const scenarios = scenariosFrom(result, questionIndex);

  const agenda: AgendaItem[] = [
    { minutes: 10, topic: "Confirm scope and known context (no re-discovery)", owner: action.primary_owner, desired_output: "Shared agreement on what is already established" },
    ...scenarios.map((s) => ({ minutes: Math.round((duration - 25) / Math.max(1, scenarios.length)), topic: `Scenario: ${s.name}`, owner: action.primary_owner, desired_output: `Validated data sources and pass/fail criteria for ${s.name}` })),
    { minutes: 15, topic: "Agree success criteria, owners, and next step", owner: action.primary_owner, desired_output: "Documented criteria, participants, and follow-up action" }
  ];

  return {
    meeting_type: action.action_type,
    title: action.title,
    objective: action.summary,
    recommended_duration_minutes: duration,
    required_participants: participantRoles.length > 0 ? participantRoles : [{ role: "Customer technical + business owner", reason: "Needed to validate scenarios and confirm data sources" }],
    optional_participants: [],
    prework: [
      "Review the specialist handoff packet (do not reopen the full transcript)",
      "Confirm the authoritative data sources for the first scenario"
    ],
    agenda,
    scenarios,
    questions_not_to_reask: doNotReaskTopics(questionIndex, 8),
    // All genuinely-open questions (blocking first), so the meeting packet
    // and the top-level handoff never disagree on what remains.
    remaining_questions: [...questionIndex.open].sort((a, b) => Number(b.blocking) - Number(a.blocking)).map((q) => q.question).slice(0, 5),
    deliverables: action.success_criteria.length > 0 ? [`Written outcome against: ${action.success_criteria.join("; ")}`] : ["Written scenario outcomes and agreed next step"],
    follow_up_actions: [action.fallback_action ?? `${action.primary_owner} circulates the outcome and proposed next step within one week.`]
  };
}
