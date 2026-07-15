/**
 * Deterministic, evidence-backed buying-committee / authority inference
 * (Phases 10-13). Produces role inferences from transcript *behavior*
 * (not titles or mere attendance) and a distributed-economic-authority
 * model, so the pipeline stops emitting "Economic Buyer: null" when the
 * transcript clearly contains implicit authority/influence evidence —
 * while never fabricating a named buyer or private budget certainty.
 *
 * Fully generic: no person, company, product, or transcript is encoded
 * here — only linguistic behavior patterns.
 */

export type AuthorityRoleType = "economic_buyer" | "executive_sponsor" | "decision_process_owner" | "champion" | "technical_decision_maker" | "security_gatekeeper" | "evaluator" | "influencer" | "procurement" | "operator" | "unknown";
export type RoleStatus = "confirmed" | "probable" | "hypothesis" | "missing";

export type RoleInference = {
  name: string | null;
  role_label: string;
  role_type: AuthorityRoleType;
  status: RoleStatus;
  confidence: number;
  behavioral_evidence: string[];
  authority_dimensions: string[];
  not_proven: string[];
  next_question: string;
};

export type EconomicAuthority = {
  status: "confirmed" | "probable" | "distributed" | "missing";
  named_person: string | null;
  role_candidates: string[];
  approval_paths: string[];
  confidence: number;
  known: string[];
  gaps: string[];
  next_question: string;
};

export type AuthorityGraph = {
  roles: RoleInference[];
  economic_authority: EconomicAuthority;
};

// Behavioral evidence patterns per role — matched against customer-side
// dialogue. Each is a linguistic behavior, never a title.
const DECISION_PROCESS_PATTERNS = [/\b(send it to|send the (outline|materials) to)\b/i, /\bwe(?:'ll| will) decide whether\b/i, /\b(who|which people) (should|will) (receive|attend|join)\b/i, /\b(let'?s|we should) (do|schedule|set up) (a|the)? ?(working session|workshop)\b/i, /\bwe(?:'ll| will) (react|review) (before|first)\b/i, /\bbroaden (the group|participation|access)\b/i];
const SECURITY_GATEKEEPER_PATTERNS = [/\b(data (segregation|separation)|role-based access|access control|retention control|audit trail|governance|masking)\b/i, /\bsecurity (needs|requires|cannot|must)\b/i, /\bcannot (block|approve) (technical )?approval\b/i, /\bidentity scenario\b/i];
const TECHNICAL_EVALUATOR_PATTERNS = [/\b(integration|architecture|data flows?|telemetry|collectors?|proof[-\s]of[-\s]value|success criteria|acceptance criteria)\b/i, /\b(what|which) (data sources?|integrations?)\b/i, /\bwe cannot require (one |a )?(proprietary )?agent\b/i, /\boperational scenario\b/i];
const ECONOMIC_AUTHORITY_PATTERNS = [/\b(controls? the budget|owns? the budget|budget owner|final decision sits with|i can authorize|we can fund|approves? (the )?(spend|purchase|budget)|hold(s)? (final )?(budget|approval) authority)\b/i];
const CHAMPION_PATTERNS = [/\b(i (own|lead)|we (want|need) to fix|let'?s (do|build|run)|i(?:'ll| will) (bring|coordinate|pull together)|i(?:'d| would) like (a|to))\b/i];

// Distributed-authority cues: multiple spending paths / no single approver.
const MULTIPLE_FUNDING_PATTERNS = [/\b(multiple (spending|funding|budget) (paths|lanes)|several (spending|funding) (paths|lanes)|different (budgets?|funding))\b/i, /\bno single (buying authority|approver|budget owner)\b/i, /\b(funding placeholder|resilience program funding|project-specific|services funding)\b/i, /\bdistributed across (multiple )?(spending|funding|approval)\b/i];
const PROCUREMENT_NOT_INVOLVED_PATTERNS = [/\bprocurement (does not|doesn'?t|won'?t) (need to )?(join|be involved)\b/i, /\bprocurement (is )?not (yet )?involved\b/i];

function countMatches(text: string, patterns: RegExp[]): { hits: number; evidence: string[] } {
  const evidence: string[] = [];
  for (const pattern of patterns) {
    if (pattern.test(text)) evidence.push(text.length > 160 ? `${text.slice(0, 159)}…` : text);
  }
  return { hits: evidence.length, evidence };
}

/** Builds the authority graph from customer-side stakeholder dialogue.
 * `stakeholderTurns` maps a customer stakeholder name to the text of
 * their turns. Vendor-side speakers must be excluded by the caller. */
export function inferAuthorityGraph(params: { stakeholderTurns: Array<{ name: string | null; text: string }>; allCustomerText: string[] }): AuthorityGraph {
  const roles: RoleInference[] = [];

  // Aggregate each stakeholder's dialogue and score their behaviors.
  const byName = new Map<string, string[]>();
  for (const turn of params.stakeholderTurns) {
    if (!turn.name) continue;
    const list = byName.get(turn.name) ?? [];
    list.push(turn.text);
    byName.set(turn.name, list);
  }

  for (const [name, texts] of byName) {
    const joined = texts.join(" ");
    const economic = countMatches(joined, ECONOMIC_AUTHORITY_PATTERNS);
    const process = countMatches(joined, DECISION_PROCESS_PATTERNS);
    const security = countMatches(joined, SECURITY_GATEKEEPER_PATTERNS);
    const technical = countMatches(joined, TECHNICAL_EVALUATOR_PATTERNS);
    const champion = countMatches(joined, CHAMPION_PATTERNS);

    // Pick the strongest-evidenced role for this person (a person can
    // hold multiple, but we surface the dominant one with its dimensions).
    const candidates: Array<{ role: AuthorityRoleType; label: string; hits: number; evidence: string[]; dimension: string; notProven: string; question: string }> = [
      { role: "economic_buyer", label: "Economic authority", hits: economic.hits, evidence: economic.evidence, dimension: "economic_authority", notProven: "single-owner budget authority", question: `Can ${name} authorize funding for an initial scenario independently?` },
      { role: "decision_process_owner", label: "Decision-process owner / initiative sponsor", hits: process.hits, evidence: process.evidence, dimension: "decision_process_authority", notProven: "direct budget authority", question: `Does ${name} control who is engaged and the next-step cadence?` },
      { role: "security_gatekeeper", label: "Security gatekeeper / evaluator", hits: security.hits, evidence: security.evidence, dimension: "security_authority", notProven: "Economic Buyer", question: `What must be true for ${name} to approve the security architecture?` },
      { role: "technical_decision_maker", label: "Technical evaluator / operational architect", hits: technical.hits, evidence: technical.evidence, dimension: "technical_authority", notProven: "final platform authority", question: `What technical criteria would make ${name} recommend proceeding?` }
    ];
    const best = candidates.filter((c) => c.hits > 0).sort((a, b) => b.hits - a.hits)[0];
    if (!best) continue;

    // Status: confirmed only with explicit economic-authority language;
    // probable with multiple consistent behavioral signals; else hypothesis.
    const status: RoleStatus = best.role === "economic_buyer" ? "confirmed" : best.hits >= 2 ? "probable" : "hypothesis";
    const championActive = champion.hits > 0 && (process.hits > 0 || technical.hits > 0 || security.hits > 0);

    roles.push({
      name,
      role_label: best.label + (championActive && best.role !== "economic_buyer" ? " (also a potential champion)" : ""),
      role_type: best.role,
      status,
      confidence: status === "confirmed" ? 0.9 : status === "probable" ? 0.6 : 0.35,
      behavioral_evidence: best.evidence.slice(0, 3),
      authority_dimensions: [best.dimension, ...(championActive ? ["champion_strength"] : [])],
      not_proven: [best.notProven],
      next_question: best.question
    });
  }

  // ─── Distributed economic authority ───────────────────────────────────────
  const allText = params.allCustomerText.join(" ");
  const multipleFunding = MULTIPLE_FUNDING_PATTERNS.some((p) => p.test(allText));
  const procurementOut = PROCUREMENT_NOT_INVOLVED_PATTERNS.some((p) => p.test(allText));
  const namedEconomic = roles.find((r) => r.role_type === "economic_buyer" && r.status === "confirmed");

  let economic_authority: EconomicAuthority;
  if (namedEconomic) {
    economic_authority = {
      status: "confirmed",
      named_person: namedEconomic.name,
      role_candidates: [],
      approval_paths: [],
      confidence: 0.9,
      known: [`${namedEconomic.name} used explicit budget/approval-authority language.`],
      gaps: [],
      next_question: "Confirm the scope this authority can approve without escalation."
    };
  } else if (multipleFunding) {
    economic_authority = {
      status: "distributed",
      named_person: null,
      role_candidates: buildRoleTargets(),
      approval_paths: extractApprovalPaths(allText),
      confidence: 0.5,
      known: ["The customer described multiple spending/funding paths with no single established approver."],
      gaps: ["No single budget owner who can independently fund the first use case has been identified."],
      next_question: "Which budget owner can sponsor an initial scenario without requiring every funding path to move together?"
    };
  } else {
    economic_authority = {
      status: "missing",
      named_person: null,
      role_candidates: buildRoleTargets(),
      approval_paths: [],
      confidence: 0,
      known: procurementOut ? ["Procurement is explicitly not yet involved."] : [],
      gaps: ["No economic-authority or budget-ownership evidence was stated in the transcript."],
      next_question: "Who holds budget authority for this initiative, and what approval path do they follow?"
    };
  }

  return { roles, economic_authority };
}

// Role-level targets (never fabricated names) for the likely economic-
// authority owners — generic executive/budget-owner families.
function buildRoleTargets(): string[] {
  return ["Executive sponsor (e.g. CIO / resilience owner)", "Enterprise-platform budget owner", "Security-budget owner (e.g. CISO)", "Project/services funding owner"];
}

function extractApprovalPaths(text: string): string[] {
  const paths: string[] = [];
  if (/\bplatform (rationalization|funding|budget)\b/i.test(text)) paths.push("Enterprise-platform / rationalization funding");
  if (/\bsecurity (funding|budget)\b/i.test(text) || /\bsecurity (may have|renewal)\b/i.test(text)) paths.push("Security funding");
  if (/\b(services|project)[-\s]?(specific)? funding\b/i.test(text) || /\bproject-specific\b/i.test(text)) paths.push("Project/services funding");
  if (/\bresilience (program|initiative|funding)\b/i.test(text)) paths.push("Operational-resilience program funding");
  return paths.length > 0 ? paths : ["Multiple undifferentiated spending paths were referenced"];
}
