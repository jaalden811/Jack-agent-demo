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
// Economic authority is about MONEY: budget ownership, funding, or approving
// spend/purchase. "I can authorize" alone is NOT economic authority — a person
// can authorize a test/design session without any budget power (and often adds
// "I am not authorizing a purchase"). So the "authorize/approve" verbs must
// have a spend/budget/purchase/contract object.
const MONEY_OBJECT = "(the |that |this )?(spend|spending|budget|funding|purchase|deal|contract|licen[cs]e|payment|investment|money|cost|envelope|program envelope|fiscal[- ]year envelope)";
// A single confirmed economic buyer asserts their OWN authority, in the first
// person, POSITIVELY. Committee/finance/board approval is DISTRIBUTED authority
// (handled below), and a NEGATED statement ("I did not approve a purchase",
// "not approve purchase") is the opposite of authority — see the negation guard.
const ECONOMIC_AUTHORITY_PATTERNS = [
  // "I own the budget" — allow up to two modifier words before "budget" so a
  // scoped budget still confirms authority ("I own the security budget", "I own
  // the program budget", "I control this fiscal-year budget").
  new RegExp(`\\b(i (?:control|own) (?:the|this|my|our) (?:[\\w-]+ ){0,2}budget|i am the (economic )?buyer|final (budget )?decision sits with me|i hold (final )?(budget|approval|spend) authority|i can fund (it|this|that))\\b`, "i"),
  // First-person economic-OWNER self-identification: "I am the program's economic
  // owner", "I am the budget owner", "I own the business outcome / the envelope".
  new RegExp(`\\bi am (?:the |a |our )?(?:program'?s |project'?s )?(economic|budget|commercial) (owner|buyer|sponsor|authority)\\b`, "i"),
  new RegExp(`\\bi (?:am the |own the )?(?:business outcome owner|owner of the (?:budget|spend|program envelope|business outcome))\\b`, "i"),
  // Self-identification as THE approver of spend ("I'm the approver up to $2M").
  // "approver" is inherently a spend/authority noun; first-person + positive.
  new RegExp(`\\bi(?:['’]m| am) (?:the |an |our )?(?:final |sole )?approver\\b`, "i"),
  // Holds financial sign-off / authority to commit ("I've got sign-off to move
  // forward", "I hold spend authority"). "sign-off"/"spend authority"/"budget
  // authority" are inherently financial-commitment nouns. Handles the "I've"
  // contraction (no space after "I") as well as "I have"/"I hold".
  new RegExp(`\\b(?:i (?:have|hold)|i['’]ve got|i['’]ve)\\s+(?:the |final |full )?(?:sign[- ]?off|spend authority|budget authority)\\b`, "i"),
  new RegExp(`\\b(?:i (?:have|hold)|i['’]ve got|i['’]ve)\\s+(?:the |final |full )?approval (?:to (?:move forward|proceed|buy|purchase|go ahead|spend)|on (?:the )?(?:spend|budget|deal|purchase))\\b`, "i"),
  // "I can approve … within that envelope", "I confirm the $X envelope/budget".
  new RegExp(`\\bi (?:can |will |personally )?(approve|authorize|sign off on|release|confirm)\\b[\\w\\s,'$-]{0,35}${MONEY_OBJECT}\\b`, "i")
];
// Negation / disclaimer of authority — a sentence carrying one of these is NOT
// an authority claim even if it lexically contains "approve … budget".
const NEGATED_AUTHORITY_RE = /\b(not|n['’]t|no one|nobody|cannot|can['’]?t|do not|does not|did not|didn['’]?t|won['’]?t|will not|without|has not|have not|is not|are not|not permission|not authorized)\b/i;

/** Counts POSITIVE first-person economic-authority claims, per sentence, so a
 * negated/disclaimed statement never confirms an economic buyer. */
function economicAuthorityHits(text: string): { hits: number; evidence: string[] } {
  const evidence: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!ECONOMIC_AUTHORITY_PATTERNS.some((p) => p.test(sentence))) continue;
    if (NEGATED_AUTHORITY_RE.test(sentence)) continue;
    evidence.push(sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence);
  }
  return { hits: evidence.length, evidence };
}
const CHAMPION_PATTERNS = [/\b(i (own|lead)|we (want|need) to fix|let'?s (do|build|run)|i(?:'ll| will) (bring|coordinate|pull together)|i(?:'d| would) like (a|to))\b/i];

// Distributed-authority cues: multiple spending paths / no single approver /
// a committee or vote-based approval body. These indicate the economic
// authority is DISTRIBUTED (a committee, not a single named person) — never
// confirm the *speaker* as the buyer just because they describe the committee.
const MULTIPLE_FUNDING_PATTERNS = [
  /\b(multiple (spending|funding|budget) (paths|lanes)|several (spending|funding) (paths|lanes)|different (budgets?|funding))\b/i,
  /\bno single (buying authority|approver|budget owner)\b/i,
  /\b(funding placeholder|resilience program funding|project-specific|services funding)\b/i,
  /\bdistributed across (multiple )?(spending|funding|approval)\b/i,
  // Committee / board / vote-based approval bodies — inherently distributed.
  /\b(investment|approval|budget|steering|investment[- ]review|governance|procurement) committee\b/i,
  /\bcommittee (approves?|reviews?|votes?|has a vote|signs? off|decides?)\b/i,
  /\b(finance|legal|procurement|the board) (has a vote|votes?|approves?|signs? off|co-?approves?)\b/i,
  /\bapproves? (cross[- ]?platform|enterprise|the larger|overall) (spend|spending|budget|funding|purchase|investment)\b/i,
  // An explicit disclaimer of sole authority — the person is NOT the buyer.
  /\bnot the (sole|single|only) (economic buyer|budget owner|approver|decision[- ]?maker|buyer)\b/i
];
const PROCUREMENT_NOT_INVOLVED_PATTERNS = [/\bprocurement (does not|doesn'?t|won'?t) (need to )?(join|be involved)\b/i, /\bprocurement (is )?not (yet )?involved\b/i];

// An economic buyer named in the THIRD person (often absent from the call):
// "<Name> is the economic buyer", "the economic buyer is <Name>", "CFO <Name>
// releases the program funds", "<Name> signs the capital release". A name is a
// Title-Case word with a lowercase body (not an ALL-CAPS acronym).
const NAME_TOKEN = "[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2}";
const NAMED_EB_PATTERNS = [
  new RegExp(`\\b(${NAME_TOKEN})\\s+is\\s+(?:the|our)\\s+economic\\s+buyer\\b`),
  new RegExp(`\\bthe\\s+economic\\s+buyer\\s+is\\s+(${NAME_TOKEN})\\b`),
  new RegExp(`\\b(?:cfo|chief financial officer|ceo|coo|cio)\\s+(${NAME_TOKEN})\\b[\\w\\s,'-]{0,40}?\\b(?:releases?|signs?|approves?|authoriz(?:es?|ing)|controls?)\\b[\\w\\s,'-]{0,25}?\\b(?:funds?|budget|capital|spend|the release|capital release)\\b`, "i"),
  new RegExp(`\\b(${NAME_TOKEN})\\s+(?:releases?|signs?)\\s+(?:the\\s+)?(?:program\\s+|capital\\s+|budget\\s+)?(?:funds?|capital release|budget)\\b`)
];
const EB_NAMING_NEGATION_RE = /\b(not|isn'?t|no longer|won'?t be)\b/i;

/** Detects an economic buyer named in the third person (typically an absent
 * approver like a CFO). Returns the fullest name found, else null. */
function detectNamedEconomicBuyer(text: string): { name: string; evidence: string } | null {
  let best: { name: string; evidence: string } | null = null;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (EB_NAMING_NEGATION_RE.test(sentence)) continue;
    for (const p of NAMED_EB_PATTERNS) {
      const m = sentence.match(p);
      if (m && m[1] && (!best || m[1].length > best.name.length)) {
        best = { name: m[1].trim(), evidence: sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence };
      }
    }
  }
  return best;
}

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
    const economic = economicAuthorityHits(joined);
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
  // A CFO/approver named in the third person as the economic buyer is a
  // confirmed, single, named EB — even when absent and even alongside a
  // committee (the committee recommends; the named person releases funds).
  const thirdPersonEb = namedEconomic ? null : detectNamedEconomicBuyer(allText);

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
  } else if (thirdPersonEb) {
    economic_authority = {
      status: "confirmed",
      named_person: thirdPersonEb.name,
      role_candidates: [],
      approval_paths: extractApprovalPaths(allText),
      confidence: 0.85,
      known: [`${thirdPersonEb.name} is named as the economic buyer / capital-release authority.`],
      gaps: [],
      next_question: "Confirm the scope this authority can approve and the gate it follows."
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
