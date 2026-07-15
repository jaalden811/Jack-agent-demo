import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { StakeholderOwnershipType } from "@/lib/signal-agent/types";
import type { Meddpicc, MeddpiccField } from "@/lib/qualification/types";

/**
 * Builds a rich, evidence-backed opportunity brief from the deterministic
 * analysis result — with NO dependency on OpenAI. This is what makes the
 * product useful before (or without) OpenAI quota: opportunity thesis,
 * why-now signals, compact MEDDPICC, nuanced stakeholder roles, specific
 * sales/technical actions, and top risks are all derived generically from
 * the already-computed structured evidence (commercial signals, taxonomy
 * matches, MEDDPICC, stakeholder analysis, pursuit scoring). Nothing here
 * hard-codes a company, product, transcript, speaker, or score.
 *
 * OpenAI, when available, refines the prose/nuance of this same material
 * (Stage D) — it is never the only source of useful detail.
 */

export type DeterministicBrief = {
  opportunity_thesis: string;
  why_now: string[];
  meddpicc_lines: string[];
  stakeholder_lines: string[];
  sales_actions: string[];
  technical_actions: string[];
  top_risks: string[];
  account_action: string | null;
  pursuit_line: string | null;
};

const MEDDPICC_LETTER: Record<keyof Meddpicc, string> = {
  metrics: "M",
  economic_buyer: "EB",
  decision_criteria: "DC",
  decision_process: "DP",
  paper_process: "PP",
  identify_pain: "I",
  champion: "C",
  competition: "Comp"
};

const MEDDPICC_ORDER: Array<keyof Meddpicc> = ["metrics", "economic_buyer", "decision_criteria", "decision_process", "paper_process", "identify_pain", "champion", "competition"];

const MEDDPICC_NAME: Record<keyof Meddpicc, string> = {
  metrics: "Metrics/value case",
  economic_buyer: "Economic Buyer",
  decision_criteria: "Decision Criteria",
  decision_process: "Decision Process",
  paper_process: "Paper Process",
  identify_pain: "Identified Pain",
  champion: "Champion",
  competition: "Competition"
};

/** Maps a generic ownership type to a concise functional-role phrase and a
 * probable buying role — purely from the taxonomy-agnostic ownership
 * classification already assigned deterministically, never from a
 * specific person/company. Buying roles are always framed as "likely"/
 * "potential" for deterministic inference (never asserted as confirmed). */
function roleProfileFor(ownership: StakeholderOwnershipType): { functional: string; buying: string } {
  switch (ownership) {
    case "executive":
      return { functional: "executive sponsor", buying: "executive sponsor" };
    case "finance_vendor_management":
      return { functional: "vendor-consolidation / procurement", buying: "commercial & procurement influence" };
    case "security":
      return { functional: "security owner", buying: "critical evaluator" };
    case "security_architecture":
      return { functional: "security architecture", buying: "design authority" };
    case "enterprise_architecture":
      return { functional: "enterprise architecture", buying: "design authority" };
    case "reliability":
      return { functional: "reliability owner", buying: "likely operational champion" };
    case "infrastructure":
      return { functional: "infrastructure owner", buying: "operational evaluator" };
    case "application":
      return { functional: "application/observability owner", buying: "technical evaluator" };
    case "cloud_platform":
      return { functional: "cloud platform owner", buying: "technical evaluator" };
    case "itsm":
      return { functional: "service management owner", buying: "operator" };
    case "technical":
      return { functional: "technical stakeholder", buying: "technical evaluator" };
    default:
      return { functional: "operational stakeholder", buying: "influencer" };
  }
}

function statusVerb(status: MeddpiccField["status"]): string {
  switch (status) {
    case "CONFIRMED":
      return "Confirmed";
    case "PARTIAL":
      return "Partial";
    case "HYPOTHESIS":
      return "Hypothesis";
    case "CONFLICTING":
      return "Conflicting";
    default:
      return "Missing";
  }
}

// Cuts only at a word boundary and never appends an ellipsis (Phase 13:
// no truncation "…"). Limits are generous so real sentences survive; the
// message-level byte budget is the true cap.
function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim();
}

function buildOpportunityThesis(result: SecureNetworkingTriageResult): string {
  const opportunity = result.executive_summary.primary_opportunity ?? result.matches[0]?.pain_category ?? "the customer's stated priorities";
  const commercial = result.commercial_signals;
  const drivers: string[] = [];
  if (commercial.budget) drivers.push("funded investment");
  if (commercial.renewal_events.length > 0) drivers.push("active renewal windows");
  if (commercial.quantified_impact.length > 0) drivers.push("quantified business impact");
  const driverText = drivers.length > 0 ? ` driven by ${drivers.slice(0, 3).join(", ")}` : "";
  // Correct article agreement: "An early" (vowel) vs "A credible".
  const qualifier = result.executive_summary.verdict === "HIGH_INTENT" ? "credible" : "early";
  const article = /^[aeiou]/i.test(qualifier) ? "An" : "A";
  return clip(`${article} ${qualifier} opportunity centered on ${opportunity}${driverText}.`, 320);
}

function buildWhyNow(result: SecureNetworkingTriageResult): string[] {
  const signals: string[] = [];
  const c = result.commercial_signals;
  for (const impact of c.quantified_impact.slice(0, 2)) signals.push(clip(impact, 280));
  if (c.budget) signals.push(clip(c.budget, 280));
  for (const renewal of c.renewal_events.slice(0, 2)) signals.push(clip(renewal, 280));
  if (c.timeline) signals.push(clip(c.timeline, 280));
  for (const purchase of c.purchase_language.slice(0, 1)) signals.push(clip(purchase, 280));
  // De-duplicate while preserving order; cap at 6 per the spec.
  const seen = new Set<string>();
  return signals.filter((s) => s && !seen.has(s) && (seen.add(s), true)).slice(0, 6);
}

function buildMeddpiccLines(meddpicc: Meddpicc): string[] {
  return MEDDPICC_ORDER.map((key) => {
    const field = meddpicc[key];
    const rawSummary = field.summary && field.summary !== "Not yet evaluated." ? field.summary : field.status === "MISSING" && field.next_question ? `ask: ${field.next_question}` : "";
    const summary = rawSummary ? clip(rawSummary, 220) : field.status === "MISSING" ? "not yet established." : "";
    return `${MEDDPICC_LETTER[key]} — ${statusVerb(field.status)}${summary ? `: ${summary}` : ""}`;
  });
}

function buildStakeholderLines(result: SecureNetworkingTriageResult): string[] {
  const named = result.stakeholder_analysis.named_stakeholders.filter((s) => s.name);
  const lines = named.slice(0, 6).map((s) => {
    const profile = roleProfileFor(s.ownership_type);
    const roleText = s.function_or_role && s.function_or_role !== "Customer stakeholder" ? s.function_or_role : profile.functional;
    return clip(`${s.name} — ${roleText}; ${profile.buying}`, 150);
  });
  // Role-only authorities (functional owners with no named individual) —
  // surfaced explicitly, never given a fabricated name.
  for (const owner of result.stakeholder_analysis.functional_owners.slice(0, 3)) {
    if (owner.name) continue;
    const profile = roleProfileFor(owner.ownership_type);
    lines.push(clip(`${owner.function_or_role} (role only) — ${profile.buying}`, 150));
  }
  return lines;
}

/** Sales actions are generated from the actual qualification gaps and
 * commercial evidence — not a static routing label. Each is specific and
 * tied to something the transcript/analysis actually surfaced. */
function buildSalesActions(result: SecureNetworkingTriageResult): string[] {
  const actions: string[] = [];
  const account = result.account_resolution;
  const meddpicc = result.meddpicc;
  const c = result.commercial_signals;

  if (account.status === "unresolved" || account.status === "ambiguous" || account.status === "conflicting") {
    actions.push("Resolve the account and matching CRM opportunity before any writeback.");
  }
  if (meddpicc.economic_buyer.status !== "CONFIRMED") {
    actions.push("Validate the executive sponsor, budget owner, and approval path.");
  }
  if (c.quantified_impact.length > 0 || c.budget) {
    actions.push(`Anchor the business case to the stated impact${c.budget ? " and funded scope" : ""}.`);
  }
  if (c.renewal_events.length > 0) {
    actions.push("Confirm the referenced renewal/contract windows and work back from them.");
  }
  if (c.timeline) {
    actions.push("Align commercial discovery to the stated planning/decision timeline.");
  }
  if (meddpicc.paper_process.status !== "CONFIRMED") {
    actions.push("Map the procurement, legal, and security review steps.");
  }
  // Always give the seller a concrete forward motion even for a thin deal.
  if (actions.length === 0) actions.push("Run commercial discovery to establish pain ownership, authority, and timing.");
  return actions.slice(0, 6);
}

function buildTechnicalActions(result: SecureNetworkingTriageResult): string[] {
  const actions: string[] = [];
  const primary = result.matches[0];
  const meddpicc = result.meddpicc;

  if (primary) {
    actions.push(`Define the target architecture and data flows for ${clip(primary.pain_category, 90)}.`);
  }
  if (meddpicc.decision_criteria.status === "CONFIRMED" || meddpicc.decision_criteria.status === "PARTIAL") {
    actions.push("Validate the customer's stated technical requirements against the proposed solution.");
  }
  const retained = primary?.solution_decision.retained_existing_platforms ?? [];
  if (retained.length > 0) {
    actions.push(`Confirm integration/coexistence with existing platforms (${clip(retained.slice(0, 3).join(", "), 90)}).`);
  }
  actions.push("Scope a proof-of-value with explicit success criteria, security controls, and cost controls.");
  if (meddpicc.decision_criteria.gaps.length > 0) {
    actions.push(clip(`Close the top technical unknown: ${meddpicc.decision_criteria.gaps[0]}`, 160));
  }
  return actions.slice(0, 6);
}

function buildTopRisks(result: SecureNetworkingTriageResult): string[] {
  const risks: string[] = [];
  const meddpicc = result.meddpicc;
  // The most decision-relevant gaps become the top risks.
  for (const key of ["economic_buyer", "paper_process", "competition", "decision_process"] as Array<keyof Meddpicc>) {
    const field = meddpicc[key];
    if (field.status === "MISSING" || field.status === "HYPOTHESIS") {
      risks.push(clip(field.gaps[0] ?? `${MEDDPICC_NAME[key]} is not yet established.`, 150));
    }
  }
  const primary = result.matches[0];
  const conflicts = primary?.solution_decision.do_not_choose_conflicts?.filter((c) => c.status === "contradicted") ?? [];
  for (const conflict of conflicts.slice(0, 1)) {
    risks.push(clip(conflict.rule, 150));
  }
  if (risks.length === 0) risks.push("Qualification is early — validate authority, timing, and success criteria.");
  return risks.slice(0, 5);
}

function buildAccountAction(result: SecureNetworkingTriageResult): string | null {
  const account = result.account_resolution;
  if (account.status === "confirmed" || account.status === "probable") return null;
  return account.action_required ?? "Associate this meeting with the correct account before CRM writeback.";
}

function buildPursuitLine(result: SecureNetworkingTriageResult): string | null {
  const scoring = result.opportunity_scoring;
  if (!scoring || (scoring.final_pursuit_score === 0 && scoring.factors.length === 0)) return null;
  return `${scoring.decision} — ${Math.round(scoring.final_pursuit_score)}/100 (confidence ${Math.round(scoring.confidence * 100)}%)`;
}

export function buildDeterministicBrief(result: SecureNetworkingTriageResult): DeterministicBrief {
  return {
    opportunity_thesis: buildOpportunityThesis(result),
    why_now: buildWhyNow(result),
    meddpicc_lines: buildMeddpiccLines(result.meddpicc),
    stakeholder_lines: buildStakeholderLines(result),
    sales_actions: buildSalesActions(result),
    technical_actions: buildTechnicalActions(result),
    top_risks: buildTopRisks(result),
    account_action: buildAccountAction(result),
    pursuit_line: buildPursuitLine(result)
  };
}
