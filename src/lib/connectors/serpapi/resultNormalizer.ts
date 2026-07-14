import { createHash } from "node:crypto";
import { canonicalizeUrl, extractDomain } from "@/lib/connectors/serpapi/canonicalUrl";
import { authorityScore, entityMatchScore, publicEvidenceScore, recencyScore, signalRelevanceScore } from "@/lib/connectors/serpapi/sourceScoring";
import type { NormalizedSerpResult, PlannedQuery, RawSerpApiResponse } from "@/lib/connectors/serpapi/types";

/**
 * Converts a raw SerpAPI response (organic_results, knowledge_graph,
 * answer_box, news_results) into this application's single normalized
 * result schema, computing every score, then deduplicates by canonical
 * URL — retaining the highest-scored entry and merging query purposes
 * when the same URL is found by more than one query. Missing optional
 * fields never crash normalization.
 */

function parsePublishedDate(dateText: string | undefined): Date | null {
  if (!dateText) return null;
  const parsed = new Date(dateText);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sourceIdFor(url: string): string {
  return `serp_${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

export function normalizeSerpApiResponse(params: {
  raw: RawSerpApiResponse;
  plannedQuery: PlannedQuery;
  accountName: string;
  accountDomain: string | null;
  signals: string[];
}): NormalizedSerpResult[] {
  const { raw, plannedQuery, accountName, accountDomain, signals } = params;
  const retrievedAt = new Date().toISOString();
  const results: NormalizedSerpResult[] = [];

  function buildEntry(input: { title?: string; url?: string; snippet?: string; position?: number; date?: string; resultType: NormalizedSerpResult["result_type"] }) {
    if (!input.url || !input.title) return; // require both — never fabricate a title or URL
    const canonical = canonicalizeUrl(input.url);
    const domain = extractDomain(canonical);
    const publishedAt = parsePublishedDate(input.date);
    const entityMatch = entityMatchScore({ title: input.title, snippet: input.snippet ?? "", url: canonical, domain, accountName, accountDomain });
    const authority = authorityScore(domain, canonical, accountDomain);
    const recency = recencyScore(publishedAt);
    const relevance = signalRelevanceScore({ title: input.title, snippet: input.snippet ?? "", signals });

    results.push({
      source_id: sourceIdFor(canonical),
      provider: "serpapi",
      query_id: plannedQuery.query_id,
      query: plannedQuery.query,
      purpose: plannedQuery.purpose,
      title: input.title,
      url: canonical,
      canonical_url: canonical,
      domain,
      snippet: input.snippet ?? "",
      position: input.position ?? results.length + 1,
      published_at: publishedAt ? publishedAt.toISOString() : null,
      retrieved_at: retrievedAt,
      result_type: input.resultType,
      account_match_confidence: entityMatch,
      stakeholder_match_confidence: 0,
      signal_relevance: relevance,
      authority_score: authority,
      recency_score: recency,
      public_evidence_score: publicEvidenceScore({ entityMatch, authority, recency, signalRelevance: relevance })
    });
  }

  for (const organic of raw.organic_results ?? []) {
    buildEntry({ title: organic.title, url: organic.link, snippet: organic.snippet, position: organic.position, date: organic.date, resultType: "organic" });
  }
  for (const news of raw.news_results ?? []) {
    buildEntry({ title: news.title, url: news.link, snippet: news.snippet, date: news.date, resultType: "news" });
  }
  if (raw.knowledge_graph?.title && raw.knowledge_graph.website) {
    buildEntry({ title: raw.knowledge_graph.title, url: raw.knowledge_graph.website, snippet: raw.knowledge_graph.description, resultType: "knowledge_graph" });
  }
  if (raw.answer_box?.title && raw.answer_box.link) {
    buildEntry({ title: raw.answer_box.title, url: raw.answer_box.link, snippet: raw.answer_box.snippet ?? raw.answer_box.answer, resultType: "answer_box" });
  }

  return dedupeByCanonicalUrl(results);
}

function dedupeByCanonicalUrl(results: NormalizedSerpResult[]): NormalizedSerpResult[] {
  const byUrl = new Map<string, NormalizedSerpResult>();
  for (const result of results) {
    const existing = byUrl.get(result.canonical_url);
    if (!existing || result.public_evidence_score > existing.public_evidence_score) {
      byUrl.set(result.canonical_url, result);
    }
  }
  return Array.from(byUrl.values());
}
