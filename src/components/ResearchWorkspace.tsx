"use client";

import { useState } from "react";
import type { AccountRecommendation, ResearchRun } from "@/lib/types";

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
      <header>
        <span className="score">Confidence {account.confidenceScore}</span>
        <h3>{account.companyName}</h3>
      </header>
      <p>{account.fitReason}</p>
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
        <ul className="evidence-list">
          {account.evidence.map((item) => (
            <li key={`${item.url}-${item.title}`}>
              <a href={item.url.startsWith("http") ? item.url : undefined}>{item.title}</a>
              <span className="muted"> — {item.sourceType}</span>
              <br />
              <small>{item.snippet}</small>
            </li>
          ))}
        </ul>
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
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
          <h2>Run status: {run.status}</h2>
          <p className="muted">
            Product: {run.input.ciscoProduct} | Market: {run.input.targetMarket} | Accounts: {run.accounts.length}
          </p>
          {run.warnings.map((warning) => (
            <div className="warning" key={warning}>
              {warning}
            </div>
          ))}
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
          {run.accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </section>
      ) : null}
    </>
  );
}
