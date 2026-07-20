import { readFileSync } from "node:fs";
import path from "node:path";
import type { CoordinationPartner, IntelligencePacket, InternalActionPlan, InternalOwner, MessageLane } from "@/lib/intelligence/types";

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

type CoordinationRules = {
  role_responsibilities: Record<string, string[]>;
  routed_reason: Record<string, string>;
  technical_trigger: { action_types: string[]; motion_keywords: string[] };
  executive_trigger: { momentum_ids: string[]; meddpicc_conditions: string[] };
  prepare: Record<string, string[]>;
  coordinate_reason: Record<string, string>;
  executive_when?: string;
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

/** Why executive coordination is warranted — the SPECIFIC trigger, so the plan
 * can explain it concretely ("no single economic buyer — committee-approved" vs
 * "exec-sponsored program") instead of a generic "needs senior alignment".
 * Returns null when no real exec/committee signal exists (an EB that is merely
 * unknown early in discovery does NOT count — that would make the exec loop-in
 * constant noise). */
function executiveTrigger(packet: IntelligencePacket, rules: CoordinationRules): "distributed" | "program" | null {
  const eb = (packet.qualification.meddpicc.economic_buyer ?? "").toUpperCase();
  // A genuine DISTRIBUTED / committee economic authority is the most concrete,
  // explainable reason: the customer's own words say no single approver.
  if (rules.executive_trigger.meddpicc_conditions.includes("distributed_economic_authority") && eb === "DISTRIBUTED") return "distributed";
  const momentumIds = new Set(packet.deal_intelligence.momentum.map((m) => m.id));
  if (rules.executive_trigger.momentum_ids.some((id) => momentumIds.has(id)) || packet.deal_intelligence.exec_program) return "program";
  return null;
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
  const execReason = executiveTrigger(packet, rules);
  const customerStep = packet.next_action.primary_action ?? packet.next_action.summary ?? "Confirm the next step and owner with the customer.";
  const champion = customerChampion(packet, rules);

  const coordinate_with: CoordinationPartner[] = [];

  // Leadership perspective is uncommon here (two-lane pilot); treat it as the
  // commercial owner steering the investment path.
  const lane: "sales" | "technical" = perspectiveLane === "technical" ? "technical" : "sales";
  const primaryOwner = lane === "technical" ? technical : sales;

  if (lane === "sales") {
    // The commercial owner loops in the technical owner when the customer step
    // needs architecture/validation shaping.
    if (technicalNeeded) {
      coordinate_with.push({
        name: technical.name,
        role: technical.role,
        lane: "technical",
        why: rules.coordinate_reason.sales_to_technical,
        prepare: technicalPrepare(packet, rules)
      });
    }
  } else {
    // The technical owner ALWAYS syncs with the commercial owner so validation
    // ladders into a real commercial motion.
    coordinate_with.push({
      name: sales.name,
      role: sales.role,
      lane: "sales",
      why: rules.coordinate_reason.technical_to_sales,
      prepare: rules.prepare.sales ?? []
    });
  }

  if (execReason) {
    // A SPECIFIC, evidence-grounded reason (committee/board authority vs an
    // exec-sponsored program) + a CONDITIONAL "when" qualifier, so this reads as
    // an optional-until-funding step, not a must-do-now like the technical loop-in.
    const execWhy = execReason === "distributed" ? rules.coordinate_reason.to_executive_distributed : rules.coordinate_reason.to_executive_program;
    coordinate_with.push({
      name: null,
      role: "Sales leader / exec sponsor",
      lane: "executive",
      why: execWhy ?? "A sales leader adds senior alignment on the funding decision.",
      prepare: rules.prepare.executive ?? [],
      condition: rules.executive_when ?? null
    });
  }

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
    customer_engagement: { next_step: clean(customerStep, 220), champion },
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
