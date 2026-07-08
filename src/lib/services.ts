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
  ContactCandidate,
  EvidenceSourceType,
  KbChunk,
  KbDocument,
  OrgSignal,
  PriorityLevel,
  ProviderCheck,
  ProviderReadiness,
  ProviderStatusSnapshot,
  ResearchInput,
  ResearchRun,
  ResultClassification,
  RunDebugStats,
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
  // Read directly from process.env (trimmed) to ensure freshness at request time.
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const searchConfigured = Boolean(process.env.SEARCH_API_KEY?.trim());
  const firecrawlConfigured = Boolean(process.env.FIRECRAWL_API_KEY?.trim());
  const config = getConfig();
  const checks = [
    providerCheck(
      "OPENAI_API_KEY",
      openAiConfigured,
      true,
      "Configured",
      "Missing required provider: OPENAI_API_KEY is not configured. Development fallback embeddings will be used."
    ),
    providerCheck(
      "SEARCH_API_KEY",
      searchConfigured,
      true,
      `Configured for ${config.SEARCH_PROVIDER}`,
      "Missing required provider: SEARCH_API_KEY is not configured. Full verified research is blocked; seed/demo mode is fallback only."
    ),
    providerCheck(
      "SEARCH_PROVIDER",
      Boolean(config.SEARCH_PROVIDER),
      true,
      `Configured as ${config.SEARCH_PROVIDER}`,
      "Missing required provider: SEARCH_PROVIDER is not set."
    ),
    providerCheck(
      "FIRECRAWL_API_KEY",
      firecrawlConfigured,
      false,
      "Configured (full-page evidence extraction available)",
      "Missing optional provider: FIRECRAWL_API_KEY not configured. Server-side fetch used as fallback; evidence may be lower quality."
    ),
    providerCheck(
      "Contact enrichment providers",
      config.hasContactEnrichment,
      false,
      "Configured (at least one licensed provider key detected)",
      "Missing optional provider: no licensed contact enrichment key configured. Contacts will remain role/persona-level."
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
    liveSearchAvailable: searchConfigured,
    openAiEmbeddingsAvailable: openAiConfigured,
    firecrawlAvailable: firecrawlConfigured,
    contactEnrichmentAvailable: config.hasContactEnrichment,
    fallbackModeActive,
    summary: fallbackModeActive
      ? "Fallback mode active: missing required provider(s). Results must be treated as unverified."
      : missingOptional
        ? "Ready for live search with missing optional provider(s). Some evidence may be lower confidence."
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

// ─── Server-side page fetch (no Firecrawl required) ──────────────────────────

type SourceDetail = {
  url: string;
  title?: string;
  text?: string;
  snippet?: string;
  sourceType: "company_site" | "news" | "search_result" | "profile" | "unknown";
  verification: "full_page_verified" | "snippet_only" | "unavailable";
  error?: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]{2,6};/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function guessSourceType(url: string): SourceDetail["sourceType"] {
  const lower = url.toLowerCase();
  if (lower.includes("linkedin.com")) return "profile";
  if (/news|press|release|blog/i.test(lower)) return "news";
  return "company_site";
}

export async function fetchSourceDetail(url: string): Promise<SourceDetail> {
  if (!url.startsWith("http")) return { url, verification: "unavailable", error: "Not an HTTP URL", sourceType: "unknown" };

  // Check Firecrawl first if configured
  const config = getConfig();
  if (config.FIRECRAWL_API_KEY) {
    try {
      type FC = { data?: { markdown?: string; metadata?: { title?: string } } };
      const data = await withRetry(
        () =>
          fetchJsonWithTimeout<FC>(
            "https://api.firecrawl.dev/v1/scrape",
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.FIRECRAWL_API_KEY}` },
              body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true })
            },
            15000
          ),
        { label: "Firecrawl", retries: 1 }
      );
      const text = data.data?.markdown?.replace(/\s+/g, " ").trim();
      if (text) {
        return {
          url,
          title: data.data?.metadata?.title,
          text: text.slice(0, 3500),
          verification: "full_page_verified",
          sourceType: guessSourceType(url)
        };
      }
    } catch {
      // Fall through to server-side fetch
    }
  }

  // Server-side HTML fetch (built-in, no extra dependency)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; market-intel-bot/1.0; +https://example.com/bot)", Accept: "text/html" },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) return { url, verification: "unavailable", error: `HTTP ${response.status}`, sourceType: guessSourceType(url) };
    const html = await response.text();
    const text = stripHtml(html).slice(0, 3000);
    // Try to extract <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      url,
      title: titleMatch?.[1]?.trim(),
      text,
      verification: "snippet_only",
      sourceType: guessSourceType(url)
    };
  } catch (error) {
    return { url, verification: "unavailable", error: sanitizeProviderError(error), sourceType: guessSourceType(url) };
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
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    if (runtime) runtime.usedFallback = true;
    return deterministicEmbedding(text);
  }
  if (runtime) runtime.attemptedOpenAi = true;
  try {
    const client = new OpenAI({ apiKey: key, timeout: 5000, maxRetries: 0 });
    const response = await withRetry(
      () => client.embeddings.create({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
      { label: "OpenAI embedding", retries: 1, baseDelayMs: 200 }
    );
    return response.data[0]?.embedding ?? deterministicEmbedding(text);
  } catch (error) {
    const sanitized = sanitizeProviderError(error);
    if (runtime) { runtime.usedFallback = true; runtime.errors.push(sanitized); }
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
  if (name.endsWith(".docx")) { const r = await mammoth.extractRawText({ buffer }); return r.value; }
  if (name.endsWith(".csv")) {
    const records = parseCsv(buffer, { relaxColumnCount: true, skipEmptyLines: true });
    return records.map((row: unknown[]) => row.join(" ")).join("\n");
  }
  if (name.endsWith(".pdf")) {
    return [
      `PDF text extraction placeholder for ${file.name}.`,
      "For production, enable a vetted PDF extraction service.",
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
    const document: KbDocument = { id: randomUUID(), runId, fileName: file.name, mimeType: file.type || "application/octet-stream", extractedText, createdAt: now() };
    documents.push(document);
    const textChunks = chunkText(extractedText);
    for (let chunkIndex = 0; chunkIndex < textChunks.length; chunkIndex += 1) {
      chunks.push({
        id: randomUUID(), runId, documentId: document.id, documentName: document.fileName, chunkIndex,
        content: textChunks[chunkIndex],
        embedding: await embedTextWithRuntime(textChunks[chunkIndex], embeddingRuntime),
        metadata: { sourceType: "uploaded_kb" }
      });
    }
  }
  return { documents, chunks };
}

export async function retrieveKbContext(query: string, chunks: KbChunk[], limit = 5, embeddingRuntime?: EmbeddingRuntime) {
  if (chunks.length === 0) return [];
  const queryEmbedding = await embedTextWithRuntime(query, embeddingRuntime);
  return chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}

export async function productCapabilityMapper(input: ResearchInput, kbChunks: KbChunk[], embeddingRuntime?: EmbeddingRuntime): Promise<CapabilityMap> {
  const query = `${input.ciscoProduct} ${input.targetMarket} cybersecurity networking observability buyer pain`;
  const relevantChunks = await retrieveKbContext(query, kbChunks, 4, embeddingRuntime);
  const product = input.ciscoProduct.toLowerCase();
  const baseCapabilities =
    product.includes("meraki") ? ["cloud-managed networking", "secure SD-WAN", "network visibility", "branch operations"]
    : product.includes("thousandeyes") ? ["internet and application visibility", "digital experience monitoring", "outage analysis"]
    : product.includes("firewall") ? ["network segmentation", "threat prevention", "secure access policy", "traffic inspection"]
    : product.includes("xdr") ? ["extended detection and response", "incident correlation", "security operations automation", "cross-telemetry threat prioritization", "SOC workflow improvement"]
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
    capabilities: Array.from(new Set([...baseCapabilities, ...relevantChunks.flatMap((c) => keywordHints(c.content))])).slice(0, 10),
    valueProps: ["reduce operational risk", "improve threat visibility across environments", "connect security outcomes to business resilience"],
    painCategories: ["security risk", "network reliability", "operational complexity", "compliance pressure", "digital experience issues"],
    buyerPersonas: {
      championTitles: ["Director of Security Operations", "Director of IT", "CISO"],
      economicBuyerTitles: ["CIO", "CISO", "VP of Infrastructure", "Chief Technology Officer"],
      influencerTitles: ["Security Architect", "SOC Manager", "Network Security Architect"]
    },
    citations: kbCitations
  };
}

function keywordHints(text: string) {
  const lower = text.toLowerCase();
  return [
    ["zero trust", "zero trust access"], ["ransomware", "ransomware readiness"],
    ["hybrid work", "hybrid work enablement"], ["iot", "IoT visibility"], ["compliance", "compliance reporting"]
  ].filter(([needle]) => lower.includes(needle)).map(([, hint]) => hint);
}

// ─── Result classification ────────────────────────────────────────────────────

const REJECT_SOURCE_DOMAINS = new Set([
  // Security vendors
  "cisco.com", "paloaltonetworks.com", "crowdstrike.com", "fortinet.com",
  "splunk.com", "mcafee.com", "sentinelone.com", "zscaler.com", "okta.com",
  "proofpoint.com", "ibm.com", "cloudflare.com", "microsoft.com", "google.com",
  // Social / content platforms
  "facebook.com", "youtube.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "medium.com", "substack.com",
  // Academic / research databases — good for market signals, never org names
  "wikipedia.org", "ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov",
  "researchgate.net", "arxiv.org"
]);

// Domains that produce academic/research pages — classify as article_or_list, not vendor_or_product
const ACADEMIC_DOMAINS = new Set([
  "ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov", "researchgate.net", "arxiv.org"
]);

export const ORG_INDICATOR_RE = /\b(health(care)?|hospital|clinic|medical|system(s)?|plan|center|group|network|care|services|solutions|inc|llc|corp|ltd|foundation|trust|association|society|institute|university|college|authority|agency|department|county|state of)\b/i;

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function looksLikePersonName(name: string): boolean {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (ORG_INDICATOR_RE.test(trimmed)) return false;
  const mainWords = words.filter((w) => !["and", "of", "the", "in", "at", "for", "de", "van"].includes(w.toLowerCase()));
  return mainWords.length >= 2 && mainWords.every((w) => /^[A-Z][a-zA-Z''-]+$/.test(w));
}

export function isValidOrganizationName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 4) return false;
  if (trimmed.length > 100) return false;

  // ── Basic structural rejects ──────────────────────────────────────────────

  // Starts with a number (article: "53 hospital CISOs...")
  if (/^\d+[\s.]/.test(trimmed)) return false;
  // Truncated article title
  if (/\.\.\.$/.test(trimmed)) return false;
  // Contains a question mark → headline/title, not an org
  if (trimmed.includes("?")) return false;
  // Contains a colon followed by article/report language (most org names don't have colons)
  if (/:/.test(trimmed)) {
    const afterColon = trimmed.split(":").slice(1).join(":");
    if (/\b(review|report|study|guide|analysis|overview|challenges|crisis|attacks|definition|examples|cybersecurity|hospitals|modern)\b/i.test(afterColon)) return false;
    // Even without a keyword after the colon, a colon usually means it's a title/subtitle
    if (!/\b(health|hospital|clinic|medical|system|network|group|center|plan)\b/i.test(trimmed)) return false;
  }

  // ── Interrogative / headline starts ──────────────────────────────────────

  if (/^(what\s+is|how\s+to|how\s+do|how\s+|why\s+|when\s+|where\s+|are\s+|is\s+a\s+)/i.test(trimmed)) return false;

  // ── Generic security concept titles (not org names) ───────────────────────

  if (/^(security\s+operations\s+center|cyber.?attacks?\s+on|ransomware\s+attacks?\s+(in|on)|healthcare\s+cybersecurity|health\s*care\s+cybersecurity|cybersecurity\s+(in|for)\s+hospital|cybersecurity\s+challenges|what\s+is\s+a)/i.test(trimmed)) return false;

  // ── Article / content keywords ────────────────────────────────────────────

  if (/\b(narrative\s+review|systematic\s+review|white\s*paper|whitepaper|case\s+study|public\s+health\s+crisis|data\s+breach\s+report|cybersecurity\s+for\s+healthcare)\b/i.test(trimmed)) return false;
  if (/\b(resources|templates|guide|guides|playbook|careers?|job\s+posting|preferred\s+vendor|vendor\s+list|approved\s+vendor)\b/i.test(trimmed)) return false;
  if (/\b(webinar|whitepaper|datasheet|podcast|ebook|newsletter|report|announcement|challenges\s+for|challenges\s+of|solutions\s+for|overview\s+of|definition\s+of)\b/i.test(trimmed)) return false;

  // ── Vendor / product names ────────────────────────────────────────────────

  if (/^cisco\b/i.test(trimmed) || /\bcisco\s+(xdr|security|cloud|meraki|duo|firewall|umbrella|talos)/i.test(trimmed)) return false;
  if (/\b(cybersecurity\s+readiness\s+index|cloud\s+protection\s+suite|readiness\s+index)\b/i.test(trimmed)) return false;

  // ── Person names ──────────────────────────────────────────────────────────

  if (looksLikePersonName(trimmed)) return false;

  // ── Word count heuristic (long names without org keywords are titles) ─────

  const words = trimmed.split(/\s+/);
  if (words.length > 7 && !ORG_INDICATOR_RE.test(trimmed)) return false;

  return true;
}

export function classifySearchResult(result: SearchResult): ResultClassification {
  const title = (result.title ?? "").trim();
  const url = (result.url ?? "").toLowerCase();

  // ── Domain checks ─────────────────────────────────────────────────────────

  if (url.includes("linkedin.com/in/")) return "person_candidate";
  const domain = extractDomain(url);
  // Academic databases → always article, never an org name source
  if (ACADEMIC_DOMAINS.has(domain) || [...ACADEMIC_DOMAINS].some((d) => domain.endsWith("." + d))) return "article_or_list";
  // Vendor / social domains
  if (REJECT_SOURCE_DOMAINS.has(domain) || [...REJECT_SOURCE_DOMAINS].some((d) => domain.endsWith("." + d))) return "vendor_or_product";

  // ── Resource / template pages (checked before article patterns) ───────────
  // These must be classified before the article/colon checks so govsite.gov pages
  // that say "Resources and Templates" are still caught as resource_template.

  if (/\b(resources?\s+(and\s+)?templates?|preferred\s+vendor|vendor\s+list|approved\s+vendor|it\s+security\s+services)\b/i.test(title)) return "resource_template";

  // ── Vendor / product title checks ─────────────────────────────────────────

  if (/^cisco\b/i.test(title) || /\bcisco\s+(xdr|security|cloud|meraki|duo|umbrella|firewall)/i.test(title)) return "vendor_or_product";

  // ── Job postings ──────────────────────────────────────────────────────────

  if (/\b(careers?|job\s+posting|we.?re hiring|apply now)\b/i.test(title)) return "job_posting";

  // ── Article / list / report headlines ─────────────────────────────────────

  // Starts with a number (e.g. "53 hospital CISOs...")
  if (/^\d+\s+(hospital|health|ciso|top|best|leading|major|key)/i.test(title)) return "article_or_list";
  if (/^(top|best|leading|major|key)\s+\d+/i.test(title)) return "article_or_list";
  // Interrogative headlines
  if (/^(what\s+is|how\s+to|how\s+do|how\s+|why\s+|when\s+|where\s+)/i.test(title)) return "article_or_list";
  // Colon-delimited article titles: "X: A Narrative Review"
  if (/:/.test(title)) {
    const afterColon = title.split(":").slice(1).join(":");
    if (/\b(review|report|study|guide|analysis|overview|challenges|crisis|attacks|definition|examples|cybersecurity|hospitals|modern)\b/i.test(afterColon)) return "article_or_list";
    // Colon without org keyword → likely a headline/subtitle
    if (!/\b(health|hospital|clinic|medical|system|network|group|center|plan)\b/i.test(title)) return "article_or_list";
  }
  // Generic security concept titles (not org names)
  if (/^(security\s+operations\s+center|cyber.?attacks?\s+on|ransomware\s+attacks?\s+(in|on)|healthcare\s+cybersecurity|health\s*care\s+cybersecurity|cybersecurity\s+(in|for)\s+hospital|cybersecurity\s+challenges)/i.test(title)) return "article_or_list";
  // Article/report content words
  if (/\b(narrative\s+review|systematic\s+review|white\s*paper|public\s+health\s+crisis|data\s+breach\s+report)\b/i.test(title)) return "article_or_list";
  // Question mark in title
  if (title.includes("?")) return "article_or_list";

  // ── Person names ──────────────────────────────────────────────────────────

  if (looksLikePersonName(title)) return "person_candidate";

  // ── Short prepositional fragment ──────────────────────────────────────────

  if (/^(in|at|of|for|the)\s+/i.test(title) && title.split(/\s+/).length < 6) return "reject";

  // ── Org keyword → likely org candidate ───────────────────────────────────

  if (ORG_INDICATOR_RE.test(title)) return "organization_candidate";

  return isValidOrganizationName(title) ? "organization_candidate" : "reject";
}

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

/** Phase-1 discovery queries — do NOT include the Cisco product name. */
export function buildDiscoveryQueries(input: ResearchInput): string[] {
  const geo = input.geography || "North America";
  const lower = input.targetMarket.toLowerCase();

  if (lower.includes("healthcare") || lower.includes("health")) {
    return [
      `${geo} hospital system cybersecurity ransomware security operations`,
      `large healthcare provider security operations center CISO`,
      `health system data breach cyber incident response`
    ];
  }
  if (lower.includes("retail")) {
    return [
      `${geo} retail chain cybersecurity security operations`,
      `large retailer ransomware data breach security CISO`
    ];
  }
  if (lower.includes("government") || lower.includes("sled")) {
    return [
      `${geo} state government agency cybersecurity ransomware`,
      `local government county cybersecurity security operations`
    ];
  }
  return [
    `"${input.targetMarket}" company cybersecurity CISO security operations ${geo}`,
    `"${input.targetMarket}" organization ransomware breach security`
  ];
}

/** Phase-2 enrichment queries for a specific org. Run even for fallback-selected orgs. */
export function buildEnrichmentQueries(orgName: string): string[] {
  return [
    `"${orgName}" cybersecurity CISO "security operations" ransomware`,
    `"${orgName}" "data breach" OR "cyber incident" OR "security leadership" OR "Chief Information Security Officer"`,
    `"${orgName}" "information security" OR "incident response" OR "privacy breach"`
  ];
}

// ─── Source quality scoring ───────────────────────────────────────────────────

/** Parse a year from snippet/title for recency scoring. */
function extractYearFromText(text: string): number | null {
  const match = text.match(/\b(20[1-9][0-9])\b/);
  return match ? parseInt(match[1]) : null;
}

/** Score a search result for quality/relevance to an org. Higher = better. */
export function computeSourceQualityScore(result: SearchResult, orgName: string): number {
  let score = 0;
  const combined = `${result.title} ${result.snippet}`.toLowerCase();
  const orgLower = orgName.toLowerCase();
  const orgWords = orgLower.split(/\s+/).filter((w) => w.length > 3);
  const domain = extractDomain(result.url.toLowerCase());

  const domainMatchesOrg = orgWords.length > 0 && orgWords.some((w) => domain.includes(w));
  const mentionsOrg = combined.includes(orgLower) || (orgWords.length >= 2 && orgWords.every((w) => combined.includes(w)));

  if (domainMatchesOrg) score += 30;
  if (result.url.includes("linkedin.com") && mentionsOrg) score += 25;
  if (/annual.report|10-k|investor.relations|sec\.gov|cms\.gov/i.test(combined + domain)) score += 20;
  if (/healthcaredive|beckershospital|healthcareitnews|modernhealthcare|fiercehealthcare|hhs\.gov/i.test(domain)) score += 20;
  if (result.sourceType === "job_post" && mentionsOrg) score += 15;
  if (mentionsOrg) score += 10;
  if (/cyber|ransomware|soc|ciso|security operations|data breach|incident response/i.test(combined)) score += 10;

  // Recency bonus
  const year = extractYearFromText(`${result.title} ${result.snippet} ${result.publishedDate ?? ""}`);
  if (year) {
    const currentYear = new Date().getFullYear();
    if (currentYear - year <= 1) score += 15;
    else if (currentYear - year <= 3) score += 10;
  }

  // Penalties for generic content
  if (!mentionsOrg && !domainMatchesOrg) {
    score -= 40;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Dynamic discovery queries ────────────────────────────────────────────────

/** Queries designed to discover real organizations in the target market — not Cisco product queries. */
export function buildDynamicDiscoveryQueries(input: ResearchInput): string[] {
  const geo = input.geography || "North America";
  const lower = input.targetMarket.toLowerCase();

  if (lower.includes("healthcare") || lower.includes("health")) {
    return [
      `${geo} hospital system CISO cybersecurity security operations`,
      `healthcare organization ransomware data breach incident response`,
      `health system cybersecurity leadership security program`,
      `hospital network security operations center endpoint security`,
      `healthcare provider data breach HIPAA security leadership`
    ];
  }
  if (lower.includes("retail")) {
    return [
      `${geo} retail company cybersecurity CISO security operations`,
      `retailer data breach security program leadership`
    ];
  }
  if (lower.includes("government") || lower.includes("sled")) {
    return [
      `${geo} state government agency cybersecurity security operations`,
      `local government county CISO cybersecurity program`
    ];
  }
  return [
    `${geo} "${input.targetMarket}" company cybersecurity CISO security operations`,
    `"${input.targetMarket}" organization cybersecurity security incident response`
  ];
}

/** Use OpenAI to extract verified org names from search results snippets. */
async function extractOrgsWithOpenAI(
  results: SearchResult[],
  input: ResearchInput,
  apiKey: string,
  debugStats: RunDebugStats
): Promise<string[]> {
  const snippets = results
    .slice(0, 15)
    .map((r, i) => `[${i}] Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet.slice(0, 200)}`)
    .join("\n\n");

  const prompt = `You are classifying web search results to find real ${input.targetMarket} organizations.

Results:
${snippets}

Target market: ${input.targetMarket}
Geography: ${input.geography || "North America"}

Return a JSON object with a "organizations" array of real organization names (not article titles, report names, vendor names, or generic concepts).
Only include actual ${input.targetMarket} organizations clearly identifiable from the snippets/titles.
{"organizations": ["Org Name 1", "Org Name 2"]}`;

  try {
    const client = new OpenAI({ apiKey, timeout: 15000, maxRetries: 0 });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.1
    });
    debugStats.openAiEntityExtractionRan = true;
    const text = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { organizations?: string[] };
    return (parsed.organizations ?? []).filter(isValidOrganizationName).slice(0, 10);
  } catch (error) {
    console.warn("OpenAI entity extraction failed (non-fatal):", sanitizeProviderError(error));
    return [];
  }
}

// ─── LinkedIn / contact discovery ─────────────────────────────────────────────

/** Public search queries targeting LinkedIn and public profiles for buyer roles. No login required. */
export function buildLinkedInBuyerQueries(orgName: string): string[] {
  return [
    `site:linkedin.com/in "${orgName}" CISO`,
    `site:linkedin.com/in "${orgName}" "Chief Information Security Officer"`,
    `site:linkedin.com/in "${orgName}" "VP Information Security"`,
    `site:linkedin.com/in "${orgName}" "Director Security Operations"`,
    `"${orgName}" CISO "information security" cybersecurity`,
    `"${orgName}" "Chief Information Officer" cybersecurity security`
  ];
}

/** Classify a buyer role title into a buyer category. */
export function categorizeContact(titleText: string): ContactCandidate["roleCategory"] {
  const t = titleText;
  // C-suite / Chief titles → economic buyer (budget owner)
  if (/\b(cio|chief information officer|chief digital officer|chief technology officer|cto)\b/i.test(t)) return "economic_buyer";
  if (/\b(ciso|chief information security officer|chief security officer)\b/i.test(t)) return "economic_buyer";
  // VP-level and Director security → business champion (initiative driver)
  if (/\b(vp.*(?:information\s+)?security|vice president.*security|director.*(security|it security|information security|infrastructure|soc)|head of security)\b/i.test(t)) return "business_champion";
  // Technical practitioners → technical influencer
  if (/\b(security architect|soc manager|network security architect|detection engineer|incident response|it security manager)\b/i.test(t)) return "technical_influencer";
  return "unknown";
}

/** Extract a person name from a LinkedIn-style search result title. */
function extractNameFromLinkedInResult(title: string): string | null {
  // LinkedIn titles: "Name - Title at Company | LinkedIn" or "Name | Title | Company | LinkedIn"
  const match = title.match(/^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,3})\s*[-|]/);
  if (match?.[1]) {
    const candidate = match[1].trim();
    if (looksLikePersonName(candidate)) return candidate;
  }
  return null;
}

/** Extract title from LinkedIn result title/snippet. */
function extractTitleFromLinkedInResult(title: string, snippet: string): string | null {
  // "Name - TITLE at Company | LinkedIn"
  const dashMatch = title.match(/[-–]\s*([^|-]{4,80}?)\s*(?:at|@|\|)\s/);
  if (dashMatch?.[1]) return dashMatch[1].trim();
  // Title keywords in snippet
  const kwMatch = snippet.match(
    /\b(CISO|CIO|CTO|Chief Information Security Officer|Chief Information Officer|Director[^,|\n]{0,50}Security|VP[^,|\n]{0,50}Security|Security Architect|SOC Manager|Head of Security)\b/i
  );
  if (kwMatch) return kwMatch[0].trim();
  return null;
}

/**
 * Extract public ContactCandidates from search results.
 * Only attaches contacts clearly tied to the organization via public snippet/title/URL.
 * Never invents people, emails, or profile URLs.
 */
export function extractContactCandidates(results: SearchResult[], orgName: string): ContactCandidate[] {
  const orgLower = orgName.toLowerCase();
  const orgWords = orgLower.split(/\s+/).filter((w) => w.length > 3);
  const candidates: ContactCandidate[] = [];

  for (const result of results) {
    const isLinkedIn = result.url.includes("linkedin.com");
    const combined = `${result.title} ${result.snippet}`.toLowerCase();

    // Must be a LinkedIn or public profile result
    if (!isLinkedIn) continue;

    // Must clearly mention the org
    const mentionsOrg =
      combined.includes(orgLower) || (orgWords.length >= 2 && orgWords.every((w) => combined.includes(w)));
    if (!mentionsOrg) {
      continue;
    }

    // Extract person name
    const name = extractNameFromLinkedInResult(result.title);
    if (!name || !looksLikePersonName(name)) continue;

    const title = extractTitleFromLinkedInResult(result.title, result.snippet);
    const roleCategory = title ? categorizeContact(title) : "unknown";
    if (roleCategory === "unknown") continue;

    candidates.push({
      name,
      title: title ?? undefined,
      organization: orgName,
      sourceUrl: result.url,
      sourceTitle: result.title,
      snippet: result.snippet.slice(0, 300),
      roleCategory,
      confidence: title ? 70 : 40,
      verification: "public_snippet"
    });
  }

  // Deduplicate by name
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.name.toLowerCase())) return false;
    seen.add(c.name.toLowerCase());
    return true;
  }).slice(0, 4);
}

/**
 * Select the target organizations upfront — BEFORE any search.
 * Account names MUST come from seeds or the approved fallback list.
 * They must never come from broad search result titles.
 */
export function selectOrganizations(input: ResearchInput): {
  orgs: string[];
  base: RunDebugStats["selectedAccountBase"];
} {
  if (input.seedAccounts.length > 0) {
    const validSeeds = input.seedAccounts
      .filter((s) => s.trim().length > 0)
      .slice(0, input.maxResults);
    return { orgs: validSeeds, base: "seed_accounts" };
  }
  const demoNames = getDemoNamesFor(input.targetMarket).slice(0, input.maxResults);
  const lower = input.targetMarket.toLowerCase();
  const base: RunDebugStats["selectedAccountBase"] =
    lower.includes("healthcare") || lower.includes("health") ? "healthcare_default" : "market_default";
  return { orgs: demoNames, base };
}

/**
 * Async version of selectOrganizations that tries live dynamic discovery first.
 * Seeds always take absolute priority. If no seeds, runs discovery queries,
 * uses OpenAI to extract org names, validates them, and falls back to the
 * approved fallback list for any missing slots.
 */
export async function selectOrganizationsWithDiscovery(
  input: ResearchInput,
  provider: SearchProviderClient | null,
  debugStats: RunDebugStats
): Promise<{ orgs: string[]; base: RunDebugStats["selectedAccountBase"] }> {
  // Seeds always win
  if (input.seedAccounts.length > 0) {
    const validSeeds = input.seedAccounts.filter((s) => s.trim().length > 0).slice(0, input.maxResults);
    return { orgs: validSeeds, base: "seed_accounts" };
  }

  // If no search provider, fall back immediately
  if (!provider) {
    return selectOrganizations(input);
  }

  // Dynamic discovery: run targeted queries and extract org names
  const discoveryQueries = buildDynamicDiscoveryQueries(input);
  const discoveryResults: SearchResult[] = [];
  for (const query of discoveryQueries.slice(0, 3)) {
    try {
      const results = await provider.search({ query, maxResults: 10 });
      discoveryResults.push(...results);
      await new Promise((r) => setTimeout(r, 150));
    } catch {
      // Non-fatal — continue with fewer results
    }
  }

  debugStats.dynamicOrgsDiscovered = 0;

  // Try OpenAI entity extraction first, fall back to deterministic
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  let dynamicOrgs: string[] = [];

  if (apiKey && discoveryResults.length > 0) {
    dynamicOrgs = await extractOrgsWithOpenAI(discoveryResults, input, apiKey, debugStats);
  }

  if (dynamicOrgs.length === 0) {
    // Deterministic fallback: classify results and extract valid org names
    for (const result of discoveryResults) {
      const classification = classifySearchResult(result);
      if (classification === "organization_candidate") {
        const name = identifyCompanyName(result);
        if (isValidOrganizationName(name) && !dynamicOrgs.includes(name)) {
          dynamicOrgs.push(name);
        }
      }
    }
  }

  debugStats.dynamicOrgsDiscovered = dynamicOrgs.length;

  // Fill remaining slots with approved fallback orgs
  const fallbackOrgs = getDemoNamesFor(input.targetMarket);
  const selectedSet = new Set(dynamicOrgs.map((o) => o.toLowerCase()));
  for (const fb of fallbackOrgs) {
    if (dynamicOrgs.length >= input.maxResults) break;
    if (!selectedSet.has(fb.toLowerCase())) {
      dynamicOrgs.push(fb);
      selectedSet.add(fb.toLowerCase());
    }
  }

  const finalOrgs = dynamicOrgs.slice(0, input.maxResults);
  const lower = input.targetMarket.toLowerCase();
  const base: RunDebugStats["selectedAccountBase"] =
    lower.includes("healthcare") || lower.includes("health") ? "healthcare_default" : "market_default";

  return { orgs: finalOrgs, base };
}

/**
 * Filter search results to only those relevant to a specific organization.
 * Broad market articles (e.g. "Healthcare Data Breach Statistics") are market context,
 * not org-specific evidence.
 */
export function filterEvidenceForOrg(
  results: SearchResult[],
  orgName: string
): { orgSpecific: SearchResult[]; marketContext: SearchResult[] } {
  const orgLower = orgName.toLowerCase();
  // Meaningful words (> 3 chars) in the org name for partial matching
  const orgWords = orgLower.split(/\s+/).filter((w) => w.length > 3);

  const orgSpecific: SearchResult[] = [];
  const marketContext: SearchResult[] = [];

  for (const result of results) {
    const combined = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
    const domain = extractDomain(result.url.toLowerCase());

    const domainMatchesOrg = orgWords.length > 0 && orgWords.some((w) => domain.includes(w));
    const fullNameMentioned = combined.includes(orgLower);
    const allWordsPresent =
      orgWords.length >= 2 && orgWords.every((w) => combined.includes(w));

    if (domainMatchesOrg || fullNameMentioned || allWordsPresent) {
      orgSpecific.push(result);
    } else {
      marketContext.push(result);
    }
  }

  return { orgSpecific, marketContext };
}

/**
 * Final safety net: remove any account whose name is not in the selected org list
 * or fails name validation. Replace removed accounts with missing fallback orgs.
 */
export function sanitizeFinalAccounts(
  accounts: AccountRecommendation[],
  selectedOrgs: string[],
  capabilityMap: CapabilityMap,
  input: ResearchInput
): { accounts: AccountRecommendation[]; replacements: number } {
  const normalizedSelected = new Set(selectedOrgs.map((s) => s.toLowerCase()));
  const valid: AccountRecommendation[] = [];
  let replacements = 0;

  for (const account of accounts) {
    const nameIsValid =
      isValidOrganizationName(account.companyName) &&
      normalizedSelected.has(account.companyName.toLowerCase());
    if (nameIsValid) {
      valid.push(account);
    } else {
      replacements++;
    }
  }

  // Backfill with any selected org that didn't make it in — create a minimal fallback card.
  const existingNamesInValid = new Set(valid.map((a) => a.companyName.toLowerCase()));
  for (const orgName of selectedOrgs) {
    if (!existingNamesInValid.has(orgName.toLowerCase()) && valid.length < input.maxResults) {
      const makeBuyer = (roleTitle: string, why: string): BuyerTarget => ({
        roleTitle, department: "Security / IT", whyThisRole: why, contactStatus: "role_only"
      });
      valid.push({
        id: randomUUID(),
        companyName: orgName,
        website: null,
        verificationStatus: "fallback_unverified",
        fitReason: `${orgName} is a major ${input.targetMarket} organization with security operations complexity aligning with ${capabilityMap.product} capabilities.`,
        marketFit: `${orgName} selected from approved ${input.targetMarket} target list.`,
        signals: [{ label: "Fallback selected", detail: `${orgName} selected from approved ${input.targetMarket} target list. No organization-specific source verified yet.`, implication: "Verify with direct outreach before claiming fit.", sourceType: "fallback", verification: "unverified" }],
        painPoints: ["Alert volume and triage burden across security tools.", "Ransomware readiness and data protection obligations.", "Incident response speed and SOC efficiency."],
        ciscoCapabilityMatch: capabilityMap.capabilities.slice(0, 4),
        ciscoFitSummary: `${capabilityMap.product} correlates endpoint, network, email, and cloud telemetry to prioritize threats and accelerate incident response.`,
        economicBuyer: makeBuyer(capabilityMap.buyerPersonas.economicBuyerTitles[0], `Owns budget and risk tradeoffs for ${capabilityMap.product} at ${orgName}.`),
        businessChampion: makeBuyer(capabilityMap.buyerPersonas.championTitles[0], `Drives day-to-day SOC outcomes at ${orgName}.`),
        technicalInfluencers: [makeBuyer(capabilityMap.buyerPersonas.influencerTitles[0], `Validates telemetry integrations for ${capabilityMap.capabilities[0]}.`)],
        evidence: [], kbInfluence: [],
        scores: { fit: 20, painEvidence: 0, buyerIdentification: 25, contactVerification: 0, overall: 20 },
        confidenceScore: 20, confidenceLabel: "fallback",
        priority: "C" as PriorityLevel,
        priorityReason: "Default priority — fallback account with no verified source.",
        contactCandidates: [],
        nextStep: `Verify ${orgName}'s current security priorities from public sources before outreach.`,
        missingDataFlags: [`${orgName} selected from approved healthcare target list. No organization-specific source verified in this run.`]
      });
      existingNamesInValid.add(orgName.toLowerCase());
    }
  }

  return { accounts: valid.slice(0, input.maxResults), replacements };
}

type SearchOptions = { query: string; maxResults: number };
type SearchProviderClient = { search(options: SearchOptions): Promise<SearchResult[]> };

function createSearchProviderClient(): SearchProviderClient | null {
  const apiKey = process.env.SEARCH_API_KEY?.trim();
  const config = getConfig();
  if (!apiKey) return null;

  if (config.SEARCH_PROVIDER === "brave") {
    return {
      async search(options) {
        type Resp = { web?: { results?: Array<{ title: string; url: string; description?: string; age?: string }> } };
        const data = await withRetry(
          () => fetchJsonWithTimeout<Resp>(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(options.query)}&count=${options.maxResults}`,
            { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } }
          ),
          { label: "Brave search" }
        );
        return (data.web?.results ?? []).map((i) => ({ title: i.title, url: i.url, snippet: i.description ?? "", publishedDate: i.age, sourceType: classifySourceType(i.url, i.title), verificationLevel: "snippet_only" as const }));
      }
    };
  }

  if (config.SEARCH_PROVIDER === "exa") {
    return {
      async search(options) {
        type Resp = { results?: Array<{ title?: string; url: string; text?: string; publishedDate?: string }> };
        const data = await withRetry(
          () => fetchJsonWithTimeout<Resp>("https://api.exa.ai/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey },
            body: JSON.stringify({ query: options.query, numResults: options.maxResults, contents: { text: true } })
          }),
          { label: "Exa search" }
        );
        return (data.results ?? []).map((i) => ({ title: i.title ?? i.url, url: i.url, snippet: i.text ?? "", publishedDate: i.publishedDate, sourceType: classifySourceType(i.url, i.title ?? ""), verificationLevel: "snippet_only" as const }));
      }
    };
  }

  if (config.SEARCH_PROVIDER === "serpapi") {
    return {
      async search(options) {
        type Resp = { organic_results?: Array<{ title: string; link: string; snippet?: string; date?: string }> };
        const data = await withRetry(
          () => fetchJsonWithTimeout<Resp>(
            `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(options.query)}&num=${options.maxResults}&api_key=${encodeURIComponent(apiKey)}`,
            { headers: { Accept: "application/json" } }
          ),
          { label: "SerpAPI search" }
        );
        return (data.organic_results ?? []).map((i) => ({ title: i.title, url: i.link, snippet: i.snippet ?? "", publishedDate: i.date, sourceType: classifySourceType(i.link, i.title), verificationLevel: "snippet_only" as const }));
      }
    };
  }

  // Default: Tavily
  return {
    async search(options) {
      type Resp = { results?: Array<{ title: string; url: string; content?: string; published_date?: string }> };
      const data = await withRetry(
        () => fetchJsonWithTimeout<Resp>("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, query: options.query, max_results: options.maxResults, search_depth: "advanced", include_answer: false })
        }),
        { label: "Tavily search" }
      );
      return (data.results ?? []).map((i) => ({ title: i.title, url: i.url, snippet: i.content ?? "", publishedDate: i.published_date, sourceType: classifySourceType(i.url, i.title), verificationLevel: "snippet_only" as const }));
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

// ─── Grouping with classification ─────────────────────────────────────────────

function identifyCompanyName(result: SearchResult) {
  const cleanedTitle = result.title.replace(/\s[-|].*$/, "").replace(/\b(press release|careers|jobs|annual report)\b/gi, "").trim();
  if (cleanedTitle.length > 2 && cleanedTitle.length < 90) return cleanedTitle;
  if (result.url) {
    try { return new URL(result.url).hostname.replace(/^www\./, "").split(".")[0]; } catch { return result.title; }
  }
  return result.title;
}

type OrgGroup = {
  results: SearchResult[];
  persons: Array<{ name: string; url: string; snippet: string }>;
};

type GroupStats = {
  total: number;
  rejected: number;
  rejectedAsArticleTitle: number;
  rejectedAsGenericConcept: number;
  rejectedAsVendorProduct: number;
  rejectedAsPerson: number;
  rejectedInvalidOrgName: number;
  rejectionReasons: Partial<Record<ResultClassification, number>>;
  marketSignals: import("@/lib/types").MarketSignal[];
};

export function groupSearchResults(results: SearchResult[]): Map<string, OrgGroup> {
  return groupSearchResultsWithStats(results).grouped;
}

// Exported so tests can inspect rejection stats
export function groupSearchResultsWithStats(results: SearchResult[]): { grouped: Map<string, OrgGroup>; stats: GroupStats } {
  const grouped = new Map<string, OrgGroup>();
  const stats: GroupStats = {
    total: results.length,
    rejected: 0,
    rejectedAsArticleTitle: 0,
    rejectedAsGenericConcept: 0,
    rejectedAsVendorProduct: 0,
    rejectedAsPerson: 0,
    rejectedInvalidOrgName: 0,
    rejectionReasons: {},
    marketSignals: []
  };

  for (const result of results) {
    const classification = classifySearchResult(result);

    if (classification === "person_candidate") {
      const orgName = extractOrgFromPersonSnippet(result);
      if (orgName && isValidOrganizationName(orgName)) {
        const existing = grouped.get(orgName) ?? { results: [], persons: [] };
        existing.persons.push({ name: result.title, url: result.url, snippet: result.snippet });
        grouped.set(orgName, existing);
      } else {
        stats.rejected++;
        stats.rejectedAsPerson++;
        stats.rejectionReasons.person_candidate = (stats.rejectionReasons.person_candidate ?? 0) + 1;
      }
      continue;
    }

    if (classification === "article_or_list") {
      // Article titles become market signals — context for the run, not account names
      stats.rejected++;
      stats.rejectedAsArticleTitle++;
      stats.rejectionReasons.article_or_list = (stats.rejectionReasons.article_or_list ?? 0) + 1;
      if (result.title && result.snippet) {
        stats.marketSignals.push({
          title: result.title,
          url: result.url || undefined,
          snippet: result.snippet.slice(0, 200),
          reason: "article_or_list"
        });
      }
      continue;
    }

    if (classification === "vendor_or_product") {
      stats.rejected++;
      stats.rejectedAsVendorProduct++;
      stats.rejectionReasons.vendor_or_product = (stats.rejectionReasons.vendor_or_product ?? 0) + 1;
      continue;
    }

    if (classification !== "organization_candidate") {
      stats.rejected++;
      stats.rejectionReasons[classification] = (stats.rejectionReasons[classification] ?? 0) + 1;
      continue;
    }

    const companyName = identifyCompanyName(result);
    if (!isValidOrganizationName(companyName)) {
      stats.rejected++;
      stats.rejectedInvalidOrgName++;
      stats.rejectionReasons.reject = (stats.rejectionReasons.reject ?? 0) + 1;
      // If it looks like an article title, capture as market signal
      if (/:/.test(companyName) || /^(what|how|why|cyber|ransomware|healthcare\s+cyber)/i.test(companyName)) {
        stats.rejectedAsArticleTitle++;
        if (result.snippet) {
          stats.marketSignals.push({
            title: companyName,
            url: result.url || undefined,
            snippet: result.snippet.slice(0, 200),
            reason: "article_title_not_org"
          });
        }
      }
      continue;
    }

    const existing = grouped.get(companyName) ?? { results: [], persons: [] };
    existing.results.push(result);
    grouped.set(companyName, existing);
  }

  return { grouped, stats };
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
      verificationLevel: r.sourceType === "uploaded_kb" ? "kb" : (r.verificationLevel ?? (r.url ? "snippet_only" : "unverified")),
      retrievedAt: now()
    }));
}

// ─── Org-specific signal extraction ──────────────────────────────────────────

export function buildOrgSignals(orgName: string, results: SearchResult[], pageDetails: SourceDetail[]): OrgSignal[] {
  const signals: OrgSignal[] = [];
  const lower = orgName.toLowerCase();

  // Org type confirmation from name
  if (ORG_INDICATOR_RE.test(orgName)) {
    signals.push({
      label: "Organization type confirmed",
      detail: `${orgName} name contains healthcare/organization identifier — consistent with a target organization in this market.`,
      implication: "Organization type matches target market segment.",
      sourceType: "unknown",
      verification: "snippet_only"
    });
  }

  // Signals from enrichment search results
  for (const result of results.filter((r) => r.url.startsWith("http")).slice(0, 6)) {
    const text = (result.extractedContent ?? result.snippet).toLowerCase();
    const titleLower = result.title.toLowerCase();

    if (/ciso|chief information security|vp.*security|director.*security/i.test(text + titleLower)) {
      signals.push({
        label: "Security leadership signal",
        detail: result.snippet.slice(0, 200),
        implication: `Security leadership role exists at ${orgName} — may own SOC modernization and ${orgName.includes("health") ? "healthcare" : "enterprise"} security decisions.`,
        sourceTitle: result.title,
        sourceUrl: result.url,
        sourceType: classifySignalSourceType(result.url),
        verification: "snippet_only"
      });
    } else if (/ransomware|data breach|cyber attack|incident response|security operations/i.test(text + titleLower)) {
      signals.push({
        label: "Cybersecurity / ransomware signal",
        detail: result.snippet.slice(0, 200),
        implication: `${orgName} has documented cybersecurity challenges or security operations investments — relevant to SOC and incident response capabilities.`,
        sourceTitle: result.title,
        sourceUrl: result.url,
        sourceType: classifySignalSourceType(result.url),
        verification: "snippet_only"
      });
    } else if (/security|cyber|soc|compliance|risk|vulnerability|threat/i.test(text + titleLower)) {
      signals.push({
        label: "Security operations signal",
        detail: result.snippet.slice(0, 200),
        implication: `${orgName} has security-related activity or investment — indicates potential SOC presence or security program maturity.`,
        sourceTitle: result.title,
        sourceUrl: result.url,
        sourceType: classifySignalSourceType(result.url),
        verification: "snippet_only"
      });
    } else if (lower && result.url && result.url.toLowerCase().includes(lower.split(" ")[0].toLowerCase())) {
      signals.push({
        label: "Official source evidence",
        detail: result.snippet.slice(0, 200),
        implication: `Source appears to be from or about ${orgName} — confirms organization presence and public profile.`,
        sourceTitle: result.title,
        sourceUrl: result.url,
        sourceType: "company_site",
        verification: "snippet_only"
      });
    }
  }

  // Signals from fetched page details
  for (const page of pageDetails.filter((p) => p.verification !== "unavailable" && p.text)) {
    const text = (page.text ?? "").toLowerCase();
    if (/ciso|chief information security|vp.*security/i.test(text)) {
      signals.push({
        label: "Security leadership confirmed on page",
        detail: `Page at ${page.url} contains security leadership references.`,
        implication: `Named security leadership confirmed at ${orgName} from page content.`,
        sourceUrl: page.url,
        sourceTitle: page.title,
        sourceType: mapPageSourceType(page.sourceType),
        verification: mapPageVerification(page.verification)
      });
    } else if (/security|cyber|ransomware|soc/i.test(text)) {
      signals.push({
        label: "Security context in page content",
        detail: `Page content at ${page.url} references security, cybersecurity, or SOC topics.`,
        implication: "Security is a documented organizational concern.",
        sourceUrl: page.url,
        sourceTitle: page.title,
        sourceType: mapPageSourceType(page.sourceType),
        verification: mapPageVerification(page.verification)
      });
    }
  }

  // Fallback signal when no live evidence
  if (signals.length === 0 || (signals.length === 1 && signals[0].sourceType === "unknown")) {
    signals.push({
      label: "Sector-based signal",
      detail: `${orgName} selected based on sector relevance. No specific evidence retrieved during this run.`,
      implication: "Verify current security priorities with direct outreach or additional research before claiming fit.",
      sourceType: "fallback",
      verification: "unverified"
    });
  }

  // De-duplicate by label+detail prefix
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = `${s.label}:${s.detail.slice(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function classifySignalSourceType(url: string): OrgSignal["sourceType"] {
  const lower = url.toLowerCase();
  if (/news|press|release|blog/i.test(lower)) return "news";
  if (lower.includes("linkedin.com")) return "search_result"; // map "profile" to a valid OrgSignal sourceType
  return "search_result";
}

function mapPageSourceType(t: SourceDetail["sourceType"]): OrgSignal["sourceType"] {
  if (t === "profile") return "search_result";
  return t;
}

function mapPageVerification(v: SourceDetail["verification"]): OrgSignal["verification"] {
  if (v === "full_page_verified") return "verified";
  if (v === "unavailable") return "unverified";
  return v; // "snippet_only"
}

// ─── Org-specific confidence scoring ─────────────────────────────────────────

export function computeOrgConfidence(params: {
  orgName: string;
  signals: OrgSignal[];
  pageDetails: SourceDetail[];
  fromLiveSearch: boolean;
  persons: Array<{ name: string; url: string; snippet: string }>;
}): { score: number; label: AccountRecommendation["confidenceLabel"]; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  const { signals, pageDetails, fromLiveSearch, persons } = params;
  const publicSignals = signals.filter((s) => s.sourceUrl?.startsWith("http"));
  const hasLeadershipSignal = signals.some((s) => /leadership|CISO|CIO|security leader/i.test(s.label + s.detail));
  const hasCyberSignal = signals.some((s) => /cyber|ransomware|breach|SOC|security operations/i.test(s.label + s.detail));
  const hasOfficialSite = pageDetails.some((p) => p.verification === "full_page_verified");
  const hasSnippetEvidence = publicSignals.length > 0;
  const hasNamedPerson = persons.length > 0;

  if (fromLiveSearch) { score += 15; reasons.push("found via live search"); }
  if (ORG_INDICATOR_RE.test(params.orgName)) { score += 20; reasons.push("healthcare/org type confirmed from name"); }
  if (hasSnippetEvidence) { score += 15; reasons.push(`${publicSignals.length} snippet source(s)`); }
  if (hasCyberSignal) { score += 15; reasons.push("security/cyber/ransomware signal found"); }
  if (hasLeadershipSignal) { score += 10; reasons.push("leadership/CISO signal found"); }
  if (hasOfficialSite) { score += 10; reasons.push("full-page evidence available"); }
  if (hasNamedPerson) { score += 10; reasons.push("named contact publicly mentioned"); }
  if (!hasSnippetEvidence && !fromLiveSearch) { score -= 20; reasons.push("fallback-only, no verified sources"); }

  score = Math.max(0, Math.min(95, score));

  const label: AccountRecommendation["confidenceLabel"] =
    score >= 75 ? "high" :
    score >= 55 ? "medium" :
    score >= 35 ? "low" : "fallback";

  const reason = reasons.length > 0
    ? `${label.charAt(0).toUpperCase() + label.slice(1)} confidence for ${params.orgName}: ${reasons.join(", ")}.`
    : `Fallback confidence: no verified sources available for ${params.orgName}.`;

  return { score, label, reason };
}

// ─── Buyer map ────────────────────────────────────────────────────────────────

function makeBuyerTarget(roleTitle: string, department: string, whyThisRole: string): BuyerTarget {
  return { roleTitle, department, whyThisRole, contactStatus: "role_only" };
}

function buildBuyerMap(orgName: string, capabilityMap: CapabilityMap, persons: Array<{ name: string; url: string; snippet: string }>) {
  const economicBuyer = makeBuyerTarget(
    capabilityMap.buyerPersonas.economicBuyerTitles[0],
    "Executive / Security Leadership",
    `This role owns budget and risk tradeoffs for ${capabilityMap.product} at ${orgName}.`
  );
  const businessChampion = makeBuyerTarget(
    capabilityMap.buyerPersonas.championTitles[0],
    "Security Operations",
    `${orgName} needs a hands-on owner for ${capabilityMap.capabilities.slice(0, 2).join(" and ")} — this role drives SOC outcomes.`
  );
  const technicalInfluencers = capabilityMap.buyerPersonas.influencerTitles.slice(0, 2).map((title) =>
    makeBuyerTarget(title, "IT / Security Architecture", `Validates telemetry integration depth and detection logic for ${capabilityMap.capabilities[0]}.`)
  );

  // Attach publicly mentioned person if available
  for (const person of persons.slice(0, 1)) {
    if (person.name.split(/\s+/).length >= 2 && person.name.split(/\s+/).length <= 4) {
      technicalInfluencers[0] = {
        ...technicalInfluencers[0],
        namedPerson: { name: person.name, title: "Security leadership (public mention)", sourceUrl: person.url },
        contactStatus: "named_public_profile"
      };
    }
  }

  return { economicBuyer, businessChampion, technicalInfluencers };
}

// ─── OpenAI synthesis ─────────────────────────────────────────────────────────

function deterministicOrgFit(
  orgName: string,
  signals: OrgSignal[],
  capabilityMap: CapabilityMap,
  input: ResearchInput
): { fitReason: string; ciscoFitSummary: string; nextStep: string } {
  const hasCyberSignal = signals.some((s) => /cyber|ransomware|breach|SOC/i.test(s.detail));
  const hasLeadershipSignal = signals.some((s) => /CISO|CIO|security leader/i.test(s.detail));
  const evidenceNote = signals.filter((s) => s.sourceUrl?.startsWith("http")).length > 0
    ? "based on search evidence"
    : "selected as a representative fallback candidate";

  return {
    fitReason: `${orgName} is a ${input.targetMarket} organization ${evidenceNote}. ${hasCyberSignal ? "Security operations and ransomware/breach signals indicate SOC modernization needs." : "Security operations complexity and compliance pressure are common in this sector."}`,
    ciscoFitSummary: `${capabilityMap.product} correlates telemetry across endpoint, network, email, and cloud to prioritize threats and accelerate incident response${hasLeadershipSignal ? " — security leadership presence suggests organizational readiness to evaluate SOC platforms" : ""}.`,
    nextStep: `Validate ${orgName}'s current security leadership and recent cyber events before outreach. Lead with ${capabilityMap.product} for ${capabilityMap.painCategories[0]} and ${capabilityMap.painCategories[1]}.`
  };
}


export async function synthesizeOrgFit(
  orgName: string,
  signals: OrgSignal[],
  capabilityMap: CapabilityMap,
  input: ResearchInput,
  debugStats: RunDebugStats,
  contactCandidates?: ContactCandidate[]
): Promise<{ fitReason: string; ciscoFitSummary: string; nextStep: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return deterministicOrgFit(orgName, signals, capabilityMap, input);

  const liveSignals = signals.filter((s) => s.sourceUrl?.startsWith("http") && s.verification !== "unverified");
  if (liveSignals.length === 0) return deterministicOrgFit(orgName, signals, capabilityMap, input);

  const signalText = liveSignals
    .slice(0, 5)
    .map((s) => `- ${s.label}: ${s.detail.slice(0, 200)}${s.sourceTitle ? ` (Source: ${s.sourceTitle})` : ""}`)
    .join("\n");

  const contactNote =
    contactCandidates && contactCandidates.length > 0
      ? `\nPublic contacts found: ${contactCandidates.map((c) => `${c.name}, ${c.title ?? "unknown title"}`).join("; ")}`
      : "";

  const prompt = `You are a Cisco security field analyst. Based ONLY on the evidence below, write source-grounded account intelligence for ${orgName} targeting ${capabilityMap.product}.

Evidence:
${signalText}${contactNote}

Return a JSON object:
{
  "fitReason": "1-2 sentences: why ${orgName} fits ${capabilityMap.product}, referencing evidence",
  "ciscoFitSummary": "1-2 sentences: which specific capabilities match the signals",
  "nextStep": "1 org-specific action for the seller mentioning ${orgName}"
}

Rules: Be specific to ${orgName}. Only reference evidence provided above. Do not invent facts or contacts. If evidence is thin, say so explicitly.`;

  try {
    const client = new OpenAI({ apiKey, timeout: 15000, maxRetries: 0 });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.2
    });
    debugStats.openAiSynthesisUsed = true;
    const text = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { fitReason?: string; ciscoFitSummary?: string; nextStep?: string };
    if (parsed.fitReason && parsed.ciscoFitSummary && parsed.nextStep) {
      return {
        fitReason: parsed.fitReason,
        ciscoFitSummary: parsed.ciscoFitSummary,
        nextStep: parsed.nextStep
      };
    }
    return deterministicOrgFit(orgName, signals, capabilityMap, input);
  } catch (error) {
    console.warn("OpenAI synthesis failed (non-fatal):", sanitizeProviderError(error));
    return deterministicOrgFit(orgName, signals, capabilityMap, input);
  }
}

/**
 * Use OpenAI to assign A/B/C priority and re-order accounts by opportunity strength.
 * Hard validation (org name validity) cannot be overridden.
 */
export async function reRankAccounts(
  accounts: AccountRecommendation[],
  capabilityMap: CapabilityMap,
  input: ResearchInput,
  debugStats: RunDebugStats
): Promise<AccountRecommendation[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || accounts.length === 0) {
    return accounts.map((a) => ({ ...a, priority: "C" as PriorityLevel, priorityReason: "Priority not assessed — OPENAI_API_KEY not configured." }));
  }

  const summaries = accounts.map((a) => ({
    name: a.companyName,
    signals: a.signals.filter((s) => s.verification !== "unverified").map((s) => `${s.label}: ${s.detail.slice(0, 100)}`).join("; "),
    evidenceCount: a.evidence.filter((e) => e.url.startsWith("http")).length,
    hasNamedContact: a.contactCandidates.length > 0,
    confidenceScore: a.confidenceScore,
    verificationStatus: a.verificationStatus
  }));

  const prompt = `You are prioritizing ${input.targetMarket} accounts for Cisco ${capabilityMap.product} opportunity.

Accounts:
${JSON.stringify(summaries, null, 2)}

Cisco ${capabilityMap.product} capabilities: ${capabilityMap.capabilities.slice(0, 5).join(", ")}
Target market: ${input.targetMarket}
Geography: ${input.geography || "North America"}

Assign each account a priority:
- A = strong signals, named contact, recent evidence, clear fit
- B = moderate signals, role-level contact, some evidence
- C = weak signals, fallback only, no evidence

Return JSON array with one entry per account:
{"rankings": [{"name": "...", "priority": "A", "rankReason": "...", "scoreAdjustment": 5}]}

scoreAdjustment: -10 to +10 modification. Be org-specific in rankReason.`;

  try {
    const client = new OpenAI({ apiKey, timeout: 20000, maxRetries: 0 });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 800,
      temperature: 0.2
    });
    debugStats.openAiRerankingRan = true;
    const text = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as {
      rankings?: Array<{ name: string; priority: string; rankReason: string; scoreAdjustment: number }>;
    };
    const rankings = parsed.rankings ?? [];

    const ranked = accounts.map((account) => {
      const r = rankings.find((x) => x.name?.toLowerCase() === account.companyName.toLowerCase());
      const priority = (["A", "B", "C"].includes(r?.priority ?? "") ? r!.priority : "C") as PriorityLevel;
      const priorityReason = r?.rankReason ?? "Priority not assigned for this account.";
      const adjustment = Math.max(-10, Math.min(10, r?.scoreAdjustment ?? 0));
      return {
        ...account,
        priority,
        priorityReason,
        confidenceScore: Math.max(0, Math.min(95, account.confidenceScore + adjustment))
      };
    });

    // Sort: A > B > C, then by confidenceScore
    const order: Record<string, number> = { A: 0, B: 1, C: 2 };
    return ranked.sort((a, b) => {
      const diff = (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
      return diff !== 0 ? diff : b.confidenceScore - a.confidenceScore;
    });
  } catch (error) {
    console.warn("OpenAI reranking failed (non-fatal):", sanitizeProviderError(error));
    return accounts.map((a) => ({ ...a, priority: "C" as PriorityLevel, priorityReason: "Reranking failed; default priority assigned." }));
  }
}

// ─── Per-org enrichment ───────────────────────────────────────────────────────

type OrgEnrichmentResult = {
  orgName: string;
  fromLiveSearch: boolean;
  enrichmentResults: SearchResult[];
  pageDetails: SourceDetail[];
  persons: Array<{ name: string; url: string; snippet: string }>;
  contactCandidates: ContactCandidate[];
};

async function enrichOneOrganization(
  orgName: string,
  existingResults: SearchResult[],
  existingPersons: Array<{ name: string; url: string; snippet: string }>,
  fromLiveSearch: boolean,
  provider: SearchProviderClient | null,
  debugStats: RunDebugStats
): Promise<OrgEnrichmentResult> {
  let enrichmentResults = [...existingResults];
  const persons = [...existingPersons];
  const linkedInResults: SearchResult[] = [];

  if (provider) {
    // Phase 1: org-specific enrichment (cybersecurity/breach/SOC signals)
    const enrichQueries = buildEnrichmentQueries(orgName);
    for (const query of enrichQueries) {
      try {
        const results = await provider.search({ query, maxResults: 5 });
        enrichmentResults.push(...results);
        debugStats.enrichmentQueriesRun++;
        for (const r of results) {
          if (classifySearchResult(r) === "person_candidate") {
            const orgMatch = extractOrgFromPersonSnippet(r);
            if (orgMatch?.toLowerCase().includes(orgName.split(" ")[0].toLowerCase())) {
              persons.push({ name: r.title, url: r.url, snippet: r.snippet });
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch {
        // Non-fatal
      }
    }

    // Phase 2: LinkedIn/public profile buyer search (public search snippets only)
    const liQueries = buildLinkedInBuyerQueries(orgName);
    for (const query of liQueries.slice(0, 3)) {
      try {
        const results = await provider.search({ query, maxResults: 5 });
        linkedInResults.push(...results);
        debugStats.enrichmentQueriesRun++;
        debugStats.linkedInQueriesRun++;
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch {
        // Non-fatal
      }
    }
  }

  // Extract public contact candidates from LinkedIn results
  const contactCandidates = extractContactCandidates(linkedInResults, orgName);
  debugStats.contactCandidatesFound = (debugStats.contactCandidatesFound ?? 0) + contactCandidates.length;

  // Deduplicate results by URL
  const seen = new Set<string>();
  enrichmentResults = enrichmentResults.filter((r) => {
    if (!r.url || seen.has(r.url)) return r.url === "";
    seen.add(r.url);
    return true;
  });

  // Fetch top 1 page (best-effort, non-fatal)
  const pageDetails: SourceDetail[] = [];
  const topUrl = enrichmentResults.find((r) => r.url.startsWith("http"))?.url;
  if (topUrl) {
    debugStats.pageFetchAttempts++;
    const detail = await fetchSourceDetail(topUrl);
    pageDetails.push(detail);
  }

  return { orgName, fromLiveSearch, enrichmentResults, pageDetails, persons, contactCandidates };
}

// ─── Main research runner ─────────────────────────────────────────────────────

export async function runResearch(input: ResearchInput, files: File[] = []): Promise<ResearchRun> {
  const runId = randomUUID();
  const createdAt = now();
  const warnings: string[] = [];
  const providerStatus = getProviderDiagnostics();
  const embeddingRuntime: EmbeddingRuntime = { attemptedOpenAi: false, usedFallback: false, errors: [] };
  const debugStats: RunDebugStats = {
    selectedAccountBase: "market_default",
    selectedOrganizationNames: [],
    discoveryQueriesRun: 0,
    broadSearchResultsForContext: 0,
    enrichmentQueriesRun: 0,
    rawResultCount: 0,
    rejectedAsArticleTitle: 0,
    rejectedAsGenericConcept: 0,
    rejectedAsVendorProduct: 0,
    rejectedAsPerson: 0,
    rejectedInvalidOrgName: 0,
    rejectedCount: 0,
    rejectionReasons: {},
    extractedOrgMentions: 0,
    verifiedOrganizations: 0,
    validOrgCount: 0,
    fallbackOrganizationsAdded: 0,
    pageFetchAttempts: 0,
    accountSignalsAttached: 0,
    marketSignalsOnly: 0,
    finalGuardReplacements: 0,
    openAiSynthesisUsed: false,
    openAiEntityExtractionRan: false,
    openAiRerankingRan: false,
    linkedInQueriesRun: 0,
    contactCandidatesFound: 0,
    dynamicOrgsDiscovered: 0
  };

  if (!providerStatus.liveSearchAvailable) {
    warnings.push("SEARCH_API_KEY is not configured; results are limited to seed accounts and marked unverified.");
  }
  if (!providerStatus.contactEnrichmentAvailable) {
    warnings.push("No licensed contact enrichment key configured; contacts degrade to role/persona-level recommendations.");
  }
  if (providerStatus.fallbackModeActive) {
    warnings.push("Unverified fallback run: add required provider keys and use Rerun with configured APIs for live evidence.");
  }

  const { documents, chunks } = await ingestKnowledgeBase(runId, files, embeddingRuntime);
  const capabilityMap = await productCapabilityMapper(input, chunks, embeddingRuntime);
  const searchProvider = createSearchProviderClient();
  const kbInfluenceBase = await retrieveKbContext(`${input.ciscoProduct} ${input.targetMarket}`, chunks, 5, embeddingRuntime);
  const kbInfluenceMapped = kbInfluenceBase.slice(0, 3).map((chunk) => ({
    documentName: chunk.documentName,
    chunkIndex: chunk.chunkIndex,
    snippet: chunk.content.slice(0, 240)
  }));

  // ─ Stage 1: Select organizations with dynamic discovery ───────────────────
  // Seeds win. If no seeds, try dynamic discovery from live search, then fallback.
  const { orgs: selectedOrgs, base: selectedAccountBase } = await selectOrganizationsWithDiscovery(
    input,
    searchProvider,
    debugStats
  );
  debugStats.selectedAccountBase = selectedAccountBase;
  debugStats.selectedOrganizationNames = [...selectedOrgs];
  debugStats.validOrgCount = selectedOrgs.length;
  debugStats.fallbackOrganizationsAdded = selectedAccountBase !== "seed_accounts" ? selectedOrgs.length : 0;

  // ─ Stage 2: Broad discovery for MARKET CONTEXT only ───────────────────────
  // These results become marketSignals. They must NOT create account names.
  const discoveryQueries = buildDiscoveryQueries(input);
  debugStats.discoveryQueriesRun = discoveryQueries.length;
  const allBroadResults: SearchResult[] = [];
  let searchFellBack = false;

  if (searchProvider) {
    for (const query of discoveryQueries) {
      try {
        const results = await searchProvider.search({ query, maxResults: 8 });
        allBroadResults.push(...results);
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (error) {
        if (error instanceof Error && (error.message.includes("HTTP 4") || error.message.includes("rate_limited"))) {
          searchFellBack = true;
          warnings.push(`Live search unavailable (${error.message}); proceeding with selected organizations only. Check SEARCH_API_KEY and SEARCH_PROVIDER.`);
          break;
        }
      }
    }
  } else {
    searchFellBack = !providerStatus.liveSearchAvailable;
  }

  // All broad results are market context — run classification for debug stats
  debugStats.broadSearchResultsForContext = allBroadResults.length;
  const { stats: broadStats } = groupSearchResultsWithStats(allBroadResults);
  debugStats.rawResultCount = broadStats.total;
  debugStats.rejectedCount = broadStats.rejected;
  debugStats.rejectedAsArticleTitle = broadStats.rejectedAsArticleTitle;
  debugStats.rejectedAsVendorProduct = broadStats.rejectedAsVendorProduct;
  debugStats.rejectedAsPerson = broadStats.rejectedAsPerson;
  debugStats.rejectedInvalidOrgName = broadStats.rejectedInvalidOrgName;
  debugStats.rejectionReasons = broadStats.rejectionReasons;
  // All broad results go to market signals, regardless of classification
  const runMarketSignals: import("@/lib/types").MarketSignal[] = allBroadResults
    .filter((r) => r.title && r.snippet)
    .map((r) => ({
      title: r.title,
      url: r.url || undefined,
      snippet: r.snippet.slice(0, 200),
      reason: "broad_market_context"
    }));
  debugStats.marketSignalsOnly = runMarketSignals.length;

  // ─ Stage 3: Per-org enrichment for every selected org ─────────────────────
  const enrichmentJobs: Array<Promise<OrgEnrichmentResult>> = [];
  for (const orgName of selectedOrgs) {
    enrichmentJobs.push(
      enrichOneOrganization(orgName, [], [], selectedAccountBase === "seed_accounts", searchProvider, debugStats)
    );
  }

  // Run enrichment in parallel
  const enriched = await Promise.all(enrichmentJobs);

  // ─ Stage 4: Build accounts ────────────────────────────────────────────────
  const accounts: AccountRecommendation[] = [];

  for (const org of enriched) {
    const { orgName, fromLiveSearch, enrichmentResults, pageDetails, persons } = org;

    // Only attach evidence that actually mentions this organization
    const { orgSpecific, marketContext } = filterEvidenceForOrg(enrichmentResults, orgName);
    // Spill non-org evidence into run-level market signals
    for (const r of marketContext) {
      if (r.title && r.snippet) {
        runMarketSignals.push({ title: r.title, url: r.url || undefined, snippet: r.snippet.slice(0, 200), reason: `enrichment_spillover_from_${orgName}` });
      }
    }

    const evidence = collectEvidence(orgSpecific);
    // Sort evidence by source quality (highest quality first)
    evidence.sort(
      (a, b) =>
        computeSourceQualityScore({ title: b.title, url: b.url, snippet: b.snippet }, orgName) -
        computeSourceQualityScore({ title: a.title, url: a.url, snippet: a.snippet }, orgName)
    );

    const signals = buildOrgSignals(orgName, orgSpecific, pageDetails);
    debugStats.accountSignalsAttached += signals.filter((s) => s.verification !== "unverified").length;
    const confidence = computeOrgConfidence({ orgName, signals, pageDetails, fromLiveSearch, persons });

    // Merge person contacts with LinkedIn contact candidates
    const allPersons = [...persons];
    for (const cc of org.contactCandidates) {
      if (!allPersons.some((p) => p.name.toLowerCase() === cc.name.toLowerCase())) {
        allPersons.push({ name: cc.name, url: cc.sourceUrl, snippet: cc.snippet ?? "" });
      }
    }
    const { economicBuyer, businessChampion, technicalInfluencers } = buildBuyerMap(orgName, capabilityMap, allPersons);

    // Upgrade buyer targets with contact candidate data where available
    const ecBuyerCandidate = org.contactCandidates.find((c) => c.roleCategory === "economic_buyer");
    const champCandidate = org.contactCandidates.find((c) => c.roleCategory === "business_champion");
    const infCandidate = org.contactCandidates.find((c) => c.roleCategory === "technical_influencer");
    if (ecBuyerCandidate) {
      economicBuyer.namedPerson = { name: ecBuyerCandidate.name, title: ecBuyerCandidate.title, sourceUrl: ecBuyerCandidate.sourceUrl };
      economicBuyer.contactStatus = "named_public_profile";
    }
    if (champCandidate) {
      businessChampion.namedPerson = { name: champCandidate.name, title: champCandidate.title, sourceUrl: champCandidate.sourceUrl };
      businessChampion.contactStatus = "named_public_profile";
    }
    if (infCandidate && technicalInfluencers[0]) {
      technicalInfluencers[0].namedPerson = { name: infCandidate.name, title: infCandidate.title, sourceUrl: infCandidate.sourceUrl };
      technicalInfluencers[0].contactStatus = "named_public_profile";
    }

    // ─ Stage 4a: OpenAI synthesis per org ──────────────────────────────────
    const synthesis = await synthesizeOrgFit(orgName, signals, capabilityMap, input, debugStats, org.contactCandidates);

    const website = enrichmentResults.find((r) => r.url.startsWith("http") && extractDomain(r.url).includes(orgName.split(" ")[0].toLowerCase()))
      ? (() => { try { return new URL(enrichmentResults.find((r) => r.url.startsWith("http") && extractDomain(r.url).includes(orgName.split(" ")[0].toLowerCase()))!.url).origin; } catch { return null; } })()
      : null;

    const hasOrgSpecificEvidence = evidence.some((e) => e.url.startsWith("http"));
    const accountStatus: AccountRecommendation["verificationStatus"] =
      selectedAccountBase === "seed_accounts" && hasOrgSpecificEvidence
        ? "candidate_unverified"
        : hasOrgSpecificEvidence
          ? "candidate_unverified"
          : "fallback_unverified";

    const missingDataFlags = [
      ...(selectedAccountBase !== "seed_accounts"
        ? [`${orgName} was selected as a ${input.targetMarket} target (${selectedAccountBase === "healthcare_default" ? "approved healthcare target list" : "market default list"}).`]
        : []),
      ...(!hasOrgSpecificEvidence
        ? [`No organization-specific source verified for ${orgName} in this run. Market-level healthcare signals applied.`]
        : []),
      ...(providerStatus.fallbackModeActive ? ["Unverified fallback run: required provider key(s) missing."] : [])
    ];

    accounts.push({
      id: randomUUID(),
      companyName: orgName,
      website,
      verificationStatus: accountStatus,
      fitReason: synthesis.fitReason,
      marketFit: `${orgName} appears in the ${input.targetMarket} market${input.geography ? ` for ${input.geography}` : ""}. Confirm qualification from cited source URLs before outreach.`,
      signals,
      painPoints: [
        "Alert volume and triage burden across security tools requiring cross-telemetry correlation.",
        "Ransomware readiness and healthcare data protection obligations.",
        "Incident response speed and SOC analyst efficiency.",
        "Compliance pressure and operational resilience requirements."
      ],
      ciscoCapabilityMatch: capabilityMap.capabilities.slice(0, 4),
      ciscoFitSummary: synthesis.ciscoFitSummary,
      economicBuyer,
      businessChampion,
      technicalInfluencers,
      evidence,
      kbInfluence: kbInfluenceMapped,
      scores: {
        fit: confidence.score,
        painEvidence: signals.filter((s) => /cyber|ransomware|breach|SOC/i.test(s.detail)).length * 15,
        buyerIdentification: persons.length > 0 ? 70 : 25,
        contactVerification: persons.length > 0 ? 60 : 0,
        overall: confidence.score
      },
      confidenceScore: confidence.score,
      confidenceLabel: confidence.label,
      priority: "C", // Will be set by reRankAccounts
      priorityReason: "",
      contactCandidates: org.contactCandidates,
      nextStep: synthesis.nextStep,
      missingDataFlags
    });
  }

  // Sort by confidence before reranking
  accounts.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // ─ Stage 4b: OpenAI reranking ─────────────────────────────────────────────
  const rerankedAccounts = await reRankAccounts(accounts, capabilityMap, input, debugStats);
  accounts.length = 0;
  accounts.push(...rerankedAccounts);

  // ─ Stage 5: Final guard ────────────────────────────────────────────────────
  // Remove any account whose name is not in the selected org list (safety net).
  const { accounts: sanitized, replacements } = sanitizeFinalAccounts(
    accounts,
    selectedOrgs,
    capabilityMap,
    input
  );
  accounts.length = 0;
  accounts.push(...sanitized);
  debugStats.finalGuardReplacements = replacements;
  if (replacements > 0) {
    warnings.push(
      `Final guard removed ${replacements} result${replacements !== 1 ? "s" : ""} that did not match selected organizations and replaced with approved targets.`
    );
  }

  if (accounts.length === 0) {
    warnings.push("No target accounts produced. Add seed accounts or configure a valid search provider.");
  }
  if (embeddingRuntime.attemptedOpenAi && embeddingRuntime.usedFallback) {
    warnings.push("OpenAI embeddings failed. Check network access and key validity.");
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
    isVerified: !usedFallbackRun && accounts.every((a) => a.evidence.some((e) => e.url.startsWith("http"))),
    isFallback: usedFallbackRun,
    warnings,
    accounts,
    kbDocuments: documents,
    kbChunks: chunks,
    createdAt,
    updatedAt: now(),
    debugStats,
    marketSignals: runMarketSignals
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function exportRun(run: ResearchRun, format: "json" | "csv" | "md") {
  if (format === "json") return JSON.stringify(run, null, 2);

  if (format === "csv") {
    const header = [
      "company", "website", "verification_status", "confidence", "confidence_label",
      "fallback_run", "fit_reason", "cisco_fit_summary", "capability_match",
      "economic_buyer_title", "champion_title",
      "evidence_urls", "evidence_verification", "missing_data_flags", "next_step"
    ];
    const rows = run.accounts.map((a) =>
      [
        a.companyName, a.website ?? "", a.verificationStatus,
        a.confidenceScore, a.confidenceLabel, run.isFallback,
        a.fitReason, a.ciscoFitSummary, a.ciscoCapabilityMatch.join(" | "),
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
    ``, `Product: ${run.input.ciscoProduct}`, `Market: ${run.input.targetMarket}`,
    `Run status: ${run.isFallback ? "Fallback run" : run.isVerified ? "Verified live-provider run" : "Live run (low confidence)"}`,
    `Provider: ${run.providerStatus.summary}`, ``,
    ...run.accounts.flatMap((a) => [
      `## ${a.companyName} (Confidence ${a.confidenceScore} — ${a.confidenceLabel})`,
      `Status: ${a.verificationStatus}`, `Website: ${a.website ?? "Not verified"}`, ``,
      `**Why this organization:** ${a.fitReason}`, ``,
      `**Cisco fit:** ${a.ciscoFitSummary}`,
      a.ciscoCapabilityMatch.map((c) => `- ${c}`).join("\n"), ``,
      `**Economic buyer:** ${a.economicBuyer.roleTitle}`,
      `**Business champion:** ${a.businessChampion.roleTitle}`,
      `**Technical influencer:** ${a.technicalInfluencers[0]?.roleTitle ?? "TBD"}`, ``,
      `**Next step:** ${a.nextStep}`,
      `**Evidence:** ${a.evidence.filter((e) => e.url.startsWith("http")).map((e) => `${e.title} ${e.url}`).join("; ") || "None verified"}`, ``
    ])
  ].join("\n");
}
