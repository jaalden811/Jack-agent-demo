import { z } from "zod";

export const researchInputSchema = z.object({
  ciscoProduct: z.string().trim().min(2, "Cisco product is required").max(120),
  targetMarket: z.string().trim().min(2, "Target market is required").max(160),
  geography: z.string().trim().max(120).optional().default(""),
  companySize: z.string().trim().max(120).optional().default(""),
  maxResults: z.coerce.number().int().min(1).max(20).default(5),
  seedAccounts: z
    .string()
    .optional()
    .default("")
    .transform((value) =>
      value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 50)
    )
});

export type ResearchInput = z.infer<typeof researchInputSchema>;

export type RunStatus = "queued" | "running" | "completed" | "failed";

export type ResultClassification =
  | "organization_candidate"
  | "person_candidate"
  | "article_or_list"
  | "vendor_or_product"
  | "job_posting"
  | "resource_template"
  | "reject";

export type EvidenceSourceType =
  | "company_page"
  | "press_release"
  | "annual_report"
  | "job_post"
  | "news"
  | "public_post"
  | "uploaded_kb"
  | "search_result";

export type ProviderReadiness =
  | "ready"
  | "missing_optional_provider"
  | "missing_required_provider"
  | "fallback_mode_active";

export type ProviderCheck = {
  name: string;
  configured: boolean;
  required: boolean;
  status: ProviderReadiness;
  message: string;
};

export type ProviderStatusSnapshot = {
  overall: ProviderReadiness;
  searchProvider: "tavily" | "brave" | "exa" | "serpapi";
  checks: ProviderCheck[];
  liveSearchAvailable: boolean;
  openAiEmbeddingsAvailable: boolean;
  firecrawlAvailable: boolean;
  contactEnrichmentAvailable: boolean;
  fallbackModeActive: boolean;
  summary: string;
};

export type Citation = {
  url: string;
  title: string;
  date?: string;
  snippet: string;
  sourceType: EvidenceSourceType;
  verificationLevel: "full_page" | "snippet_only" | "kb" | "unverified";
  retrievedAt: string;
};

export type OrgSignal = {
  label: string;
  detail: string;
  /** What the signal implies about this organization's needs or fit. */
  implication?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  sourceType: "company_site" | "news" | "search_result" | "kb" | "fallback" | "unknown";
  verification: "verified" | "snippet_only" | "unverified";
};

export type RunDebugStats = {
  // Account selection
  selectedAccountBase: "seed_accounts" | "healthcare_default" | "market_default";
  selectedOrganizationNames: string[];
  // Broad market search (context only — not used for account name derivation)
  discoveryQueriesRun: number;
  broadSearchResultsForContext: number;
  rawResultCount: number;
  // Rejection counters
  rejectedAsArticleTitle: number;
  rejectedAsGenericConcept: number;
  rejectedAsVendorProduct: number;
  rejectedAsPerson: number;
  rejectedInvalidOrgName: number;
  rejectedCount: number;
  rejectionReasons: Partial<Record<ResultClassification, number>>;
  // Org tracking
  extractedOrgMentions: number;
  verifiedOrganizations: number;
  validOrgCount: number;
  fallbackOrganizationsAdded: number;
  // Enrichment
  enrichmentQueriesRun: number;
  pageFetchAttempts: number;
  accountSignalsAttached: number;
  marketSignalsOnly: number;
  // Final guard
  finalGuardReplacements: number;
  // OpenAI steps
  openAiSynthesisUsed: boolean;
  openAiEntityExtractionRan: boolean;
  openAiRerankingRan: boolean;
  // LinkedIn / contact discovery
  linkedInQueriesRun: number;
  contactCandidatesFound: number;
  dynamicOrgsDiscovered: number;
};

export type MarketSignal = {
  title: string;
  url?: string;
  snippet?: string;
  reason: string;
};

export type PriorityLevel = "A" | "B" | "C";

/** Public contact candidate found via public search (e.g. LinkedIn snippets). Never invented. */
export type ContactCandidate = {
  name: string;
  title?: string;
  organization: string;
  sourceUrl: string;
  sourceTitle?: string;
  snippet?: string;
  roleCategory: "economic_buyer" | "business_champion" | "technical_influencer" | "unknown";
  confidence: number;
  verification: "public_snippet" | "public_page" | "unverified";
  rejectionReason?: string;
};

/** Buyer persona recommendation under an organization. Never contains invented people or emails. */
export type BuyerTarget = {
  roleTitle: string;
  department?: string;
  /** Only populated when a person is publicly verified and clearly tied to the organization. */
  namedPerson?: {
    name: string;
    title?: string;
    sourceUrl: string;
  };
  whyThisRole: string;
  contactStatus: "role_only" | "named_public_profile" | "unavailable";
};

export type KbDocument = {
  id: string;
  runId: string;
  fileName: string;
  mimeType: string;
  extractedText: string;
  createdAt: string;
};

export type KbChunk = {
  id: string;
  runId: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, string | number | boolean>;
};

export type AccountRecommendation = {
  id: string;

  /** The target organization. Must be a real org name — never a person, article, or list title. */
  companyName: string;
  website: string | null;
  verificationStatus: "verified" | "fallback_unverified" | "candidate_unverified";

  /** Why this organization fits the Cisco product + market. */
  fitReason: string;
  marketFit: string;

  /** Structured signals read from sources. */
  signals: OrgSignal[];

  /** Inferred pain points. */
  painPoints: string[];

  /** Cisco product capability bullets. */
  ciscoCapabilityMatch: string[];
  ciscoFitSummary: string;

  /** Buyer map — nested inside organization, never the top-level account name. */
  economicBuyer: BuyerTarget;
  businessChampion: BuyerTarget;
  technicalInfluencers: BuyerTarget[];

  /** Raw evidence citations from search/KB. */
  evidence: Citation[];
  kbInfluence: Array<{
    documentName: string;
    chunkIndex: number;
    snippet: string;
  }>;

  scores: {
    fit: number;
    painEvidence: number;
    buyerIdentification: number;
    contactVerification: number;
    overall: number;
  };
  confidenceScore: number;
  confidenceLabel: "high" | "medium" | "low" | "fallback";

  /** OpenAI-assigned priority: A = high, B = medium, C = low/fallback */
  priority: PriorityLevel;
  priorityReason: string;

  /** Public contacts discovered via search/LinkedIn snippets. Never invented. */
  contactCandidates: ContactCandidate[];

  nextStep: string;
  missingDataFlags: string[];
};

export type ResearchRun = {
  id: string;
  input: ResearchInput;
  status: RunStatus;
  providerStatus: ProviderStatusSnapshot;
  liveSearchUsed: boolean;
  openAiEmbeddingsUsed: boolean;
  firecrawlExtractionUsed: boolean;
  contactEnrichmentUsed: boolean;
  isVerified: boolean;
  isFallback: boolean;
  warnings: string[];
  accounts: AccountRecommendation[];
  kbDocuments: KbDocument[];
  kbChunks: KbChunk[];
  createdAt: string;
  updatedAt: string;
  error?: string;
  debugStats?: RunDebugStats;
  /** Generic market/industry evidence — not tied to a specific org; shown once in run summary. */
  marketSignals?: MarketSignal[];
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  sourceType?: EvidenceSourceType;
  extractedContent?: string;
  verificationLevel?: "full_page" | "snippet_only" | "unverified";
};

export type CapabilityMap = {
  product: string;
  capabilities: string[];
  valueProps: string[];
  painCategories: string[];
  buyerPersonas: {
    championTitles: string[];
    economicBuyerTitles: string[];
    influencerTitles: string[];
  };
  citations: Citation[];
};
