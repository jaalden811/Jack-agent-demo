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
  ResearchInput,
  ResearchRun,
  SearchResult
} from "@/lib/types";

const now = () => new Date().toISOString();

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
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }

  throw new Error(`${options.label} failed after ${retries + 1} attempts: ${(lastError as Error).message}`);
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
  const config = getConfig();
  if (!config.OPENAI_API_KEY) {
    return deterministicEmbedding(text);
  }

  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const response = await withRetry(
    () =>
      client.embeddings.create({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000)
      }),
    { label: "OpenAI embedding" }
  );
  return response.data[0]?.embedding ?? deterministicEmbedding(text);
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

export async function ingestKnowledgeBase(runId: string, files: File[]) {
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
        embedding: await embedText(textChunks[chunkIndex]),
        metadata: { sourceType: "uploaded_kb" }
      });
    }
  }

  return { documents, chunks };
}

export async function retrieveKbContext(query: string, chunks: KbChunk[], limit = 5) {
  const queryEmbedding = await embedText(query);
  return chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}

export async function productCapabilityMapper(
  input: ResearchInput,
  kbChunks: KbChunk[]
): Promise<CapabilityMap> {
  const query = `${input.ciscoProduct} ${input.targetMarket} cybersecurity networking observability buyer pain`;
  const relevantChunks = await retrieveKbContext(query, kbChunks, 4);
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

export async function searchMarketAccounts(input: ResearchInput, capabilityMap: CapabilityMap) {
  const config = getConfig();
  if (!config.SEARCH_API_KEY) {
    return input.seedAccounts.map<SearchResult>((name) => ({
      title: name,
      url: "",
      snippet: "Seed account supplied by user. Public evidence search was not run because SEARCH_API_KEY is not configured.",
      sourceType: "search_result"
    }));
  }

  const query = [
    input.targetMarket,
    input.geography,
    capabilityMap.painCategories.slice(0, 3).join(" OR "),
    "company press release job posting annual report"
  ]
    .filter(Boolean)
    .join(" ");

  if (config.SEARCH_PROVIDER === "brave") {
    type BraveResponse = { web?: { results?: Array<{ title: string; url: string; description?: string; age?: string }> } };
    const data = await withRetry(
      () =>
        fetchJsonWithTimeout<BraveResponse>(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${input.maxResults * 3}`,
          { headers: { Accept: "application/json", "X-Subscription-Token": config.SEARCH_API_KEY! } }
        ),
      { label: "Brave search" }
    );
    return (data.web?.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description ?? "",
      publishedDate: item.age,
      sourceType: classifySource(item.url, item.title)
    }));
  }

  type TavilyResponse = { results?: Array<{ title: string; url: string; content?: string; published_date?: string }> };
  const data = await withRetry(
    () =>
      fetchJsonWithTimeout<TavilyResponse>("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: config.SEARCH_API_KEY,
          query,
          max_results: input.maxResults * 3,
          search_depth: "advanced",
          include_answer: false
        })
      }),
    { label: `${config.SEARCH_PROVIDER} search` }
  );
  return (data.results ?? []).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content ?? "",
    publishedDate: item.published_date,
    sourceType: classifySource(item.url, item.title)
  }));
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
      snippet: result.snippet.slice(0, 500),
      sourceType: result.sourceType ?? "search_result",
      retrievedAt: now()
    }));
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
    return contact;
  }

  return {
    ...contact,
    missingDataFlags: [
      ...contact.missingDataFlags,
      "Licensed contact enrichment is configured, but this implementation only accepts provider responses with explicit verification evidence."
    ]
  };
}

export function confidenceScorer(params: {
  evidence: Citation[];
  kbInfluenceCount: number;
  hasVerifiedContact: boolean;
}) {
  const publicEvidence = params.evidence.filter((item) => item.url.startsWith("http"));
  const fit = Math.min(100, 45 + params.kbInfluenceCount * 8 + publicEvidence.length * 4);
  const painEvidence = Math.min(100, publicEvidence.length * 12);
  const buyerIdentification = publicEvidence.length > 0 ? 55 : 25;
  const contactVerification = params.hasVerifiedContact ? 100 : 0;
  const overall = Math.round(fit * 0.35 + painEvidence * 0.3 + buyerIdentification * 0.2 + contactVerification * 0.15);

  return { fit, painEvidence, buyerIdentification, contactVerification, overall };
}

export function generateReport(
  input: ResearchInput,
  capabilityMap: CapabilityMap,
  groupedResults: Map<string, SearchResult[]>,
  kbChunks: KbChunk[]
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
      "Business email unavailable unless a licensed source verifies it.",
      "Named people are not invented; role/persona recommendations are used when person evidence is missing."
    ];

    accounts.push({
      id: randomUUID(),
      companyName,
      fitReason: `${companyName} matches ${input.targetMarket} signals relevant to ${capabilityMap.product}: ${capabilityMap.capabilities.slice(0, 3).join(", ")}.`,
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
  const config = getConfig();

  if (!config.SEARCH_API_KEY) {
    warnings.push("SEARCH_API_KEY is not configured; results are limited to seed accounts and marked unverified.");
  }
  if (!config.OPENAI_API_KEY) {
    warnings.push("OPENAI_API_KEY is not configured; deterministic local embeddings are used for development.");
  }
  if (!config.FIRECRAWL_API_KEY) {
    warnings.push("FIRECRAWL_API_KEY is not configured; evidence uses public search result metadata/snippets only.");
  }
  if (!config.hasContactEnrichment) {
    warnings.push("No licensed contact enrichment key configured; contacts degrade to role/persona-level recommendations.");
  }

  const { documents, chunks } = await ingestKnowledgeBase(runId, files);
  const capabilityMap = await productCapabilityMapper(input, chunks);
  const searchResults = await searchMarketAccounts(input, capabilityMap);
  const grouped = groupSearchResults(searchResults);
  const relevantKb = await retrieveKbContext(`${input.ciscoProduct} ${input.targetMarket}`, chunks, 5);
  const accounts = generateReport(input, capabilityMap, grouped, relevantKb);

  for (const account of accounts) {
    account.champion = await contactEnricher(account.champion);
    account.economicBuyer = await contactEnricher(account.economicBuyer);
    account.otherInfluencers = await Promise.all(account.otherInfluencers.map(contactEnricher));
  }

  if (accounts.length === 0) {
    warnings.push("No source-backed accounts were found. Add seed accounts or configure a supported search provider.");
  }

  return {
    id: runId,
    input,
    status: "completed",
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
      "confidence",
      "fit_reason",
      "champion_title",
      "economic_buyer_title",
      "verified_email",
      "evidence_urls",
      "missing_data_flags",
      "outreach_angle"
    ];
    const rows = run.accounts.map((account) =>
      [
        account.companyName,
        account.confidenceScore,
        account.fitReason,
        account.champion.title,
        account.economicBuyer.title,
        account.champion.businessEmail ?? "",
        account.evidence.map((item) => item.url).join(" | "),
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
    ``,
    ...run.accounts.flatMap((account) => [
      `## ${account.companyName} (${account.confidenceScore})`,
      account.fitReason,
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
