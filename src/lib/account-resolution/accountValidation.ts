/**
 * Generic account-name plausibility validation (Section 1). Rejects
 * placeholder/demo values and internal application/service/environment
 * names — never a specific company, ever. Every rule here is a
 * structural/lexical shape check, not a lookup against one known name.
 */

const GENERIC_PLACEHOLDER_NAMES = new Set([
  "unknown",
  "not stated",
  "not specified",
  "n/a",
  "na",
  "demo account",
  "demo company",
  "customer",
  "example company",
  "example corporation",
  "sample company",
  "test account",
  "test company",
  "global retail operations"
]);

// Words that mark a candidate as an internal system/application/
// environment name rather than a company — checked as whole words.
// Overridden when the candidate also contains a company-suffix word
// (see COMPANY_SUFFIX_WORDS below), since a real company can
// legitimately be named e.g. "Platform Solutions Group".
const SYSTEM_OR_APPLICATION_WORDS = [
  "platform",
  "portal",
  "system",
  "service",
  "working group",
  "environment",
  "pipeline",
  "dashboard",
  "database",
  "prod",
  "production",
  "dev",
  "development",
  "stg",
  "staging",
  "test",
  "qa",
  "sandbox",
  "cluster",
  "gateway",
  "microservice",
  "workspace",
  "instance",
  "app",
  "application"
];

// Deliberately excludes ambiguous words like "Group" or "Systems" —
// both are common legitimate company-name suffixes ("Acme Retail
// Group", "Meridian Health Systems") but also appear as the tail of a
// generic system-phrase ("Observability Working Group"). Only
// suffixes that are unambiguous corporate-entity designators are used
// to override a system/application-word match.
const COMPANY_SUFFIX_WORDS = ["inc", "inc.", "llc", "l.l.c.", "corp", "corp.", "corporation", "holdings", "partners", "co", "co.", "company", "ltd", "ltd.", "limited", "gmbh", "plc", "llp", "enterprises", "industries"];

/** Lowercase, hyphen-separated slug patterns typical of internal
 * environment/service identifiers (e.g. "commerce-prd-us2",
 * "billing-svc-eu1") — never a company name. */
const SLUG_IDENTIFIER_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+){1,}$/;

/** Environment-suffix patterns embedded in an otherwise plausible-
 * looking token (e.g. "DCP-Prod", "Ordering-Staging"). */
const ENVIRONMENT_SUFFIX_RE = /-(prod|dev|stg|staging|test|qa|sandbox|prd|uat)([-\d]*)$/i;

export type AccountValidationResult = { valid: boolean; reason: string | null };

export function isGenericPlaceholderAccountName(name: string | null | undefined): boolean {
  if (!name) return true;
  return GENERIC_PLACEHOLDER_NAMES.has(name.trim().toLowerCase());
}

function containsWholeWord(haystackLower: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystackLower);
}

/** Rejects candidates that structurally look like an internal
 * application, service, or environment identifier rather than a
 * company name — e.g. "Digital Customer Portal", "Ordering Platform",
 * "Observability Working Group", "DCP-Prod", "commerce-prd-us2". Never
 * a lookup against one known app/company; purely structural. */
export function looksLikeApplicationOrEnvironmentName(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return true;

  if (SLUG_IDENTIFIER_RE.test(trimmed)) return true;
  if (ENVIRONMENT_SUFFIX_RE.test(trimmed)) return true;

  const lower = trimmed.toLowerCase();
  const hasSystemWord = SYSTEM_OR_APPLICATION_WORDS.some((word) => containsWholeWord(lower, word));
  if (!hasSystemWord) return false;

  const hasCompanySuffix = COMPANY_SUFFIX_WORDS.some((word) => containsWholeWord(lower, word));
  return !hasCompanySuffix;
}

/** A pluralized all-caps acronym ("IDs", "APIs", "URLs", "SLAs", "KPIs",
 * "SOCs", "VPNs", "PDFs") is a common-noun, never a company name. A bare
 * acronym company (IBM, SAP, AWS, GE) is NOT matched — only the lowercase
 * plural 's' form is rejected. */
const PLURAL_ACRONYM_RE = /^[A-Z]{2,}s$/;

export function validateAccountCandidateName(name: string | null | undefined): AccountValidationResult {
  if (!name || !name.trim()) return { valid: false, reason: "empty" };
  const trimmed = name.trim();
  if (isGenericPlaceholderAccountName(trimmed)) return { valid: false, reason: "generic_placeholder" };
  if (trimmed.length > 120) return { valid: false, reason: "implausibly_long" };
  if (PLURAL_ACRONYM_RE.test(trimmed)) return { valid: false, reason: "pluralized_acronym_not_a_company" };
  if (looksLikeApplicationOrEnvironmentName(trimmed)) return { valid: false, reason: "looks_like_application_or_environment_name" };
  return { valid: true, reason: null };
}
