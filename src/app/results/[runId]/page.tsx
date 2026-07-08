import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/lib/storage";
import type { AccountRecommendation, BuyerTarget } from "@/lib/types";

function BuyerSection({ label, buyer }: { label: string; buyer: BuyerTarget }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <strong>{label}:</strong> {buyer.roleTitle}
      {buyer.department && <span className="muted"> · {buyer.department}</span>}
      {buyer.namedPerson && (
        <p style={{ margin: "2px 0 0", fontSize: "0.88rem" }}>
          Public mention:{" "}
          <a href={buyer.namedPerson.sourceUrl}>{buyer.namedPerson.name}</a>
          {buyer.namedPerson.title && <span className="muted"> — {buyer.namedPerson.title}</span>}
        </p>
      )}
      <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.82rem" }}>
        {buyer.whyThisRole}
      </p>
    </div>
  );
}

function AccountDetail({ account }: { account: AccountRecommendation }) {
  const publicEvidence = account.evidence.filter((e) => e.url.startsWith("http"));
  const isDemoCard = account.verificationStatus === "fallback_unverified";

  return (
    <article className="account-card">
      <div className="account-header">
        <div>
          <h2 style={{ margin: "0 0 4px" }}>{account.companyName}</h2>
          {account.website && (
            <a className="url-wrap muted" href={account.website}>
              {account.website}
            </a>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className="score">Confidence {account.confidenceScore}</span>
          <span className={`mini-pill ${isDemoCard ? "fallback_mode_active" : account.confidenceLabel === "high" ? "ready" : "missing_optional_provider"}`}>
            {isDemoCard ? "Fallback / unverified" : account.verificationStatus.replaceAll("_", " ")}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <strong>Why this organization</strong>
          <p style={{ margin: "6px 0 0" }}>{account.fitReason}</p>
        </div>

        {account.signals.length > 0 && (
          <div>
            <strong>Signals read</strong>
            <ul className="compact-list" style={{ marginTop: 6 }}>
              {account.signals.map((s, i) => (
                <li key={i}>
                  <em>{s.label}:</em> {s.detail.slice(0, 200)}
                  {s.sourceUrl?.startsWith("http") && (
                    <> · <a className="url-wrap" href={s.sourceUrl}>{s.sourceTitle || "source"}</a></>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="detail-grid">
          <div>
            <strong>Pain points</strong>
            <ul className="compact-list" style={{ marginTop: 6 }}>
              {account.painPoints.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
          <div>
            <strong>Cisco capability fit</strong>
            <p style={{ margin: "6px 0 4px", fontSize: "0.88rem" }}>{account.ciscoFitSummary}</p>
            <ul className="compact-list">
              {account.ciscoCapabilityMatch.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        </div>

        <div>
          <strong>Contacts / buyer map</strong>
          <p className="muted" style={{ margin: "4px 0 8px", fontSize: "0.82rem" }}>
            No named contacts or emails unless publicly verified.
          </p>
          <BuyerSection label="Economic buyer" buyer={account.economicBuyer} />
          <BuyerSection label="Business champion" buyer={account.businessChampion} />
          {account.technicalInfluencers.slice(0, 2).map((b, i) => (
            <BuyerSection key={i} label="Technical influencer" buyer={b} />
          ))}
        </div>

        <div>
          <strong>Source evidence</strong>
          {publicEvidence.length > 0 ? (
            <ul className="compact-list" style={{ marginTop: 6 }}>
              {publicEvidence.map((e) => (
                <li key={`${e.url}-${e.title}`}>
                  <a className="url-wrap" href={e.url}>{e.title}</a>
                  <small className="muted"> — {e.sourceType} · {e.verificationLevel.replaceAll("_", " ")}</small>
                  <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.8rem" }}>{e.snippet}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ marginTop: 6 }}>Unavailable / unverified</p>
          )}
        </div>

        {account.missingDataFlags.length > 0 && (
          <div>
            <strong>Missing data / caveats</strong>
            <ul className="compact-list" style={{ marginTop: 6 }}>
              {account.missingDataFlags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}

        <div>
          <strong>Suggested next step</strong>
          <p style={{ margin: "6px 0 0" }}>{account.nextStep}</p>
        </div>
      </div>
    </article>
  );
}

export default async function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();

  const isFallback = run.isFallback ?? true;
  const isVerified = run.isVerified ?? false;

  return (
    <main className="shell">
      <section className="hero">
        <Link href="/">← Back to research</Link>
        <h1>
          {run.input.ciscoProduct} / {run.input.targetMarket}
        </h1>
        <p>Detailed account report for run {run.id}.</p>
        <span
          className={`status-pill ${isFallback ? "fallback_mode_active" : isVerified ? "ready" : "missing_optional_provider"}`}
        >
          {isFallback ? "Fallback run" : isVerified ? "Verified live run" : "Low-confidence live run"}
        </span>
      </section>
      <section className="panel">
        <div
          className="warning slim"
          style={{ background: "#f0f4f8", borderColor: "#c0cdd8", color: "#3a4f62", marginBottom: 16 }}
        >
          Provider: {run.providerStatus?.summary ?? "Legacy run — treat as unverified fallback."}
        </div>

        {run.warnings.map((w) => (
          <div className="warning slim" key={w}>{w}</div>
        ))}

        <div className="export-actions">
          <a className="button secondary" href={`/api/research/${run.id}/export?format=csv`}>Export CSV</a>
          <a className="button secondary" href={`/api/research/${run.id}/export?format=json`}>Export JSON</a>
          <a className="button secondary" href={`/api/research/${run.id}/export?format=md`}>Export Markdown</a>
        </div>

        <h2 style={{ marginTop: 24 }}>Target organizations ({run.accounts.length})</h2>
        {run.accounts.map((account) => (
          <AccountDetail key={account.id} account={account} />
        ))}
      </section>
    </main>
  );
}
