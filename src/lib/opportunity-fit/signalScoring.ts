import { createHash } from "node:crypto";
import { authorityScore, entityMatchScore, recencyScore } from "@/lib/connectors/serpapi/sourceScoring";
import { canonicalizeUrl, extractDomain } from "@/lib/connectors/serpapi/canonicalUrl";
import { computePublicSignalQuality, classifyEvidenceStrength, allowedSupportsForCategory } from "@/lib/opportunity-fit/evidenceRules";
import type { NormalizedPublicSignal, PublicSignalCategory } from "@/lib/opportunity-fit/types";

/**
 * Normalizes a raw SerpAPI organic result into a NormalizedPublicSignal
 * (Section 5), computing every generic sub-score, then deduplicates
 * signals describing the same underlying event across multiple
 * publishers into one signal with corroborating sources (Section 6) —
 * never counting five articles about one announcement as five
 * independent signals.
 */

/** Specificity — how concrete/detailed the claim is, based purely on
 * generic textual shape (dates, numbers, named entities), never on
 * matching one known company's wording. */
export function computeSpecificity(snippet: string): number {
  let score = 0.3;
  if (/\b\d{4}\b/.test(snippet)) score += 0.2; // a year
  if (/\$\s?[\d,.]+/.test(snippet) || /\b\d+(\.\d+)?%/.test(snippet)) score += 0.2; // a quantified figure
  if (/\b(million|billion|thousand)\b/i.test(snippet)) score += 0.1;
  if (snippet.length > 120) score += 0.2;
  return Math.min(1, score);
}

function signalIdFor(url: string, category: string, subcategory: string): string {
  return `pubsig_${createHash("sha256").update(`${url}:${category}:${subcategory}`).digest("hex").slice(0, 12)}`;
}

export function buildNormalizedSignal(params: {
  accountName: string;
  accountDomain: string | null;
  category: PublicSignalCategory;
  subcategory: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  transcriptSignals: string[];
}): NormalizedPublicSignal {
  const canonical = canonicalizeUrl(params.url);
  const domain = extractDomain(canonical);
  const publishedDate = params.publishedAt ? new Date(params.publishedAt) : null;

  const entityMatch = entityMatchScore({ title: params.title, snippet: params.snippet, url: canonical, domain, accountName: params.accountName, accountDomain: params.accountDomain });
  const authority = authorityScore(domain, canonical, params.accountDomain);
  const recency = recencyScore(publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate : null);
  const signalText = params.transcriptSignals.join(" ").toLowerCase();
  const haystack = `${params.title} ${params.snippet}`.toLowerCase();
  const relevanceHits = params.transcriptSignals.filter((s) => s && haystack.includes(s.toLowerCase()));
  const transcriptRelevance = signalText ? Math.min(1, relevanceHits.length / Math.max(1, Math.ceil(params.transcriptSignals.length / 3))) : 0.3;
  const specificity = computeSpecificity(params.snippet);

  const qualityScore = computePublicSignalQuality({ entityMatch, sourceAuthority: authority, transcriptRelevance, recency, specificity });
  const evidenceClass = classifyEvidenceStrength(qualityScore);

  return {
    signal_id: signalIdFor(canonical, params.category, params.subcategory),
    account_name: params.accountName,
    category: params.category,
    subcategory: params.subcategory,
    claim: params.snippet || params.title,
    source_title: params.title,
    source_url: canonical,
    source_domain: domain,
    published_at: publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate.toISOString() : null,
    retrieved_at: new Date().toISOString(),
    source_authority: Math.round(authority * 1000) / 1000,
    entity_match: Math.round(entityMatch * 1000) / 1000,
    recency: Math.round(recency * 1000) / 1000,
    transcript_relevance: Math.round(transcriptRelevance * 1000) / 1000,
    signal_strength: Math.round(qualityScore * 1000) / 1000,
    confidence: Math.round(qualityScore * 1000) / 1000,
    evidence_class: evidenceClass,
    supports: allowedSupportsForCategory(params.category),
    limitations: [],
    corroborating_urls: []
  };
}

/** Deduplicates signals describing the same underlying event —
 * grouped by (category, subcategory) plus significant textual overlap
 * in the claim — into one signal with the highest-quality claim
 * retained and every other URL recorded as a corroborating source. */
export function deduplicateSignals(signals: NormalizedPublicSignal[]): NormalizedPublicSignal[] {
  const groups: NormalizedPublicSignal[][] = [];

  for (const signal of signals) {
    const claimWords = new Set(signal.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
    const group = groups.find((g) => {
      const representative = g[0];
      if (representative.category !== signal.category || representative.subcategory !== signal.subcategory) return false;
      const repWords = new Set(representative.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
      const overlap = Array.from(claimWords).filter((w) => repWords.has(w)).length;
      const overlapRatio = overlap / Math.max(1, Math.min(claimWords.size, repWords.size));
      return overlapRatio >= 0.5;
    });
    if (group) group.push(signal);
    else groups.push([signal]);
  }

  return groups.map((group) => {
    const best = group.reduce((a, b) => (b.signal_strength > a.signal_strength ? b : a));
    const corroboratingUrls = group.filter((s) => s.source_url !== best.source_url).map((s) => s.source_url);
    return { ...best, corroborating_urls: Array.from(new Set(corroboratingUrls)) };
  });
}

export function acceptedSignals(signals: NormalizedPublicSignal[]): NormalizedPublicSignal[] {
  return signals.filter((s) => s.evidence_class !== "rejected");
}
