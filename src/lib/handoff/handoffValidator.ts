import type { NextBestAction } from "@/lib/action-intelligence/types";
import type { SpecialistHandoffPacket } from "@/lib/handoff/types";

/**
 * Handoff + action validation (Section 16). Rejects a packet that would
 * make the specialist re-do discovery or act on a vague recommendation.
 * Generic — no company/product/transcript string appears here.
 */

const GENERIC_ACTION_RE = [
  /^progress the opportunity\.?$/i,
  /^follow up with the customer\.?$/i,
  /^engage the specialist\.?$/i,
  /^advance the motion\.?$/i,
  /^schedule a meeting\.?$/i,
  /^validate fit\.?$/i
];

export function isGenericAction(summary: string): boolean {
  const t = summary.trim();
  return GENERIC_ACTION_RE.some((re) => re.test(t)) || t.length < 25;
}

export function validateNextBestAction(action: NextBestAction): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const active = action.action_type !== "hold" && action.action_type !== "suppress";
  if (!active) return { ok: true, failures };

  if (!action.primary_owner) failures.push("action has no owner");
  if (isGenericAction(action.summary)) failures.push("action is generic / too vague");
  if (action.evidence_ids.length === 0) failures.push("action has no supporting evidence");
  if (action.due_basis === undefined) failures.push("action has no timing basis");
  const needsCriteria = action.action_type === "architecture_workshop" || action.action_type === "proof_of_value" || action.action_type === "demo";
  if (needsCriteria && action.success_criteria.length === 0) failures.push("workshop/PoV action has no success criteria");
  return { ok: failures.length === 0, failures };
}

/** Two lane handoffs must differ materially — a shared 90-second brief +
 * identical remaining questions means the split added no value. */
export function handoffsDiffer(sales: SpecialistHandoffPacket, technical: SpecialistHandoffPacket): boolean {
  if (sales.ninety_second_brief === technical.ninety_second_brief) return false;
  const salesQ = new Set(sales.remaining_questions.map((q) => q.question));
  const techQ = technical.remaining_questions.map((q) => q.question);
  const sharedTalking = sales.recommended_talking_points.join("|") === technical.recommended_talking_points.join("|");
  // Different opening + at least some divergence in questions or context.
  const questionsDiverge = techQ.some((q) => !salesQ.has(q)) || sales.remaining_questions.length !== technical.remaining_questions.length;
  return !sharedTalking || questionsDiverge || sales.business_context.join("|") !== technical.technical_context.join("|");
}

export function validateHandoff(packet: SpecialistHandoffPacket): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const actionResult = validateNextBestAction(packet.recommended_action);
  failures.push(...actionResult.failures);

  // Answered questions must never reappear as open discovery questions.
  const answeredTopics = new Set(packet.questions_already_answered.filter((a) => a.answer_status === "complete").map((a) => a.topic.toLowerCase()));
  for (const q of packet.remaining_questions) {
    // An open question whose purpose targets a topic already fully answered is a re-ask.
    const purposeTopic = q.purpose.toLowerCase();
    for (const topic of answeredTopics) {
      if (purposeTopic.includes(topic) && q.blocking) {
        failures.push(`open question re-asks an already-answered topic: ${q.question}`);
        break;
      }
    }
  }

  // Declined/sensitive topics must not appear as casual open questions.
  const declined = packet.sensitive_or_declined_questions.map((d) => d.what_was_declined.toLowerCase());
  for (const q of packet.remaining_questions) {
    if (declined.some((d) => d.length > 20 && q.question.toLowerCase().includes(d.slice(0, 20)))) {
      failures.push(`open question re-raises a declined/sensitive topic: ${q.question}`);
    }
  }

  // A meeting packet must have expected outputs and (for workshop/PoV) success criteria.
  if (packet.meeting_or_workshop_plan) {
    if (packet.meeting_or_workshop_plan.agenda.some((a) => !a.desired_output)) failures.push("meeting agenda item has no desired output");
    if ((packet.meeting_or_workshop_plan.meeting_type === "architecture_workshop" || packet.meeting_or_workshop_plan.meeting_type === "proof_of_value") && packet.success_criteria.length === 0) {
      failures.push("workshop/PoV has no success criteria");
    }
  }

  // Public context, if present, must carry an action implication.
  for (const p of packet.public_context) {
    if (!p.handoff_implication || !p.action_effect) failures.push("public context has no action implication");
  }

  return { ok: failures.length === 0, failures };
}
