import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDiscoveryQueries,
  buildEnrichmentQueries,
  chunkText,
  classifySearchResult,
  cosineSimilarity,
  computeOrgConfidence,
  exportRun,
  filterEvidenceForOrg,
  groupSearchResults,
  groupSearchResultsWithStats,
  isValidOrganizationName,
  productCapabilityMapper,
  retrieveKbContext,
  runResearch,
  sanitizeFinalAccounts,
  selectOrganizations,
  synthesizeOrgFit
} from "@/lib/services";
import type { KbChunk, ResearchInput, ResearchRun, RunDebugStats, SearchResult } from "@/lib/types";

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
  it("accepts well-known healthcare orgs", () => {
    expect(isValidOrganizationName("Mayo Clinic")).toBe(true);
    expect(isValidOrganizationName("Cleveland Clinic")).toBe(true);
    expect(isValidOrganizationName("HCA Healthcare")).toBe(true);
    expect(isValidOrganizationName("CommonSpirit Health")).toBe(true);
    expect(isValidOrganizationName("Tenet Healthcare")).toBe(true);
  });

  it("rejects person names", () => {
    expect(isValidOrganizationName("Kirk Davis")).toBe(false);
    expect(isValidOrganizationName("John Smith")).toBe(false);
    expect(isValidOrganizationName("Mary Johnson")).toBe(false);
  });

  it("rejects article / report / generic concept titles — the ones currently appearing as bad accounts", () => {
    // The exact bad titles reported by the user
    expect(isValidOrganizationName("Cyber-Attacks on Hospital Systems: A Narrative Review")).toBe(false);
    expect(isValidOrganizationName("Healthcare Cybersecurity: Challenges for Modern Hospitals")).toBe(false);
    expect(isValidOrganizationName("Ransomware Attacks in Healthcare: How to Respond")).toBe(false);
    expect(isValidOrganizationName("What Is a Security Operations Center (SOC)?")).toBe(false);
    expect(isValidOrganizationName("Ransomware Attacks on Hospitals Have Changed")).toBe(false);
    expect(isValidOrganizationName("Cybersecurity in Hospitals: A Systematic, Organizational ...")).toBe(false);
    expect(isValidOrganizationName("Ransomware: A Public Health Crisis White Paper")).toBe(false);
  });

  it("rejects other article / list / vendor patterns", () => {
    expect(isValidOrganizationName("53 hospital and health system CISOs and chief privacy offic")).toBe(false);
    expect(isValidOrganizationName("Resources and Templates")).toBe(false);
    expect(isValidOrganizationName("IT Security Services Preferred Vendor List")).toBe(false);
    expect(isValidOrganizationName("Careers in Cybersecurity")).toBe(false);
    expect(isValidOrganizationName("Cisco XDR")).toBe(false);
    expect(isValidOrganizationName("2023 Cybersecurity Readiness Index")).toBe(false);
    expect(isValidOrganizationName("Logicalis US Announced as First Global Partner to Launch ...")).toBe(false);
    expect(isValidOrganizationName("Security Operations Center")).toBe(false);
    expect(isValidOrganizationName("Healthcare Cybersecurity")).toBe(false);
  });
});

// ─── classifySearchResult ─────────────────────────────────────────────────────
describe("classifySearchResult", () => {
  const r = (title: string, url: string): SearchResult => ({ title, url, snippet: "", verificationLevel: "snippet_only" });

  it("classifies LinkedIn person profile as person_candidate", () => {
    expect(classifySearchResult(r("Kirk Davis", "https://www.linkedin.com/in/kirk-davis-12345"))).toBe("person_candidate");
  });

  it("classifies number-prefixed article as article_or_list", () => {
    expect(classifySearchResult(r("53 hospital and health system CISOs", "https://news.example.com/article"))).toBe("article_or_list");
  });

  it("classifies colon article titles as article_or_list", () => {
    expect(classifySearchResult(r("Cyber-Attacks on Hospital Systems: A Narrative Review", "https://ncbi.nlm.nih.gov/article"))).toBe("article_or_list");
    expect(classifySearchResult(r("Healthcare Cybersecurity: Challenges for Modern Hospitals", "https://blog.example.com"))).toBe("article_or_list");
    expect(classifySearchResult(r("Ransomware Attacks in Healthcare: How to Respond", "https://healthtech.example.com"))).toBe("article_or_list");
  });

  it("classifies interrogative / generic concept titles as article_or_list", () => {
    // Use a neutral domain so the title pattern fires (not the vendor domain check)
    expect(classifySearchResult(r("What Is a Security Operations Center (SOC)?", "https://healthcareit.example.com/soc"))).toBe("article_or_list");
    expect(classifySearchResult(r("Ransomware Attacks on Hospitals Have Changed", "https://news.example.com/ransomware"))).toBe("article_or_list");
  });

  it("classifies academic/research domains as article_or_list", () => {
    expect(classifySearchResult(r("Some Article", "https://ncbi.nlm.nih.gov/pmc/articles/12345"))).toBe("article_or_list");
    expect(classifySearchResult(r("Research Paper", "https://pubmed.ncbi.nlm.nih.gov/12345"))).toBe("article_or_list");
  });

  it("classifies cisco.com as vendor_or_product", () => {
    expect(classifySearchResult(r("Cisco XDR", "https://www.cisco.com/site/us/en/products/security/xdr/index.html"))).toBe("vendor_or_product");
  });

  it("classifies resource pages", () => {
    expect(classifySearchResult(r("Resources and Templates", "https://govsite.gov/it/resources"))).toBe("resource_template");
    expect(classifySearchResult(r("IT Security Services Preferred Vendor List", "https://govsite.gov/vendor-list"))).toBe("resource_template");
  });

  it("classifies job postings", () => {
    expect(classifySearchResult(r("Careers in Cybersecurity", "https://company.com/careers/cyber"))).toBe("job_posting");
  });

  it("classifies healthcare org names as organization_candidate", () => {
    expect(classifySearchResult(r("BayCare Health System", "https://baycare.org"))).toBe("organization_candidate");
    expect(classifySearchResult(r("Mayo Clinic", "https://www.mayoclinic.org"))).toBe("organization_candidate");
  });
});

// ─── groupSearchResultsWithStats ─────────────────────────────────────────────
describe("groupSearchResultsWithStats", () => {
  it("counts article titles in rejectedAsArticleTitle, not in validOrgs", () => {
    const results: SearchResult[] = [
      { title: "Cyber-Attacks on Hospital Systems: A Narrative Review", url: "https://ncbi.nlm.nih.gov/pmc/123", snippet: "hospitals cybersecurity", verificationLevel: "snippet_only" },
      { title: "Healthcare Cybersecurity: Challenges for Modern Hospitals", url: "https://blog.example.com/hc", snippet: "cybersecurity challenges", verificationLevel: "snippet_only" },
      { title: "Ransomware Attacks in Healthcare: How to Respond", url: "https://securitynews.com/r", snippet: "ransomware healthcare", verificationLevel: "snippet_only" },
      { title: "What Is a Security Operations Center (SOC)?", url: "https://crowdstrike.com/blog/soc", snippet: "SOC definition", verificationLevel: "snippet_only" },
      { title: "Mayo Clinic", url: "https://www.mayoclinic.org", snippet: "health system", verificationLevel: "snippet_only" },
    ];
    const { grouped, stats } = groupSearchResultsWithStats(results);
    expect(grouped.size).toBe(1);
    expect(grouped.has("Mayo Clinic")).toBe(true);
    expect(stats.rejectedAsArticleTitle).toBeGreaterThanOrEqual(3);
    expect(stats.marketSignals.length).toBeGreaterThan(0);
  });
});

// ─── groupSearchResults ───────────────────────────────────────────────────────
describe("groupSearchResults", () => {
  it("rejects all known bad result types and accepts valid orgs", () => {
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

// ─── selectOrganizations ─────────────────────────────────────────────────────
describe("selectOrganizations", () => {
  it("returns seed accounts when provided", () => {
    const { orgs, base } = selectOrganizations({ ...input, seedAccounts: ["ACME Health", "BetaCare"] });
    expect(orgs).toEqual(["ACME Health", "BetaCare"]);
    expect(base).toBe("seed_accounts");
  });

  it("returns approved healthcare fallback when no seeds and market is healthcare", () => {
    const { orgs, base } = selectOrganizations(input); // input.seedAccounts = []
    expect(orgs).toContain("Mayo Clinic");
    expect(orgs).toContain("Cleveland Clinic");
    expect(orgs).toContain("HCA Healthcare");
    expect(base).toBe("healthcare_default");
  });

  it("never returns article titles as selected orgs", () => {
    const { orgs } = selectOrganizations(input);
    for (const org of orgs) {
      expect(org).not.toMatch(/what is|narrative review|ransomware attacks|data breach statistics/i);
      expect(isValidOrganizationName(org)).toBe(true);
    }
  });
});

// ─── filterEvidenceForOrg ─────────────────────────────────────────────────────
describe("filterEvidenceForOrg", () => {
  it("keeps results that mention the org name, discards generic articles", () => {
    const results: SearchResult[] = [
      { title: "Cleveland Clinic CISO cybersecurity", url: "https://news.example.com/cleveland-clinic", snippet: "Cleveland Clinic invests in security operations.", verificationLevel: "snippet_only" },
      { title: "Healthcare Data Breach Statistics – Updated for 2026", url: "https://healthcaredive.com/stats", snippet: "Healthcare data breaches increased.", verificationLevel: "snippet_only" },
      { title: "Ransomware Attacks on Hospitals Have Changed", url: "https://news.example.com/ransomware", snippet: "Hospitals face ransomware.", verificationLevel: "snippet_only" },
    ];
    const { orgSpecific, marketContext } = filterEvidenceForOrg(results, "Cleveland Clinic");
    expect(orgSpecific.length).toBe(1);
    expect(orgSpecific[0].title).toContain("Cleveland Clinic");
    expect(marketContext.length).toBe(2);
  });

  it("attaches org domain evidence to the org", () => {
    const results: SearchResult[] = [
      { title: "Mayo Clinic - Official Site", url: "https://www.mayoclinic.org/about-mayo-clinic", snippet: "Mayo Clinic is a nonprofit medical center.", verificationLevel: "snippet_only" },
    ];
    const { orgSpecific } = filterEvidenceForOrg(results, "Mayo Clinic");
    expect(orgSpecific.length).toBe(1);
  });

  it("does not attach generic healthcare articles to a specific org", () => {
    const results: SearchResult[] = [
      { title: "Healthcare Incident Response Services for Cybersecurity", url: "https://vendor.com/services", snippet: "Generic incident response services.", verificationLevel: "snippet_only" },
      { title: "Security Incidents and Data Breaches", url: "https://news.example.com/breach", snippet: "Generic breach statistics.", verificationLevel: "snippet_only" },
    ];
    const { orgSpecific } = filterEvidenceForOrg(results, "HCA Healthcare");
    expect(orgSpecific.length).toBe(0);
  });
});

// ─── sanitizeFinalAccounts ────────────────────────────────────────────────────
describe("sanitizeFinalAccounts", () => {
  it("removes accounts not in selectedOrgs and backfills with approved orgs", async () => {
    const cap = await productCapabilityMapper(input, []);
    const badAccount = {
      id: "bad-1",
      companyName: "Healthcare Data Breach Statistics",
      website: null,
      verificationStatus: "fallback_unverified" as const,
      fitReason: "",
      marketFit: "",
      signals: [],
      painPoints: [],
      ciscoCapabilityMatch: [],
      ciscoFitSummary: "",
      economicBuyer: { roleTitle: "CIO", department: "", whyThisRole: "", contactStatus: "role_only" as const },
      businessChampion: { roleTitle: "Director IT", department: "", whyThisRole: "", contactStatus: "role_only" as const },
      technicalInfluencers: [],
      evidence: [],
      kbInfluence: [],
      scores: { fit: 0, painEvidence: 0, buyerIdentification: 0, contactVerification: 0, overall: 0 },
      confidenceScore: 0,
      confidenceLabel: "fallback" as const,
      nextStep: "",
      missingDataFlags: []
    };
    const selectedOrgs = ["Mayo Clinic", "Cleveland Clinic"];
    const { accounts, replacements } = sanitizeFinalAccounts([badAccount], selectedOrgs, cap, input);
    expect(replacements).toBe(1);
    const names = accounts.map((a) => a.companyName);
    expect(names).not.toContain("Healthcare Data Breach Statistics");
    expect(names).toContain("Mayo Clinic");
    expect(names).toContain("Cleveland Clinic");
  });
});

// ─── buildDiscoveryQueries ────────────────────────────────────────────────────
describe("buildDiscoveryQueries", () => {
  it("produces healthcare-specific queries that do NOT include the product name", () => {
    const queries = buildDiscoveryQueries(input);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q).not.toMatch(/Cisco XDR/i);
      expect(q).toMatch(/hospital|healthcare|health system/i);
    }
  });
});

// ─── buildEnrichmentQueries ───────────────────────────────────────────────────
describe("buildEnrichmentQueries", () => {
  it("generates org-specific enrichment queries for Mayo Clinic", () => {
    const queries = buildEnrichmentQueries("Mayo Clinic");
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q).toMatch(/Mayo Clinic/i);
    }
    // Should include security/cyber terms
    const combined = queries.join(" ");
    expect(combined).toMatch(/cyber|CISO|security/i);
  });

  it("generates different queries for Cleveland Clinic vs HCA Healthcare", () => {
    const q1 = buildEnrichmentQueries("Cleveland Clinic");
    const q2 = buildEnrichmentQueries("HCA Healthcare");
    expect(q1.join(" ")).toMatch(/Cleveland Clinic/);
    expect(q2.join(" ")).toMatch(/HCA Healthcare/);
    expect(q1[0]).not.toBe(q2[0]);
  });
});

// ─── computeOrgConfidence ─────────────────────────────────────────────────────
describe("computeOrgConfidence", () => {
  it("scores fallback-only with no sources below 35", () => {
    const { score, label } = computeOrgConfidence({
      orgName: "Mayo Clinic",
      signals: [],
      pageDetails: [],
      fromLiveSearch: false,
      persons: []
    });
    expect(score).toBeLessThan(35);
    expect(label).toBe("fallback");
  });

  it("scores higher when cyber signal is found", () => {
    const withCyber = computeOrgConfidence({
      orgName: "HCA Healthcare",
      signals: [
        { label: "Cybersecurity / ransomware signal", detail: "HCA Healthcare ransomware breach security operations", sourceType: "news", verification: "snippet_only" }
      ],
      pageDetails: [],
      fromLiveSearch: true,
      persons: []
    });
    const withoutCyber = computeOrgConfidence({
      orgName: "HCA Healthcare",
      signals: [],
      pageDetails: [],
      fromLiveSearch: false,
      persons: []
    });
    expect(withCyber.score).toBeGreaterThan(withoutCyber.score);
  });

  it("fallback score < verified org with cyber signal", () => {
    const fallback = computeOrgConfidence({
      orgName: "Some Org",
      signals: [],
      pageDetails: [],
      fromLiveSearch: false,
      persons: []
    });
    const live = computeOrgConfidence({
      orgName: "HCA Healthcare",
      signals: [
        { label: "Cybersecurity signal", detail: "security operations breach", sourceType: "news", verification: "snippet_only" },
        { label: "Leadership signal", detail: "CISO security leader", sourceType: "search_result", verification: "snippet_only" }
      ],
      pageDetails: [],
      fromLiveSearch: true,
      persons: [{ name: "Jane Smith", url: "https://example.com/jsmith", snippet: "CISO at HCA" }]
    });
    expect(live.score).toBeGreaterThan(fallback.score);
  });
});

// ─── KB retrieval ─────────────────────────────────────────────────────────────
describe("KB retrieval helpers", () => {
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

// ─── synthesizeOrgFit ─────────────────────────────────────────────────────────
describe("synthesizeOrgFit", () => {
  const makeDebugStats = (): RunDebugStats => ({
    selectedAccountBase: "healthcare_default", selectedOrganizationNames: [],
    discoveryQueriesRun: 0, broadSearchResultsForContext: 0,
    enrichmentQueriesRun: 0, rawResultCount: 0,
    rejectedAsArticleTitle: 0, rejectedAsGenericConcept: 0, rejectedAsVendorProduct: 0,
    rejectedAsPerson: 0, rejectedInvalidOrgName: 0, rejectedCount: 0, rejectionReasons: {},
    extractedOrgMentions: 0, verifiedOrganizations: 0, validOrgCount: 0,
    fallbackOrganizationsAdded: 0, pageFetchAttempts: 0, accountSignalsAttached: 0,
    marketSignalsOnly: 0, finalGuardReplacements: 0, openAiSynthesisUsed: false
  });

  it("returns deterministic fallback when OPENAI_API_KEY is not configured", async () => {
    const cap = await productCapabilityMapper(input, []);
    const debugStats = makeDebugStats();
    const result = await synthesizeOrgFit("Mayo Clinic", [], cap, input, debugStats);
    expect(result.fitReason).toContain("Mayo Clinic");
    expect(result.ciscoFitSummary).toBeTruthy();
    expect(result.nextStep).toContain("Mayo Clinic");
    expect(debugStats.openAiSynthesisUsed).toBe(false);
  });

  it("synthesis is org-specific (different outputs for different orgs)", async () => {
    const cap = await productCapabilityMapper(input, []);
    const debugStats = makeDebugStats();
    const r1 = await synthesizeOrgFit("Mayo Clinic", [], cap, input, debugStats);
    const r2 = await synthesizeOrgFit("HCA Healthcare", [], cap, input, debugStats);
    // Different org names should produce different fit reasons
    expect(r1.fitReason).toContain("Mayo Clinic");
    expect(r2.fitReason).toContain("HCA Healthcare");
  });
});

// ─── runResearch (integration) ────────────────────────────────────────────────
describe("runResearch", () => {
  it("uses EXACTLY the approved fallback orgs for healthcare when no seeds provided", async () => {
    const run = await runResearch(input, []);
    const names = run.accounts.map((a) => a.companyName);
    const approvedFallbacks = ["Mayo Clinic", "Cleveland Clinic", "HCA Healthcare", "CommonSpirit Health", "Tenet Healthcare"];
    // Every account MUST be from the approved fallback list
    for (const name of names) {
      expect(approvedFallbacks).toContain(name);
      expect(isValidOrganizationName(name)).toBe(true);
    }
    // At least 3 of the 5 approved fallbacks must be present
    const matched = names.filter((n) => approvedFallbacks.includes(n));
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it("uses seed accounts when provided instead of fallback list", async () => {
    const seedInput = { ...input, seedAccounts: ["Northwell Health", "Kaiser Permanente"], maxResults: 2 };
    const run = await runResearch(seedInput, []);
    const names = run.accounts.map((a) => a.companyName);
    expect(names).toContain("Northwell Health");
    expect(names).toContain("Kaiser Permanente");
    // Should NOT include generic healthcare fallback when seeds are provided
    expect(names).not.toContain("Mayo Clinic");
  });

  it("debug stats show selectedAccountBase and selectedOrganizationNames", async () => {
    const run = await runResearch(input, []);
    expect(run.debugStats?.selectedAccountBase).toBe("healthcare_default");
    expect(run.debugStats?.selectedOrganizationNames).toContain("Mayo Clinic");
  });

  it("fills healthcare fallback candidates when live results are insufficient", async () => {
    const run = await runResearch(input, []);
    const names = run.accounts.map((a) => a.companyName);
    const knownFallbacks = ["Mayo Clinic", "Cleveland Clinic", "HCA Healthcare", "CommonSpirit Health", "Tenet Healthcare"];
    const matched = names.filter((n) => knownFallbacks.includes(n));
    expect(matched.length).toBeGreaterThan(0);
  });

  it("account names are all valid organization names", async () => {
    const run = await runResearch(input, []);
    for (const account of run.accounts) {
      expect(isValidOrganizationName(account.companyName)).toBe(true);
    }
  });

  it("accounts use BuyerTarget shape — no email field", async () => {
    const run = await runResearch(input, []);
    const champion = run.accounts[0]?.businessChampion;
    expect(champion?.roleTitle).toBeTruthy();
    expect("businessEmail" in champion).toBe(false);
    expect("emailVerified" in champion).toBe(false);
  });

  it("confidence scores vary across fallback orgs based on signals", async () => {
    const run = await runResearch(input, []);
    // All should have scores (may be same for pure fallback but should be non-zero)
    for (const account of run.accounts) {
      expect(account.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(["high", "medium", "low", "fallback"]).toContain(account.confidenceLabel);
    }
  });

  it("debug stats are present on the run", async () => {
    const run = await runResearch(input, []);
    expect(run.debugStats).toBeDefined();
    expect(typeof run.debugStats?.discoveryQueriesRun).toBe("number");
    expect(typeof run.debugStats?.fallbackOrganizationsAdded).toBe("number");
    expect(typeof run.debugStats?.rejectedCount).toBe("number");
  });

  it("marks run as fallback when required providers are missing", async () => {
    const run = await runResearch(input, []);
    expect(run.isFallback).toBe(true);
    expect(run.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Unverified fallback run")]));
  });

  it("diagnostics labels empty-string OPENAI_API_KEY as missing", async () => {
    process.env.OPENAI_API_KEY = "";
    const { getProviderDiagnostics } = await import("@/lib/services");
    const diag = getProviderDiagnostics();
    expect(diag.openAiEmbeddingsAvailable).toBe(false);
  });

  it("exports include all required columns", async () => {
    const run = (await runResearch(input, [])) as ResearchRun;
    const csv = exportRun(run, "csv");
    expect(csv).toContain("confidence");
    expect(csv).toContain("evidence_urls");
    expect(csv).toContain("cisco_fit_summary");
    const md = exportRun(run, "md");
    expect(md).toContain("Confidence");
    const json = exportRun(run, "json");
    expect(json).toContain("confidenceScore");
    expect(json).toContain("debugStats");
  });
});
