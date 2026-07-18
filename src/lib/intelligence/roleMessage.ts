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

// A business-impact statement reads like a PROBLEM (a metric, a loss, a
// blind spot, a time/cost consequence) — as opposed to a budget-approval line
// ("committee approved $1.4M") or a decision-criteria list, which appear in the
// same business_impact array but are not the customer's problem.
const PROBLEM_HINT_RE =
  /\b(slow|delay|fail|failure|outage|downtime|risk|breach|incident|cost|lose|losing|lost|can'?t|cannot|unable|too long|minutes?|hours?|days?|%|percent|conversion|manual|blind|visibility|no way to|hard to|difficult|degrade|penal|punish|complexity|complex)\b/i;
const NON_PROBLEM_RE =
  /\b(approved|budget|envelope|decision criteria|our criteria|success criteria|criteria are|criteria:|authorize|approval authority)\b/i;

/** The most decision-relevant customer PROBLEM, in their own words. Prefers a
 * business impact that reads like a problem, then the value hypothesis; only
 * falls back to the taxonomy category (a generic label) when nothing concrete
 * was stated. `real` is false for the taxonomy fallback so the caller can add
 * the impact as a separate stakes line. */
function pickProblem(packet: IntelligencePacket): { text: string; real: boolean } {
  const impacts = packet.customer_evidence.business_impacts.map((b) => b.statement).filter(Boolean);
  const problem = impacts.find((s) => PROBLEM_HINT_RE.test(s) && !NON_PROBLEM_RE.test(s));
  if (problem) return { text: lowerFirst(clean(problem, 200)), real: true };
  const vh = stripValuePrefix(packet.deal_intelligence.value_hypothesis ?? "");
  if (vh && !/^(not stated|none|no quantified|no explicit)\b/i.test(vh)) return { text: lowerFirst(clean(vh, 200)), real: true };
  return { text: lowerFirst(packet.opportunity.primary_opportunity), real: false };
}

/** The target half of a "baseline → target" headline metric ("84 → under 20
 * minutes" -> "under 20 minutes"), so "why this matters" can state the goal
 * without repeating the baseline already in the problem sentence. */
function metricTarget(metric: string | null): string | null {
  if (!metric) return null;
  const arrow = metric.split(/→|->/);
  const t = (arrow.length > 1 ? arrow[1] : metric).trim();
  return t || null;
}

/** WHY THIS MATTERS — a synthesized read of the opportunity, not a category tag.
 * Leads with the real customer problem, frames the metric as a target, then adds
 * expansion / exec framing (sales) or the current stack (technical). */
function whyThisMatters(packet: IntelligencePacket, lane: MessageLane): string {
  const account = packet.identity.account_prose;
  const { text: problem, real } = pickProblem(packet);
  const target = metricTarget(packet.deal_intelligence.headline_metric);
  const problemHasTarget = /→|->|\btarget\b|\bunder\b|\bwithin\b/i.test(problem);
  const parts: string[] = [];

  if (lane === "technical") {
    parts.push(`${upperFirst(account)}'s core problem: ${sentence(problem)}`);
    if (target && !problemHasTarget) parts.push(`The target is ${sentence(target)}`);
    // Naming the current stack makes the technical read concrete and materially
    // distinct from the commercial lane (it is what the validation must integrate).
    const env = packet.current_environment.slice(0, 5);
    if (env.length > 0) parts.push(`Validation must coexist with the current stack: ${clean(env.join(", "), 160)}.`);
    if (packet.deal_intelligence.existing_footprint) parts.push("The product already exists in pockets, so this validates an expansion, not a net-new deployment.");
    return clean(parts.join(" "), 420);
  }

  // Sales / leadership: account importance + commercial framing.
  parts.push(`${upperFirst(account)}: ${sentence(problem)}`);
  if (target && !problemHasTarget) parts.push(`The target is ${sentence(target)}`);
  if (packet.deal_intelligence.existing_footprint) {
    parts.push(`${packet.opportunity.primary_solution_motion ?? "The platform"} already exists in pockets, so this is an expansion play rather than a net-new platform decision.`);
  }
  if (packet.deal_intelligence.exec_program) {
    parts.push("It attaches to an exec-sponsored program with senior attention.");
  }
  // Only add a separate stakes line when the headline fell back to the generic
  // category (otherwise the problem sentence already IS the concrete stake).
  if (!real) {
    const stakes = firstMeaningful(stripValuePrefix(packet.deal_intelligence.value_hypothesis ?? ""), packet.customer_evidence.business_impacts[0]?.statement);
    if (stakes) parts.push(sentence(`Business stakes: ${clean(stakes, 160).replace(/[.]+$/, "")}`));
  }
  return clean(parts.join(" "), 400);
}

/** WHY NOW — strict priority: real timing driver, else the customer-requested
 * next step, else an honest early-stage line. Never a hedged impact quote. */
/** Strips a leading enumeration/discourse marker ("First,", "Second,", "Also,",
 * "And,") that the customer used mid-list — it reads as a fragment out of context. */
function stripEnumeration(s: string): string {
  return s.replace(/^(?:first|second|third|fourth|fifth|next|also|and|but|finally|lastly|then)\s*[,:]\s*/i, "").trim();
}

function whyNow(packet: IntelligencePacket): string {
  const timing = packet.deal_intelligence.timing_driver;
  if (timing && timing.label && !HEDGED.test(timing.label)) return upperFirst(stripEnumeration(clean(timing.label, 200)));
  const requested = packet.deal_intelligence.momentum.some((m) => m.id === "requested_next_step") || packet.next_action.primary_action_type !== "hold";
  if (requested && packet.opportunity.is_actionable) {
    return "The customer requested a concrete next step to test whether the solution can address the stated business and technical gaps.";
  }
  return "Engage while the conversation is warm to shape the evaluation before it hardens.";
}

/** The ONE action — the canonical Next Best Action, as one clean sentence. Raw
 * workshop-scenario sentences are intentionally NOT spliced in (they are noisy
 * transcript fragments); scenario scope lives in the workshop plan / UI. */
function actionText(packet: IntelligencePacket): string {
  const base = packet.next_action.primary_action ?? packet.next_action.summary ?? "Confirm the next step and owner with the customer.";
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
  const environment =
    lane === "technical"
      ? [packet.current_environment.length ? `Current stack: ${clean(packet.current_environment.slice(0, 5).join(", "), 150)}` : null, packet.opportunity.primary_solution_motion ? `Motion: ${packet.opportunity.primary_solution_motion}` : null]
          .filter(Boolean)
          .join(" · ") || null
      : null;

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
