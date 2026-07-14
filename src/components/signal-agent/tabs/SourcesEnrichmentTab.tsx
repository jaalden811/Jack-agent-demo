import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * "Sources & enrichment" tab (Section 13): shows exactly which OpenAI
 * qualification stages ran, the full SerpAPI query trace (purpose,
 * query, result/accept/reject counts, cache status, errors), and every
 * accepted public source with its evidence score and inclusion
 * rationale — so a reviewer can see precisely what evidence contributed
 * to the result, and what did not.
 */

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-pill ${ok ? "status-ok" : "status-off"}`}>{label}</span>;
}

export function SourcesEnrichmentTab({ result }: { result: SecureNetworkingTriageResult }) {
  const { ai_processing: ai, public_enrichment: enrichment, account_resolution: account, analysis_link: link } = result;

  return (
    <div className="tab-content">
      <h3>OpenAI qualification pipeline</h3>
      <div className="detail-grid">
        <div>
          <span className="muted">Configured</span>
          <p>
            <StatusPill ok={ai.openai_configured} label={ai.openai_configured ? "Yes" : "No"} />
          </p>
        </div>
        <div>
          <span className="muted">Transcript extraction (Stage A)</span>
          <p>
            <StatusPill ok={ai.transcript_extraction_used} label={ai.transcript_extraction_used ? "Used" : "Not used"} />
          </p>
        </div>
        <div>
          <span className="muted">Public-evidence classification (Stage B)</span>
          <p>
            <StatusPill ok={ai.public_evidence_classification_used} label={ai.public_evidence_classification_used ? "Used" : "Not used"} />
          </p>
        </div>
        <div>
          <span className="muted">Qualification synthesis (Stage C)</span>
          <p>
            <StatusPill ok={ai.qualification_synthesis_used} label={ai.qualification_synthesis_used ? "Used" : "Not used"} />
          </p>
        </div>
        <div>
          <span className="muted">Message synthesis (Stage D)</span>
          <p>
            <StatusPill ok={ai.message_synthesis_used} label={ai.message_synthesis_used ? "Used" : "Deterministic template"} />
          </p>
        </div>
        <div>
          <span className="muted">Models</span>
          <p style={{ fontSize: "0.85rem" }}>
            Embedding: <code>{ai.embedding_model}</code>
            <br />
            Synthesis: <code>{ai.synthesis_model}</code>
          </p>
        </div>
      </div>
      {ai.fallback_reason && <div className="warning slim">Fallback reason: {ai.fallback_reason}</div>}

      <h3>Account resolution</h3>
      <div className="detail-grid">
        <div>
          <span className="muted">Status</span>
          <p>
            <strong>{account.status}</strong> ({Math.round(account.confidence * 100)}% confidence, via {(account.source ?? "unknown").replace(/_/g, " ")})
          </p>
        </div>
        <div>
          <span className="muted">Name</span>
          <p>{account.name ?? "Not identified"}</p>
        </div>
      </div>
      {account.action_required && <div className="warning slim">{account.action_required}</div>}
      {account.alternatives.length > 0 && (
        <p className="muted" style={{ fontSize: "0.82rem" }}>
          Other candidates considered: {account.alternatives.map((a) => a.name).join(", ")}
        </p>
      )}

      <h3>SerpAPI enrichment</h3>
      <div className="detail-grid">
        <div>
          <span className="muted">Configured</span>
          <p>
            <StatusPill ok={enrichment.configured} label={enrichment.configured ? "Yes" : "No"} />
          </p>
        </div>
        <div>
          <span className="muted">Enabled this run</span>
          <p>
            <StatusPill ok={enrichment.enabled} label={enrichment.enabled ? "Yes" : "No"} />
          </p>
        </div>
        <div>
          <span className="muted">Queries executed</span>
          <p>
            <strong>{enrichment.queries.length}</strong>
          </p>
        </div>
        <div>
          <span className="muted">Cache hits</span>
          <p>
            <strong>{enrichment.queries.filter((q) => q.cache === "hit").length}</strong>
          </p>
        </div>
        <div>
          <span className="muted">Results considered</span>
          <p>
            <strong>{enrichment.queries.reduce((sum, q) => sum + q.results, 0)}</strong>
          </p>
        </div>
        <div>
          <span className="muted">Accepted evidence</span>
          <p>
            <strong>{enrichment.accepted_evidence.length}</strong>
          </p>
        </div>
        <div>
          <span className="muted">Rejected results</span>
          <p>
            <strong>{enrichment.rejected_count}</strong>
          </p>
        </div>
      </div>
      {enrichment.fallback_reason && <div className="warning slim">{enrichment.fallback_reason}</div>}

      {enrichment.queries.length > 0 && (
        <>
          <h4>Query trace</h4>
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Purpose</th>
                <th>Query</th>
                <th>Results</th>
                <th>Accepted</th>
                <th>Rejected</th>
                <th>Latency</th>
                <th>Cache</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {enrichment.queries.map((query) => (
                <tr key={query.query_id}>
                  <td>{query.purpose.replace(/_/g, " ")}</td>
                  <td className="url-wrap">{query.query}</td>
                  <td>{query.results}</td>
                  <td>{query.accepted}</td>
                  <td>{query.rejected}</td>
                  <td>{query.latency_ms} ms</td>
                  <td>{query.cache}</td>
                  <td className="muted">{query.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h4>Accepted public sources</h4>
      {enrichment.accepted_evidence.length === 0 ? (
        <p className="muted">No public evidence was accepted for this run.</p>
      ) : (
        <ul className="compact-list">
          {enrichment.accepted_evidence.map((item) => (
            <li key={item.evidence_id}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="url-wrap">
                  {item.title ?? item.url}
                </a>
              ) : (
                <span>{item.title}</span>
              )}
              <span className="muted">
                {" "}
                — confidence {Math.round(item.confidence * 100)}%{item.published_at ? ` · ${new Date(item.published_at).toLocaleDateString()}` : ""}
              </span>
              <p className="muted" style={{ fontSize: "0.8rem", margin: "2px 0 0" }}>
                {item.quote_or_snippet}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h3>Analysis link</h3>
      <div className="detail-grid">
        <div>
          <span className="muted">Included in outbound messages</span>
          <p>
            <StatusPill ok={link.included} label={link.included ? "Yes" : "No"} />
          </p>
        </div>
        <div>
          <span className="muted">Reason</span>
          <p>{link.reason.replace(/_/g, " ")}</p>
        </div>
      </div>
      {link.included && link.url && (
        <p style={{ fontSize: "0.85rem" }}>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="url-wrap">
            {link.url}
          </a>{" "}
          {link.expires_at && <span className="muted">(expires {new Date(link.expires_at).toLocaleString()})</span>}
        </p>
      )}
    </div>
  );
}
