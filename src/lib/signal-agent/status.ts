import { getConfig } from "@/lib/config";
import { getCatalog } from "@/lib/signal-agent/loadCatalog";
import { readRecentAuditRecords, AUDIT_LOG_RELATIVE_PATH } from "@/lib/signal-agent/auditLog";
import type { ProviderStatusEntry, SignalAgentStatus } from "@/lib/signal-agent/types";

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

async function probeOpenAi(apiKey: string, model: string): Promise<ProviderStatusEntry> {
  const base: ProviderStatusEntry = {
    configured: true,
    usable: false,
    model,
    used_for: "semantic transcript matching",
    last_check: new Date().toISOString(),
    message: "Not checked"
  };

  let client: import("openai").default;
  try {
    const { default: OpenAI } = await import("openai");
    client = new OpenAI({ apiKey, timeout: 5000, maxRetries: 0 });
  } catch {
    return { ...base, usable: false, message: "API client initialization failure" };
  }

  try {
    await client.models.retrieve(model);
    return { ...base, usable: true, message: "Ready" };
  } catch (error) {
    const message = describeOpenAiFailure(error);
    return { ...base, usable: false, message };
  }
}

export function describeOpenAiFailure(error: unknown): string {
  const status = (error as { status?: number })?.status;
  const code = (error as { code?: string })?.code;
  const name = (error as { name?: string })?.name;

  if (name === "APIConnectionTimeoutError" || code === "ETIMEDOUT") return "timeout";
  if (status === 401 || status === 403) return "request rejected (invalid or unauthorized key)";
  if (status === 404) return "model unavailable";
  if (status === 429) return "request rejected (rate limited)";
  if (status && status >= 500) return "request rejected (provider error)";
  return "request rejected";
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

  const openaiBase: ProviderStatusEntry =
    !config.OPENAI_API_KEY
      ? {
          configured: false,
          usable: false,
          model: config.OPENAI_EMBEDDING_MODEL,
          used_for: "semantic transcript matching",
          last_check: new Date().toISOString(),
          message: "no configured key"
        }
      : options.useOpenAI === false
        ? {
            configured: true,
            usable: false,
            model: config.OPENAI_EMBEDDING_MODEL,
            used_for: "semantic transcript matching",
            last_check: new Date().toISOString(),
            message: "embeddings disabled by user"
          }
        : await probeOpenAi(config.OPENAI_API_KEY, config.OPENAI_EMBEDDING_MODEL);

  // Embeddings (semantic matching) and synthesis (executive brief) share
  // the same configured key/model, so both reflect the same live probe.
  const openai: ProviderStatusEntry = {
    ...openaiBase,
    embeddings_enabled: openaiBase.usable,
    synthesis_enabled: openaiBase.usable
  };

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
