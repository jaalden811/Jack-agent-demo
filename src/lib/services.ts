import { randomUUID, createHash } from "node:crypto";
import OpenAI from "openai";
import mammoth from "mammoth";
import { parse as parseCsv } from "csv-parse/sync";
import { getConfig } from "@/lib/config";
import type {
  AccountRecommendation,
  CapabilityMap,
  Citation,
  ContactRecommendation,
  EvidenceSourceType,
  KbChunk,
  KbDocument,
  ProviderCheck,
  ProviderReadiness,
  ProviderStatusSnapshot,
  ResearchInput,
  ResearchRun,
  SearchResult
} from "@/lib/types";

const now = () => new Date().toISOString();

type EmbeddingRuntime = {
  attemptedOpenAi: boolean;
  usedFallback: boolean;
  errors: string[];
};

function providerCheck(
  name: string,
  configured: boolean,
  required: boolean,
  readyMessage: string,
  missingMessage: string
): ProviderCheck {
  return {
    name,
    configured,
    required,
    status: configured ? "ready" : required ? "missing_required_provider" : "missing_optional_provider",
    message: configured ? readyMessage : missingMessage
  };
}

export function getProviderDiagnostics(): ProviderStatusSnapshot {
  const config = getConfig();
  const searchProviderConfigured = Boolean(config.SEARCH_PROVIDER);
  const checks = [
    providerCheck(
      "OPENAI_API_KEY",
      Boolean(config.OPENAI_API_KEY),
      true,
      "Configured",
      "Missing required provider: OPENAI_API_KEY is not configured. Development fallback embeddings will be used and runs are unverified."
    ),
    providerCheck(
      "SEARCH_API_KEY",
      Boolean(config.SEARCH_API_KEY),
      true,
      `Configured for ${config.SEARCH_PROVIDER}`,
      "Missing required provider: SEARCH_API_KEY is not configured. Full verified research is blocked; seed/demo mode is fallback only."
    ),
    providerCheck(
      "SEARCH_PROVIDER",
      searchProviderConfigured,
      true,
      `Configured as ${config.SEARCH_PROVIDER}`,
      "Missing required provider: SEARCH_PROVIDER is not set to a supported value."
    ),
    providerCheck(
      "FIRECRAWL_API_KEY",
      Boolean(config.FIRECRAWL_API_KEY),
      false,
      "Configured (full-page evidence extraction available)",
      "Missing optional provider: FIRECRAWL_API_KEY is not configured. Evidence will be snippet-only and lower confidence."
    ),
    providerCheck(
      "Contact enrichment providers",
      config.hasContactEnrichment,
      false,
      "Configured (at least one licensed provider key detected)",
      "Missing optional provider: no licensed contact enrichment key is configured. Contacts will remain role/persona-level unless public evidence verifies them."
    )
  ];
  const missingRequired = checks.some((check) => check.required && !check.configured);
  const missingOptional = checks.some((check) => !check.required && !check.configured);
  const fallbackModeActive = missingRequired;
  const overall: ProviderReadiness = fallbackModeActive
    ? "fallback_mode_active"
    : missingOptional
      ? "missing_optional_provider"
      : "ready";

  return {
    overall,
    searchProvider: config.SEARCH_PROVIDER,
    checks,
    liveSearchAvailable: Boolean(config.SEARCH_API_KEY),
    openAiEmbeddingsAvailable: Boolean(config.OPENAI_API_KEY),
    firecrawlAvailable: Boolean(config.FIRECRAWL_API_KEY),
    contactEnrichmentAvailable: config.hasContactEnrichment,
    fallbackModeActive,
    summary: fallbackModeActive
      ? "Fallback mode active: missing required provider(s). Results must be treated as unverified."
      : missingOptional
        ? "Ready for live search with missing optional provider(s). Some evidence/contact fields may be lower confidence."
        : "Ready: all configured provider checks passed."
  };
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; label: string } = { label: "operation" }
) {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 400;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      // Never retry permanent HTTP failures (401, 403, 404, etc.)
      if (error instanceof PermanentHttpError) break;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }

  throw new Error(`${options.label} failed after ${retries + 1} attempts: ${(lastError as Error).message}`);
}

// Errors thrown with this marker are not retried by withRetry.
class PermanentHttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "PermanentHttpError";
  }
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 12000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // 4xx (except 429) are permanent failures — no point retrying.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new PermanentHttpError(response.status);
    }
    if (response.status === 429) {
      throw new Error("rate_limited");
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function chunkText(text: string, maxChars = 1200, overlapChars = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    chunks.push(normalized.slice(start, end).trim());
    if (end === normalized.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks;
}

function deterministicEmbedding(text: string, dimensions = 128) {
  const values = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    for (let i = 0; i < digest.length; i += 1) {
      values[digest[i] % dimensions] += digest[(i + 1) % digest.length] % 2 === 0 ? 1 : -1;
    }
  }
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / magnitude);
}

export async function embedText(text: string) {
  return embedTextWithRuntime(text);
}

function sanitizeProviderError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return "Unknown provider error";
}

async function embedTextWithRuntime(text: string, runtime?: EmbeddingRuntime) {
  const config = getConfig();
  if (!config.OPENAI_API_KEY) {
    if (runtime) {
      runtime.usedFallback = true;
    }
    return deterministicEmbedding(text);
  }

  if (runtime) {
    runtime.attemptedOpenAi = true;
  }

  try {
    // 5 s timeout; 1 retry (2 total attempts). Fail fast — deterministic fallback is always available.
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 5000, maxRetries: 0 });
    const response = await withRetry(
      () =>
        client.embeddings.create({
          model: "text-embedding-3-small",
          input: text.slice(0, 8000)
        }),
      { label: "OpenAI embedding", retries: 1, baseDelayMs: 200 }
    );
    return response.data[0]?.embedding ?? deterministicEmbedding(text);
  } catch (error) {
    const sanitized = sanitizeProviderError(error);
    if (runtime) {
      runtime.usedFallback = true;
      runtime.errors.push(sanitized);
    }
    console.warn("OpenAI embedding failure metadata:", sanitized);
    return deterministicEmbedding(text);
  }
}

export function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / ((Math.sqrt(magA) || 1) * (Math.sqrt(magB) || 1));
}

export async function extractTextFromUpload(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (name.endsWith(".csv")) {
    const records = parseCsv(buffer, { relaxColumnCount: true, skipEmptyLines: true });
    return records.map((row: unknown[]) => row.join(" ")).join("\n");
  }

  if (name.endsWith(".pdf")) {
    return [
      `PDF text extraction placeholder for ${file.name}.`,
      "For production, enable a vetted PDF extraction service or server-compatible parser.",
      buffer.toString("utf8", 0, Math.min(buffer.length, 12000))
    ].join("\n");
  }

  return buffer.toString("utf8");
}

export async function ingestKnowledgeBase(runId: string, files: File[], embeddingRuntime?: EmbeddingRuntime) {
  const documents: KbDocument[] = [];
  const chunks: KbChunk[] = [];

  for (const file of files) {
    const extractedText = await extractTextFromUpload(file);
    const document: KbDocument = {
      id: randomUUID(),
      runId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      extractedText,
      createdAt: now()
    };
    documents.push(document);

    const textChunks = chunkText(extractedText);
    for (let chunkIndex = 0; chunkIndex < textChunks.length; chunkIndex += 1) {
      chunks.push({
        id: randomUUID(),
        runId,
        documentId: document.id,
        documentName: document.fileName,
        chunkIndex,
        content: textChunks[chunkIndex],
        embedding: await embedTextWithRuntime(textChunks[chunkIndex], embeddingRuntime),
        metadata: { sourceType: "uploaded_kb" }
      });
    }
  }

  return { documents, chunks };
}

export async function retrieveKbContext(
  query: string,
  chunks: KbChunk[],
  limit = 5,
  embeddingRuntime?: EmbeddingRuntime
) {
  // Skip the OpenAI call entirely when there is nothing to rank against.
  if (chunks.length === 0) return [];
  const queryEmbedding = await embedTextWithRuntime(query, embeddingRuntime);
  return chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}

export async function productCapabilityMapper(
  input: ResearchInput,
  kbChunks: KbChunk[],
  embeddingRuntime?: EmbeddingRuntime
): Promise<CapabilityMap> {
  const query = `${input.ciscoProduct} ${input.targetMarket} cybersecurity networking observability buyer pain`;
  const relevantChunks = await retrieveKbContext(query, kbChunks, 4, embeddingRuntime);
  const product = input.ciscoProduct.toLowerCase();
  const baseCapabilities =
    product.includes("meraki")
      ? ["cloud-managed networking", "secure SD-WAN", "network visibility", "branch operations"]
      : product.includes("thousandeyes")
        ? ["internet and application visibility", "digital experience monitoring", "outage analysis"]
        : product.includes("firewall")
          ? ["network segmentation", "threat prevention", "secure access policy", "traffic inspection"]
          : product.includes("xdr")
            ? ["extended detection and response", "incident correlation", "security operations automation"]
            : ["secure connectivity", "threat visibility", "operational resilience"];

  const kbCitations: Citation[] = relevantChunks.map((chunk) => ({
    url: `kb://${chunk.documentId}#chunk-${chunk.chunkIndex}`,
    title: chunk.documentName,
    snippet: chunk.content.slice(0, 260),
    sourceType: "uploaded_kb",
    verificationLevel: "kb",
    retrievedAt: now()
  }));

  return {
    product: input.ciscoProduct,
    capabilities: Array.from(new Set([...baseCapabilities, ...relevantChunks.flatMap((chunk) => keywordHints(chunk.content))])).slice(0, 10),
    valueProps: [
      "reduce operational risk with Cisco-aligned capabilities",
      "improve visibility across distributed environments",
      "connect business resilience goals to measurable security and network outcomes"
    ],
    painCategories: [
      "security risk",
      "network reliability",
      "operational complexity",
      "compliance pressure",
      "digital experience issues"
    ],
    buyerPersonas: {
      championTitles: ["Director of IT", "Director of Security Operations", "Network Operations Lead"],
      economicBuyerTitles: ["CIO", "CISO", "VP of Infrastructure", "Chief Technology Officer"],
      influencerTitles: ["Security Architect", "Network Architect", "IT Operations Manager"]
    },
    citations: kbCitations
  };
}

function keywordHints(text: string) {
  const lower = text.toLowerCase();
  return [
    ["zero trust", "zero trust access"],
    ["ransomware", "ransomware readiness"],
    ["hybrid work", "hybrid work enablement"],
    ["iot", "IoT visibility"],
    ["compliance", "compliance reporting"]
  ]
    .filter(([needle]) => lower.includes(needle))
    .map(([, hint]) => hint);
}

type SearchOptions = {
  query: string;
  maxResults: number;
};

type SearchProviderClient = {
  search(options: SearchOptions): Promise<SearchResult[]>;
};

function buildMarketQuery(input: ResearchInput, capabilityMap: CapabilityMap) {
  return [
    `"${input.ciscoProduct}"`,
    input.targetMarket,
    input.geography,
    input.companySize,
    capabilityMap.painCategories.slice(0, 3).join(" OR "),
    "company press release job posting annual report cybersecurity networking operations"
  ]
    .filter(Boolean)
    .join(" ");
}

function createSearchProviderClient(): SearchProviderClient | null {
  const config = getConfig();
  if (!config.SEARCH_API_KEY) return null;

  if (config.SEARCH_PROVIDER === "brave") {
    return {
      async search(options) {
        type BraveResponse = { web?: { results?: Array<{ title: string; url: string; description?: string; age?: string }> } };
        const data = await withRetry(
          () =>
            fetchJsonWithTimeout<BraveResponse>(
              `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(options.query)}&count=${options.maxResults}`,
              { headers: { Accept: "application/json", "X-Subscription-Token": config.SEARCH_API_KEY! } }
            ),
          { label: "Brave search" }
        );
        return (data.web?.results ?? []).map((item) => ({
          title: item.title,
          url: item.url,
          snippet: item.description ?? "",
          publishedDate: item.age,
          sourceType: classifySource(item.url, item.title),
          verificationLevel: "snippet_only"
        }));
      }
    };
  }

  if (config.SEARCH_PROVIDER === "exa") {
    return {
      async search(options) {
        type ExaResponse = { results?: Array<{ title?: string; url: string; text?: string; publishedDate?: string }> };
        const data = await withRetry(
          () =>
            fetchJsonWithTimeout<ExaResponse>("https://api.exa.ai/search", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": config.SEARCH_API_KEY! },
              body: JSON.stringify({ query: options.query, numResults: options.maxResults, contents: { text: true } })
            }),
          { label: "Exa search" }
        );
        return (data.results ?? []).map((item) => ({
          title: item.title ?? item.url,
          url: item.url,
          snippet: item.text ?? "",
          publishedDate: item.publishedDate,
          sourceType: classifySource(item.url, item.title ?? ""),
          verificationLevel: "snippet_only"
        }));
      }
    };
  }

  if (config.SEARCH_PROVIDER === "serpapi") {
    return {
      async search(options) {
        type SerpResponse = { organic_results?: Array<{ title: string; link: string; snippet?: string; date?: string }> };
        const data = await withRetry(
          () =>
            fetchJsonWithTimeout<SerpResponse>(
              `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(options.query)}&num=${options.maxResults}&api_key=${encodeURIComponent(config.SEARCH_API_KEY!)}`,
              { headers: { Accept: "application/json" } }
            ),
          { label: "SerpAPI search" }
        );
        return (data.organic_results ?? []).map((item) => ({
          title: item.title,
          url: item.link,
          snippet: item.snippet ?? "",
          publishedDate: item.date,
          sourceType: classifySource(item.link, item.title),
          verificationLevel: "snippet_only"
        }));
      }
    };
  }

  return {
    async search(options) {
      type TavilyResponse = { results?: Array<{ title: string; url: string; content?: string; published_date?: string }> };
      const data = await withRetry(
        () =>
          fetchJsonWithTimeout<TavilyResponse>("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: config.SEARCH_API_KEY,
              query: options.query,
              max_results: options.maxResults,
              search_depth: "advanced",
              include_answer: false
            })
          }),
        { label: "Tavily search" }
      );
      return (data.results ?? []).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.content ?? "",
        publishedDate: item.published_date,
        sourceType: classifySource(item.url, item.title),
        verificationLevel: "snippet_only"
      }));
    }
  };
}

// Thrown by searchMarketAccounts when the provider returns a non-retryable error.
// Caught in runResearch so the run continues in fallback mode.
class SearchProviderFallbackError extends Error {
  constructor(public readonly providerMessage: string) {
    super(`Live search unavailable: ${providerMessage}`);
    this.name = "SearchProviderFallbackError";
  }
}

// Per-market unverified demo candidates used when live search is unavailable.
const DEMO_CANDIDATES: Record<string, string[]> = {
  healthcare: [
    "Mayo Clinic",
    "Cleveland Clinic",
    "HCA Healthcare",
    "CommonSpirit Health",
    "Tenet Healthcare"
  ],
  "mid-market retail": [
    "Shoe Carnival",
    "Tuesday Morning",
    "Gordmans",
    "Big 5 Sporting Goods",
    "Sportsman's Warehouse"
  ],
  "state/local government": [
    "City of Phoenix",
    "Dallas County",
    "State of Utah ITS",
    "Miami-Dade County",
    "Virginia VITA"
  ],
  "general market": [
    "Example Corp A",
    "Example Corp B",
    "Example Corp C",
    "Example Corp D",
    "Example Corp E"
  ]
};

function demoCandidatesFor(market: string, maxResults: number): SearchResult[] {
  const normalised = market.toLowerCase();
  const candidates =
    Object.entries(DEMO_CANDIDATES).find(([key]) => normalised.includes(key))?.[1] ??
    DEMO_CANDIDATES["general market"];
  return candidates.slice(0, maxResults).map<SearchResult>((name) => ({
    title: name,
    url: "",
    snippet: `Demo/unverified fallback candidate for ${market}. Live search was unavailable. Verify this account manually before outreach.`,
    sourceType: "search_result",
    verificationLevel: "unverified"
  }));
}

export async function searchMarketAccounts(input: ResearchInput, capabilityMap: CapabilityMap) {
  const provider = createSearchProviderClient();
  if (!provider) {
    return input.seedAccounts.map<SearchResult>((name) => ({
      title: name,
      url: "",
      snippet: "Seed account supplied by user. Public evidence search was not run because SEARCH_API_KEY is not configured.",
      sourceType: "search_result",
      verificationLevel: "unverified"
    }));
  }

  try {
    return await provider.search({
      query: buildMarketQuery(input, capabilityMap),
      maxResults: input.maxResults * 4
    });
  } catch (error) {
    // Non-fatal: 401/403/429/network errors must not block the run.
    const message = error instanceof Error ? error.message : "Unknown";
    console.warn("Search provider error (non-fatal):", message);
    // Propagate the reason so runResearch can add the right warning.
    throw new SearchProviderFallbackError(message);
  }
}

function classifySource(url: string, title: string): EvidenceSourceType {
  const value = `${url} ${title}`.toLowerCase();
  if (value.includes("job") || value.includes("careers")) return "job_post";
  if (value.includes("press") || value.includes("newsroom")) return "press_release";
  if (value.includes("annual") || value.includes("10-k")) return "annual_report";
  if (value.includes("linkedin.com/company")) return "company_page";
  if (value.includes("news")) return "news";
  return "search_result";
}

export function collectEvidence(results: SearchResult[]) {
  return results
    .filter((result) => result.url || result.snippet)
    .map<Citation>((result) => ({
      url: result.url || "unverified://seed-account",
      title: result.title,
      date: result.publishedDate,
      snippet: (result.extractedContent ?? result.snippet).slice(0, 700),
      sourceType: result.sourceType ?? "search_result",
      verificationLevel:
        result.sourceType === "uploaded_kb"
          ? "kb"
          : (result.verificationLevel ?? (result.url ? "snippet_only" : "unverified")),
      retrievedAt: now()
    }));
}

export async function collectPageEvidence(results: SearchResult[]) {
  const config = getConfig();
  if (!config.FIRECRAWL_API_KEY) {
    return results.map((result) => ({
      ...result,
      verificationLevel: result.verificationLevel ?? (result.url ? "snippet_only" : "unverified")
    }));
  }

  type FirecrawlResponse = {
    success?: boolean;
    data?: {
      markdown?: string;
      metadata?: {
        title?: string;
        sourceURL?: string;
        statusCode?: number;
      };
    };
  };

  const enhanced: SearchResult[] = [];
  for (const result of results) {
    if (!result.url.startsWith("http")) {
      enhanced.push({ ...result, verificationLevel: "unverified" });
      continue;
    }

    try {
      const data = await withRetry(
        () =>
          fetchJsonWithTimeout<FirecrawlResponse>(
            "https://api.firecrawl.dev/v1/scrape",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.FIRECRAWL_API_KEY}`
              },
              body: JSON.stringify({ url: result.url, formats: ["markdown"], onlyMainContent: true })
            },
            15000
          ),
        { label: "Firecrawl scrape", retries: 1 }
      );
      const markdown = data.data?.markdown?.replace(/\s+/g, " ").trim();
      enhanced.push({
        ...result,
        title: data.data?.metadata?.title ?? result.title,
        extractedContent: markdown || result.snippet,
        verificationLevel: markdown ? "full_page" : "snippet_only"
      });
    } catch {
      enhanced.push({
        ...result,
        verificationLevel: "snippet_only",
        snippet: `${result.snippet} Firecrawl extraction failed; using search snippet only.`
      });
    }
  }
  return enhanced;
}

export function identifyCompanyName(result: SearchResult) {
  const cleanedTitle = result.title
    .replace(/\s[-|].*$/, "")
    .replace(/\b(press release|careers|jobs|annual report)\b/gi, "")
    .trim();
  if (cleanedTitle.length > 2 && cleanedTitle.length < 90) return cleanedTitle;
  if (result.url) {
    try {
      return new URL(result.url).hostname.replace(/^www\./, "").split(".")[0];
    } catch {
      return result.title;
    }
  }
  return result.title;
}

export function personRoleIdentifier(
  companyName: string,
  capabilityMap: CapabilityMap,
  evidence: Citation[]
) {
  const companyPage = evidence.find((item) => item.sourceType === "company_page")?.url ?? null;
  const citationEvidence = evidence.filter((item) => item.url !== "unverified://seed-account");
  const makeContact = (
    roleType: ContactRecommendation["roleType"],
    title: string,
    relationship: string
  ): ContactRecommendation => ({
    roleType,
    name: null,
    title,
    businessEmail: null,
    emailVerified: false,
    profileUrl: null,
    companyPage,
    verificationStatus: "role_only",
    relationshipHypothesis: relationship,
    citations: citationEvidence,
    missingDataFlags: [
      "No verified public person record found.",
      "No verified contact found.",
      "No verified business email available; do not infer or pattern-match an email."
    ]
  });

  return {
    champion: makeContact(
      "business_champion",
      capabilityMap.buyerPersonas.championTitles[0],
      `${companyName} likely needs a hands-on owner for ${capabilityMap.capabilities.slice(0, 2).join(" and ")} based on the cited business signals.`
    ),
    economicBuyer: makeContact(
      "economic_buyer",
      capabilityMap.buyerPersonas.economicBuyerTitles[0],
      `This role usually owns budget and risk tradeoffs for ${capabilityMap.product} outcomes.`
    ),
    influencers: capabilityMap.buyerPersonas.influencerTitles.slice(0, 2).map((title) =>
      makeContact(
        "technical_influencer",
        title,
        `This role can validate technical fit and operational impact for ${capabilityMap.capabilities[0]}.`
      )
    )
  };
}

export async function contactEnricher(contact: ContactRecommendation) {
  const config = getConfig();
  if (!config.hasContactEnrichment) {
    return {
      ...contact,
      missingDataFlags: Array.from(new Set([...contact.missingDataFlags, "No licensed contact enrichment provider configured."]))
    };
  }

  return {
    ...contact,
    missingDataFlags: [
      ...contact.missingDataFlags,
      "Licensed contact enrichment is configured, but no provider response with explicit verification evidence was available for this role."
    ]
  };
}

export function confidenceScorer(params: {
  evidence: Citation[];
  kbInfluenceCount: number;
  hasVerifiedContact: boolean;
}) {
  const publicEvidence = params.evidence.filter((item) => item.url.startsWith("http"));
  const fullPageEvidence = publicEvidence.filter((item) => item.verificationLevel === "full_page");
  const snippetEvidence = publicEvidence.filter((item) => item.verificationLevel === "snippet_only");
  const fit = Math.min(100, 30 + params.kbInfluenceCount * 8 + fullPageEvidence.length * 8 + snippetEvidence.length * 4);
  const painEvidence = Math.min(100, fullPageEvidence.length * 18 + snippetEvidence.length * 9);
  const buyerIdentification = publicEvidence.length > 0 ? 55 : 25;
  const contactVerification = params.hasVerifiedContact ? 100 : 0;
  const overall = Math.round(fit * 0.35 + painEvidence * 0.3 + buyerIdentification * 0.2 + contactVerification * 0.15);

  return { fit, painEvidence, buyerIdentification, contactVerification, overall };
}

export function generateReport(
  input: ResearchInput,
  capabilityMap: CapabilityMap,
  groupedResults: Map<string, SearchResult[]>,
  kbChunks: KbChunk[],
  providerStatus: ProviderStatusSnapshot
) {
  const accounts: AccountRecommendation[] = [];
  for (const [companyName, results] of groupedResults.entries()) {
    if (accounts.length >= input.maxResults) break;
    const evidence = collectEvidence(results);
    const kbInfluence = kbChunks.slice(0, 3).map((chunk) => ({
      documentName: chunk.documentName,
      chunkIndex: chunk.chunkIndex,
      snippet: chunk.content.slice(0, 240)
    }));
    const roles = personRoleIdentifier(companyName, capabilityMap, evidence);
    const scores = confidenceScorer({
      evidence,
      kbInfluenceCount: kbInfluence.length,
      hasVerifiedContact: false
    });
    const publicEvidence = evidence.filter((item) => item.url.startsWith("http"));
    const missingDataFlags = [
      ...(publicEvidence.length === 0 ? ["No public web citation available for this account yet."] : []),
      ...(publicEvidence.every((item) => item.verificationLevel !== "full_page")
        ? ["Evidence is snippet-only; full-page verification was not available for this account."]
        : []),
      ...(providerStatus.fallbackModeActive
        ? ["Unverified fallback run: missing required provider(s) when this recommendation was generated."]
        : []),
      "Business email unavailable unless a licensed source verifies it.",
      "Named people are not invented; role/persona recommendations are used when person evidence is missing."
    ];
    const website = publicEvidence[0]?.url ? originFromUrl(publicEvidence[0].url) : null;

    accounts.push({
      id: randomUUID(),
      companyName,
      website,
      fitReason: `${companyName} matches ${input.targetMarket} signals relevant to ${capabilityMap.product}: ${capabilityMap.capabilities.slice(0, 3).join(", ")}.`,
      marketFit: `${companyName} appears in the ${input.targetMarket} research set${input.geography ? ` for ${input.geography}` : ""}. Confirm account qualification from the cited source URLs before outreach.`,
      ciscoCapabilityMatch: capabilityMap.capabilities.slice(0, 5),
      champion: roles.champion,
      economicBuyer: roles.economicBuyer,
      otherInfluencers: roles.influencers,
      painPoints: publicEvidence.length
        ? [
            {
              pain: `Observed public signals align to ${capabilityMap.painCategories.slice(0, 2).join(" and ")}.`,
              citations: publicEvidence
            }
          ]
        : [],
      evidence,
      kbInfluence,
      scores,
      confidenceScore: scores.overall,
      suggestedOutreachAngle: `Lead with ${capabilityMap.product} as a way to address ${capabilityMap.painCategories[0]} and ${capabilityMap.painCategories[1]} for ${input.targetMarket}. Reference the cited public source before making a claim.`,
      missingDataFlags
    });
  }

  return accounts.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

function originFromUrl(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function groupSearchResults(results: SearchResult[]) {
  const grouped = new Map<string, SearchResult[]>();
  for (const result of results) {
    const companyName = identifyCompanyName(result);
    const existing = grouped.get(companyName) ?? [];
    existing.push(result);
    grouped.set(companyName, existing);
  }
  return grouped;
}

export async function runResearch(input: ResearchInput, files: File[] = []): Promise<ResearchRun> {
  const runId = randomUUID();
  const createdAt = now();
  const warnings: string[] = [];
  const providerStatus = getProviderDiagnostics();
  const embeddingRuntime: EmbeddingRuntime = {
    attemptedOpenAi: false,
    usedFallback: false,
    errors: []
  };

  if (!providerStatus.liveSearchAvailable) {
    warnings.push("SEARCH_API_KEY is not configured; results are limited to seed accounts and marked unverified.");
  }
  if (!providerStatus.firecrawlAvailable) {
    warnings.push("FIRECRAWL_API_KEY is not configured; evidence uses search snippets only and is not full-page verified.");
  }
  if (!providerStatus.contactEnrichmentAvailable) {
    warnings.push("No licensed contact enrichment key configured; contacts degrade to role/persona-level recommendations.");
  }
  if (providerStatus.fallbackModeActive) {
    warnings.push("Unverified fallback run: add required provider keys and use Rerun with configured APIs for live evidence.");
  }

  const { documents, chunks } = await ingestKnowledgeBase(runId, files, embeddingRuntime);
  const capabilityMap = await productCapabilityMapper(input, chunks, embeddingRuntime);

  let searchResults: SearchResult[];
  let searchFellBack = false;
  try {
    searchResults = await searchMarketAccounts(input, capabilityMap);
  } catch (error) {
    searchFellBack = true;
    if (error instanceof SearchProviderFallbackError) {
      warnings.push(
        `Live search unavailable (${error.providerMessage}); using seed/demo candidates. Check SEARCH_API_KEY and SEARCH_PROVIDER.`
      );
    } else {
      warnings.push("Live search unavailable; using seed/demo candidates.");
    }
    // Prefer user-supplied seed accounts, then market-keyed demo candidates.
    searchResults =
      input.seedAccounts.length > 0
        ? input.seedAccounts.map<SearchResult>((name) => ({
            title: name,
            url: "",
            snippet: "Seed account supplied by user. Live search was unavailable.",
            sourceType: "search_result",
            verificationLevel: "unverified"
          }))
        : demoCandidatesFor(input.targetMarket, input.maxResults);
  }

  const evidenceResults = await collectPageEvidence(searchResults);
  const grouped = groupSearchResults(evidenceResults);
  const relevantKb = await retrieveKbContext(
    `${input.ciscoProduct} ${input.targetMarket}`,
    chunks,
    5,
    embeddingRuntime
  );
  const accounts = generateReport(input, capabilityMap, grouped, relevantKb, providerStatus);

  for (const account of accounts) {
    account.champion = await contactEnricher(account.champion);
    account.economicBuyer = await contactEnricher(account.economicBuyer);
    account.otherInfluencers = await Promise.all(account.otherInfluencers.map(contactEnricher));
  }

  if (accounts.length === 0) {
    warnings.push("No source-backed accounts were found. Add seed accounts or configure a supported search provider.");
  }
  if (embeddingRuntime.attemptedOpenAi && embeddingRuntime.usedFallback) {
    warnings.push("OpenAI embeddings failed. Check network access, key validity, and provider status.");
  }
  if (embeddingRuntime.usedFallback) {
    warnings.push("Development fallback embeddings used — not production-quality.");
  }

  const usedFallbackRun = providerStatus.fallbackModeActive || embeddingRuntime.usedFallback || searchFellBack;

  return {
    id: runId,
    input,
    status: "completed",
    providerStatus,
    liveSearchUsed: providerStatus.liveSearchAvailable && !searchFellBack,
    openAiEmbeddingsUsed: providerStatus.openAiEmbeddingsAvailable && !embeddingRuntime.usedFallback,
    firecrawlExtractionUsed: accounts.some((account) =>
      account.evidence.some((evidence) => evidence.verificationLevel === "full_page")
    ),
    contactEnrichmentUsed: providerStatus.contactEnrichmentAvailable,
    isVerified:
      !usedFallbackRun &&
      accounts.every((account) => account.evidence.some((evidence) => evidence.url.startsWith("http"))),
    isFallback: usedFallbackRun,
    warnings,
    accounts,
    kbDocuments: documents,
    kbChunks: chunks,
    createdAt,
    updatedAt: now()
  };
}

export function exportRun(run: ResearchRun, format: "json" | "csv" | "md") {
  if (format === "json") {
    return JSON.stringify(run, null, 2);
  }

  if (format === "csv") {
    const header = [
      "company",
      "website",
      "confidence",
      "verified_run",
      "fallback_run",
      "fit_reason",
      "market_fit",
      "capability_match",
      "champion_title",
      "economic_buyer_title",
      "verified_email",
      "evidence_urls",
      "evidence_verification",
      "missing_data_flags",
      "outreach_angle"
    ];
    const rows = run.accounts.map((account) =>
      [
        account.companyName,
        account.website ?? "",
        account.confidenceScore,
        run.isVerified,
        run.isFallback,
        account.fitReason,
        account.marketFit,
        account.ciscoCapabilityMatch.join(" | "),
        account.champion.title,
        account.economicBuyer.title,
        account.champion.businessEmail ?? "",
        account.evidence.map((item) => item.url).join(" | "),
        account.evidence.map((item) => `${item.title}: ${item.verificationLevel}`).join(" | "),
        account.missingDataFlags.join(" | "),
        account.suggestedOutreachAngle
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );
    return [header.join(","), ...rows].join("\n");
  }

  return [
    `# Cisco Market + Buyer Intelligence Report`,
    ``,
    `Product: ${run.input.ciscoProduct}`,
    `Market: ${run.input.targetMarket}`,
    `Run status: ${run.isFallback ? "Unverified fallback run" : run.isVerified ? "Verified live-provider run" : "Low-confidence run"}`,
    `Provider summary: ${run.providerStatus.summary}`,
    ``,
    ...run.accounts.flatMap((account) => [
      `## ${account.companyName} (${account.confidenceScore})`,
      `Website: ${account.website ?? "Not verified"}`,
      account.fitReason,
      `Market fit: ${account.marketFit}`,
      `Cisco capability match: ${account.ciscoCapabilityMatch.join(", ")}`,
      ``,
      `- Champion: ${account.champion.name ?? "Not verified"} / ${account.champion.title}`,
      `- Economic buyer: ${account.economicBuyer.name ?? "Not verified"} / ${account.economicBuyer.title}`,
      `- Outreach angle: ${account.suggestedOutreachAngle}`,
      `- Missing data: ${account.missingDataFlags.join("; ")}`,
      `- Evidence: ${account.evidence.map((item) => `${item.title} ${item.url}`).join("; ") || "None verified"}`,
      ``
    ])
  ].join("\n");
}
