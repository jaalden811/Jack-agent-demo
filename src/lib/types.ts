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

export type EvidenceSourceType =
  | "company_page"
  | "press_release"
  | "annual_report"
  | "job_post"
  | "news"
  | "public_post"
  | "uploaded_kb"
  | "search_result";

export type Citation = {
  url: string;
  title: string;
  date?: string;
  snippet: string;
  sourceType: EvidenceSourceType;
  retrievedAt: string;
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

export type ContactRecommendation = {
  roleType: "business_champion" | "economic_buyer" | "technical_influencer" | "other_influencer";
  name: string | null;
  title: string;
  businessEmail: string | null;
  emailVerified: boolean;
  profileUrl: string | null;
  companyPage: string | null;
  verificationStatus: "verified" | "role_only" | "unverified";
  relationshipHypothesis: string;
  citations: Citation[];
  missingDataFlags: string[];
};

export type AccountRecommendation = {
  id: string;
  companyName: string;
  fitReason: string;
  champion: ContactRecommendation;
  economicBuyer: ContactRecommendation;
  otherInfluencers: ContactRecommendation[];
  painPoints: Array<{
    pain: string;
    citations: Citation[];
  }>;
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
  suggestedOutreachAngle: string;
  missingDataFlags: string[];
};

export type ResearchRun = {
  id: string;
  input: ResearchInput;
  status: RunStatus;
  warnings: string[];
  accounts: AccountRecommendation[];
  kbDocuments: KbDocument[];
  kbChunks: KbChunk[];
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  sourceType?: EvidenceSourceType;
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
