import { readFileSync } from "node:fs";
import path from "node:path";
import type { HandoffReadiness, ReadinessComponent, ReadinessStatus, SpecialistHandoffPacket } from "@/lib/handoff/types";

/**
 * Deterministic handoff-readiness scoring (Section 9). Measures whether a
 * specialist can act from the packet alone — deliberately SEPARATE from
 * MEDDPICC completeness (an early-discovery opportunity with thin MEDDPICC
 * can still be handoff-ready). All weights/thresholds are read from
 * signal-agent-poc/config/handoff_readiness_scoring.json.
 */

type ReadinessConfig = {
  weights: Record<string, number>;
  thresholds: { ready: number; ready_with_gaps: number };
  blocking_dimensions: string[];
};

let cached: ReadinessConfig | null = null;
export function clearHandoffReadinessConfigCache(): void {
  cached = null;
}
function loadConfig(): ReadinessConfig {
  if (cached) return cached;
  const text = readFileSync(path.join(process.cwd(), "signal-agent-poc/config/handoff_readiness_scoring.json"), "utf8");
  cached = JSON.parse(text) as ReadinessConfig;
  return cached;
}

function isGenericAction(summary: string): boolean {
  const generic = [/^progress the opportunity/i, /^follow up with the customer\.?$/i, /^engage the specialist/i, /^advance the motion/i, /^schedule a meeting\.?$/i, /^validate fit\.?$/i];
  return generic.some((re) => re.test(summary.trim()));
}

/** Each dimension returns a 0..1 sub-score from the assembled packet. */
function dimensionScores(packet: SpecialistHandoffPacket): Record<string, { score: number; detail: string }> {
  const action = packet.recommended_action;
  const actionable = action.action_type !== "hold" && action.action_type !== "suppress";

  return {
    account_resolution: {
      score: packet.account.status === "confirmed" ? 1 : packet.account.status === "probable" ? 0.75 : packet.account.name ? 0.4 : 0,
      detail: `Account ${packet.account.status}`
    },
    problem_clarity: {
      score: packet.customer_problem && packet.customer_problem.length > 24 ? 1 : packet.customer_problem ? 0.5 : 0,
      detail: packet.customer_problem ? "Customer problem stated" : "No customer problem captured"
    },
    next_action_clarity: {
      score: actionable && !isGenericAction(action.summary) && action.summary.length > 40 ? 1 : actionable ? 0.4 : 0,
      detail: actionable ? `Action: ${action.action_type}` : "No active action"
    },
    owner_assignment: {
      score: actionable && action.primary_owner ? 1 : 0,
      detail: action.primary_owner ? `Owner: ${action.primary_owner}` : "No owner"
    },
    evidence_quality: {
      score: Math.min(1, action.evidence_ids.length / 6),
      detail: `${action.evidence_ids.length} evidence ids on the action`
    },
    stakeholder_coverage: {
      score: Math.min(1, packet.stakeholder_map.length / 3),
      detail: `${packet.stakeholder_map.length} stakeholders`
    },
    known_environment_coverage: {
      score: Math.min(1, (packet.current_environment.length + packet.technical_context.length) / 3),
      detail: `${packet.current_environment.length} environment facts`
    },
    decision_criteria_coverage: {
      score: (packet.meddpicc_summary.decision_criteria?.status === "CONFIRMED" || packet.meddpicc_summary.decision_criteria?.status === "PARTIAL") ? 1 : packet.success_criteria.length > 0 ? 0.6 : 0,
      detail: `${packet.success_criteria.length} success criteria`
    },
    answered_question_coverage: {
      score: Math.min(1, packet.questions_already_answered.length / 5),
      detail: `${packet.questions_already_answered.length} answered questions indexed`
    },
    meeting_objective: {
      score: packet.meeting_or_workshop_plan ? (packet.meeting_or_workshop_plan.objective.length > 24 ? 1 : 0.5) : actionable ? 0.5 : 0,
      detail: packet.meeting_or_workshop_plan ? "Meeting objective set" : "No meeting packet"
    },
    success_criteria: {
      score: packet.success_criteria.length > 0 ? 1 : 0,
      detail: `${packet.success_criteria.length} success criteria`
    },
    delivery_target: {
      score: packet.recipient.name ? 1 : 0,
      detail: `Recipient ${packet.recipient.name || "unset"}`
    }
  };
}

export function computeHandoffReadiness(packet: SpecialistHandoffPacket): HandoffReadiness {
  const config = loadConfig();
  const scores = dimensionScores(packet);
  const components: ReadinessComponent[] = [];
  const blocking_gaps: string[] = [];
  const recommended_remediation: string[] = [];
  let total = 0;

  for (const [dimension, weight] of Object.entries(config.weights)) {
    const sub = scores[dimension] ?? { score: 0, detail: "not evaluated" };
    const contribution = weight * sub.score * 100;
    total += contribution;
    components.push({ dimension, score: Math.round(sub.score * 100) / 100, weight, contribution: Math.round(contribution * 100) / 100, detail: sub.detail });
    if (config.blocking_dimensions.includes(dimension) && sub.score < 0.5) {
      blocking_gaps.push(`${dimension}: ${sub.detail}`);
      recommended_remediation.push(`Resolve ${dimension.replace(/_/g, " ")} before handing off.`);
    }
  }

  const rounded = Math.round(total);
  let status: ReadinessStatus;
  if (blocking_gaps.length > 0) status = "blocked";
  else if (rounded >= config.thresholds.ready) status = "ready";
  else if (rounded >= config.thresholds.ready_with_gaps) status = "ready_with_gaps";
  else status = "blocked";

  return { score: rounded, status, components, blocking_gaps, recommended_remediation };
}
