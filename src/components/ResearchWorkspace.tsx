"use client";

import { useEffect, useState } from "react";
import type { AccountRecommendation, BuyerTarget, ProviderStatusSnapshot, ResearchRun, RunDebugStats } from "@/lib/types";

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function ProviderStatusCard({
  diagnostics,
  onRefresh
}: {
  diagnostics: ProviderStatusSnapshot | null;
  onRefresh: () => void;
}) {
  return (
    <section className="panel provider-panel">
      <div className="section-heading">
        <div>
          <h2>Provider diagnostics</h2>
          <p className="muted">Required providers control verified live research.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className={`status-pill ${diagnostics?.overall ?? "fallback_mode_active"}`}>
            {diagnostics ? statusLabel(diagnostics.overall) : "checking…"}
          </span>
          <button
            className="button secondary"
            style={{ padding: "6px 10px", fontSize: "0.82rem" }}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>
      </div>
      {diagnostics ? (
        <>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
            SEARCH_PROVIDER: <strong>{diagnostics.searchProvider}</strong>
          </p>
          <div className="provider-grid">
            {diagnostics.checks.map((check) => (
              <div className="provider-check" key={check.name}>
                <strong>{check.name}</strong>
                <span className={`mini-pill ${check.status}`}>
                  {check.configured ? "configured ✓" : check.required ? "missing" : "missing optional"}
                </span>
                <p>{check.message}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="muted">Loading provider configuration…</p>
      )}
    </section>
  );
}

function DebugPanel({ stats, marketSignals }: { stats: RunDebugStats; marketSignals?: import("@/lib/types").MarketSignal[] }) {
  return (
    <details className="debug-panel">
      <summary>
        Search debug — account base: {stats.selectedAccountBase} · {stats.validOrgCount} selected org{stats.validOrgCount !== 1 ? "s" : ""}
        {stats.finalGuardReplacements > 0 ? ` · ${stats.finalGuardReplacements} final guard replacement${stats.finalGuardReplacements !== 1 ? "s" : ""}` : ""}
      </summary>
      <div className="debug-body">
        <strong>Selected organizations</strong>
        <ul className="compact-list" style={{ marginTop: 4, marginBottom: 10 }}>
          {stats.selectedOrganizationNames.map((name) => <li key={name}>{name}</li>)}
        </ul>
        <div className="debug-grid">
          <span>Account base</span><span>{stats.selectedAccountBase}</span>
          <span>Broad market search results</span><span>{stats.broadSearchResultsForContext}</span>
          <span>Enrichment queries</span><span>{stats.enrichmentQueriesRun}</span>
          <span>Account signals attached</span><span>{stats.accountSignalsAttached}</span>
          <span>Market signals only</span><span>{stats.marketSignalsOnly}</span>
          <span>Final guard replacements</span><span>{stats.finalGuardReplacements}</span>
          <span>OpenAI synthesis used</span><span>{stats.openAiSynthesisUsed ? "yes" : "no"}</span>
        </div>
        <strong style={{ display: "block", marginTop: 10 }}>Broad search rejection breakdown</strong>
        <div className="debug-grid" style={{ marginTop: 4 }}>
          <span>Article / report titles</span><span>{stats.rejectedAsArticleTitle}</span>
          <span>Vendor / product pages</span><span>{stats.rejectedAsVendorProduct}</span>
          <span>Person results</span><span>{stats.rejectedAsPerson}</span>
          <span>Invalid org name</span><span>{stats.rejectedInvalidOrgName}</span>
        </div>
        {(marketSignals ?? []).length > 0 && (
          <>
            <strong style={{ display: "block", marginTop: 10 }}>Market signals (not accounts)</strong>
            <p className="muted" style={{ margin: "4px 0 6px", fontSize: "0.8rem" }}>
              These search results were classified as market context, not target organizations.
            </p>
            <ul className="compact-list" style={{ marginTop: 4 }}>
              {(marketSignals ?? []).slice(0, 5).map((s, i) => (
                <li key={i} style={{ fontSize: "0.82rem" }}>
                  {s.url ? <a className="url-wrap" href={s.url}>{s.title}</a> : s.title}
                  <span className="muted"> — {s.reason}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

function BuyerRow({ label, buyer }: { label: string; buyer: BuyerTarget }) {
  return (
    <div className="buyer-row">
      <div className="buyer-label">{label}</div>
      <div className="buyer-detail">
        <strong>{buyer.roleTitle}</strong>
        {buyer.department && <span className="muted"> · {buyer.department}</span>}
        {buyer.namedPerson ? (
          <p style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>
            Public mention:{" "}
            <a href={buyer.namedPerson.sourceUrl}>{buyer.namedPerson.name}</a>
            {buyer.namedPerson.title && <span className="muted"> — {buyer.namedPerson.title}</span>}
          </p>
        ) : (
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>No named person verified.</p>
        )}
        <p style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>{buyer.whyThisRole}</p>
      </div>
    </div>
  );
}

function AccountCard({ account }: { account: AccountRecommendation }) {
  const isDemoCard = account.verificationStatus === "fallback_unverified";
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
          <span className={`mini-pill ${isDemoCard ? "fallback_mode_active" : account.confidenceLabel === "high" ? "ready" : "missing_optional_provider"}`}>
            {isDemoCard ? "Fallback / unverified" : account.confidenceLabel}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Why this organization */}
        <div>
          <strong>Why this organization</strong>
          <p style={{ margin: "6px 0 0" }}>{account.fitReason}</p>
        </div>

        {/* Signals — with implication shown */}
        {account.signals.length > 0 && (
          <div>
            <strong>Signals read</strong>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
              {account.signals.map((signal, i) => (
                <div key={i} className="signal-row">
                  <div className="signal-header">
                    <span className={`mini-pill ${signal.verification === "unverified" ? "fallback_mode_active" : signal.verification === "verified" ? "ready" : "missing_optional_provider"}`}>
                      {signal.verification.replaceAll("_", " ")}
                    </span>
                    <strong style={{ marginLeft: 8 }}>{signal.label}</strong>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>{signal.detail.slice(0, 200)}</p>
                  {signal.implication && (
                    <p style={{ margin: "4px 0 0", fontSize: "0.84rem", color: "var(--muted)", fontStyle: "italic" }}>
                      → {signal.implication}
                    </p>
                  )}
                  {signal.sourceUrl?.startsWith("http") && (
                    <a className="url-wrap" href={signal.sourceUrl} style={{ fontSize: "0.8rem" }}>
                      {signal.sourceTitle ?? signal.sourceUrl}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="detail-grid">
          {/* Pain points */}
          <div>
            <strong>Pain points</strong>
            <ul className="compact-list" style={{ marginTop: 6 }}>
              {account.painPoints.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>

          {/* Cisco fit */}
          <div>
            <strong>Cisco fit</strong>
            <p style={{ margin: "6px 0 4px", fontSize: "0.88rem" }}>{account.ciscoFitSummary}</p>
            <ul className="compact-list">
              {account.ciscoCapabilityMatch.slice(0, 4).map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        </div>

        {/* Buyer map */}
        <div>
          <strong>Contacts / buyer map</strong>
          <p className="muted" style={{ margin: "4px 0 8px", fontSize: "0.82rem" }}>
            No named contacts or emails unless publicly verified.
          </p>
          <div className="buyer-map">
            <BuyerRow label="Economic buyer" buyer={account.economicBuyer} />
            <BuyerRow label="Business champion" buyer={account.businessChampion} />
            {account.technicalInfluencers.slice(0, 1).map((b, i) => <BuyerRow key={i} label="Technical influencer" buyer={b} />)}
          </div>
        </div>

        {/* Source evidence */}
        <div>
          <strong>Source evidence</strong>
          {publicEvidence.length > 0 ? (
            <ul className="compact-list" style={{ marginTop: 6 }}>
              {publicEvidence.slice(0, 3).map((e) => (
                <li key={e.url}>
                  <a className="url-wrap" href={e.url}>{e.title}</a>
                  <small className="muted"> — {e.sourceType} · {e.verificationLevel.replaceAll("_", " ")}</small>
                  {e.snippet && (
                    <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.8rem" }}>{e.snippet.slice(0, 180)}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ marginTop: 6 }}>Unavailable / unverified</p>
          )}
        </div>

        {/* KB influence (only show if present) */}
        {account.kbInfluence.length > 0 && (
          <div>
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

        {/* Next step */}
        <div>
          <strong>Suggested next step</strong>
          <p style={{ margin: "6px 0 0" }}>{account.nextStep}</p>
        </div>
      </div>
    </article>
  );
}

async function fetchDiagnostics(): Promise<ProviderStatusSnapshot> {
  const response = await fetch("/api/providers/diagnostics", { cache: "no-store" });
  return response.json();
}

export default function ResearchWorkspace() {
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProviderStatusSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDiagnostics = () => {
    fetchDiagnostics().then(setDiagnostics).catch(() => setDiagnostics(null));
  };

  useEffect(() => { refreshDiagnostics(); }, []);

  async function submitResearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/research", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? data.error ?? "Research failed");
      setRun(data);
      // Refresh diagnostics after run so user sees current key status
      refreshDiagnostics();
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
      if (!response.ok) throw new Error(data.detail ?? data.error ?? "Rerun failed");
      setRun(data);
      refreshDiagnostics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rerun failed");
    } finally {
      setIsRerunning(false);
    }
  }

  return (
    <>
      <ProviderStatusCard diagnostics={diagnostics} onRefresh={refreshDiagnostics} />

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
            <button disabled={isLoading}>
              {isLoading ? "Running multi-stage research…" : "Run Cisco market intelligence"}
            </button>
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
                {run.input.ciscoProduct} · {run.input.targetMarket} · {run.accounts.length} account
                {run.accounts.length !== 1 ? "s" : ""}
              </p>
            </div>
            <span className={`status-pill ${run.isFallback ? "fallback_mode_active" : run.isVerified ? "ready" : "missing_optional_provider"}`}>
              {run.isFallback ? "Fallback run" : run.isVerified ? "Verified live run" : "Live run (low confidence)"}
            </span>
          </div>

          <div className="summary-grid">
            <div><strong>Search</strong><span>{run.liveSearchUsed ? "Live API-backed" : "Seed/demo fallback"}</span></div>
            <div><strong>Embeddings</strong><span>{run.openAiEmbeddingsUsed ? "OpenAI" : "Development fallback"}</span></div>
            <div><strong>Extraction</strong><span>{run.firecrawlExtractionUsed ? "Firecrawl full-page" : "Snippet-only / server fetch"}</span></div>
            <div><strong>Contacts</strong><span>{run.contactEnrichmentUsed ? "Licensed provider" : "Role/persona only"}</span></div>
          </div>

          {run.warnings
            .filter((w) => !w.includes("FIRECRAWL") && !w.includes("contact enrichment"))
            .map((w) => (
              <div className="warning slim" key={w}>{w}</div>
            ))}

          <div className="warning slim" style={{ background: "#f0f4f8", borderColor: "#c0cdd8", color: "#3a4f62" }}>
            No contacts, emails, or named people are invented. Buyer entries are role/persona level unless a public source is cited.
            {run.isFallback ? " Some or all accounts are fallback candidates — verify before outreach." : ""}
          </div>

          {run.debugStats && <DebugPanel stats={run.debugStats} marketSignals={run.marketSignals} />}

          <div className="export-actions">
            {run.isFallback && (
              <button className="rerun-button" disabled={isRerunning} onClick={rerunWithConfiguredApis}>
                {isRerunning ? "Rerunning…" : "Rerun with configured APIs"}
              </button>
            )}
            <a className="button secondary" href={`/api/research/${run.id}/export?format=csv`}>Export CSV</a>
            <a className="button secondary" href={`/api/research/${run.id}/export?format=json`}>Export JSON</a>
            <a className="button secondary" href={`/api/research/${run.id}/export?format=md`}>Export Markdown</a>
          </div>

          <h3 style={{ marginTop: 24 }}>Target organizations ({run.accounts.length})</h3>
          {run.accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </section>
      ) : null}
    </>
  );
}
