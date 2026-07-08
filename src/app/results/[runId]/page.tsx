import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/lib/storage";

export default async function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();
  const isFallback = run.isFallback ?? true;
  const isVerified = run.isVerified ?? false;

  return (
    <main className="shell">
      <section className="hero">
        <Link href="/">Back to research</Link>
        <h1>{run.input.ciscoProduct} / {run.input.targetMarket}</h1>
        <p>Detailed account report for run {run.id}.</p>
        <span className={`status-pill ${isFallback ? "fallback_mode_active" : isVerified ? "ready" : "missing_optional_provider"}`}>
          {isFallback ? "Unverified fallback run" : isVerified ? "Verified live run" : "Low-confidence live run"}
        </span>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Run summary</h2>
            <p className="muted">{run.providerStatus?.summary ?? "Legacy run without provider snapshot; treat as unverified fallback."}</p>
          </div>
        </div>
        <div className="summary-grid">
          <div><strong>Search</strong><span>{run.liveSearchUsed ? "Live API-backed" : "Seed/demo fallback"}</span></div>
          <div><strong>Embeddings</strong><span>{run.openAiEmbeddingsUsed ? "OpenAI" : "Development fallback"}</span></div>
          <div><strong>Extraction</strong><span>{run.firecrawlExtractionUsed ? "Firecrawl full-page" : "Snippet-only"}</span></div>
          <div><strong>Contacts</strong><span>{run.contactEnrichmentUsed ? "Licensed provider configured" : "Role/persona only"}</span></div>
        </div>
        {run.warnings.map((warning) => (
          <div className="warning slim" key={warning}>{warning}</div>
        ))}
        <div className="export-actions">
          <a className="button secondary" href={`/api/research/${run.id}/export?format=csv`}>Export CSV</a>
          <a className="button secondary" href={`/api/research/${run.id}/export?format=json`}>Export JSON</a>
          <a className="button secondary" href={`/api/research/${run.id}/export?format=md`}>Export Markdown</a>
        </div>
        <h2>Ranked account table</h2>
        <div className="evidence-table-wrap">
          <table className="ranked-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Company</th>
                <th>Website</th>
                <th>Confidence</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {run.accounts.map((account, index) => (
                <tr key={account.id}>
                  <td>{index + 1}</td>
                  <td>{account.companyName}</td>
                  <td className="url-wrap">{account.website ?? "Not verified"}</td>
                  <td>{account.confidenceScore}</td>
                  <td>{account.evidence.filter((source) => source.url.startsWith("http")).length} public source(s)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {run.accounts.map((account) => (
          <article className="account-card" key={account.id}>
            <div className="account-header">
              <div>
                <h2>{account.companyName}</h2>
                <p className="muted url-wrap">{account.website ?? "Website not verified"}</p>
              </div>
              <span className="score">Confidence {account.confidenceScore}</span>
            </div>
            <p>{account.fitReason}</p>
            <div className="detail-grid">
              <div>
                <h3>Market / industry fit</h3>
                <p>{account.marketFit}</p>
              </div>
              <div>
                <h3>Cisco capability match</h3>
                <ul>
                  {account.ciscoCapabilityMatch.map((capability) => (
                    <li key={capability}>{capability}</li>
                  ))}
                </ul>
              </div>
            </div>
            <h3>Buyer map</h3>
            <ul>
              <li>Champion: {account.champion.name ?? "Not verified"} / {account.champion.title}</li>
              <li>Economic buyer: {account.economicBuyer.name ?? "Not verified"} / {account.economicBuyer.title}</li>
              {account.otherInfluencers.map((contact) => (
                <li key={contact.title}>Influencer: {contact.name ?? "Not verified"} / {contact.title}</li>
              ))}
            </ul>
            <h3>Evidence</h3>
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
                  {account.evidence.map((source) => (
                    <tr key={`${source.url}-${source.title}`}>
                      <td>
                        {source.url.startsWith("http") ? <a className="url-wrap" href={source.url}>{source.title}</a> : source.title}
                        <small className="muted url-wrap">{source.url}</small>
                      </td>
                      <td>{source.sourceType}</td>
                      <td><span className={`mini-pill ${source.verificationLevel}`}>{source.verificationLevel.replaceAll("_", " ")}</span></td>
                      <td>{source.snippet}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Missing-data warnings</h3>
            <ul>
              {account.missingDataFlags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
