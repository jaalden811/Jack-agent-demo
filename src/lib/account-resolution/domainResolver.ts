/**
 * Resolves a probable company domain from customer participant email
 * domains (Section 1, priority #7) — generic filtering of personal/
 * webmail/vendor domains, never a lookup against one known company.
 */

const NON_COMPANY_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "live.com",
  "msn.com",
  "cisco.com",
  "splunk.com"
]);

export function resolveDomainFromEmails(emailDomains: string[]): { domain: string | null; guessedName: string | null } {
  const candidate = emailDomains.map((d) => d.toLowerCase().trim()).find((d) => d && !NON_COMPANY_EMAIL_DOMAINS.has(d));
  if (!candidate) return { domain: null, guessedName: null };

  const base = candidate.split(".")[0];
  const guessedName = base
    .split(/[-_]/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");

  return { domain: candidate, guessedName: guessedName || null };
}
