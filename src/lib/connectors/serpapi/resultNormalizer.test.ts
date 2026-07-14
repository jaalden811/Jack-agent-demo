import { describe, expect, it } from "vitest";
import { normalizeSerpApiResponse } from "@/lib/connectors/serpapi/resultNormalizer";
import type { PlannedQuery, RawSerpApiResponse } from "@/lib/connectors/serpapi/types";

const plannedQuery: PlannedQuery = {
  query_id: "q_001",
  purpose: "strategic_initiative",
  query: '"Meridian Health Systems" observability strategy',
  reason: "test",
  evidence_ids: [],
  priority: 0.8
};

describe("normalizeSerpApiResponse", () => {
  it("normalizes organic_results into the application schema", () => {
    const raw: RawSerpApiResponse = {
      organic_results: [
        { title: "Meridian Health Systems announces platform initiative", link: "https://meridianhealth.example.com/news/platform", snippet: "Meridian Health Systems announced a new observability strategy.", position: 1, date: "2026-05-01" }
      ]
    };
    const results = normalizeSerpApiResponse({ raw, plannedQuery, accountName: "Meridian Health Systems", accountDomain: "meridianhealth.example.com", signals: ["observability"] });
    expect(results).toHaveLength(1);
    expect(results[0].source_id).toMatch(/^serp_/);
    expect(results[0].domain).toBe("meridianhealth.example.com");
    expect(results[0].account_match_confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("never crashes when optional fields are missing", () => {
    const raw: RawSerpApiResponse = { organic_results: [{ title: "Untitled result" }, {}] };
    expect(() => normalizeSerpApiResponse({ raw, plannedQuery, accountName: "Meridian Health Systems", accountDomain: null, signals: [] })).not.toThrow();
    const results = normalizeSerpApiResponse({ raw, plannedQuery, accountName: "Meridian Health Systems", accountDomain: null, signals: [] });
    // The result with no URL is dropped entirely — never fabricates one.
    expect(results).toHaveLength(0);
  });

  it("deduplicates by canonical URL, keeping the highest-scored entry", () => {
    const raw: RawSerpApiResponse = {
      organic_results: [
        { title: "Story", link: "https://example.com/story?utm_source=a", snippet: "Meridian Health Systems story.", position: 1 },
        { title: "Story", link: "https://example.com/story?utm_source=b", snippet: "Meridian Health Systems detailed story with more context.", position: 2 }
      ]
    };
    const results = normalizeSerpApiResponse({ raw, plannedQuery, accountName: "Meridian Health Systems", accountDomain: null, signals: [] });
    expect(results).toHaveLength(1);
  });

  it("reads knowledge_graph and answer_box sections", () => {
    const raw: RawSerpApiResponse = {
      knowledge_graph: { title: "Meridian Health Systems", website: "https://meridianhealth.example.com", description: "A healthcare provider." },
      answer_box: { title: "Meridian Health Systems overview", link: "https://meridianhealth.example.com/about", snippet: "Overview." }
    };
    const results = normalizeSerpApiResponse({ raw, plannedQuery, accountName: "Meridian Health Systems", accountDomain: "meridianhealth.example.com", signals: [] });
    expect(results.some((r) => r.result_type === "knowledge_graph")).toBe(true);
    expect(results.some((r) => r.result_type === "answer_box")).toBe(true);
  });

  it("assigns a low entity-match score for an unrelated company", () => {
    const raw: RawSerpApiResponse = { organic_results: [{ title: "Totally Unrelated Co news", link: "https://unrelated.example.com/news", snippet: "Nothing about the account here." }] };
    const results = normalizeSerpApiResponse({ raw, plannedQuery, accountName: "Meridian Health Systems", accountDomain: null, signals: [] });
    expect(results[0].account_match_confidence).toBeLessThan(0.5);
  });
});
