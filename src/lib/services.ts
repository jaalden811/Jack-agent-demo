import { randomUUID, createHash } from "node:crypto";
import OpenAI from "openai";
import mammoth from "mammoth";
import { parse as parseCsv } from "csv-parse/sync";
import { getConfig } from "@/lib/config";
import type {
  AccountRecommendation,
  BuyerTarget,
  CapabilityMap,
  Citation,
  EvidenceSourceType,
  KbChunk,
  KbDocument,
  OrgSignal,
  ProviderCheck,
  ProviderReadiness,
  ProviderStatusSnapshot,
  ResearchInput,
  ResearchRun,
  ResultClassification,
  SearchResult
} from "@/lib/types";

const now = () => new Date().toISOString();

type EmbeddingRuntime = {
  attemptedOpenAi: boolean;
  usedFallback: boolean;
  errors: string[];
};

// ─── Provider diagnostics ─────────────────────────────────────────────────────

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
  const checks = [
    providerCheck(
      "OPENAI_API_KEY",
      Boolean(config.OPENAI_API_KEY?.trim()),
      true,
      "Configured",
      "Missing required provider: OPENAI_API_KEY is not configured. Development fallback embeddings will be used and runs are unverified."
    ),
    providerCheck(
      "SEARCH_API_KEY",
      Boolean(config.SEARCH_API_KEY?.trim()),
      true,
      `Configured for ${config.SEARCH_PROVIDER}`,
      "Missing required provider: SEARCH_API_KEY is not configured. Full verified research is blocked; seed/demo mode is fallback only."
    ),
    providerCheck(
      "SEARCH_PROVIDER",
      Boolean(config.SEARCH_PROVIDER),
      true,
      `Configured as ${config.SEARCH_PROVIDER}`,
      "Missing required provider: SEARCH_PROVIDER is not set to a supported value."
    ),
    providerCheck(
      "FIRECRAWL_API_KEY",
      Boolean(config.FIRECRAWL_API_KEY?.trim()),
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
  const missingRequired = checks.some((c) => c.required && !c.configured);
  const missingOptional = checks.some((c) => !c.required && !c.configured);
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
    liveSearchAvailable: Boolean(config.SEARCH_API_KEY?.trim()),
    openAiEmbeddingsAvailable: Boolean(config.OPENAI_API_KEY?.trim()),
    firecrawlAvailable: Boolean(config.FIRECRAWL_API_KEY?.trim()),
    contactEnrichmentAvailable: config.hasContactEnrichment,
    fallbackModeActive,
    summary: fallbackModeActive
      ? "Fallback mode active: missing required provider(s). Results must be treated as unverified."
      : missingOptional
        ? "Ready for live search with missing optional provider(s). Some evidence/contact fields may be lower confidence."
        : "Ready: all configured provider checks passed."
  };
}

// ─── Retry / HTTP helpers ─────────────────────────────────────────────────────

class PermanentHttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "PermanentHttpError";
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; label: string } = { label: "operation" }
) {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 400;
  let lastError: unknown;
  let attemptsRun = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      attemptsRun = attempt + 1;
      lastError = error;
      if (error instanceof PermanentHttpError) break;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }

  throw new Error(
    `${options.label} failed after ${attemptsRun} attempt${attemptsRun === 1 ? "" : "s"}: ${(lastError as Error).message}`
  );
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
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new PermanentHttpError(response.status);
    }
    if (response.status === 429) throw new Error("rate_limited");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Text chunking ────────────────────────────────────────────────────────────

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

// ─── Embeddings ───────────────────────────────────────────────────────────────

function deterministicEmbedding(text: string, dimensions = 128) {
  const values = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    for (let i = 0; i < digest.length; i += 1) {
      values[digest[i] % dimensions] += digest[(i + 1) % digest.length] % 2 === 0 ? 1 : -1;
    }
  }
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;
  return values.map((v) => v / magnitude);
}

export async function embedText(text: string) {
  return embedTextWithRuntime(text);
}

function sanitizeProviderError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown provider error";
}

async function embedTextWithRuntime(text: string, runtime?: EmbeddingRuntime) {
  const config = getConfig();
  if (!config.OPENAI_API_KEY?.trim()) {
    if (runtime) runtime.usedFallback = true;
    return deterministicEmbedding(text);
  }
  if (runtime) runtime.attemptedOpenAi = true;
  try {
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 5000, maxRetries: 0 });
    const response = await withRetry(
      () => client.embeddings.create({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
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
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / ((Math.sqrt(magA) || 1) * (Math.sqrt(magB) || 1));
}

// ─── File extraction ──────────────────────────────────────────────────────────

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
            ? ["extended detection and response", "incident correlation", "security operations automation", "cross-telemetry threat prioritization"]
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
    capabilities: Array.from(
      new Set([...baseCapabilities, ...relevantChunks.flatMap((c) => keywordHints(c.content))])
    ).slice(0, 10),
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
      championTitles: ["Director of Security Operations", "Director of IT", "CISO"],
      economicBuyerTitles: ["CIO", "CISO", "VP of Infrastructure", "Chief Technology Officer"],
      influencerTitles: ["Security Architect", "SOC Manager", "Network Architect"]
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

// ─── Result classification ────────────────────────────────────────────────────

// Domains whose content must never become target account names.
const REJECT_SOURCE_DOMAINS = new Set([
  "cisco.com", "facebook.com", "youtube.com", "instagram.com",
  "twitter.com", "x.com", "linkedin.com", "paloaltonetworks.com",
  "crowdstrike.com", "fortinet.com", "splunk.com", "mcafee.com",
  "sentinelone.com", "zscaler.com", "okta.com", "microsoft.com", "google.com"
]);

// Organization-type words that prove a name is NOT a person name.
const ORG_INDICATOR_RE = /\b(health(care)?|hospital|clinic|medical|system(s)?|plan|center|group|network|care|services|solutions|inc|llc|corp|ltd|foundation|trust|association|society|institute|university|college|authority|agency|department|department of|county|state of)\b/i;

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Heuristic: does this string look like a person name (2–4 Title-Case words, no org words)? */
function looksLikePersonName(name: string): boolean {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (ORG_INDICATOR_RE.test(trimmed)) return false;
  // All main words start with uppercase
  const mainWords = words.filter((w) => !["and", "of", "the", "in", "at", "for", "de", "van"].includes(w.toLowerCase()));
  return mainWords.length >= 2 && mainWords.every((w) => /^[A-Z][a-zA-Z''-]+$/.test(w));
}

/** Returns true only for names that plausibly identify a real organization. */
export function isValidOrganizationName(name: string): boolean {
  if (!name || name.trim().length < 4) return false;
  if (name.trim().length > 100) return false;
  // Starts with a number
  if (/^\d+[\s.]/.test(name.trim())) return false;
  // Article/list title
  if (/\b(resources|templates|guide|guides|playbook|careers?|job\s+posting|preferred\s+vendor|vendor\s+list|approved\s+vendor)\b/i.test(name)) return false;
  // Vendor/product names
  if (/^cisco\b/i.test(name)) return false;
  if (/\bcisco\s+(xdr|security|cloud|meraki|duo|firewall|umbrella|talos)/i.test(name)) return false;
  if (/\b(cybersecurity\s+readiness\s+index|cloud\s+protection\s+suite|readiness\s+index)\b/i.test(name)) return false;
  // Webinar/whitepaper/report
  if (/\b(webinar|whitepaper|datasheet|podcast|ebook|newsletter|report|announcement)\b/i.test(name)) return false;
  // Truncated article title
  if (/\.\.\.$/.test(name.trim())) return false;
  // Person name
  if (looksLikePersonName(name)) return false;
  // Too many words for a company name unless it contains an org keyword
  const words = name.trim().split(/\s+/);
  if (words.length > 7 && !ORG_INDICATOR_RE.test(name)) return false;
  return true;
}

/** Classify a single search result so we know what to do with it. */
export function classifySearchResult(result: SearchResult): ResultClassification {
  const title = (result.title ?? "").trim();
  const url = (result.url ?? "").toLowerCase();

  // LinkedIn person profile
  if (url.includes("linkedin.com/in/")) return "person_candidate";

  const domain = extractDomain(url);
  if (REJECT_SOURCE_DOMAINS.has(domain) || [...REJECT_SOURCE_DOMAINS].some((d) => domain.endsWith("." + d))) {
    return "vendor_or_product";
  }

  // Cisco product pages
  if (/^cisco\b/i.test(title) || /\bcisco\s+(xdr|security|cloud|meraki|duo|umbrella|firewall)/i.test(title)) {
    return "vendor_or_product";
  }

  // Job postings
  if (/\b(careers?|job\s+posting|we.?re hiring|apply now)\b/i.test(title)) return "job_posting";

  // Resource/template/list pages
  if (/\b(resources?\s+(and\s+)?templates?|preferred\s+vendor|vendor\s+list|approved\s+vendor|it\s+security\s+services)\b/i.test(title)) return "resource_template";
  if (/\b(guides?|playbook|toolkit|framework|checklist)\b/i.test(title) && !/\b(health|hospital|clinic|medical)\b/i.test(title)) return "resource_template";

  // Number-prefixed article titles: "53 hospital CISOs", "Top 10 healthcare..."
  if (/^\d+\s+(hospital|health|ciso|top|best|leading|major|key)/i.test(title)) return "article_or_list";
  if (/^(top|best|leading|major|key)\s+\d+/i.test(title)) return "article_or_list";

  // Person names
  if (looksLikePersonName(title)) return "person_candidate";

  // Short fragment starting with preposition
  if (/^(in|at|of|for|the)\s+/i.test(title) && title.split(/\s+/).length < 6) return "reject";

  // Org keyword present → valid candidate
  if (ORG_INDICATOR_RE.test(title)) return "organization_candidate";

  // Let the name validator decide
  return isValidOrganizationName(title) ? "organization_candidate" : "reject";
}

/** Try to extract an org name from a person result snippet (e.g. "CISO at XYZ Health"). */
function extractOrgFromPersonSnippet(result: SearchResult): string | null {
  const text = `${result.title} ${result.snippet}`;
  const patterns = [
    /(?:^|,|\bat\s+)([A-Z][A-Za-z\s]+(?:Health(?:care)?|Hospital|Clinic|Medical\s+Center|Health\s+System|Health\s+Plan|Care|Group))/,
    /(?:of|for|at)\s+([A-Z][A-Za-z\s]{3,50}(?:Health|Healthcare|Hospital|Clinic|Medical|System|Plan|Network))/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const org = match[1].trim().replace(/[,.]$/, "");
      if (org.length > 4 && org.length < 80 && isValidOrganizationName(org)) return org;
    }
  }
  return null;
}

// ─── Search providers ─────────────────────────────────────────────────────────

class SearchProviderFallbackError extends Error {
  constructor(public readonly providerMessage: string) {
    super(`Live search unavailable: ${providerMessage}`);
    this.name = "SearchProviderFallbackError";
  }
}

// Per-market demo candidate names when live search yields insufficient valid accounts.
function getDemoNamesFor(market: string): string[] {
  const lower = market.toLowerCase();
  if (lower.includes("healthcare") || lower.includes("health")) {
    return ["Mayo Clinic", "Cleveland Clinic", "HCA Healthcare", "CommonSpirit Health", "Tenet Healthcare"];
  }
  if (lower.includes("retail")) {
    return ["Kroger", "Albertsons", "Dollar Tree", "Ross Stores", "Burlington Stores"];
  }
  if (lower.includes("government") || lower.includes("sled")) {
    return ["State of Texas DIR", "Los Angeles County", "Fairfax County", "State of Georgia", "Dallas County"];
  }
  return ["Enterprise Corp A", "Enterprise Corp B", "Enterprise Corp C", "Enterprise Corp D", "Enterprise Corp E"];
}

// Phase-1 account discovery query — does NOT include the Cisco product name.
function buildMarketQuery(input: ResearchInput, capabilityMap: CapabilityMap) {
  const lower = input.targetMarket.toLowerCase();
  let marketTerms: string;
  if (lower.includes("healthcare") || lower.includes("health")) {
    marketTerms = '"health system" OR "hospital system" OR "healthcare provider" OR "health plan"';
  } else if (lower.includes("retail")) {
    marketTerms = '"retail chain" OR "retailer" OR "retail company"';
  } else if (lower.includes("government") || lower.includes("sled")) {
    marketTerms = '"state government" OR "local government" OR "county government"';
  } else {
    marketTerms = `"${input.targetMarket}" company`;
  }
  const geoTerms = input.geography || "";
  const painTerms = capabilityMap.painCategories.slice(0, 2).join(" ");
  return [marketTerms, geoTerms, "cybersecurity CISO", '"security operations"', painTerms]
    .filter(Boolean)
    .join(" ");
}

type SearchOptions = { query: string; maxResults: number };
type SearchProviderClient = { search(options: SearchOptions): Promise<SearchResult[]> };

function createSearchProviderClient(): SearchProviderClient | null {
  const config = getConfig();
  if (!config.SEARCH_API_KEY?.trim()) return null;

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
          title: item.title, url: item.url, snippet: item.description ?? "",
          publishedDate: item.age, sourceType: classifySourceType(item.url, item.title), verificationLevel: "snippet_only" as const
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
          title: item.title ?? item.url, url: item.url, snippet: item.text ?? "",
          publishedDate: item.publishedDate, sourceType: classifySourceType(item.url, item.title ?? ""), verificationLevel: "snippet_only" as const
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
          title: item.title, url: item.link, snippet: item.snippet ?? "",
          publishedDate: item.date, sourceType: classifySourceType(item.link, item.title), verificationLevel: "snippet_only" as const
        }));
      }
    };
  }

  // Default: Tavily
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
        title: item.title, url: item.url, snippet: item.content ?? "",
        publishedDate: item.published_date, sourceType: classifySourceType(item.url, item.title), verificationLevel: "snippet_only" as const
      }));
    }
  };
}

function classifySourceType(url: string, title: string): EvidenceSourceType {
  const value = `${url} ${title}`.toLowerCase();
  if (value.includes("job") || value.includes("careers")) return "job_post";
  if (value.includes("press") || value.includes("newsroom")) return "press_release";
  if (value.includes("annual") || value.includes("10-k")) return "annual_report";
  if (value.includes("linkedin.com/company")) return "company_page";
  if (value.includes("news")) return "news";
  return "search_result";
}

export async function searchMarketAccounts(input: ResearchInput, capabilityMap: CapabilityMap) {
  const provider = createSearchProviderClient();
  if (!provider) {
    return input.seedAccounts.map<SearchResult>((name) => ({
      title: name, url: "", snippet: "Seed account supplied by user. SEARCH_API_KEY is not configured.",
      sourceType: "search_result", verificationLevel: "unverified"
    }));
  }
  try {
    return await provider.search({
      query: buildMarketQuery(input, capabilityMap),
      maxResults: input.maxResults * 4
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown";
    console.warn("Search provider error (non-fatal):", message);
    throw new SearchProviderFallbackError(message);
  }
}

// ─── Firecrawl evidence extraction ───────────────────────────────────────────

export async function collectPageEvidence(results: SearchResult[]) {
  const config = getConfig();
  if (!config.FIRECRAWL_API_KEY?.trim()) {
    return results.map((r) => ({
      ...r,
      verificationLevel: r.verificationLevel ?? (r.url ? "snippet_only" : "unverified")
    }));
  }
  type FirecrawlResponse = {
    data?: { markdown?: string; metadata?: { title?: string } };
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
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.FIRECRAWL_API_KEY}` },
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
      enhanced.push({ ...result, verificationLevel: "snippet_only" });
    }
  }
  return enhanced;
}

// ─── Grouping with strict classification ─────────────────────────────────────

function identifyCompanyName(result: SearchResult) {
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

// Map from org name → [ search results for that org, optional person contacts found ]
type OrgGroup = {
  results: SearchResult[];
  persons: Array<{ name: string; url: string; snippet: string }>;
};

export function groupSearchResults(results: SearchResult[]) {
  const grouped = new Map<string, OrgGroup>();

  for (const result of results) {
    const classification = classifySearchResult(result);

    if (classification === "person_candidate") {
      // Try to attach person to an org extracted from snippet
      const orgName = extractOrgFromPersonSnippet(result);
      if (orgName && isValidOrganizationName(orgName)) {
        const existing = grouped.get(orgName) ?? { results: [], persons: [] };
        existing.persons.push({ name: result.title, url: result.url, snippet: result.snippet });
        grouped.set(orgName, existing);
      }
      continue;
    }

    if (classification !== "organization_candidate") continue;

    const companyName = identifyCompanyName(result);
    if (!isValidOrganizationName(companyName)) continue;

    const existing = grouped.get(companyName) ?? { results: [], persons: [] };
    existing.results.push(result);
    grouped.set(companyName, existing);
  }

  return grouped;
}

// ─── Evidence helpers ─────────────────────────────────────────────────────────

export function collectEvidence(results: SearchResult[]) {
  return results
    .filter((r) => r.url || r.snippet)
    .map<Citation>((r) => ({
      url: r.url || "unverified://seed-account",
      title: r.title,
      date: r.publishedDate,
      snippet: (r.extractedContent ?? r.snippet).slice(0, 700),
      sourceType: r.sourceType ?? "search_result",
      verificationLevel:
        r.sourceType === "uploaded_kb"
          ? "kb"
          : (r.verificationLevel ?? (r.url ? "snippet_only" : "unverified")),
      retrievedAt: now()
    }));
}

// ─── Buyer map helpers ────────────────────────────────────────────────────────

function makeBuyerTarget(
  roleTitle: string,
  department: string,
  whyThisRole: string
): BuyerTarget {
  return {
    roleTitle,
    department,
    whyThisRole,
    contactStatus: "role_only"
  };
}

function makeBuyerMap(
  companyName: string,
  capabilityMap: CapabilityMap,
  persons: Array<{ name: string; url: string; snippet: string }>
) {
  const economicBuyer = makeBuyerTarget(
    capabilityMap.buyerPersonas.economicBuyerTitles[0],
    "Executive / Security Leadership",
    `This role owns budget, risk tradeoffs, and organizational commitment for ${capabilityMap.product} investments at ${companyName}.`
  );
  const businessChampion = makeBuyerTarget(
    capabilityMap.buyerPersonas.championTitles[0],
    "Security Operations",
    `${companyName} needs a hands-on owner for ${capabilityMap.capabilities.slice(0, 2).join(" and ")} — this role drives day-to-day SOC outcomes.`
  );
  const technicalInfluencers = capabilityMap.buyerPersonas.influencerTitles.slice(0, 2).map((title) =>
    makeBuyerTarget(
      title,
      "IT / Security Architecture",
      `This role validates technical fit and telemetry integration depth for ${capabilityMap.capabilities[0]}.`
    )
  );

  // Attach publicly mentioned persons if found in snippets
  for (const person of persons.slice(0, 1)) {
    const nameParts = person.name.split(/\s+/);
    if (nameParts.length >= 2 && nameParts.length <= 4) {
      technicalInfluencers[0] = {
        ...technicalInfluencers[0],
        namedPerson: { name: person.name, title: "Security leadership (public mention)", sourceUrl: person.url },
        contactStatus: "named_public_profile"
      };
    }
  }

  return { economicBuyer, businessChampion, technicalInfluencers };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function confidenceScorer(params: {
  evidence: Citation[];
  kbInfluenceCount: number;
  hasVerifiedContact: boolean;
}) {
  const publicEvidence = params.evidence.filter((e) => e.url.startsWith("http"));
  const fullPageEvidence = publicEvidence.filter((e) => e.verificationLevel === "full_page");
  const snippetEvidence = publicEvidence.filter((e) => e.verificationLevel === "snippet_only");
  const fit = Math.min(100, 30 + params.kbInfluenceCount * 8 + fullPageEvidence.length * 8 + snippetEvidence.length * 4);
  const painEvidence = Math.min(100, fullPageEvidence.length * 18 + snippetEvidence.length * 9);
  const buyerIdentification = publicEvidence.length > 0 ? 55 : 25;
  const contactVerification = params.hasVerifiedContact ? 100 : 0;
  const overall = Math.round(fit * 0.35 + painEvidence * 0.3 + buyerIdentification * 0.2 + contactVerification * 0.15);
  return { fit, painEvidence, buyerIdentification, contactVerification, overall };
}

function scoreToLabel(score: number): AccountRecommendation["confidenceLabel"] {
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  if (score >= 20) return "low";
  return "fallback";
}

// ─── Report generation ────────────────────────────────────────────────────────

export function generateReport(
  input: ResearchInput,
  capabilityMap: CapabilityMap,
  groupedResults: Map<string, OrgGroup>,
  kbChunks: KbChunk[],
  providerStatus: ProviderStatusSnapshot
) {
  const accounts: AccountRecommendation[] = [];

  for (const [companyName, group] of groupedResults.entries()) {
    if (accounts.length >= input.maxResults) break;

    const evidence = collectEvidence(group.results);
    const kbInfluence = kbChunks.slice(0, 3).map((chunk) => ({
      documentName: chunk.documentName,
      chunkIndex: chunk.chunkIndex,
      snippet: chunk.content.slice(0, 240)
    }));

    const { economicBuyer, businessChampion, technicalInfluencers } = makeBuyerMap(
      companyName,
      capabilityMap,
      group.persons
    );

    const scores = confidenceScorer({
      evidence,
      kbInfluenceCount: kbInfluence.length,
      hasVerifiedContact: group.persons.length > 0
    });

    const publicEvidence = evidence.filter((e) => e.url.startsWith("http"));
    const isCandidate = publicEvidence.length > 0;

    const signals: OrgSignal[] = publicEvidence.slice(0, 3).map((e) => ({
      label: "Search evidence",
      detail: e.snippet.slice(0, 200),
      sourceTitle: e.title,
      sourceUrl: e.url,
      sourceType: e.sourceType === "news" ? "news" : "search_result",
      verification: e.verificationLevel === "full_page" ? "verified" : "snippet_only"
    }));

    const missingDataFlags = [
      ...(publicEvidence.length === 0 ? ["No public web citation available for this account yet."] : []),
      ...(publicEvidence.every((e) => e.verificationLevel !== "full_page")
        ? ["Evidence is snippet-only; full-page verification was not available."]
        : []),
      ...(providerStatus.fallbackModeActive
        ? ["Unverified fallback run: missing required provider(s) when this recommendation was generated."]
        : [])
    ];

    const website = publicEvidence[0]?.url ? originFromUrl(publicEvidence[0].url) : null;

    accounts.push({
      id: randomUUID(),
      companyName,
      website,
      verificationStatus: isCandidate ? "candidate_unverified" : "fallback_unverified",
      fitReason: `${companyName} appears in the ${input.targetMarket} research for ${input.geography || "North America"}. Security signals align with ${capabilityMap.product} capabilities. Verify before outreach.`,
      marketFit: `${companyName} is a ${input.targetMarket} organization. Confirm account qualification from the cited source URLs before outreach.`,
      signals,
      painPoints: [
        `Security operations complexity and alert volume requiring ${capabilityMap.capabilities[0]}.`,
        `Compliance and breach risk exposure relevant to ${capabilityMap.painCategories[0]}.`,
        `Incident triage speed and SOC modernization priorities.`
      ],
      ciscoCapabilityMatch: capabilityMap.capabilities.slice(0, 4),
      ciscoFitSummary: `${capabilityMap.product} correlates telemetry across endpoint, network, email, and cloud to prioritize threats and accelerate incident response — directly relevant to ${input.targetMarket} SOC operations.`,
      economicBuyer,
      businessChampion,
      technicalInfluencers,
      evidence,
      kbInfluence,
      scores,
      confidenceScore: scores.overall,
      confidenceLabel: scoreToLabel(scores.overall),
      nextStep: `Validate ${companyName}'s current security priorities from public sources before outreach. Lead with ${capabilityMap.product} as a way to address ${capabilityMap.painCategories[0]} and ${capabilityMap.painCategories[1]}.`,
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

// ─── Demo account creation ────────────────────────────────────────────────────

function createDemoAccount(
  companyName: string,
  input: ResearchInput,
  capabilityMap: CapabilityMap
): AccountRecommendation {
  const { economicBuyer, businessChampion, technicalInfluencers } = makeBuyerMap(
    companyName,
    capabilityMap,
    []
  );
  const scores = { fit: 42, painEvidence: 0, buyerIdentification: 25, contactVerification: 0, overall: 22 };

  return {
    id: randomUUID(),
    companyName,
    website: null,
    verificationStatus: "fallback_unverified",
    fitReason: `${companyName} is a major ${input.targetMarket} organization with security operations complexity, regulatory compliance requirements, and ransomware exposure aligning with ${capabilityMap.product} capabilities.`,
    marketFit: `${companyName} is a well-known ${input.targetMarket} organization. Confirm current security priorities from public sources before outreach.`,
    signals: [
      {
        label: "Fallback demo candidate",
        detail: `Live search did not produce enough valid ${input.targetMarket} organizations. This account was selected as a known representative organization. Verify with public sources before outreach.`,
        sourceType: "fallback",
        verification: "unverified"
      }
    ],
    painPoints: [
      "Alert volume across security tools requiring cross-telemetry correlation.",
      "Incident triage speed and SOC analyst efficiency.",
      "Ransomware readiness and healthcare data protection.",
      "Compliance pressure and operational resilience requirements."
    ],
    ciscoCapabilityMatch: capabilityMap.capabilities.slice(0, 4),
    ciscoFitSummary: `${capabilityMap.product} correlates endpoint, network, email, and cloud telemetry to prioritize threats, reduce analyst triage time, and improve response workflows — directly relevant to ${input.targetMarket} security operations.`,
    economicBuyer,
    businessChampion,
    technicalInfluencers,
    evidence: [],
    kbInfluence: [],
    scores,
    confidenceScore: scores.overall,
    confidenceLabel: "fallback",
    nextStep: `Verify ${companyName}'s current security priorities from public sources or direct outreach before making ${capabilityMap.product} claims.`,
    missingDataFlags: [
      "Fallback / demo candidate — not sourced from live search.",
      "No verified public evidence retrieved.",
      "Verify this account manually before outreach."
    ]
  };
}

// ─── Main research runner ─────────────────────────────────────────────────────

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
    warnings.push("FIRECRAWL_API_KEY is not configured; evidence uses search snippets only.");
  }
  if (!providerStatus.contactEnrichmentAvailable) {
    warnings.push("No licensed contact enrichment key configured; contacts degrade to role/persona-level recommendations.");
  }
  if (providerStatus.fallbackModeActive) {
    warnings.push("Unverified fallback run: add required provider keys and use Rerun with configured APIs for live evidence.");
  }

  const { documents, chunks } = await ingestKnowledgeBase(runId, files, embeddingRuntime);
  const capabilityMap = await productCapabilityMapper(input, chunks, embeddingRuntime);

  let rawResults: SearchResult[];
  let searchFellBack = false;

  try {
    rawResults = await searchMarketAccounts(input, capabilityMap);
  } catch (error) {
    searchFellBack = true;
    if (error instanceof SearchProviderFallbackError) {
      warnings.push(
        `Live search unavailable (${error.providerMessage}); using seed/demo candidates. Check SEARCH_API_KEY and SEARCH_PROVIDER.`
      );
    } else {
      warnings.push("Live search unavailable; using seed/demo candidates.");
    }
    rawResults =
      input.seedAccounts.length > 0
        ? input.seedAccounts.map<SearchResult>((name) => ({
            title: name, url: "", snippet: "Seed account supplied by user. Live search was unavailable.",
            sourceType: "search_result", verificationLevel: "unverified"
          }))
        : [];
  }

  const evidenceResults = await collectPageEvidence(rawResults);
  const grouped = groupSearchResults(evidenceResults);
  const relevantKb = await retrieveKbContext(`${input.ciscoProduct} ${input.targetMarket}`, chunks, 5, embeddingRuntime);
  const accounts = generateReport(input, capabilityMap, grouped, relevantKb, providerStatus);

  // Fill with known demo candidates when live results are insufficient.
  if (accounts.length < input.maxResults) {
    const existingNames = new Set(accounts.map((a) => a.companyName.toLowerCase()));
    const demoNames = getDemoNamesFor(input.targetMarket)
      .filter((name) => !existingNames.has(name.toLowerCase()))
      .slice(0, input.maxResults - accounts.length);
    for (const name of demoNames) {
      accounts.push(createDemoAccount(name, input, capabilityMap));
    }
    if (demoNames.length > 0 && !warnings.some((w) => w.includes("demo"))) {
      warnings.push(
        `Live search returned fewer than ${input.maxResults} valid organizations; filled with ${input.targetMarket} demo candidates. Verify before outreach.`
      );
    }
  }

  if (accounts.length === 0) {
    warnings.push("No target accounts were found. Add seed accounts or configure a supported search provider.");
  }
  if (embeddingRuntime.attemptedOpenAi && embeddingRuntime.usedFallback) {
    warnings.push("OpenAI embeddings failed. Check network access, key validity, and provider status.");
  }
  if (embeddingRuntime.usedFallback && !embeddingRuntime.attemptedOpenAi) {
    warnings.push("Development fallback embeddings used — OPENAI_API_KEY not configured.");
  }

  const usedFallbackRun = providerStatus.fallbackModeActive || embeddingRuntime.usedFallback || searchFellBack;

  return {
    id: runId,
    input,
    status: "completed",
    providerStatus,
    liveSearchUsed: providerStatus.liveSearchAvailable && !searchFellBack,
    openAiEmbeddingsUsed: providerStatus.openAiEmbeddingsAvailable && !embeddingRuntime.usedFallback,
    firecrawlExtractionUsed: accounts.some((a) => a.evidence.some((e) => e.verificationLevel === "full_page")),
    contactEnrichmentUsed: providerStatus.contactEnrichmentAvailable,
    isVerified:
      !usedFallbackRun && accounts.every((a) => a.evidence.some((e) => e.url.startsWith("http"))),
    isFallback: usedFallbackRun,
    warnings,
    accounts,
    kbDocuments: documents,
    kbChunks: chunks,
    createdAt,
    updatedAt: now()
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function exportRun(run: ResearchRun, format: "json" | "csv" | "md") {
  if (format === "json") return JSON.stringify(run, null, 2);

  if (format === "csv") {
    const header = [
      "company", "website", "verification_status", "confidence", "confidence_label",
      "fallback_run", "fit_reason", "capability_match",
      "economic_buyer_title", "champion_title",
      "evidence_urls", "evidence_verification", "missing_data_flags", "next_step"
    ];
    const rows = run.accounts.map((a) =>
      [
        a.companyName, a.website ?? "", a.verificationStatus,
        a.confidenceScore, a.confidenceLabel, run.isFallback,
        a.fitReason, a.ciscoCapabilityMatch.join(" | "),
        a.economicBuyer.roleTitle, a.businessChampion.roleTitle,
        a.evidence.map((e) => e.url).join(" | "),
        a.evidence.map((e) => `${e.title}: ${e.verificationLevel}`).join(" | "),
        a.missingDataFlags.join(" | "), a.nextStep
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(",")
    );
    return [header.join(","), ...rows].join("\n");
  }

  return [
    `# Cisco Market + Buyer Intelligence Report`,
    ``,
    `Product: ${run.input.ciscoProduct}`,
    `Market: ${run.input.targetMarket}`,
    `Run status: ${run.isFallback ? "Fallback / unverified" : run.isVerified ? "Verified live-provider run" : "Low-confidence run"}`,
    `Provider summary: ${run.providerStatus.summary}`,
    ``,
    ...run.accounts.flatMap((a) => [
      `## ${a.companyName} (Confidence ${a.confidenceScore} — ${a.confidenceLabel})`,
      `Status: ${a.verificationStatus}`,
      `Website: ${a.website ?? "Not verified"}`,
      ``,
      `**Why this organization**`,
      a.fitReason,
      ``,
      `**Cisco capability fit**`,
      a.ciscoFitSummary,
      a.ciscoCapabilityMatch.map((c) => `- ${c}`).join("\n"),
      ``,
      `**Economic buyer:** ${a.economicBuyer.roleTitle}`,
      `**Business champion:** ${a.businessChampion.roleTitle}`,
      `**Technical influencer:** ${a.technicalInfluencers[0]?.roleTitle ?? "TBD"}`,
      ``,
      `**Next step:** ${a.nextStep}`,
      `**Missing data:** ${a.missingDataFlags.join("; ") || "None"}`,
      `**Evidence:** ${a.evidence.map((e) => `${e.title} ${e.url}`).join("; ") || "None verified"}`,
      ``
    ])
  ].join("\n");
}
