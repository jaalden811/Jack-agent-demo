import { getConfig } from "@/lib/config";
import { executeSerpApiSearch } from "@/lib/connectors/serpapi/client";
import { canonicalizeUrl, extractDomain } from "@/lib/connectors/serpapi/canonicalUrl";
import { SerpApiError, type RawSerpApiResponse } from "@/lib/connectors/serpapi/types";
import type { AccountResolutionResult } from "@/lib/account-resolution/types";

/**
 * SerpAPI-based account disambiguation (Section 2) — runs only when a
 * candidate exists but confidence is below 0.90 (i.e. status is
 * "probable" or "ambiguous", never "unresolved"). Only high-authority
 * sources (official site, investor relations, government/regulatory,
 * reputable business directory, major news) may confirm an account;
 * a single ambiguous snippet or low-authority aggregator never does.
 */

export type DisambiguationSourceType = "official_website" | "investor_relations" | "government_regulatory" | "business_directory" | "major_news" | "low_authority";

export type DisambiguationEvidence = {
  title: string;
  url: string;
  domain: string;
  source_type: DisambiguationSourceType;
  snippet: string;
};

export type DisambiguationOutcome = {
  ran: boolean;
  reason: string | null;
  queries_executed: string[];
  confirmed_domain: string | null;
  evidence: DisambiguationEvidence[];
  remains_ambiguous: boolean;
};

const HIGH_AUTHORITY_HINTS: Array<{ type: DisambiguationSourceType; hints: string[] }> = [
  { type: "investor_relations", hints: ["investor", "ir.", "/investors"] },
  { type: "government_regulatory", hints: [".gov", "sec.gov", "companieshouse", "opencorporates"] },
  { type: "business_directory", hints: ["crunchbase.com", "bloomberg.com/profile", "dnb.com", "zoominfo.com"] },
  { type: "major_news", hints: ["reuters.com", "bloomberg.com", "wsj.com", "businesswire.com", "prnewswire.com", "cnbc.com", "forbes.com"] }
];

function classifySourceType(domain: string, candidateDomain: string | null): DisambiguationSourceType {
  if (candidateDomain && domain.endsWith(candidateDomain)) return "official_website";
  for (const entry of HIGH_AUTHORITY_HINTS) {
    if (entry.hints.some((hint) => domain.includes(hint))) return entry.type;
  }
  return "low_authority";
}

function normalizeResults(raw: RawSerpApiResponse, candidateDomain: string | null): DisambiguationEvidence[] {
  return (raw.organic_results ?? [])
    .filter((r) => r.title && r.link)
    .map((r) => {
      const canonical = canonicalizeUrl(r.link as string);
      const domain = extractDomain(canonical);
      return { title: r.title as string, url: canonical, domain, source_type: classifySourceType(domain, candidateDomain), snippet: r.snippet ?? "" };
    });
}

const HIGH_AUTHORITY_TYPES: ReadonlySet<DisambiguationSourceType> = new Set(["official_website", "investor_relations", "government_regulatory", "business_directory", "major_news"]);

// Third-party sites (directories, social, news wires, job boards, generic
// registries) may CORROBORATE that a company exists, but their domain is NOT
// the company's canonical domain. Generic list — never an account-specific
// entry.
const NON_CANONICAL_DOMAIN_HINTS = [
  "zoominfo.com", "crunchbase.com", "bloomberg.com", "dnb.com", "reuters.com", "wsj.com", "businesswire.com",
  "prnewswire.com", "cnbc.com", "forbes.com", "linkedin.com", "indeed.com", "glassdoor.com", "wikipedia.org",
  "facebook.com", "twitter.com", "x.com", "youtube.com", "sec.gov", "companieshouse", "opencorporates.com",
  "talent.com", "jobleads.com", "talents.vaia.com", "clearancejobs.com", "investing.com", "finance.yahoo.com",
  "okta.com", "mdcounties.org", "glassdoor", "ziprecruiter.com"
];

export function isNonCanonicalDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return NON_CANONICAL_DOMAIN_HINTS.some((hint) => d === hint || d.endsWith(`.${hint}`) || d.includes(hint));
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/\b(inc|corp|corporation|company|co|ltd|llc|plc|technologies|technology|group|holdings|international|global)\b/g, "").replace(/[^a-z0-9]/g, "");
}

/** A registrable-domain label (e.g. "aecom" from "investors.aecom.com") that
 * matches the account name is a first-party (canonical) domain signal. */
export function domainMatchesName(domain: string, name: string): boolean {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return false;
  const label = normalizeToken(parts[parts.length - 2]);
  const n = normalizeToken(name);
  if (label.length < 3 || n.length < 3) return false;
  return n.includes(label) || label.includes(n);
}

export async function disambiguateAccount(params: {
  candidateName: string;
  candidateDomain: string | null;
  knownGeography: string | null;
  knownProductOrService: string | null;
  status: AccountResolutionResult["status"];
}): Promise<DisambiguationOutcome> {
  const config = getConfig();

  // Never run for a confirmed or unresolved account — disambiguation is
  // only for the "probable"/"ambiguous" middle ground.
  if (params.status !== "probable" && params.status !== "ambiguous") {
    return { ran: false, reason: `disambiguation not applicable for status "${params.status}"`, queries_executed: [], confirmed_domain: null, evidence: [], remains_ambiguous: false };
  }
  if (!config.hasSerpApi) {
    return { ran: false, reason: "SerpAPI is not configured", queries_executed: [], confirmed_domain: null, evidence: [], remains_ambiguous: true };
  }

  const queries: string[] = [`"${params.candidateName}" official website`, `"${params.candidateName}" headquarters industry`];
  if (params.knownGeography) queries.push(`"${params.candidateName}" "${params.knownGeography}"`);
  if (params.knownProductOrService) queries.push(`"${params.candidateName}" "${params.knownProductOrService}"`);
  if (params.candidateDomain) queries.push(`site:${params.candidateDomain} about`);

  const executed: string[] = [];
  const allEvidence: DisambiguationEvidence[] = [];

  for (const query of queries.slice(0, 5)) {
    executed.push(query);
    try {
      const raw = await executeSerpApiSearch({ query });
      allEvidence.push(...normalizeResults(raw, params.candidateDomain));
    } catch (error) {
      // A single query failing never blocks the remaining disambiguation
      // queries or the deterministic transcript analysis.
      if (!(error instanceof SerpApiError)) throw error;
    }
  }

  const highAuthorityEvidence = allEvidence.filter((e) => HIGH_AUTHORITY_TYPES.has(e.source_type));
  const distinctDomains = new Set(highAuthorityEvidence.map((e) => e.domain));

  // The CANONICAL domain must be first-party: an official-website match, or a
  // domain whose registrable label matches the account name. Third-party
  // directories/news/social/job boards (e.g. zoominfo.com) can confirm the
  // NAME but must never become the company's domain.
  const canonicalDomains = new Set(
    highAuthorityEvidence
      .filter((e) => (e.source_type === "official_website" || domainMatchesName(e.domain, params.candidateName)) && !isNonCanonicalDomain(e.domain))
      .map((e) => e.domain)
  );
  const confirmedDomain = canonicalDomains.size === 1 ? Array.from(canonicalDomains)[0] : null;

  // The NAME is confirmed by any non-conflicting high-authority source (a
  // directory listing is fine for existence); the domain is set separately
  // and stays null when no first-party domain is verified.
  return {
    ran: true,
    reason: null,
    queries_executed: executed,
    confirmed_domain: confirmedDomain,
    evidence: highAuthorityEvidence,
    remains_ambiguous: highAuthorityEvidence.length === 0 || distinctDomains.size > 1
  };
}
