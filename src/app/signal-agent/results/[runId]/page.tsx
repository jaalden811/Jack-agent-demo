import { verifyRunToken } from "@/lib/signal-agent/shareLink";
import { readRunResult } from "@/lib/signal-agent/resultStore";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { WebexAutomationRunResult } from "@/lib/webex/types";
import { OrchestrationPanel } from "@/components/signal-agent/OrchestrationPanel";

export const dynamic = "force-dynamic";

function InvalidLink({ reason }: { reason: string }) {
  const message =
    reason === "expired"
      ? "This analysis link has expired."
      : reason === "signature_mismatch" || reason === "malformed"
        ? "This analysis link is invalid."
        : "This analysis could not be found.";
  return (
    <main className="shell">
      <section className="panel">
        <h1>Signal-to-Solution Triage — Result</h1>
        <div className="warning slim">{message}</div>
        <p className="muted">Ask the sender to re-share the analysis, or run the analysis again in the Signal-to-Solution app.</p>
      </section>
    </main>
  );
}

function EvidenceList({ items }: { items: SecureNetworkingTriageResult["public_enrichment"]["accepted_evidence"] }) {
  if (!items || items.length === 0) return <p className="muted">No public evidence was cited for this analysis.</p>;
  return (
    <ul className="compact-list">
      {items.map((item) => (
        <li key={item.evidence_id}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title ?? item.url}
            </a>
          ) : (
            <span>{item.title ?? item.quote_or_snippet}</span>
          )}
          <span className="muted"> — confidence {Math.round(item.confidence * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

export default async function SignalAgentResultPage({
  params,
  searchParams
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { runId } = await params;
  const { token } = await searchParams;

  if (!token) {
    return <InvalidLink reason="malformed" />;
  }

  const verification = verifyRunToken(runId, token);
  if (!verification.valid) {
    return <InvalidLink reason={verification.reason} />;
  }

  const record = await readRunResult(runId);
  if (!record) {
    return <InvalidLink reason="not_found" />;
  }

  const result = record.qualification_json as unknown as SecureNetworkingTriageResult;

  return (
    <main className="shell">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h1>Signal-to-Solution Triage — Result</h1>
            <p className="muted">
              Read-only shared analysis · Run <code>{runId}</code> · Expires {new Date(record.expires_at).toLocaleString()}
            </p>
          </div>
        </div>

        <h2>Executive summary</h2>
        <div className="summary-grid">
          <div>
            <span className="muted">Verdict</span>
            <strong>
              {record.verdict} ({Math.round(record.confidence * 100)}%)
            </strong>
          </div>
          <div>
            <span className="muted">Account</span>
            <strong>{record.account ?? "Not resolved"}</strong>
          </div>
        </div>
        {result?.executive_summary && (
          <div className="detail-grid" style={{ marginTop: 12 }}>
            <div>
              <span className="muted">Business problem</span>
              <p>{result.executive_summary.business_problem}</p>
            </div>
            <div>
              <span className="muted">Business impact</span>
              <p>{result.executive_summary.business_impact}</p>
            </div>
            <div>
              <span className="muted">Primary opportunity</span>
              <p>{result.executive_summary.primary_opportunity ?? "Not identified"}</p>
            </div>
            <div>
              <span className="muted">Recommended next action</span>
              <p>{result.executive_summary.recommended_next_action}</p>
            </div>
          </div>
        )}

        {result?.orchestration && (
          <>
            <h2>ActionCase</h2>
            <OrchestrationPanel result={result as unknown as WebexAutomationRunResult} />
          </>
        )}

        {result?.account_resolution && (
          <>
            <h2>Account resolution</h2>
            <p>
              Status: <strong>{result.account_resolution.status}</strong> (confidence {Math.round(result.account_resolution.confidence * 100)}%)
            </p>
            {result.account_resolution.action_required && <div className="warning slim">{result.account_resolution.action_required}</div>}
          </>
        )}

        {result?.meddpicc && (
          <>
            <h2>MEDDPICC</h2>
            <table className="evidence-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Status</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(result.meddpicc) as Array<keyof typeof result.meddpicc>).map((key) => (
                  <tr key={key}>
                    <td>{key.replace(/_/g, " ")}</td>
                    <td>{result.meddpicc[key].status}</td>
                    <td>{result.meddpicc[key].summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {result?.stakeholder_analysis && (
          <>
            <h2>Stakeholder map</h2>
            <ul className="compact-list">
              {result.stakeholder_analysis.named_stakeholders.map((s, i) => (
                <li key={i}>
                  <strong>{s.name}</strong> — {s.function_or_role} ({s.ownership_type.replace(/_/g, " ")})
                </li>
              ))}
            </ul>
          </>
        )}

        {result?.solution_architecture && result.solution_architecture.length > 0 && (
          <>
            <h2>Solution architecture</h2>
            <ul className="compact-list">
              {result.solution_architecture.map((item, i) => (
                <li key={i}>
                  <strong>{item.product}</strong> — {item.role} ({item.layer})
                </li>
              ))}
            </ul>
          </>
        )}

        {result?.public_enrichment && (
          <>
            <h2>Public evidence and links</h2>
            <EvidenceList items={result.public_enrichment.accepted_evidence} />
          </>
        )}

        <h2>Sales next actions</h2>
        <pre className="internal-brief">{record.sales_message ?? "Not generated for this run."}</pre>

        <h2>Technical next actions</h2>
        <pre className="internal-brief">{record.technical_message ?? "Not generated for this run."}</pre>

        {record.source_summary.length > 0 && (
          <>
            <h2>Source trace</h2>
            <ul className="compact-list">
              {record.source_summary.map((source, i) => (
                <li key={i}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                  </a>{" "}
                  <span className="muted">({source.domain})</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>Delivery status</h2>
        <pre className="raw-json">{JSON.stringify(record.delivery_summary, null, 2)}</pre>
      </section>
    </main>
  );
}
