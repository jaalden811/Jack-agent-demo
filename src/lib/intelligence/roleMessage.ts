import type { IntelligencePacket, MessageLane, RoleMessage } from "@/lib/intelligence/types";
import { normalizeSpelledNumbers } from "@/lib/signal-agent/numberWords";
import { resolveGoalFrames } from "@/lib/personalization/goalMessageStrategy";
import { buildInternalActionPlan } from "@/lib/intelligence/internalActionPlan";

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
/** Converts a first-person customer quote into attributed third-person prose so
 * the system voice never speaks as the customer ("first, our average time ... is
 * ninety-six minutes" -> "its average time ... is 96 minutes"). Strips leading
 * enumerators/lead-ins and swaps first-person pronouns; spelled numbers are
 * normalized to digits. Exact quotes remain untouched in the evidence/details. */
function toThirdPerson(quote: string): string {
  let t = normalizeSpelledNumbers(quote).trim();
  t = t.replace(/^(?:first|second|third|fourth|fifth|next|also|and|but|finally|lastly|then|so|well|plus|now)\s*[,:]\s*/i, "");
  t = t
    .replace(/\bwe're\b/gi, "they are")
    .replace(/\bwe've\b/gi, "they have")
    .replace(/\bwe'll\b/gi, "they will")
    .replace(/\bwe\b/gi, "they")
    .replace(/\bour\b/gi, "its")
    .replace(/\bours\b/gi, "theirs")
    .replace(/\bus\b/gi, "them")
    // First-person SINGULAR too — the system voice must never say "I"/"my".
    .replace(/\bi'm\b/gi, "they are")
    .replace(/\bi've\b/gi, "they have")
    .replace(/\bi'll\b/gi, "they will")
    .replace(/\bi'd\b/gi, "they would")
    .replace(/\bmy\b/gi, "their")
    .replace(/\bmine\b/gi, "theirs")
    .replace(/\bi\b/g, "they")
    .replace(/\bme\b/gi, "them");
  return t.charAt(0).toLowerCase() + t.slice(1);
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
  // Normalize first-person customer quotes to attributed third person so the
  // system voice never says "our" (the reported confusion).
  if (problem) return { text: toThirdPerson(clean(problem, 200)), real: true };
  const vh = stripValuePrefix(packet.deal_intelligence.value_hypothesis ?? "");
  if (vh && !/^(not stated|none|no quantified|no explicit)\b/i.test(vh)) return { text: toThirdPerson(clean(vh, 200)), real: true };
  return { text: lowerFirst(packet.opportunity.primary_opportunity), real: false };
}

/** The target half of a "baseline → target" headline metric ("84 → under 20
 * minutes" -> "under 20 minutes"), so "why this matters" can state the goal
 * without repeating the baseline. Returns null for a bare count metric ("4,800
 * endpoints") — a scale count is not a target and must never be phrased as one. */
function metricTarget(metric: string | null): string | null {
  if (!metric) return null;
  const arrow = metric.split(/→|->/);
  return arrow.length > 1 ? arrow[1].trim() || null : null;
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
    // Attributed third-person (never the system speaking as the customer), while
    // keeping the "core problem" technical framing.
    parts.push(real ? `${upperFirst(account)}'s core problem: ${sentence(upperFirst(problem))}` : `${upperFirst(account)}'s core problem: ${sentence(problem)}`);
    if (target && !problemHasTarget) parts.push(`The target is ${sentence(target)}`);
    // Naming the current stack makes the technical read concrete and materially
    // distinct from the commercial lane (it is what the validation must integrate).
    const env = packet.current_environment.slice(0, 5);
    if (env.length > 0) parts.push(`Validation must coexist with the current stack: ${clean(env.join(", "), 160)}.`);
    if (packet.deal_intelligence.existing_footprint) parts.push("The product already exists in pockets, so this validates an expansion, not a net-new deployment.");
    return clean(parts.join(" "), 420);
  }

  // Sales / leadership: account importance + commercial framing. Attributed
  // third-person opener — never the system speaking as the customer.
  const opener = real ? `${upperFirst(account)} reports that ${problem}` : `${upperFirst(account)}: ${sentence(problem)}`;
  parts.push(sentence(opener));
  if (target && !problemHasTarget) parts.push(`The target is ${sentence(target)}`);
  if (packet.deal_intelligence.existing_footprint) {
    parts.push(`${packet.opportunity.primary_solution_motion ?? "The platform"} already exists in pockets, so this is an expansion play rather than a net-new platform decision.`);
  }
  if (packet.deal_intelligence.exec_program) {
    parts.push("It attaches to an exec-sponsored program with senior attention.");
  }
  // Only add a separate stakes line when the headline fell back to the generic
  // category (otherwise the problem sentence already IS the concrete stake) — and
  // only from a REAL problem/impact statement (never a budget/authority line),
  // attributed in third person so the system never speaks as the customer.
  if (!real) {
    const vh = stripValuePrefix(packet.deal_intelligence.value_hypothesis ?? "");
    const realImpact = packet.customer_evidence.business_impacts.map((b) => b.statement).find((s) => s && PROBLEM_HINT_RE.test(s) && !NON_PROBLEM_RE.test(s));
    const stakes = firstMeaningful(vh && PROBLEM_HINT_RE.test(vh) && !NON_PROBLEM_RE.test(vh) ? vh : null, realImpact);
    if (stakes) parts.push(sentence(`Business stakes: ${toThirdPerson(clean(stakes, 160).replace(/[.]+$/, ""))}`));
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
function watchOut(packet: IntelligencePacket, lane: MessageLane, goalPreferredRisks: string[] = []): string | null {
  const salesIds = ["not_a_competition", "budget_not_approved", "no_single_eb", "cost_governance", "decentralized_control", "privacy_gate"];
  const techIds = ["credibility", "sovereignty", "skills_gap", "cost_governance", "privacy_gate", "not_a_competition"];
  // The recipient's top goal decides which risk to LEAD the watch-out with
  // (goal-driven emphasis); the lane order is the tiebreaker. This is the only
  // way goals touch the watch-out — the landmines themselves are unchanged.
  const pref = [...goalPreferredRisks, ...(lane === "technical" ? techIds : salesIds)];
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
      internal_action: null,
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
      source: "deterministic",
      personalization: { goals_used: [], profile_source: "none", fields_influenced: [] }
    };
  }

  const champ = lane === "sales" ? packet.stakeholders.find((s) => /champion/i.test(s.role_label)) ?? null : null;
  const environment =
    lane === "technical"
      ? [packet.current_environment.length ? `Current stack: ${clean(packet.current_environment.slice(0, 5).join(", "), 150)}` : null, packet.opportunity.primary_solution_motion ? `Motion: ${packet.opportunity.primary_solution_motion}` : null]
          .filter(Boolean)
          .join(" · ") || null
      : null;

  // Resolve THIS lane's recipient goals (Bella's for sales, Jack's for
  // technical) → the goal → message strategy. Goals change emphasis (watch-out
  // order, goal line) only, never facts/scores/routing.
  const goalLane = lane === "leadership" ? "leadership" : lane === "technical" ? "technical" : "sales";
  const laneGoalIds = packet.personalization.goal_ids_by_lane[lane] ?? [];
  const goalFrames = resolveGoalFrames({
    profileGoals: laneGoalIds.map((goal_id) => ({ goal_id })),
    lane: goalLane,
    matchedCategoryIds: packet.opportunity.matched_category_ids,
    presentMomentumIds: packet.deal_intelligence.momentum.map((m) => m.id),
    presentRiskIds: packet.deal_intelligence.landmines.map((r) => r.id)
  });
  const topGoal = goalFrames.frames[0] ?? null;
  const profileGoalsResolved = laneGoalIds.length > 0 && topGoal;

  // Owner-only quota hook; goal-alignment line names the aligned recipient goal.
  // When the recipient has explicit profile goals that align, lead with the goal
  // frame; otherwise keep the existing teaser line, then a role-default frame.
  const goalImpact = teaser?.goal_impact ?? null;
  // No profile → no "your goal" line (role-default frames still shape the
  // watch-out emphasis, but must not fabricate a personal-goal claim).
  const goalAlignment = profileGoalsResolved
    ? `${topGoal.label} — ${topGoal.reason}`
    : teaser?.goal_alignment
      ? teaser.goal_alignment.replace(/^Supports:\s*/i, "")
      : null;

  return {
    lane,
    account: packet.identity.account_prose,
    account_resolved: accountResolved,
    hook: `${account}: ${clean(packet.deal_intelligence.deal_shape ?? packet.opportunity.primary_opportunity, 90)} (${packet.opportunity.signal_band.toLowerCase()} signal)`,
    why_this_matters: whyThisMatters(packet, lane),
    why_now: whyNow(packet),
    action: actionText(packet),
    internal_action: buildInternalActionPlan(packet, lane),
    expected_outcome: expectedOutcome(packet, lane),
    watch_out: watchOut(packet, lane, topGoal?.preferred_risk_types ?? []),
    goal_alignment: goalAlignment,
    goal_impact: goalImpact,
    personalization: {
      goals_used: goalFrames.frames.map((f) => f.label),
      profile_source: packet.personalization.profile_source_by_lane[lane] ?? (profileGoalsResolved ? "recipient_match" : "role_default"),
      fields_influenced: topGoal ? ["watch_out", ...(profileGoalsResolved ? ["goal_alignment"] : [])] : []
    },
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
  const ia = rm.internal_action;
  // Lead with the IMMEDIATE internal coordination ("here is what you do now"),
  // then the customer step. Later/conditional steps (e.g. a committee funding
  // gate) render LAST, clearly subordinate — never with do-now priority.
  const isImmediate = (p: { requirement: string }) => p.requirement === "required" || p.requirement === "recommended";
  const immediate = (ia?.coordinate_with ?? []).filter(isImmediate);
  const later = (ia?.coordinate_with ?? []).filter((p) => !isImmediate(p));
  const coordinationLines = immediate.map((p) => {
    const who = p.name ?? p.role;
    const prep = p.prepare.length > 0 ? ` Ask them to prepare: ${p.prepare.join("; ")}.` : "";
    return `**Loop in ${who}:** ${p.why}${prep}`;
  });
  // A conditional step is a single, concise, visibly-subordinate "Later" line —
  // no "prepare" dump, no do-now framing.
  const laterLines = later.map((p) => `**Later — ${p.condition ?? "only if triggered"}:** ${p.why}`);
  const rawStep = ia ? ia.customer_engagement.next_step : rm.action;
  const customerStep = /[.!?]$/.test(rawStep) ? rawStep : `${rawStep}.`;
  // The customer champion is a commercial-lane engagement cue (who advocates
  // internally); the technical lane stays focused on the validation + partner.
  const championNote =
    rm.lane === "sales" && ia?.customer_engagement.champion
      ? ` Engage ${ia.customer_engagement.champion.name ?? ia.customer_engagement.champion.role} (${ia.customer_engagement.champion.role}), who ${ia.customer_engagement.champion.why}.`
      : "";
  const lines = [
    `**${rm.hook}** — ${laneLabel}`,
    rm.goal_impact ? `**Goal impact:** ${rm.goal_impact}` : null,
    `**Why this matters:** ${rm.why_this_matters}`,
    `**Why now:** ${rm.why_now}`,
    ia ? `**Your move (internal):** ${ia.your_move}` : null,
    ...coordinationLines,
    `**Customer next step:** ${customerStep}${championNote}`,
    `**Expected outcome:** ${rm.expected_outcome}`,
    rm.goal_alignment ? `**Goal fit:** ${rm.goal_alignment}` : null,
    rm.environment ? `**Environment:** ${rm.environment}` : null,
    rm.watch_out ? `**Watch-out:** ${rm.watch_out}` : null,
    ...laterLines
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

export function renderInAppTeaser(rm: RoleMessage): { headline: string; why_you: string; why_now: string; internal_move: string | null; action: string } {
  return {
    headline: rm.hook,
    why_you: rm.why_this_matters,
    why_now: rm.why_now,
    internal_move: rm.internal_action?.your_move ?? null,
    action: rm.internal_action?.customer_engagement.next_step ?? rm.action
  };
}
