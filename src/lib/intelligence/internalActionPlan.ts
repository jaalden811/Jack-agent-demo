import { readFileSync } from "node:fs";
import path from "node:path";
import type { CoordinationPartner, CoordinationRequirement, CoordinationTiming, CustomerStakeholder, IntelligencePacket, InternalActionPlan, InternalOwner, MessageLane } from "@/lib/intelligence/types";

/**
 * buildInternalActionPlan(packet, perspectiveLane) — turns a routed opportunity
 * into an INTERNAL coordination plan from ONE owner's perspective.
 *
 * The product promise is "turn important customer conversations into coordinated
 * internal action". So before the customer step, the plan answers: why was this
 * routed to me, what do I do internally, who else should I loop in and why, what
 * should each person prepare — then, separately, the customer engagement.
 *
 * Fully deterministic and config-driven (internal_coordination_rules.json). The
 * concrete internal people are the routing-config owners on the packet; a
 * coordination partner is NEVER a customer participant and NEVER an invented
 * name (a role-only slot has name = null). Facts, scores, routing, and evidence
 * identity are untouched — this only composes coordination guidance.
 */

type ExecutiveGateStep = { timing: CoordinationTiming; requirement: CoordinationRequirement; when: string; reason: string; prepare: string[]; trigger_code?: string };
type CoordinationRules = {
  role_responsibilities: Record<string, string[]>;
  routed_reason: Record<string, string>;
  technical_trigger: { action_types: string[]; motion_keywords: string[] };
  executive_gate: {
    internal_role_label: string;
    committee_funding: ExecutiveGateStep;
    explicit_triggers: Record<string, ExecutiveGateStep>;
  };
  prepare: Record<string, string[]>;
  coordinate_reason: Record<string, string>;
  customer_roles: Record<string, string>;
};

const CONFIG_RELATIVE_PATH = "signal-agent-poc/config/internal_coordination_rules.json";
let cached: CoordinationRules | null = null;

export function clearInternalCoordinationRulesCache(): void {
  cached = null;
}

function loadRules(): CoordinationRules {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(path.join(process.cwd(), CONFIG_RELATIVE_PATH), "utf8")) as CoordinationRules;
  return cached;
}

function clean(s: string, max = 200): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t.replace(/[,;:]\s*$/, "");
  return t.slice(0, t.lastIndexOf(" ", max)).replace(/[,;:]\s*$/, "").trim();
}

function ownerLabel(owner: InternalOwner | null, fallbackRole: string): { name: string | null; role: string } {
  if (owner && owner.name && owner.name.trim()) return { name: owner.name.trim(), role: owner.role || fallbackRole };
  return { name: null, role: (owner?.role || fallbackRole).trim() };
}

/** Does the customer next step require technical (architecture / validation /
 * integration) shaping? True when the NBA action type, the primary motion, or a
 * requested workshop matches the config trigger. */
function needsTechnicalShaping(packet: IntelligencePacket, rules: CoordinationRules): boolean {
  const actionType = (packet.next_action.primary_action_type ?? "").toLowerCase();
  if (rules.technical_trigger.action_types.some((t) => actionType.includes(t.toLowerCase()))) return true;
  if (packet.workshop.requested) return true;
  const haystack = `${packet.next_action.primary_action ?? ""} ${packet.opportunity.primary_solution_motion ?? ""} ${packet.next_action.summary}`.toLowerCase();
  return rules.technical_trigger.motion_keywords.some((k) => haystack.includes(k.toLowerCase()));
}

/** Builds the internal sales-leader / executive step, if any. An IMMEDIATE step
 * is produced ONLY from an explicit, evidence-backed trigger (the customer asked
 * for executive engagement, or the decision is blocked at leadership) —
 * `packet.executive_trigger`. DISTRIBUTED / committee authority alone produces a
 * CONDITIONAL funding-gate note (never an immediate task), and every other
 * signal (missing EB, a board mention, an exec attending, high signal, a large
 * account, an exec-sponsored program) produces NOTHING. The `to` party is always
 * a ROLE-ONLY internal slot (never a named or invented leader, never a customer). */
function buildExecutiveStep(packet: IntelligencePacket, rules: CoordinationRules): CoordinationPartner | null {
  const gate = rules.executive_gate;
  const roleLabel = gate.internal_role_label || "Internal sales leader";
  const explicit = packet.executive_trigger;
  if (explicit) {
    const step = gate.explicit_triggers[explicit.code];
    if (step) {
      return {
        name: null,
        role: roleLabel,
        lane: "executive",
        why: step.reason,
        prepare: step.prepare ?? [],
        timing: step.timing,
        requirement: step.requirement,
        trigger_code: explicit.code,
        condition: step.when ?? null
      };
    }
  }
  // No explicit trigger: distributed/committee authority → a CONDITIONAL gate.
  const eb = (packet.qualification.meddpicc.economic_buyer ?? "").toUpperCase();
  if (eb === "DISTRIBUTED") {
    const step = gate.committee_funding;
    return {
      name: null,
      role: roleLabel,
      lane: "executive",
      why: step.reason,
      prepare: step.prepare ?? [],
      timing: step.timing,
      requirement: step.requirement,
      trigger_code: step.trigger_code ?? "COMMITTEE_FUNDING_GATE",
      condition: step.when ?? null
    };
  }
  return null;
}

/** Customer-side stakeholders to engage — kept strictly SEPARATE from internal
 * coordination. A customer executive sponsor / committee chair appears HERE. */
function customerStakeholders(packet: IntelligencePacket): CustomerStakeholder[] {
  return packet.stakeholders
    .filter((s) => (s.name ?? "").trim().length > 0)
    .slice(0, 6)
    .map((s) => ({ name: s.name, role: s.role_label, engagement: clean(s.play || "", 140) }));
}

/** Keeps only short, clean scenario/label phrases — drops raw customer-quote
 * sentences ("I'd like a working session…") that read as noise in a prep list. */
function cleanShortPhrase(raw: string, max = 60): string | null {
  const t = (raw ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
  if (!t || t.length > max) return null;
  if (/[.!?]/.test(t)) return null; // internal sentence punctuation
  if (/^(i|i'd|i'll|we|we'd|our|the|a|an|they|it|this|that|let|can|could|would|maybe)\b/i.test(t)) return null;
  return t;
}

/** Concrete technical prep — leads with the run's real workshop scenarios / data
 * sources when present, then fills from the config defaults (never fabricated). */
function technicalPrepare(packet: IntelligencePacket, rules: CoordinationRules): string[] {
  const out: string[] = [];
  const scenarios = packet.workshop.scenarios.map((s) => cleanShortPhrase(s, 60)).filter((s): s is string => Boolean(s)).slice(0, 2);
  if (scenarios.length > 0) out.push(`validation scenarios: ${scenarios.join("; ")}`);
  const sources = packet.workshop.data_sources.map((s) => cleanShortPhrase(s, 40)).filter((s): s is string => Boolean(s)).slice(0, 3);
  if (sources.length > 0) out.push(`required data sources: ${sources.join(", ")}`);
  if (packet.current_environment.length > 0) out.push(`integration with the current stack (${clean(packet.current_environment.slice(0, 4).join(", "), 90)})`);
  for (const item of rules.prepare.technical ?? []) {
    if (out.length >= 4) break;
    out.push(item);
  }
  // De-dupe (case-insensitive), keep order, cap at 4.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of out) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped.slice(0, 4);
}

function customerChampion(packet: IntelligencePacket, rules: CoordinationRules): InternalActionPlan["customer_engagement"]["champion"] {
  const champ = packet.stakeholders.find((s) => /champion/i.test(s.role_label));
  if (champ) return { name: champ.name, role: "customer champion", why: rules.customer_roles.champion ?? "owns the internal recommendation" };
  const sponsor = packet.stakeholders.find((s) => /(economic buyer|sponsor|executive)/i.test(s.role_label));
  if (sponsor) return { name: sponsor.name, role: sponsor.role_label.toLowerCase(), why: rules.customer_roles.economic_buyer ?? "controls the budget for the decision" };
  return null;
}

export function buildInternalActionPlan(packet: IntelligencePacket, perspectiveLane: MessageLane): InternalActionPlan | null {
  if (!packet.opportunity.is_actionable) return null;
  const rules = loadRules();

  const sales = ownerLabel(packet.owners.sales, "Sales / Commercial owner");
  const technical = ownerLabel(packet.owners.technical, "Technical / Specialist owner");
  const technicalNeeded = needsTechnicalShaping(packet, rules);
  const customerStep = packet.next_action.primary_action ?? packet.next_action.summary ?? "Confirm the next step and owner with the customer.";
  const champion = customerChampion(packet, rules);

  const coordinate_with: CoordinationPartner[] = [];

  // Leadership perspective is uncommon here (two-lane pilot); treat it as the
  // commercial owner steering the investment path.
  const lane: "sales" | "technical" = perspectiveLane === "technical" ? "technical" : "sales";
  const primaryOwner = lane === "technical" ? technical : sales;

  if (lane === "sales") {
    // The commercial owner loops in the technical owner when the customer step
    // needs architecture/validation shaping — the IMMEDIATE, required step.
    if (technicalNeeded) {
      coordinate_with.push({
        name: technical.name,
        role: technical.role,
        lane: "technical",
        why: rules.coordinate_reason.sales_to_technical,
        prepare: technicalPrepare(packet, rules),
        timing: "before_customer_meeting",
        requirement: "required",
        trigger_code: "TECHNICAL_VALIDATION",
        condition: null
      });
    }
  } else {
    // The technical owner ALWAYS syncs with the commercial owner so validation
    // ladders into a real commercial motion — the IMMEDIATE, required step.
    coordinate_with.push({
      name: sales.name,
      role: sales.role,
      lane: "sales",
      why: rules.coordinate_reason.technical_to_sales,
      prepare: rules.prepare.sales ?? [],
      timing: "immediate",
      requirement: "required",
      trigger_code: "COMMERCIAL_PROGRESSION",
      condition: null
    });
  }

  // Internal sales-leader / executive step — IMMEDIATE only on an explicit
  // evidence trigger; a distributed committee produces a CONDITIONAL funding-gate
  // note; everything else produces nothing.
  const execStep = buildExecutiveStep(packet, rules);
  if (execStep) coordinate_with.push(execStep);

  // The internal next move — coordination-first, explicitly NOT the customer
  // step. It names who to align with, so it always differs from customer_engagement.
  let yourMove: string;
  if (lane === "sales") {
    if (technicalNeeded) {
      const who = technical.name ?? "the technical specialist";
      // The exec step (when present) is its own clearly-conditional loop-in line,
      // so it is NOT repeated here — this keeps the primary move concise.
      yourMove = `Before the customer session, align with ${who} on the validation approach, then own the commercial framing.`;
    } else {
      yourMove = "Own the commercial motion: build the business case and confirm the buying/decision path before advancing.";
    }
  } else {
    const who = sales.name ?? "the commercial owner";
    yourMove = `Define the validation architecture and required data boundaries, prepare the proof-of-value scenarios, and sync with ${who} so the technical work ladders into the commercial motion.`;
  }

  return {
    primary_owner: { name: primaryOwner.name, role: primaryOwner.role, lane: perspectiveLane },
    routed_reason: rules.routed_reason[perspectiveLane] ?? rules.routed_reason[lane] ?? "You own this lane for the account.",
    your_move: clean(yourMove, 260),
    coordinate_with,
    customer_engagement: { next_step: clean(customerStep, 220), champion, stakeholders: customerStakeholders(packet) },
    source: "deterministic"
  };
}

/** Loads the advisory suggested-role allow-list (from the coordination rules),
 * used by the Circuit enrichment to constrain proposed extra coordination. */
export function loadSuggestedRoles(): string[] {
  try {
    return (loadRules() as CoordinationRules & { suggested_roles?: { roles?: string[] } }).suggested_roles?.roles ?? [];
  } catch {
    return [];
  }
}
