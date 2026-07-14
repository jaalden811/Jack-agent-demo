import { getConfig } from "@/lib/config";
import { getCatalog } from "@/lib/signal-agent/loadCatalog";
import { readRecentAuditRecords, AUDIT_LOG_RELATIVE_PATH } from "@/lib/signal-agent/auditLog";
import { checkOpenAiAuthentication, checkOpenAiEmbeddings, checkOpenAiSynthesis } from "@/lib/signal-agent/openaiStatus";
import { deriveOpenAiProviderState, type OpenAiSafeClassification } from "@/lib/openai/errorNormalizer";
import type { OpenAiCapabilityStatus, OpenAiStatus, ProviderStatusEntry, SignalAgentStatus } from "@/lib/signal-agent/types";

/**
 * Server-side operational status for the Signal-to-Solution Triage app.
 * Reuses @/lib/config's getConfig() — the same helper the existing
 * /api/providers/diagnostics route uses — as the single source of truth
 * for what is configured, so this route can never diverge from the
 * homepage's provider diagnostics about what OPENAI_API_KEY/SEARCH_API_KEY
 * actually contain.
 *
 * "configured" = the environment variable is present.
 * "usable" = a live, short-timeout probe against the actual provider
 * succeeded just now. If configured but not usable, `message` states the
 * specific reason (never just "fallback").
 */

const NOT_CHECKED: OpenAiCapabilityStatus = { usable: false, message: "not checked", error: null, last_check: null };

async function buildOpenAiStatus(options: { useOpenAI?: boolean }): Promise<OpenAiStatus> {
  const config = getConfig();
  const base: OpenAiStatus = {
    configured: Boolean(config.OPENAI_API_KEY),
    embedding_model: config.OPENAI_EMBEDDING_MODEL,
    synthesis_model: config.OPENAI_SYNTHESIS_MODEL,
    authentication: NOT_CHECKED,
    embeddings: NOT_CHECKED,
    synthesis: NOT_CHECKED,
    provider_state: deriveOpenAiProviderState({ configured: Boolean(config.OPENAI_API_KEY), authenticationOk: false, authenticationClassification: null, operationalOk: false, worstClassification: null })
  };

  if (!config.OPENAI_API_KEY) {
    const notConfigured: OpenAiCapabilityStatus = { usable: false, message: "no configured key", error: null, last_check: new Date().toISOString() };
    return { ...base, authentication: notConfigured, embeddings: notConfigured, synthesis: notConfigured };
  }

  if (options.useOpenAI === false) {
    const disabled: OpenAiCapabilityStatus = { usable: false, message: "disabled by user", error: null, last_check: new Date().toISOString() };
    return { ...base, authentication: disabled, embeddings: disabled, synthesis: disabled };
  }

  // Each capability is checked with its own API call so one failing
  // (e.g. an embedding-only key rejected for synthesis) never masks or
  // is masked by the other.
  const [authentication, embeddings, synthesis] = await Promise.all([
    checkOpenAiAuthentication(config.OPENAI_API_KEY),
    checkOpenAiEmbeddings(config.OPENAI_API_KEY, config.OPENAI_EMBEDDING_MODEL),
    checkOpenAiSynthesis(config.OPENAI_API_KEY, config.OPENAI_SYNTHESIS_MODEL)
  ]);

  // `diagnostic` carries the full Section-8 structured shape
  // (http_status/error_type/error_code/request_id/retryable/safe_message)
  // — everything else on these objects stays backward-compatible.
  const authClassification = (authentication.diagnostic?.safe_classification as OpenAiSafeClassification | undefined) ?? null;
  // "Operational" for the product's purposes means synthesis works
  // (the capability that generates messages); embeddings enhances
  // retrieval but is not required for a useful result.
  const operationalOk = synthesis.usable;
  const failing = [authentication.diagnostic, embeddings.diagnostic, synthesis.diagnostic].filter((d) => d && !d.operational && d.safe_classification);
  const worstClassification = (failing[0]?.safe_classification as OpenAiSafeClassification | undefined) ?? null;
  const provider_state = deriveOpenAiProviderState({
    configured: true,
    authenticationOk: authentication.usable,
    authenticationClassification: authClassification,
    operationalOk,
    worstClassification
  });

  return { ...base, authentication, embeddings, synthesis, provider_state };
}

async function probeSearch(apiKey: string, provider: string): Promise<ProviderStatusEntry> {
  const base: ProviderStatusEntry = {
    configured: true,
    usable: false,
    provider,
    used_for: "optional public-signal enrichment",
    last_check: new Date().toISOString(),
    message: "Not checked"
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let url: string;
    let headers: Record<string, string> = { Accept: "application/json" };

    if (provider === "serpapi") {
      url = `https://serpapi.com/search.json?engine=google&q=test&num=1&api_key=${encodeURIComponent(apiKey)}`;
    } else if (provider === "brave") {
      url = `https://api.search.brave.com/res/v1/web/search?q=test&count=1`;
      headers = { ...headers, "X-Subscription-Token": apiKey };
    } else if (provider === "exa") {
      url = "https://api.exa.ai/search";
    } else {
      url = "https://api.tavily.com/search";
    }

    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) return { ...base, usable: true, message: "Ready" };
    if (response.status === 401 || response.status === 403) return { ...base, usable: false, message: "request rejected (invalid or unauthorized key)" };
    return { ...base, usable: false, message: `request rejected (HTTP ${response.status})` };
  } catch (error) {
    if ((error as Error).name === "AbortError") return { ...base, usable: false, message: "timeout" };
    return { ...base, usable: false, message: "request rejected" };
  }
}

export async function getSignalAgentStatus(options: { useOpenAI?: boolean } = {}): Promise<SignalAgentStatus> {
  const config = getConfig();
  const catalog = getCatalog();

  const openai = await buildOpenAiStatus(options);

  const search: ProviderStatusEntry = !config.SEARCH_API_KEY
    ? {
        configured: false,
        usable: false,
        provider: config.SEARCH_PROVIDER,
        used_for: "optional public-signal enrichment",
        last_check: new Date().toISOString(),
        message: "no configured key"
      }
    : await probeSearch(config.SEARCH_API_KEY, config.SEARCH_PROVIDER);

  const firecrawl: ProviderStatusEntry = {
    configured: config.hasFirecrawl,
    usable: config.hasFirecrawl,
    used_for: "optional page extraction",
    message: config.hasFirecrawl ? "Configured" : "Not configured"
  };

  const contactEnrichment: ProviderStatusEntry = {
    configured: config.hasContactEnrichment,
    usable: config.hasContactEnrichment,
    used_for: "optional specialist/contact enrichment",
    message: config.hasContactEnrichment ? "Configured" : "Not configured"
  };

  const auditSummary = await readRecentAuditRecords(1);

  return {
    openai,
    search,
    firecrawl,
    contact_enrichment: contactEnrichment,
    taxonomy: {
      loaded: catalog.source === "cisco_mapping",
      file: catalog.sourcePath,
      version: catalog.metadata?.version ?? "unknown",
      as_of: catalog.metadata?.asOf ?? null,
      categories: catalog.entries.length
    },
    reference_report: {
      loaded: catalog.source === "cisco_mapping",
      file: "signal-agent-poc/docs/cisco_portfolio_painpoint_mapping_report.md"
    },
    audit_log: {
      writable: auditSummary.available || auditSummary.warning?.includes("No audit log yet") === true,
      path: AUDIT_LOG_RELATIVE_PATH
    }
  };
}
