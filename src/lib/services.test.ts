import { describe, expect, it, vi } from "vitest";
import {
  chunkText,
  cosineSimilarity,
  exportRun,
  generateReport,
  groupSearchResults,
  productCapabilityMapper,
  retrieveKbContext,
  runResearch
} from "@/lib/services";
import type { KbChunk, ResearchInput, ResearchRun, SearchResult } from "@/lib/types";

vi.mock("openai", () => ({
  default: vi.fn()
}));

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
    const results: SearchResult[] = [
      {
        title: "Regional Health System expands security operations",
        url: "https://example.com/news",
        snippet: "The hospital system is investing in cybersecurity operations.",
        sourceType: "news"
      }
    ];
    const accounts = generateReport(input, capabilityMap, groupSearchResults(results), []);
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
  });
});
