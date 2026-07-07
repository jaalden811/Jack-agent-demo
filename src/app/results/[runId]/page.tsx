import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/lib/storage";

export default async function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();

  return (
    <main className="shell">
      <section className="hero">
        <Link href="/">Back to research</Link>
        <h1>{run.input.ciscoProduct} / {run.input.targetMarket}</h1>
        <p>Detailed source-backed account report for run {run.id}.</p>
      </section>
      <section className="panel">
        <div className="export-actions">
          <a className="button secondary" href={`/api/research/${run.id}/export?format=csv`}>Export CSV</a>
          <a className="button secondary" href={`/api/research/${run.id}/export?format=json`}>Export JSON</a>
          <a className="button secondary" href={`/api/research/${run.id}/export?format=md`}>Export Markdown</a>
        </div>
        {run.accounts.map((account) => (
          <article className="account-card" key={account.id}>
            <span className="score">Confidence {account.confidenceScore}</span>
            <h2>{account.companyName}</h2>
            <p>{account.fitReason}</p>
            <h3>Buyer map</h3>
            <ul>
              <li>Champion: {account.champion.name ?? "Not verified"} / {account.champion.title}</li>
              <li>Economic buyer: {account.economicBuyer.name ?? "Not verified"} / {account.economicBuyer.title}</li>
              {account.otherInfluencers.map((contact) => (
                <li key={contact.title}>Influencer: {contact.name ?? "Not verified"} / {contact.title}</li>
              ))}
            </ul>
            <h3>Evidence</h3>
            <ul>
              {account.evidence.map((source) => (
                <li key={`${source.url}-${source.title}`}>
                  {source.url.startsWith("http") ? <a href={source.url}>{source.title}</a> : source.title}
                  <p className="muted">{source.snippet}</p>
                </li>
              ))}
            </ul>
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
