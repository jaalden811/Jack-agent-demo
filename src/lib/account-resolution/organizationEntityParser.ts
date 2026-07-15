import { validateAccountCandidateName } from "@/lib/account-resolution/accountValidation";

/**
 * Generic organization-entity extraction, kept STRICTLY SEPARATE from
 * opportunity-claim interpretation. The primary defect this fixes: an
 * explicit organization named inside a negated commercial claim
 * (e.g. "please don't leave saying <Org> is running a SIEM competition")
 * must still produce an account candidate — the negated claim's polarity
 * must never erase the organization entity.
 *
 * Nothing here is transcript/company-specific: it recognizes generic
 * organization shapes (all-caps acronym orgs, legal-entity suffixes,
 * and company-context phrases like "at <Org>" / "saying <Org> is" /
 * "our client <Org>"), and rejects products/vendors (via a stoplist
 * supplied from the taxonomy/source catalog), internal application and
 * service names, and generic placeholders.
 */

export type OrganizationCandidate = {
  name: string;
  source: "explicit_dialogue_organization" | "legal_entity_suffix" | "company_context_phrase";
  confidence: number;
  evidence_text: string;
};

export type OrganizationClaimType = "siem_competition" | "replacement_project" | "formal_evaluation" | "procurement_timeline";
export type ClaimPolarity = "asserted" | "negated" | "hypothetical";
export type ExtractedClaim = { type: OrganizationClaimType; classification: ClaimPolarity; value: boolean; evidence_text: string };

// Generic technical/business acronyms that look like all-caps orgs but
// never are — a linguistic stoplist (like stopwords), not a
// company/product list. Extendable without touching extraction logic.
const ACRONYM_NOISE = new Set([
  "SIEM", "SOC", "XDR", "EDR", "NDR", "SOAR", "ITSI", "ITSM", "APM", "POV", "POC", "RFP", "RFI", "SLA", "SLO", "KPI", "MTTR", "MTTD", "API", "SDK", "UI", "UX", "IT", "HR", "AI", "ML", "LLM",
  "CEO", "CIO", "CISO", "CTO", "CFO", "COO", "VP", "SVP", "EVP", "AWS", "GCP", "SQL", "VPN", "WAN", "LAN", "SDWAN", "SASE", "SSE", "MFA", "IAM", "PII", "GDPR", "HIPAA", "SOX", "PCI", "OKR",
  "CRM", "ERP", "CMDB", "SaaS", "PaaS", "IaaS", "OS", "VM", "K8S", "CPU", "GPU", "SIE", "US", "EU", "UK", "APAC", "EMEA", "NA", "Q1", "Q2", "Q3", "Q4", "FY", "OT", "IOT", "IIOT",
  // Cloud/platform service acronyms — infrastructure services, not orgs.
  "AKS", "EKS", "GKE", "VPC", "EC2", "S3", "RDS", "SNS", "SQS", "ACR", "ECR", "CDN", "DNS", "TLS", "SSL", "HTTP", "HTTPS", "TCP", "UDP", "SSH", "RBAC", "SSO", "OIDC", "SAML", "JWT",
  // Security/observability discipline acronyms — techniques, not orgs.
  "UEBA", "UBA", "ITSI", "SRE", "DR", "HA", "QA", "CI", "CD", "PR", "MR", "TAM", "SKU", "MSP", "MSSP", "NOC", "GRC", "DLP", "CASB", "ZTNA", "EASM", "ASM", "TDR", "MDR", "FIM", "TIP", "IDS", "IPS", "WAF", "PAM", "CIEM", "CSPM", "CNAPP", "DAST", "SAST", "SBOM"
]);

// A generic base of well-known product/technology/vendor names that are
// never an account — merged with the taxonomy-supplied stoplist. This is
// generic infrastructure (like a stopword list), not a company-specific
// branch.
const BASE_TECH_STOPLIST = new Set([
  "splunk", "cisco", "servicenow", "thousandeyes", "opentelemetry", "otel", "azure", "aws", "gcp", "google cloud", "kubernetes", "kafka", "vmware", "windows", "linux", "okta", "entra", "crowdstrike", "proofpoint", "pagerduty", "elasticsearch", "elastic", "datadog", "dynatrace", "grafana", "prometheus", "sap", "oracle", "salesforce", "microsoft", "meraki", "catalyst", "appdynamics", "sentinel", "qradar", "chronicle", "wiz", "zscaler", "palo alto", "fortinet", "tanium"
]);

// Common capitalized non-org words (months) that can follow a context
// prefix but are never organizations.
const COMMON_CAPITALIZED = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "today", "tomorrow", "yesterday"]);

// Context-lead words that must be stripped from a captured entity name
// (a legal-entity match may greedily include a leading "Our client ").
const LEADING_CONTEXT_STRIP_RE = /^(?:our\s+)?(?:client|customer|account|at|saying|work at)\s+/i;

const LEGAL_SUFFIX = "(?:Inc|Inc\\.|LLC|L\\.L\\.C\\.|Corp|Corp\\.|Corporation|Group|Holdings|Partners|Ltd|Ltd\\.|Limited|PLC|GmbH|Company|Co\\.|Enterprises|Industries|Systems|Technologies|Solutions)";

// Phrases that introduce a third-party organization by STRONG company
// framing (not the first-person "we are X" handled elsewhere). Weak
// prepositions like "with"/"for"/"from" are deliberately excluded — they
// precede technologies and common nouns far more often than company
// names ("with OpenTelemetry", "for May"). Each prefix word allows a
// capitalized first letter (sentence start) while the pattern is
// case-SENSITIVE, so the captured org name's words must each start
// uppercase (prevents "saying <Org> is running" capturing the trailing
// lowercase clause).
const CONTEXT_PREFIX_WORDS = ["at", "saying", "client", "customer", "account", "our client", "our customer", "our account", "work at", "our work at", "on behalf of"];
const CONTEXT_PREFIX_ALT = CONTEXT_PREFIX_WORDS.map((word) =>
  word
    .split(" ")
    .map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`)
    .join("\\s+")
).join("|");

const ALL_CAPS_ORG_RE = /\b([A-Z][A-Z0-9&.]{1,11})\b/g;
const LEGAL_ENTITY_RE = new RegExp(`\\b([A-Z][A-Za-z0-9&.'\\-]*(?:\\s+[A-Za-z0-9&.'\\-]+){0,3}\\s+${LEGAL_SUFFIX})\\b`, "g");
const CONTEXT_PHRASE_RE = new RegExp(`\\b(?:${CONTEXT_PREFIX_ALT})\\s+([A-Z][A-Za-z0-9&.'\\-]+(?:\\s+[A-Z][A-Za-z0-9&.'\\-]+){0,3})\\b`, "g");

function isProductOrVendor(name: string, productStoplist: Set<string>): boolean {
  const lower = name.toLowerCase().trim();
  if (productStoplist.has(lower) || BASE_TECH_STOPLIST.has(lower)) return true;
  // Any single token that is a product/vendor word (in either the
  // taxonomy stoplist or the generic base tech stoplist).
  return name
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .some((token) => productStoplist.has(token) || BASE_TECH_STOPLIST.has(token));
}

function acceptCandidate(raw: string, source: OrganizationCandidate["source"], confidence: number, evidence: string, ctx: { productStoplist: Set<string>; participantFirstNames: Set<string>; seen: Set<string> }, out: OrganizationCandidate[]) {
  const name = raw
    .trim()
    .replace(LEADING_CONTEXT_STRIP_RE, "")
    .trim()
    .replace(/[.,;:]+$/, "");
  if (!name) return;
  const key = name.toLowerCase();
  if (ctx.seen.has(key)) return;
  // A single-word candidate that is a known participant's first name is a
  // person, not an organization; a common capitalized word (a month, a
  // weekday) is never an organization.
  if (!name.includes(" ") && (ctx.participantFirstNames.has(key) || COMMON_CAPITALIZED.has(key))) return;
  if (isProductOrVendor(name, ctx.productStoplist)) return;
  if (!validateAccountCandidateName(name).valid) return;
  ctx.seen.add(key);
  out.push({ name, source, confidence, evidence_text: evidence });
}

// ─── Claim polarity (separate from entity extraction) ─────────────────────────

const CLAIM_PATTERNS: Array<{ type: OrganizationClaimType; keywords: RegExp }> = [
  { type: "siem_competition", keywords: /\bsiem\b[^.!?]*\b(competition|bake-?off|rfp|evaluation)\b|\b(competition|bake-?off|rfp)\b[^.!?]*\bsiem\b/i },
  { type: "replacement_project", keywords: /\b(replacement project|replacing|replace)\b/i },
  { type: "formal_evaluation", keywords: /\bformal (evaluation|competition|selection|rfp)\b/i },
  { type: "procurement_timeline", keywords: /\bprocurement timeline\b/i }
];

const NEGATION_RE = /\b(not|n't|no|never|isn'?t|aren'?t|without|don'?t|doesn'?t|didn'?t)\b/i;
const HYPOTHETICAL_RE = /\b(may|might|could|would|if|possibly|perhaps|potential(ly)?|flexib)/i;

function classifyPolarity(sentence: string, keywordIndex: number): ClaimPolarity {
  // Inspect the clause around the keyword for negation/hypothetical cues.
  const window = sentence.slice(Math.max(0, keywordIndex - 60), keywordIndex + 40);
  if (NEGATION_RE.test(window)) return "negated";
  if (HYPOTHETICAL_RE.test(window)) return "hypothetical";
  return "asserted";
}

export function extractOrganizationClaims(sentences: string[]): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  for (const sentence of sentences) {
    for (const pattern of CLAIM_PATTERNS) {
      const match = pattern.keywords.exec(sentence);
      if (!match) continue;
      const classification = classifyPolarity(sentence, match.index);
      claims.push({ type: pattern.type, classification, value: classification === "asserted", evidence_text: sentence });
    }
  }
  return claims;
}

export function parseOrganizationEntities(
  sentences: string[],
  options: { productStoplist?: string[]; participantFirstNames?: string[] } = {}
): { organization_candidates: OrganizationCandidate[]; claims: ExtractedClaim[] } {
  const ctx = {
    productStoplist: new Set((options.productStoplist ?? []).map((p) => p.toLowerCase())),
    participantFirstNames: new Set((options.participantFirstNames ?? []).map((p) => p.toLowerCase())),
    seen: new Set<string>()
  };
  const candidates: OrganizationCandidate[] = [];

  for (const sentence of sentences) {
    // Highest precision first: legal-entity suffixes.
    for (const match of sentence.matchAll(LEGAL_ENTITY_RE)) {
      acceptCandidate(match[1], "legal_entity_suffix", 0.85, sentence, ctx, candidates);
    }
    // Distinctive all-caps acronym organizations. Require >= 4 letters
    // and exclude the generic technical/service/discipline acronym noise
    // list — 2-3 letter and known-technique acronyms (ID, SRE, UEBA,
    // ITSI, SIEM, ...) are never treated as an account on shape alone.
    // Runs before the context-phrase pattern so a clean acronym keeps its
    // higher confidence.
    for (const match of sentence.matchAll(ALL_CAPS_ORG_RE)) {
      const token = match[1];
      if (token.replace(/[.&0-9]/g, "").length < 4) continue;
      if (ACRONYM_NOISE.has(token.toUpperCase())) continue;
      acceptCandidate(token, "explicit_dialogue_organization", 0.82, sentence, ctx, candidates);
    }
    // Company-context phrases ("at <Org>", "saying <Org>", "our client <Org>").
    for (const match of sentence.matchAll(CONTEXT_PHRASE_RE)) {
      acceptCandidate(match[1], "company_context_phrase", 0.78, sentence, ctx, candidates);
    }
  }

  return { organization_candidates: candidates, claims: extractOrganizationClaims(sentences) };
}
