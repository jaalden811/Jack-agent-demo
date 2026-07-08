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

function RoleCard({
  title,
  contact
}: {
  title: string;
  contact: AccountRecommendation["champion"];
}) {
  return (
    <div className="role">
      <strong>{title}</strong>
      <p>{contact.name ?? "Person not verified"}</p>
      <p className="muted">{contact.title}</p>
      <p>Email: {contact.emailVerified ? contact.businessEmail : "Not verified"}</p>
      {contact.profileUrl ? <a href={contact.profileUrl}>Profile</a> : <p className="muted">Profile URL not verified</p>}
      <small>{contact.relationshipHypothesis}</small>
    </div>
  );
}

function AccountCard({ account }: { account: AccountRecommendation }) {
  return (
    <article className="account-card">
      <header className="account-header">
        <div>
          <h3>{account.companyName}</h3>
          <p className="muted url-wrap">{account.website ?? "Website not verified"}</p>
        </div>
        <span className="score">Confidence {account.confidenceScore}</span>
      </header>
      <p>{account.fitReason}</p>
      <div className="detail-grid">
        <div>
          <h4>Market / industry fit</h4>
          <p>{account.marketFit}</p>
        </div>
        <div>
          <h4>Cisco capability match</h4>
          <ul className="compact-list">
            {account.ciscoCapabilityMatch.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="role-grid">
        <RoleCard title="Business champion" contact={account.champion} />
        <RoleCard title="Economic buyer" contact={account.economicBuyer} />
        {account.otherInfluencers.slice(0, 1).map((contact) => (
          <RoleCard key={contact.title} title="Technical influencer" contact={contact} />
        ))}
      </div>

      <h4>Observed pain points</h4>
      {account.painPoints.length ? (
        account.painPoints.map((pain) => (
          <p key={pain.pain}>
            {pain.pain} <span className="muted">({pain.citations.length} citation(s))</span>
          </p>
        ))
      ) : (
        <p className="muted">No source-backed pain point identified yet.</p>
      )}

      <h4>Evidence</h4>
      {account.evidence.length ? (
        <div className="evidence-table-wrap">
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Verification</th>
                <th>Snippet</th>
              </tr>
            </thead>
            <tbody>
          {account.evidence.map((item) => (
                <tr key={`${item.url}-${item.title}`}>
                  <td>
                    <a className="url-wrap" href={item.url.startsWith("http") ? item.url : undefined}>
                      {item.title}
                    </a>
                    <small className="muted url-wrap">{item.url}</small>
                  </td>
                  <td>{item.sourceType}</td>
                  <td><span className={`mini-pill ${item.verificationLevel}`}>{item.verificationLevel.replaceAll("_", " ")}</span></td>
                  <td>{item.snippet}</td>
                </tr>
          ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No public source evidence stored for this account.</p>
      )}

      <h4>KB influence</h4>
      {account.kbInfluence.length ? (
        <ul>
          {account.kbInfluence.map((chunk) => (
            <li key={`${chunk.documentName}-${chunk.chunkIndex}`}>
              {chunk.documentName} chunk {chunk.chunkIndex}: {chunk.snippet}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No uploaded KB influenced this recommendation.</p>
      )}

      <h4>Outreach angle</h4>
      <p>{account.suggestedOutreachAngle}</p>

      <h4>Do-not-invent flags</h4>
      <ul>
        {account.missingDataFlags.map((flag) => (
          <li key={flag}>{flag}</li>
        ))}
      </ul>
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
          {run.warnings.map((warning) => (
            <div className="warning slim" key={warning}>
              {warning}
            </div>
          ))}
          {run.isFallback ? (
            <button className="rerun-button" disabled={isRerunning} onClick={rerunWithConfiguredApis}>
              {isRerunning ? "Rerunning..." : "Rerun with configured APIs"}
            </button>
          ) : null}
          <div className="export-actions">
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
          <h3>Ranked accounts</h3>
          <div className="evidence-table-wrap">
            <table className="ranked-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Company</th>
                  <th>Confidence</th>
                  <th>Evidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {run.accounts.map((account, index) => (
                  <tr key={account.id}>
                    <td>{index + 1}</td>
                    <td>{account.companyName}</td>
                    <td>{account.confidenceScore}</td>
                    <td>{account.evidence.filter((item) => item.url.startsWith("http")).length} public source(s)</td>
                    <td>{run.isFallback ? "Fallback" : account.evidence.some((item) => item.verificationLevel === "full_page") ? "Full-page evidence" : "Snippet-only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {run.accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </section>
      ) : null}
    </>
  );
}
