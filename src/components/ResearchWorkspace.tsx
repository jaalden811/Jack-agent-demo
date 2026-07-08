"use client";

import { useEffect, useState } from "react";
import type { AccountRecommendation, ProviderStatusSnapshot, ResearchRun } from "@/lib/types";

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function ProviderStatusCard({ diagnostics }: { diagnostics: ProviderStatusSnapshot | null }) {
  return (
    <section className="panel provider-panel">
      <div className="section-heading">
        <div>
          <h2>Provider diagnostics</h2>
          <p className="muted">Checks run before research starts. Required providers control verified live research.</p>
        </div>
        <span className={`status-pill ${diagnostics?.overall ?? "fallback_mode_active"}`}>
          {diagnostics ? statusLabel(diagnostics.overall) : "checking"}
        </span>
      </div>
      {diagnostics ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            SEARCH_PROVIDER current value: <strong>{diagnostics.searchProvider}</strong>
          </p>
          <div className="provider-grid">
            {diagnostics.checks.map((check) => (
              <div className="provider-check" key={check.name}>
                <strong>{check.name}</strong>
                <span className={`mini-pill ${check.status}`}>
                  {check.configured ? "configured" : check.required ? "missing" : "missing optional"}
                </span>
                <p>{check.message}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="muted">Loading provider configuration...</p>
      )}
    </section>
  );
}

function AccountCard({ account, runIsFallback }: { account: AccountRecommendation; runIsFallback: boolean }) {
  const isDemoCard =
    runIsFallback || account.evidence.filter((e) => e.url.startsWith("http")).length === 0;
  const publicEvidence = account.evidence.filter((e) => e.url.startsWith("http"));

  return (
    <article className="account-card">
      <div className="account-header">
        <div>
          <h3 style={{ margin: "0 0 4px" }}>{account.companyName}</h3>
          {account.website && (
            <a className="url-wrap muted" href={account.website} style={{ fontSize: "0.88rem" }}>
              {account.website}
            </a>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className="score">Confidence {account.confidenceScore}</span>
          <span className={`mini-pill ${isDemoCard ? "fallback_mode_active" : "ready"}`}>
            {isDemoCard ? "Fallback / unverified" : "Live evidence"}
          </span>
        </div>
      </div>

      <div className="card-body">
        <div className="detail-grid" style={{ marginTop: 14 }}>
          <div>
            <strong>Why this account</strong>
            <p style={{ margin: "6px 0 0" }}>{account.fitReason}</p>
            {account.painPoints.length > 0 && (
              <ul className="compact-list" style={{ marginTop: 6 }}>
                {account.painPoints.map((p) => (
                  <li key={p.pain}>{p.pain}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <strong>Cisco capability fit</strong>
            <ul className="compact-list" style={{ marginTop: 6 }}>
              {account.ciscoCapabilityMatch.slice(0, 3).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="detail-grid" style={{ marginTop: 14 }}>
          <div>
            <strong>Likely buyers</strong>
            <ul className="compact-list" style={{ marginTop: 6 }}>
              <li>{account.champion.title}</li>
              <li>{account.economicBuyer.title}</li>
              {account.otherInfluencers.slice(0, 1).map((i) => (
                <li key={i.title}>{i.title}</li>
              ))}
            </ul>
            <small className="muted">No named people unless publicly verified.</small>
          </div>
          <div>
            <strong>Sources</strong>
            {publicEvidence.length > 0 ? (
              <ul className="compact-list" style={{ marginTop: 6 }}>
                {publicEvidence.slice(0, 3).map((e) => (
                  <li key={e.url}>
                    <a className="url-wrap" href={e.url}>
                      {e.title}
                    </a>
                    <small className="muted"> — {e.sourceType}</small>
                    {e.snippet && (
                      <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.82rem" }}>
                        {e.snippet.slice(0, 180)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ marginTop: 6 }}>
                Unavailable / unverified
              </p>
            )}
          </div>
        </div>

        {account.kbInfluence.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <strong>KB influence</strong>
            <ul className="compact-list" style={{ marginTop: 6 }}>
              {account.kbInfluence.map((chunk) => (
                <li key={`${chunk.documentName}-${chunk.chunkIndex}`}>
                  {chunk.documentName}: {chunk.snippet.slice(0, 120)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <strong>Suggested next step</strong>
          <p style={{ margin: "6px 0 0" }}>{account.suggestedOutreachAngle}</p>
        </div>
      </div>
    </article>
  );
}

export default function ResearchWorkspace() {
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProviderStatusSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/providers/diagnostics")
      .then((response) => response.json())
      .then(setDiagnostics)
      .catch(() => setDiagnostics(null));
  }, []);

  async function submitResearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "Research failed");
      }
      setRun(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Research failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function rerunWithConfiguredApis() {
    if (!run) return;
    setIsRerunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/${run.id}/rerun`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "Rerun failed");
      }
      setRun(data);
      const nextDiagnostics = await fetch("/api/providers/diagnostics").then((response) => response.json());
      setDiagnostics(nextDiagnostics);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rerun failed");
    } finally {
      setIsRerunning(false);
    }
  }

  return (
    <>
      <ProviderStatusCard diagnostics={diagnostics} />
      <section className="panel">
        <h2>Research inputs</h2>
        <form onSubmit={submitResearch}>
          <div className="grid">
            <label>
              Cisco product
              <input name="ciscoProduct" required placeholder="Cisco XDR" />
            </label>
            <label>
              Target market
              <input name="targetMarket" required placeholder="healthcare, mid-market retail, SLED" />
            </label>
            <label>
              Geography
              <input name="geography" placeholder="North America, Texas, EMEA" />
            </label>
            <label>
              Company size
              <input name="companySize" placeholder="1,000-5,000 employees" />
            </label>
            <label>
              Max accounts
              <input name="maxResults" type="number" min="1" max="20" defaultValue="5" />
            </label>
            <label>
              Knowledge-base files
              <input
                name="knowledgeBase"
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.csv,text/plain,text/markdown,text/csv,application/pdf"
              />
            </label>
          </div>
          <label style={{ marginTop: 16 }}>
            Optional seed account list
            <textarea name="seedAccounts" placeholder="One company per line or comma-separated" />
          </label>
          <div className="actions">
            <button disabled={isLoading}>{isLoading ? "Researching..." : "Run Cisco market intelligence"}</button>
          </div>
        </form>
        {error ? <div className="warning">{error}</div> : null}
      </section>

      {run ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Run summary</h2>
              <p className="muted">
                Product: {run.input.ciscoProduct} | Market: {run.input.targetMarket} | Accounts: {run.accounts.length}
              </p>
            </div>
            <span className={`status-pill ${run.isFallback ? "fallback_mode_active" : run.isVerified ? "ready" : "missing_optional_provider"}`}>
              {run.isFallback ? "Unverified fallback run" : run.isVerified ? "Verified live run" : "Low-confidence live run"}
            </span>
          </div>
          <div className="summary-grid">
            <div><strong>Search</strong><span>{run.liveSearchUsed ? "Live API-backed" : "Seed/demo fallback"}</span></div>
            <div><strong>Embeddings</strong><span>{run.openAiEmbeddingsUsed ? "OpenAI" : "Development fallback"}</span></div>
            <div><strong>Extraction</strong><span>{run.firecrawlExtractionUsed ? "Firecrawl full-page" : "Snippet-only"}</span></div>
            <div><strong>Contacts</strong><span>{run.contactEnrichmentUsed ? "Licensed provider configured" : "Role/persona only"}</span></div>
          </div>
          {/* Show warnings once, not repeated per card */}
          {run.warnings.filter((w) => !w.includes("FIRECRAWL") && !w.includes("contact enrichment")).map((warning) => (
            <div className="warning slim" key={warning}>
              {warning}
            </div>
          ))}
          {/* Single safety note for the whole run */}
          <div className="warning slim" style={{ background: "#f0f4f8", borderColor: "#c0cdd8", color: "#3a4f62" }}>
            No named contacts, emails, or phone numbers are invented. All buyer recommendations are role/persona level only.
            {run.isFallback ? " Some or all accounts are demo/fallback candidates — verify before outreach." : ""}
          </div>
          <div className="export-actions">
            {run.isFallback && (
              <button className="rerun-button" disabled={isRerunning} onClick={rerunWithConfiguredApis}>
                {isRerunning ? "Rerunning..." : "Rerun with configured APIs"}
              </button>
            )}
            <a className="button secondary" href={`/api/research/${run.id}/export?format=csv`}>
              Export CSV
            </a>
            <a className="button secondary" href={`/api/research/${run.id}/export?format=json`}>
              Export JSON
            </a>
            <a className="button secondary" href={`/api/research/${run.id}/export?format=md`}>
              Export Markdown
            </a>
          </div>
          <h3 style={{ marginTop: 24 }}>
            {run.accounts.length} target account{run.accounts.length !== 1 ? "s" : ""}
          </h3>
          {run.accounts.map((account) => (
            <AccountCard key={account.id} account={account} runIsFallback={run.isFallback} />
          ))}
        </section>
      ) : null}
    </>
  );
}
