import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chunkText,
  collectPageEvidence,
  cosineSimilarity,
  exportRun,
  generateReport,
  getProviderDiagnostics,
  groupSearchResults,
  productCapabilityMapper,
  retrieveKbContext,
  runResearch
} from "@/lib/services";
import type { KbChunk, ResearchInput, ResearchRun, SearchResult } from "@/lib/types";

vi.mock("openai", () => ({
  default: vi.fn()
}));

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.SEARCH_API_KEY;
  process.env.SEARCH_PROVIDER = "tavily";
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.HUNTER_API_KEY;
  delete process.env.PEOPLE_DATA_LABS_API_KEY;
  delete process.env.CLEARBIT_API_KEY;
});

const input: ResearchInput = {
  ciscoProduct: "Cisco XDR",
  targetMarket: "healthcare",
  geography: "",
  companySize: "",
  maxResults: 2,
  seedAccounts: ["Regional Health System"]
};

function testChunk(content: string, index = 0): KbChunk {
  return {
    id: `chunk-${index}`,
    runId: "run-1",
    documentId: "doc-1",
    documentName: "cisco-xdr.md",
    chunkIndex: index,
    content,
    embedding: new Array(128).fill(0).map((_, position) => (position === index ? 1 : 0)),
    metadata: { sourceType: "uploaded_kb" }
  };
}

describe("chunkText", () => {
  it("creates overlapping chunks without empty values", () => {
    const chunks = chunkText("a ".repeat(1300), 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(Boolean)).toBe(true);
  });
});

describe("retrieval and scoring helpers", () => {
  it("computes bounded cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("maps product capabilities with KB citations", async () => {
    const capabilityMap = await productCapabilityMapper(input, [
      testChunk("Cisco XDR helps ransomware readiness and zero trust operations.")
    ]);
    expect(capabilityMap.capabilities).toContain("extended detection and response");
    expect(capabilityMap.citations[0]?.sourceType).toBe("uploaded_kb");
  });

  it("retrieves relevant KB chunks", async () => {
    const chunks = [testChunk("ransomware zero trust", 0), testChunk("unrelated cafeteria menu", 1)];
    const result = await retrieveKbContext("ransomware", chunks, 1);
    expect(result).toHaveLength(1);
  });
});

describe("report generation", () => {
  it("does not invent emails or named people", async () => {
    const capabilityMap = await productCapabilityMapper(input, []);
    const providerStatus = getProviderDiagnostics();
    const results: SearchResult[] = [
      {
        title: "Regional Health System expands security operations",
        url: "https://example.com/news",
        snippet: "The hospital system is investing in cybersecurity operations.",
        sourceType: "news",
        verificationLevel: "snippet_only"
      }
    ];
    const accounts = generateReport(input, capabilityMap, groupSearchResults(results), [], providerStatus);
    expect(accounts[0].champion.name).toBeNull();
    expect(accounts[0].champion.businessEmail).toBeNull();
    expect(accounts[0].missingDataFlags.join(" ")).toMatch(/do not infer|not invented/i);
  });

  it("exports citations and confidence scores", async () => {
    const run = (await runResearch(input, [])) as ResearchRun;
    const csv = exportRun(run, "csv");
    expect(csv).toContain("confidence");
    expect(csv).toContain("evidence_urls");
    const json = exportRun(run, "json");
    expect(json).toContain("confidenceScore");
    expect(json).toContain("providerStatus");
  });

  it("labels missing required providers as fallback diagnostics", () => {
    const diagnostics = getProviderDiagnostics();
    expect(diagnostics.fallbackModeActive).toBe(true);
    expect(diagnostics.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "OpenAI embeddings", status: "missing_required_provider" }),
        expect.objectContaining({ name: "tavily search", status: "missing_required_provider" })
      ])
    );
  });

  it("marks missing Firecrawl evidence as snippet-only", async () => {
    const results = await collectPageEvidence([
      {
        title: "Example source",
        url: "https://example.com/source",
        snippet: "Search snippet",
        sourceType: "news"
      }
    ]);
    expect(results[0].verificationLevel).toBe("snippet_only");
  });

  it("marks fallback embedding runs as unverified", async () => {
    const run = await runResearch(input, []);
    expect(run.openAiEmbeddingsUsed).toBe(false);
    expect(run.isFallback).toBe(true);
    expect(run.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Development fallback embeddings")]));
  });
});
