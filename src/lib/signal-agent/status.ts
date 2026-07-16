import { getConfig } from "@/lib/config";
import { getCatalog } from "@/lib/signal-agent/loadCatalog";
import { readRecentAuditRecords, AUDIT_LOG_RELATIVE_PATH } from "@/lib/signal-agent/auditLog";
import { getCircuitDiagnostics } from "@/lib/circuit/diagnostics";
import type { AiProviderStatus, ProviderStatusEntry, SignalAgentStatus } from "@/lib/signal-agent/types";

/**
 * Server-side operational status for the Signal-to-Action app. Reuses
 * @/lib/config's getConfig() as the single source of truth for what is
 * configured.
 *
 * The generative AI provider is Circuit (an optional additive enhancement
 * layer); semantic retrieval is deterministic (no embedding provider). The
 * `ai_provider` status block is built from the safe Circuit diagnostics
 * (@/lib/circuit/diagnostics) — never a secret, and no network probe.
 */

function buildAiProviderStatus(): AiProviderStatus {
  const d = getCircuitDiagnostics();
  return {
    provider: "circuit",
    configured: d.configured,
    contract_confirmed: d.contractConfirmed,
    operational: d.operational,
    state: d.state,
    model: d.model,
    message:
      d.safeError ??
      (d.operational
        ? "Circuit is configured and operational."
        : "Circuit is an optional enhancement; the deterministic engine is authoritative.")
  };
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

export async function getSignalAgentStatus(): Promise<SignalAgentStatus> {
  const config = getConfig();
  const catalog = getCatalog();

  const ai_provider = buildAiProviderStatus();

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
    ai_provider,
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
