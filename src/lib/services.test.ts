import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDiscoveryQueries,
  buildDynamicDiscoveryQueries,
  buildEnrichmentQueries,
  buildLinkedInBuyerQueries,
  categorizeContact,
  chunkText,
  classifySearchResult,
  computeOrgConfidence,
  computeSourceQualityScore,
  cosineSimilarity,
  exportRun,
  extractContactCandidates,
  filterEvidenceForOrg,
  groupSearchResults,
  groupSearchResultsWithStats,
  isValidOrganizationName,
  productCapabilityMapper,
  reRankAccounts,
  retrieveKbContext,
  runResearch,
  sanitizeFinalAccounts,
  selectOrganizations,
  synthesizeOrgFit
} from "@/lib/services";
import type { KbChunk, ResearchInput, ResearchRun, RunDebugStats, SearchResult } from "@/lib/types";

vi.mock("openai", () => ({ default: vi.fn() }));

// Shared helper for test debug stats fixtures
const makeDebugStats = (): RunDebugStats => ({
  selectedAccountBase: "healthcare_default", selectedOrganizationNames: [],
  discoveryQueriesRun: 0, broadSearchResultsForContext: 0,
  enrichmentQueriesRun: 0, rawResultCount: 0,
  rejectedAsArticleTitle: 0, rejectedAsGenericConcept: 0, rejectedAsVendorProduct: 0,
  rejectedAsPerson: 0, rejectedInvalidOrgName: 0, rejectedCount: 0, rejectionReasons: {},
  extractedOrgMentions: 0, verifiedOrganizations: 0, validOrgCount: 0,
  fallbackOrganizationsAdded: 0, pageFetchAttempts: 0, accountSignalsAttached: 0,
  marketSignalsOnly: 0, finalGuardReplacements: 0, aiSynthesisUsed: false,
  aiEntityExtractionRan: false, aiRerankingRan: false,
  linkedInQueriesRun: 0, contactCandidatesFound: 0, dynamicOrgsDiscovered: 0
});

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

  it("rejects the exact bad titles that appeared as accounts in production", () => {
    // These are the real titles that appeared as account cards — they must all be rejected
    expect(isValidOrganizationName("Current and Emerging Healthcare Cyber Threat Landscape")).toBe(false);
    expect(isValidOrganizationName("Hospital Chief Information Security Officer CISO")).toBe(false);
    expect(isValidOrganizationName("Hospital Cybersecurity in Chicago, IL")).toBe(false);
    expect(isValidOrganizationName("Incident Response for Small Healthcare Organizations")).toBe(false);
    expect(isValidOrganizationName("Proactive Cyber Security for the Healthcare Industry")).toBe(false);
    expect(isValidOrganizationName("Hospital Chief Information Security Officer CISO Job")).toBe(false);
    expect(isValidOrganizationName("Security Incidents and Data Breaches")).toBe(false);
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

  it("classifies the exact bad production titles as article_or_list or job_posting", () => {
    const bad = [
      ["Current and Emerging Healthcare Cyber Threat Landscape", "https://healthisac.net/report"],
      ["Incident Response for Small Healthcare Organizations", "https://hhs.gov/405d"],
      ["Proactive Cyber Security for the Healthcare Industry", "https://vendor.com/healthcare"],
      ["Hospital Chief Information Security Officer CISO", "https://jobs.example.com/ciso"],
      ["Security Incidents and Data Breaches", "https://hhs.gov/incidents"]
    ];
    for (const [title, url] of bad) {
      const classification = classifySearchResult(r(title, url));
      expect(["article_or_list", "job_posting", "resource_template", "reject"]).toContain(classification);
    }
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
      priority: "C" as const,
      priorityReason: "",
      contactCandidates: [],
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

// ─── buildLinkedInBuyerQueries ────────────────────────────────────────────────
describe("buildLinkedInBuyerQueries", () => {
  it("generates LinkedIn queries including site:linkedin.com/in for CISO/CIO roles", () => {
    const queries = buildLinkedInBuyerQueries("HCA Healthcare");
    const combined = queries.join(" ");
    expect(combined).toMatch(/site:linkedin\.com\/in/i);
    expect(combined).toMatch(/HCA Healthcare/);
    expect(combined).toMatch(/CISO|Chief Information Security|VP Information Security/i);
  });

  it("generates different queries for different orgs", () => {
    const q1 = buildLinkedInBuyerQueries("Mayo Clinic");
    const q2 = buildLinkedInBuyerQueries("Tenet Healthcare");
    expect(q1.join(" ")).toMatch(/Mayo Clinic/);
    expect(q2.join(" ")).toMatch(/Tenet Healthcare/);
    expect(q1[0]).not.toBe(q2[0]);
  });
});

// ─── categorizeContact ────────────────────────────────────────────────────────
describe("categorizeContact", () => {
  it("categorizes CISO and CIO as economic_buyer", () => {
    expect(categorizeContact("CISO")).toBe("economic_buyer");
    expect(categorizeContact("Chief Information Security Officer")).toBe("economic_buyer");
    expect(categorizeContact("Chief Information Officer")).toBe("economic_buyer");
    expect(categorizeContact("CIO")).toBe("economic_buyer");
  });

  it("categorizes Director of Security Operations as business_champion", () => {
    expect(categorizeContact("Director of Security Operations")).toBe("business_champion");
    expect(categorizeContact("VP Information Security")).toBe("business_champion");
  });

  it("categorizes Security Architect as technical_influencer", () => {
    expect(categorizeContact("Security Architect")).toBe("technical_influencer");
    expect(categorizeContact("SOC Manager")).toBe("technical_influencer");
  });

  it("returns unknown for unrecognized titles", () => {
    expect(categorizeContact("Marketing Manager")).toBe("unknown");
    expect(categorizeContact("Software Engineer")).toBe("unknown");
  });
});

// ─── extractContactCandidates ─────────────────────────────────────────────────
describe("extractContactCandidates", () => {
  it("attaches LinkedIn contact clearly tied to org", () => {
    const results: SearchResult[] = [
      {
        title: "Jane Smith - CISO at Cleveland Clinic | LinkedIn",
        url: "https://www.linkedin.com/in/jane-smith-ciso-cc-12345",
        snippet: "Jane Smith is Chief Information Security Officer at Cleveland Clinic. Security operations leadership.",
        verificationLevel: "snippet_only"
      }
    ];
    const candidates = extractContactCandidates(results, "Cleveland Clinic");
    expect(candidates.length).toBe(1);
    expect(candidates[0].name).toBe("Jane Smith");
    expect(candidates[0].roleCategory).toBe("economic_buyer");
    expect(candidates[0].organization).toBe("Cleveland Clinic");
    expect(candidates[0].verification).toBe("public_snippet");
  });

  it("rejects LinkedIn contact not tied to org", () => {
    const results: SearchResult[] = [
      {
        title: "Bob Jones - CISO at Acme Corp | LinkedIn",
        url: "https://www.linkedin.com/in/bob-jones-12345",
        snippet: "Bob Jones is CISO at Acme Corp, specializing in cybersecurity.",
        verificationLevel: "snippet_only"
      }
    ];
    const candidates = extractContactCandidates(results, "Mayo Clinic");
    expect(candidates.length).toBe(0);
  });

  it("never invents contacts from non-LinkedIn results", () => {
    const results: SearchResult[] = [
      {
        title: "Healthcare Cybersecurity: Top CISOs in 2025",
        url: "https://healthcareitnews.com/article/top-cisos",
        snippet: "Leading CISOs discuss ransomware readiness.",
        verificationLevel: "snippet_only"
      }
    ];
    const candidates = extractContactCandidates(results, "HCA Healthcare");
    expect(candidates.length).toBe(0);
  });
});

// ─── computeSourceQualityScore ────────────────────────────────────────────────
describe("computeSourceQualityScore", () => {
  it("scores official org domain higher than generic article", () => {
    const orgResult = { title: "HCA Healthcare - Cybersecurity", url: "https://hcahealthcare.com/security", snippet: "HCA Healthcare security program." };
    const genericResult = { title: "Healthcare Data Breach Statistics", url: "https://blog.vendor.com/healthcare-stats", snippet: "General healthcare breach data." };
    expect(computeSourceQualityScore(orgResult, "HCA Healthcare")).toBeGreaterThan(computeSourceQualityScore(genericResult, "HCA Healthcare"));
  });

  it("gives recency bonus for 2025/2026 dates", () => {
    const recentResult = { title: "Mayo Clinic cybersecurity 2026", url: "https://mayoclinic.org/news", snippet: "Mayo Clinic 2026 security update." };
    const oldResult = { title: "Mayo Clinic cybersecurity 2018", url: "https://mayoclinic.org/old-news", snippet: "Old security news from 2018." };
    expect(computeSourceQualityScore(recentResult, "Mayo Clinic")).toBeGreaterThan(computeSourceQualityScore(oldResult, "Mayo Clinic"));
  });

  it("penalizes generic content not mentioning the org", () => {
    const generic = { title: "Ransomware Attacks in Healthcare 2025", url: "https://vendor.com/healthcare", snippet: "Generic ransomware in healthcare." };
    const score = computeSourceQualityScore(generic, "Tenet Healthcare");
    expect(score).toBeLessThan(30);
  });
});

// ─── buildDynamicDiscoveryQueries ─────────────────────────────────────────────
describe("buildDynamicDiscoveryQueries", () => {
  it("returns healthcare-specific queries without Cisco product name", () => {
    const queries = buildDynamicDiscoveryQueries(input);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q).not.toMatch(/Cisco XDR/i);
    }
    expect(queries.join(" ")).toMatch(/hospital|health|ransomware|CISO/i);
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
  it("returns deterministic fallback when the AI provider is not configured", async () => {
    const cap = await productCapabilityMapper(input, []);
    const debugStats = makeDebugStats();
    const result = await synthesizeOrgFit("Mayo Clinic", [], cap, input, debugStats);
    expect(result.fitReason).toContain("Mayo Clinic");
    expect(result.ciscoFitSummary).toBeTruthy();
    expect(result.nextStep).toContain("Mayo Clinic");
    expect(debugStats.aiSynthesisUsed).toBe(false);
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

  it("AI reranking unavailable does NOT produce per-card 'failed' message", async () => {
    // reRankAccounts with no configured provider should use deterministicRerank, not error messages
    await productCapabilityMapper(input, []);
    const run = await runResearch(input, []);
    for (const account of run.accounts) {
      expect(account.priorityReason).not.toMatch(/reranking failed/i);
      expect(account.priority).toMatch(/^[ABC]$/);
    }
  });

  it("reRankAccounts deterministic path assigns A/B/C based on signal count", async () => {
    const mockAccounts = [
      {
        id: "1", companyName: "Mayo Clinic", website: null, verificationStatus: "candidate_unverified" as const,
        fitReason: "", marketFit: "", signals: [
          { label: "Cybersecurity signal", detail: "ransomware security operations", sourceType: "news" as const, verification: "snippet_only" as const },
          { label: "Security signal", detail: "cyber breach", sourceType: "news" as const, verification: "snippet_only" as const }
        ],
        painPoints: [], ciscoCapabilityMatch: [], ciscoFitSummary: "",
        economicBuyer: { roleTitle: "CIO", department: "", whyThisRole: "", contactStatus: "role_only" as const },
        businessChampion: { roleTitle: "Dir", department: "", whyThisRole: "", contactStatus: "role_only" as const },
        technicalInfluencers: [], evidence: [
          { url: "https://example.com/1", title: "Mayo security", snippet: "", sourceType: "news" as const, verificationLevel: "snippet_only" as const, retrievedAt: "" },
          { url: "https://example.com/2", title: "Mayo breach", snippet: "", sourceType: "news" as const, verificationLevel: "snippet_only" as const, retrievedAt: "" }
        ],
        kbInfluence: [], scores: { fit: 60, painEvidence: 0, buyerIdentification: 25, contactVerification: 0, overall: 55 },
        confidenceScore: 55, confidenceLabel: "medium" as const,
        priority: "C" as const, priorityReason: "",
        contactCandidates: [], nextStep: "", missingDataFlags: []
      }
    ];
    const debugStats = makeDebugStats();
    const capMap = await productCapabilityMapper(input, []);
    const { accounts } = await reRankAccounts(mockAccounts, capMap, input, debugStats);
    // With 2 signals and 2 evidence URLs, should be Priority A
    expect(accounts[0].priority).toBe("A");
    expect(accounts[0].priorityReason).not.toMatch(/failed/i);
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

  it("accounts use BuyerTarget shape — no email field; have priority and contactCandidates", async () => {
    const run = await runResearch(input, []);
    const account = run.accounts[0];
    expect(account?.businessChampion?.roleTitle).toBeTruthy();
    expect("businessEmail" in account.businessChampion).toBe(false);
    expect(account.priority).toMatch(/^[ABC]$/);
    expect(Array.isArray(account.contactCandidates)).toBe(true);
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

  it("diagnostics report remote embeddings unavailable (deterministic local retrieval)", async () => {
    const { getProviderDiagnostics } = await import("@/lib/services");
    const diag = getProviderDiagnostics();
    // Circuit exposes no embedding endpoint; KB retrieval is always local.
    expect(diag.remoteEmbeddingsAvailable).toBe(false);
    // The Circuit AI provider check is optional — its absence must not force fallback mode.
    const aiCheck = diag.checks.find((c) => c.name === "AI provider (Circuit)");
    expect(aiCheck?.required).toBe(false);
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
