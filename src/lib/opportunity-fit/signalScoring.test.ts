import { describe, expect, it } from "vitest";
import { buildNormalizedSignal, deduplicateSignals, computeSpecificity } from "@/lib/opportunity-fit/signalScoring";

describe("Test 16: duplicate news articles become one signal", () => {
  it("collapses five articles about the same announcement into one signal with corroborating URLs", () => {
    const signals = Array.from({ length: 5 }, (_, i) =>
      buildNormalizedSignal({
        accountName: "Acme Retail Group",
        accountDomain: "acmeretail.com",
        category: "strategic_objective",
        subcategory: "cloud_modernization",
        title: `Acme Retail Group announces cloud modernization program (report ${i})`,
        url: `https://publisher${i}.example.com/story-${i}`,
        snippet: "Acme Retail Group announced a multi-year cloud modernization program this week.",
        publishedAt: new Date().toISOString(),
        transcriptSignals: ["cloud modernization"]
      })
    );
    const deduped = deduplicateSignals(signals);
    expect(deduped.length).toBe(1);
    expect(deduped[0].corroborating_urls.length).toBe(4);
  });

  it("keeps genuinely distinct events as separate signals", () => {
    const signalA = buildNormalizedSignal({
      accountName: "Acme Retail Group",
      accountDomain: null,
      category: "strategic_objective",
      subcategory: "cloud_modernization",
      title: "Acme Retail Group announces cloud modernization program",
      url: "https://news.example.com/cloud",
      snippet: "Acme Retail Group announced a cloud modernization program.",
      publishedAt: new Date().toISOString(),
      transcriptSignals: []
    });
    const signalB = buildNormalizedSignal({
      accountName: "Acme Retail Group",
      accountDomain: null,
      category: "trigger_event",
      subcategory: "outage",
      title: "Acme Retail Group suffers major outage",
      url: "https://news.example.com/outage",
      snippet: "Acme Retail Group suffered a multi-hour outage last week affecting checkout.",
      publishedAt: new Date().toISOString(),
      transcriptSignals: []
    });
    const deduped = deduplicateSignals([signalA, signalB]);
    expect(deduped.length).toBe(2);
  });
});

describe("Test 9: official company source outranks an aggregator", () => {
  it("assigns higher source_authority to the official company domain than to a low-authority aggregator", () => {
    const official = buildNormalizedSignal({
      accountName: "Acme Retail Group",
      accountDomain: "acmeretail.com",
      category: "executive_priority",
      subcategory: "official_strategy_page",
      title: "Our technology strategy",
      url: "https://acmeretail.com/strategy",
      snippet: "Acme Retail Group's technology strategy for the coming year.",
      publishedAt: null,
      transcriptSignals: []
    });
    const aggregator = buildNormalizedSignal({
      accountName: "Acme Retail Group",
      accountDomain: "acmeretail.com",
      category: "executive_priority",
      subcategory: "aggregator_mention",
      title: "Acme Retail Group mentioned in roundup",
      url: "https://pinterest.com/some-roundup",
      snippet: "A brief, low-quality mention of Acme Retail Group.",
      publishedAt: null,
      transcriptSignals: []
    });
    expect(official.source_authority).toBeGreaterThan(aggregator.source_authority);
  });
});

describe("computeSpecificity", () => {
  it("scores a concrete, quantified claim higher than a vague one", () => {
    const concrete = computeSpecificity("In 2026, the company invested $50 million, a 12% increase, in a new data platform initiative that spans multiple regions.");
    const vague = computeSpecificity("Things are changing.");
    expect(concrete).toBeGreaterThan(vague);
  });
});
