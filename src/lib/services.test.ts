import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chunkText,
  classifySearchResult,
  cosineSimilarity,
  exportRun,
  groupSearchResults,
  isValidOrganizationName,
  productCapabilityMapper,
  retrieveKbContext,
  runResearch
} from "@/lib/services";
import type { KbChunk, ResearchInput, ResearchRun, SearchResult } from "@/lib/types";

vi.mock("openai", () => ({ default: vi.fn() }));

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
  geography: "North America",
  companySize: "",
  maxResults: 5,
  seedAccounts: []
};

function testChunk(content: string, index = 0): KbChunk {
  return {
    id: `chunk-${index}`,
    runId: "run-1",
    documentId: "doc-1",
    documentName: "cisco-xdr.md",
    chunkIndex: index,
    content,
    embedding: new Array(128).fill(0).map((_, p) => (p === index ? 1 : 0)),
    metadata: { sourceType: "uploaded_kb" }
  };
}

// ─── chunkText ────────────────────────────────────────────────────────────────

describe("chunkText", () => {
  it("creates overlapping chunks without empty values", () => {
    const chunks = chunkText("a ".repeat(1300), 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(Boolean)).toBe(true);
  });
});

// ─── isValidOrganizationName ──────────────────────────────────────────────────

describe("isValidOrganizationName", () => {
  it("accepts valid healthcare org names", () => {
    expect(isValidOrganizationName("Mayo Clinic")).toBe(true);
    expect(isValidOrganizationName("Cleveland Clinic")).toBe(true);
    expect(isValidOrganizationName("HCA Healthcare")).toBe(true);
    expect(isValidOrganizationName("CommonSpirit Health")).toBe(true);
    expect(isValidOrganizationName("Tenet Healthcare")).toBe(true);
    expect(isValidOrganizationName("BayCare Health System")).toBe(true);
    expect(isValidOrganizationName("St. Lawrence Health")).toBe(true);
  });

  it("rejects person names", () => {
    expect(isValidOrganizationName("Kirk Davis")).toBe(false);
    expect(isValidOrganizationName("John Smith")).toBe(false);
    expect(isValidOrganizationName("Mary Johnson")).toBe(false);
  });

  it("rejects article / list titles", () => {
    expect(isValidOrganizationName("53 hospital and health system CISOs and chief privacy offic")).toBe(false);
    expect(isValidOrganizationName("Resources and Templates")).toBe(false);
    expect(isValidOrganizationName("IT Security Services Preferred Vendor List")).toBe(false);
    expect(isValidOrganizationName("Careers in Cybersecurity")).toBe(false);
  });

  it("rejects vendor / product names", () => {
    expect(isValidOrganizationName("Cisco XDR")).toBe(false);
    expect(isValidOrganizationName("Cisco Security")).toBe(false);
    expect(isValidOrganizationName("Cybersecurity Readiness Index")).toBe(false);
    expect(isValidOrganizationName("2023 Cybersecurity Readiness Index")).toBe(false);
  });

  it("rejects truncated article titles", () => {
    expect(isValidOrganizationName("Logicalis US Announced as First Global Partner to Launch ...")).toBe(false);
  });
});

// ─── classifySearchResult ─────────────────────────────────────────────────────

describe("classifySearchResult", () => {
  function makeResult(title: string, url: string, snippet = ""): SearchResult {
    return { title, url, snippet, verificationLevel: "snippet_only" };
  }

  it("classifies LinkedIn person profile as person_candidate", () => {
    expect(classifySearchResult(makeResult("Kirk Davis", "https://www.linkedin.com/in/kirk-davis-12345"))).toBe("person_candidate");
  });

  it("classifies number-prefixed article as article_or_list", () => {
    expect(classifySearchResult(makeResult("53 hospital and health system CISOs and chief privacy offic", "https://example.com/article"))).toBe("article_or_list");
  });

  it("classifies vendor domains as vendor_or_product", () => {
    expect(classifySearchResult(makeResult("Cisco XDR", "https://www.cisco.com/site/us/en/products/security/xdr/index.html"))).toBe("vendor_or_product");
  });

  it("classifies resource/template pages", () => {
    expect(classifySearchResult(makeResult("Resources and Templates", "https://somegov.gov/it/resources"))).toBe("resource_template");
    expect(classifySearchResult(makeResult("IT Security Services Preferred Vendor List", "https://somegov.gov/vendor-list"))).toBe("resource_template");
  });

  it("classifies job postings", () => {
    expect(classifySearchResult(makeResult("Careers in Cybersecurity", "https://somecompany.com/careers/cybersecurity"))).toBe("job_posting");
  });

  it("classifies healthcare org as organization_candidate", () => {
    expect(classifySearchResult(makeResult("BayCare Health System", "https://baycare.org"))).toBe("organization_candidate");
  });

  it("classifies person name (2-word title-case, no org words) as person_candidate", () => {
    expect(classifySearchResult(makeResult("John Smith", "https://somesite.org/jsmith"))).toBe("person_candidate");
  });
});

// ─── groupSearchResults ───────────────────────────────────────────────────────

describe("groupSearchResults", () => {
  it("rejects person names, vendor pages, and article titles", () => {
    const results: SearchResult[] = [
      { title: "Kirk Davis", url: "https://www.linkedin.com/in/kirk-davis", snippet: "", verificationLevel: "snippet_only" },
      { title: "Cisco XDR", url: "https://www.cisco.com/site/us/en/products/security/xdr/", snippet: "", verificationLevel: "snippet_only" },
      { title: "53 hospital and health system CISOs...", url: "https://news.example.com/article", snippet: "", verificationLevel: "snippet_only" },
      { title: "Resources and Templates", url: "https://gov.example.com/resources", snippet: "", verificationLevel: "snippet_only" },
      { title: "Mayo Clinic", url: "https://www.mayoclinic.org", snippet: "security operations", verificationLevel: "snippet_only" },
    ];
    const grouped = groupSearchResults(results);
    expect(grouped.has("Kirk Davis")).toBe(false);
    expect(grouped.has("Cisco XDR")).toBe(false);
    expect(grouped.has("53 hospital and health system CISOs...")).toBe(false);
    expect(grouped.has("Resources and Templates")).toBe(false);
    expect(grouped.has("Mayo Clinic")).toBe(true);
  });
});

// ─── KB retrieval ─────────────────────────────────────────────────────────────

describe("KB retrieval and scoring helpers", () => {
  it("computes bounded cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("skips embedding when chunks is empty", async () => {
    const result = await retrieveKbContext("ransomware", [], 5);
    expect(result).toEqual([]);
  });

  it("maps XDR capabilities with KB citations", async () => {
    const cap = await productCapabilityMapper(input, [
      testChunk("Cisco XDR helps ransomware readiness and zero trust operations.")
    ]);
    expect(cap.capabilities).toContain("extended detection and response");
    expect(cap.citations[0]?.sourceType).toBe("uploaded_kb");
  });
});

// ─── runResearch ──────────────────────────────────────────────────────────────

describe("runResearch", () => {
  it("marks run as fallback/unverified when required providers are missing", async () => {
    const run = await runResearch(input, []);
    expect(run.openAiEmbeddingsUsed).toBe(false);
    expect(run.isFallback).toBe(true);
    expect(run.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Unverified fallback run")])
    );
  });

  it("fills healthcare fallback candidates when live results are insufficient", async () => {
    const run = await runResearch(input, []);
    const names = run.accounts.map((a) => a.companyName);
    // At least some of the known healthcare demo names must appear
    const knownFallbacks = ["Mayo Clinic", "Cleveland Clinic", "HCA Healthcare", "CommonSpirit Health", "Tenet Healthcare"];
    const matched = names.filter((n) => knownFallbacks.includes(n));
    expect(matched.length).toBeGreaterThan(0);
  });

  it("account names are never person names or article titles", async () => {
    const run = await runResearch(input, []);
    for (const account of run.accounts) {
      expect(isValidOrganizationName(account.companyName)).toBe(true);
    }
  });

  it("accounts use BuyerTarget shape — no email field on champion", async () => {
    const run = await runResearch(input, []);
    const champion = run.accounts[0]?.businessChampion;
    expect(champion).toBeDefined();
    expect(champion.roleTitle).toBeTruthy();
    expect("businessEmail" in champion).toBe(false);
    expect("emailVerified" in champion).toBe(false);
  });

  it("exports include confidence and evidence_urls columns", async () => {
    const run = (await runResearch(input, [])) as ResearchRun;
    const csv = exportRun(run, "csv");
    expect(csv).toContain("confidence");
    expect(csv).toContain("evidence_urls");
    const md = exportRun(run, "md");
    expect(md).toContain("Confidence");
    const json = exportRun(run, "json");
    expect(json).toContain("confidenceScore");
    expect(json).toContain("providerStatus");
  });

  it("labels missing required providers as fallback diagnostics", async () => {
    const { getProviderDiagnostics } = await import("@/lib/services");
    const diagnostics = getProviderDiagnostics();
    expect(diagnostics.fallbackModeActive).toBe(true);
    expect(diagnostics.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "OPENAI_API_KEY", status: "missing_required_provider" }),
        expect.objectContaining({ name: "SEARCH_API_KEY", status: "missing_required_provider" })
      ])
    );
  });

  it("marks missing Firecrawl evidence as snippet-only", async () => {
    const { collectPageEvidence } = await import("@/lib/services");
    const results = await collectPageEvidence([
      { title: "Example", url: "https://example.com/source", snippet: "Search snippet", sourceType: "news" }
    ]);
    expect(results[0].verificationLevel).toBe("snippet_only");
  });
});
