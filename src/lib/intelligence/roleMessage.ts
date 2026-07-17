import type { IntelligencePacket, MessageLane, RoleMessage } from "@/lib/intelligence/types";

/**
 * generateRoleMessage(packet, lane) -> the ONE content decision for a lane.
 *
 * This is the deterministic synthesizer. It composes a concise, role-specific,
 * evidence-grounded message from the canonical IntelligencePacket — NEVER from
 * raw transcript text. Circuit, when available, refines this same shape and
 * falls back to exactly this output; every channel renders the result. The
 * synthesis is rich (a real "why this matters", an honest "why now", the one
 * canonical action, a concrete outcome, and one decisive watch-out) so the
 * delivered message reads like seller intelligence, not a field dump.
 */

const HEDGED = /\b(?:it may be|may be|might be|could be|would be|may need|becoming harder|harder to meet|perhaps|possibly)\b/i;

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function upperFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function stripValuePrefix(s: string): string {
  return s.replace(/^frame value in their words:\s*/i, "").replace(/^["']|["']$/g, "").trim();
}
/** Strips conversational lead-ins from a raw success-criteria/outcome quote. */
function stripCriteriaFiller(s: string): string {
  return s
    .replace(/^(?:for\s+)?success criteria(?:\s+(?:are|would be|could be|include|is|i suggest))?[:,]?\s*/i, "")
    .replace(/^(?:i(?:'d| would)?\s+suggest|i think|maybe|ideally|we(?:'d| would)?\s+(?:like|want))[:,]?\s*/i, "")
    .trim();
}
/** Joins a sentence and clause without producing a double terminal period. */
function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
function clean(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t.replace(/[,;:]\s*$/, "");
  const slice = t.slice(0, max);
  const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(", "), slice.lastIndexOf("; "));
  return (end > max * 0.5 ? slice.slice(0, end) : slice.slice(0, slice.lastIndexOf(" "))).replace(/[,;:]\s*$/, "").trim();
}
function firstMeaningful(...cands: Array<string | null | undefined>): string | null {
  for (const c of cands) {
    const t = (c ?? "").trim();
    if (t && !/^(not stated|none|no quantified|no explicit|not yet|unknown|n\/a)\b/i.test(t)) return t;
  }
  return null;
}

/** WHY THIS MATTERS — a synthesized read of the opportunity, not a category tag.
 * Composes the core problem, the expansion-vs-net-new framing, and the business
 * stakes, all from packet fields. */
function whyThisMatters(packet: IntelligencePacket, lane: MessageLane): string {
  const account = packet.identity.account_prose;
  const problem = lowerFirst(packet.opportunity.primary_opportunity);
  const parts: string[] = [];

  if (lane === "technical") {
    parts.push(`${upperFirst(account)}'s core problem is ${sentence(problem)}`);
    const stakes = firstMeaningful(stripValuePrefix(packet.deal_intelligence.value_hypothesis ?? ""), packet.customer_evidence.business_impacts[0]?.statement);
    if (stakes) parts.push(sentence(`The stakes: ${clean(stakes, 160).replace(/[.]+$/, "")}`));
    if (packet.deal_intelligence.existing_footprint) parts.push("The product already exists in pockets, so this validates an expansion, not a net-new deployment.");
    return clean(parts.join(" "), 380);
  }

  // Sales / leadership: account importance + commercial framing.
  parts.push(`${upperFirst(account)} is working to ${sentence(problem)}`);
  if (packet.deal_intelligence.existing_footprint) {
    parts.push(`${packet.opportunity.primary_solution_motion ?? "The platform"} already exists in pockets, so this is an expansion play rather than a net-new platform decision.`);
  }
  if (packet.deal_intelligence.exec_program) {
    parts.push("It attaches to an exec-sponsored program with senior attention.");
  }
  const stakes = firstMeaningful(stripValuePrefix(packet.deal_intelligence.value_hypothesis ?? ""), packet.customer_evidence.business_impacts[0]?.statement);
  if (stakes) parts.push(sentence(`Business stakes are concrete: ${clean(stakes, 160).replace(/[.]+$/, "")}`));
  return clean(parts.join(" "), 400);
}

/** WHY NOW — strict priority: real timing driver, else the customer-requested
 * next step, else an honest early-stage line. Never a hedged impact quote. */
function whyNow(packet: IntelligencePacket): string {
  const timing = packet.deal_intelligence.timing_driver;
  if (timing && timing.label && !HEDGED.test(timing.label)) return clean(timing.label, 200);
  const requested = packet.deal_intelligence.momentum.some((m) => m.id === "requested_next_step") || packet.next_action.primary_action_type !== "hold";
  if (requested && packet.opportunity.is_actionable) {
    return "The customer requested a concrete next step to test whether the solution can address the stated business and technical gaps.";
  }
  return "Engage while the conversation is warm to shape the evaluation before it hardens.";
}

/** The ONE action, enriched with grounded scope (scenarios) — never fabricated. */
function actionText(packet: IntelligencePacket): string {
  const base = packet.next_action.primary_action ?? packet.next_action.summary ?? "Confirm the next step and owner with the customer.";
  const scenarios = packet.workshop.scenarios.slice(0, 2).map((s) => clean(s, 60)).filter(Boolean);
  if (scenarios.length > 0) return clean(`${base} — cover: ${scenarios.join("; ")}`, 300);
  return clean(base, 300);
}

function expectedOutcome(packet: IntelligencePacket, lane: MessageLane): string {
  const sc = packet.next_action.success_criteria.map(stripCriteriaFiller).filter(Boolean);
  if (sc.length > 0) return upperFirst(clean(sc.join("; "), 220));
  return lane === "technical"
    ? "Validated data sources, evidence-quality criteria, and a bounded pilot candidate."
    : "Agreement on the data sources, success criteria, ownership model, and one bounded pilot candidate.";
}

/** WATCH-OUT — the decisive constraint. Sales leads with commercial/adoption
 * landmines and any explicit "do not frame it as X" boundary; technical leads
 * with feasibility/sovereignty/coexistence. */
function watchOut(packet: IntelligencePacket, lane: MessageLane): string | null {
  const salesIds = ["not_a_competition", "budget_not_approved", "no_single_eb", "cost_governance", "decentralized_control", "privacy_gate"];
  const techIds = ["credibility", "sovereignty", "skills_gap", "cost_governance", "privacy_gate", "not_a_competition"];
  const pref = lane === "technical" ? techIds : salesIds;
  const ordered = [...packet.deal_intelligence.landmines].sort((a, b) => {
    const ai = pref.indexOf(a.id);
    const bi = pref.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const top = ordered[0];
  if (!top) return null;
  // A "do not frame as a competition/replacement" boundary is the sharpest sales
  // watch-out; pair the landmine with the customer's own boundary when present.
  return clean(top.label, 160);
}

export function generateRoleMessage(packet: IntelligencePacket, lane: MessageLane): RoleMessage {
  const account = packet.identity.account_label;
  const accountResolved = packet.identity.account_resolved;
  const teaser = packet.personalization.recipient_teasers[lane];

  if (!packet.opportunity.is_actionable) {
    // Honest no-action content — no fabricated pursue nudge.
    const boundary = packet.customer_evidence.explicit_negations[0] ?? packet.customer_evidence.objections[0]?.statement ?? null;
    return {
      lane,
      account: packet.identity.account_prose,
      account_resolved: accountResolved,
      hook: `${account} — no qualified ${lane === "technical" ? "technical" : "commercial"} action`,
      why_this_matters: clean(firstMeaningful(packet.next_action.summary, "The transcript did not produce a qualified opportunity signal.") ?? "No qualified opportunity signal.", 300),
      why_now: "No timely buying signal — revisit only if a clearer signal appears.",
      action: lane === "technical" ? "No technical action — no workshop or validation is warranted." : "No sales outreach — this is not a qualified sales opportunity.",
      expected_outcome: "—",
      watch_out: boundary ? `Customer boundary: ${clean(boundary, 160)}` : null,
      goal_alignment: null,
      goal_impact: null,
      champion: null,
      environment: null,
      evidence_ids: [],
      confidence: packet.opportunity.pursuit_confidence,
      limitations: packet.provenance.limitations,
      kind: "no_action",
      source: "deterministic"
    };
  }

  const champ = lane === "sales" ? packet.stakeholders.find((s) => /champion/i.test(s.role_label)) ?? null : null;
  const environment = lane === "technical" && packet.opportunity.primary_solution_motion ? `Motion: ${packet.opportunity.primary_solution_motion}` : null;

  // Owner-only quota hook; goal alignment (named goals) is safe for any lane.
  const goalImpact = teaser?.goal_impact ?? null;
  const goalAlignment = teaser?.goal_alignment ? teaser.goal_alignment.replace(/^Supports:\s*/i, "") : null;

  return {
    lane,
    account: packet.identity.account_prose,
    account_resolved: accountResolved,
    hook: `${account}: ${clean(packet.deal_intelligence.deal_shape ?? packet.opportunity.primary_opportunity, 90)} (${packet.opportunity.signal_band.toLowerCase()} signal)`,
    why_this_matters: whyThisMatters(packet, lane),
    why_now: whyNow(packet),
    action: actionText(packet),
    expected_outcome: expectedOutcome(packet, lane),
    watch_out: watchOut(packet, lane),
    goal_alignment: goalAlignment,
    goal_impact: goalImpact,
    champion: champ ? { name: champ.name, play: clean(champ.play, 160) } : null,
    environment,
    evidence_ids: packet.next_action.evidence_ids,
    confidence: packet.opportunity.pursuit_confidence,
    limitations: packet.provenance.limitations,
    kind: "action",
    source: "deterministic"
  };
}

// ─── Channel renderers (no channel re-interprets the transcript) ────────────

export function renderWebexMessage(rm: RoleMessage): string {
  if (rm.kind === "no_action") {
    const boundaryLine = rm.watch_out
      ? rm.watch_out.startsWith("Customer boundary")
        ? `**Customer boundary:** ${rm.watch_out.replace(/^Customer boundary:\s*/, "")}`
        : `**Watch-out:** ${rm.watch_out}`
      : null;
    return [
      `**${rm.account} — ${rm.lane}: no action recommended**`,
      `**Assessment:** ${rm.why_this_matters}`,
      `**Recommended action:** ${rm.action}`,
      boundaryLine
    ]
      .filter((l): l is string => Boolean(l))
      .join("\n");
  }
  const laneLabel = rm.lane === "sales" ? "commercial" : rm.lane === "technical" ? "technical" : "leadership";
  const lines = [
    `**${rm.hook}** — ${laneLabel}`,
    rm.goal_impact ? `**Goal impact:** ${rm.goal_impact}` : null,
    `**Why this matters:** ${rm.why_this_matters}`,
    `**Why now:** ${rm.why_now}`,
    `**Recommended action:** ${rm.action}`,
    `**Expected outcome:** ${rm.expected_outcome}`,
    rm.goal_alignment ? `**Goal fit:** ${rm.goal_alignment}` : null,
    rm.champion ? `**Champion:** ${rm.champion.name} — ${rm.champion.play}` : null,
    rm.environment ? `**Environment:** ${rm.environment}` : null,
    rm.watch_out ? `**Watch-out:** ${rm.watch_out}` : null
  ];
  return lines.filter((l): l is string => Boolean(l)).join("\n");
}

export function renderEmailMessage(rm: RoleMessage): { subject: string; body: string } {
  const subject =
    rm.kind === "no_action"
      ? `${rm.lane === "sales" ? "Sales" : "Technical"} — ${rm.account} — no action`
      : `${rm.lane === "sales" ? "Sales action" : rm.lane === "technical" ? "Technical action" : "Leadership"} — ${rm.account}`;
  return { subject, body: renderWebexMessage(rm) };
}

export function renderInAppTeaser(rm: RoleMessage): { headline: string; why_you: string; why_now: string; action: string } {
  return {
    headline: rm.hook,
    why_you: rm.why_this_matters,
    why_now: rm.why_now,
    action: rm.action
  };
}
