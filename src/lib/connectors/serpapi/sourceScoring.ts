/**
 * Source-quality scoring per the public-evidence rules: official
 * sources, investor relations, and government/regulatory sources score
 * highest; low-authority aggregators and unverifiable pages score
 * lowest. Every score is 0..1.
 */

const OFFICIAL_HOST_HINTS = ["investor", "ir.", "sec.gov", ".gov", "newsroom", "press"];
const EXECUTIVE_BIO_HINTS = ["leadership", "executive", "about/leadership", "management-team"];
const TRADE_PUB_HINTS = ["techtarget", "crn.com", "zdnet", "computerworld", "networkworld", "sdxcentral"];
const NEWS_PUB_HINTS = ["reuters", "bloomberg", "wsj.com", "nytimes", "forbes", "businesswire", "prnewswire", "cnbc"];
const JOB_HINTS = ["/careers", "/jobs", "linkedin.com/jobs", "indeed.com", "greenhouse.io", "lever.co"];
const LOW_AUTHORITY_HINTS = ["pinterest", "slideshare", "scribd"];

export function authorityScore(domain: string, url: string, companyDomain: string | null): number {
  const haystack = `${domain} ${url}`.toLowerCase();

  if (companyDomain && domain.endsWith(companyDomain.toLowerCase())) {
    if (OFFICIAL_HOST_HINTS.some((hint) => haystack.includes(hint))) return 1.0;
    return 1.0; // official company website
  }
  if (haystack.endsWith(".gov") || haystack.includes(".gov/")) return 1.0;
  if (EXECUTIVE_BIO_HINTS.some((hint) => haystack.includes(hint))) return 0.9;
  if (haystack.includes("cisco.com") || haystack.includes("splunk.com")) return 0.85;
  if (NEWS_PUB_HINTS.some((hint) => haystack.includes(hint))) return 0.8;
  if (TRADE_PUB_HINTS.some((hint) => haystack.includes(hint))) return 0.65;
  if (JOB_HINTS.some((hint) => haystack.includes(hint))) return 0.55;
  if (LOW_AUTHORITY_HINTS.some((hint) => haystack.includes(hint))) return 0.35;
  return 0.5; // other web source — neither penalized to zero nor trusted
}

export function recencyScore(publishedAt: Date | null): number {
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) return 0.45;
  const ageDays = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.9;
  if (ageDays <= 180) return 0.8;
  if (ageDays <= 365) return 0.65;
  if (ageDays <= 730) return 0.45;
  return 0.25;
}

/** Entity-match confidence between a search result and the account
 * candidate it was searched for — never a full NLP entity-resolution
 * system, but a conservative, explainable heuristic. */
export function entityMatchScore(params: { title: string; snippet: string; url: string; domain: string; accountName: string; accountDomain: string | null }): number {
  const { title, snippet, url, domain, accountName, accountDomain } = params;
  const haystack = `${title} ${snippet}`.toLowerCase();
  const nameLower = accountName.toLowerCase().trim();

  if (accountDomain && domain === accountDomain.toLowerCase().replace(/^www\./, "")) return 1.0;
  if (accountDomain && url.toLowerCase().includes(accountDomain.toLowerCase())) return 1.0;

  const exactPhrase = new RegExp(`\\b${nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (exactPhrase.test(haystack)) return 0.85;

  const tokens = nameLower.split(/\s+/).filter((t) => t.length > 2);
  const matchedTokens = tokens.filter((t) => haystack.includes(t));
  if (tokens.length > 0 && matchedTokens.length === tokens.length) return 0.7;
  if (tokens.length > 0 && matchedTokens.length / tokens.length >= 0.5) return 0.4;

  return 0.0;
}

/** Compares a result against transcript-derived signals (taxonomy
 * categories, products, buying signals) to estimate relevance. */
export function signalRelevanceScore(params: { title: string; snippet: string; signals: string[] }): number {
  if (params.signals.length === 0) return 0.3;
  const haystack = `${params.title} ${params.snippet}`.toLowerCase();
  const matched = params.signals.filter((signal) => haystack.includes(signal.toLowerCase()));
  return Math.min(1, matched.length / Math.max(1, Math.ceil(params.signals.length / 2)));
}

export function publicEvidenceScore(params: { entityMatch: number; authority: number; recency: number; signalRelevance: number }): number {
  return 0.35 * params.entityMatch + 0.25 * params.authority + 0.2 * params.recency + 0.2 * params.signalRelevance;
}
