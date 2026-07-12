import type { SecureNetworkingTriageResult, SignalAgentStatus } from "@/lib/signal-agent/types";

function ProviderCard({
  name,
  configured,
  usedInRun,
  purpose,
  detail,
  message
}: {
  name: string;
  configured: boolean;
  usedInRun: boolean | null;
  purpose: string;
  detail?: string;
  message: string;
}) {
  return (
    <div className="provider-check">
      <strong>{name}</strong>
      <span className="muted">Purpose: {purpose}</span>
      <div className="provider-line">
        <span>Configured:</span>
        <span className={configured ? "provider-yes" : "provider-no"}>{configured ? "Yes" : "No"}</span>
      </div>
      <div className="provider-line">
        <span>Used in this run:</span>
        <span className={usedInRun ? "provider-yes" : "provider-no"}>{usedInRun === null ? "—" : usedInRun ? "Yes" : "No"}</span>
      </div>
      {detail && <span className="muted">{detail}</span>}
      <span className="muted">{message}</span>
    </div>
  );
}

export function IntegrationsPanel({
  status,
  lastRun,
  onTestIntegrations,
  testing
}: {
  status: SignalAgentStatus | null;
  lastRun: SecureNetworkingTriageResult | null;
  onTestIntegrations: () => void;
  testing: boolean;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Integrations &amp; runtime</h2>
          <p className="muted">What is configured on this server, and what this specific run actually used.</p>
        </div>
        <button type="button" className="button secondary" onClick={onTestIntegrations} disabled={testing}>
          {testing ? "Testing…" : "Test integrations"}
        </button>
      </div>

      {status ? (
        <div className="provider-grid">
          <ProviderCard
            name="OpenAI"
            configured={status.openai.configured}
            usedInRun={lastRun ? lastRun.providers.embeddings_used || lastRun.providers.synthesis_used : null}
            purpose="Semantic matching + executive brief synthesis"
            detail={status.openai.model ? `Model: ${status.openai.model}` : undefined}
            message={status.openai.message}
          />
          <ProviderCard
            name="Search"
            configured={status.search.configured}
            usedInRun={lastRun ? lastRun.public_signals.length > 0 : null}
            purpose="Optional public-signal enrichment"
            detail={status.search.provider ? `Provider: ${status.search.provider}` : undefined}
            message={status.search.message}
          />
          <ProviderCard
            name="Firecrawl"
            configured={status.firecrawl.configured}
            usedInRun={null}
            purpose="Optional full-page extraction"
            message={status.firecrawl.message}
          />
          <ProviderCard
            name="Contact enrichment"
            configured={status.contact_enrichment.configured}
            usedInRun={null}
            purpose="Optional specialist/contact enrichment"
            message={status.contact_enrichment.message}
          />
        </div>
      ) : (
        <p className="muted">Loading provider status…</p>
      )}

      {lastRun && !lastRun.providers.embeddings_used && lastRun.providers.fallback_reason && (
        <div className="warning slim" style={{ marginTop: 12 }}>
          Semantic matching unavailable; using deterministic fallback. Reason: {lastRun.providers.fallback_reason}
        </div>
      )}
    </section>
  );
}
