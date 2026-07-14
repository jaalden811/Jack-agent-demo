import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { buildDeterministicBrief } from "@/lib/webex/opportunityBrief";

export function ExecutiveSummaryTab({ result }: { result: SecureNetworkingTriageResult }) {
  const { executive_summary: summary, stakeholders, commercial_signals: commercial } = result;
  const brief = buildDeterministicBrief(result);

  return (
    <div className="tab-content">
      <div className="opportunity-brief" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 4px" }}>Opportunity thesis</h3>
        <p>{brief.opportunity_thesis}</p>
        {brief.pursuit_line && (
          <p>
            <strong>Pursuit:</strong> {brief.pursuit_line}
          </p>
        )}
        {brief.account_action && <div className="warning slim">{brief.account_action}</div>}
        {brief.why_now.length > 0 && (
          <>
            <h4 style={{ margin: "10px 0 4px" }}>Why now</h4>
            <ul className="compact-list">
              {brief.why_now.map((signal, i) => (
                <li key={i}>{signal}</li>
              ))}
            </ul>
          </>
        )}
        <h4 style={{ margin: "10px 0 4px" }}>MEDDPICC snapshot</h4>
        <ul className="compact-list">
          {brief.meddpicc_lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <h4 style={{ margin: "0 0 4px" }}>Bella — next actions</h4>
            <ul className="compact-list">
              {brief.sales_actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 style={{ margin: "0 0 4px" }}>Jack — next actions</h4>
            <ul className="compact-list">
              {brief.technical_actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </div>
        </div>
        {brief.top_risks.length > 0 && (
          <>
            <h4 style={{ margin: "10px 0 4px" }}>Top risks</h4>
            <ul className="compact-list">
              {brief.top_risks.map((risk, i) => (
                <li key={i}>{risk}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="detail-grid">
        <div>
          <span className="muted">Business problem</span>
          <p>{summary.business_problem}</p>
        </div>
        <div>
          <span className="muted">Business impact</span>
          <p>{summary.business_impact}</p>
        </div>
        <div>
          <span className="muted">Urgency</span>
          <p>{summary.urgency}</p>
        </div>
        <div>
          <span className="muted">Owners</span>
          {stakeholders.length > 0 ? (
            <ul className="compact-list">
              {stakeholders.map((stakeholder) => (
                <li key={stakeholder.name}>
                  {stakeholder.name} — {stakeholder.role} <span className="muted">({stakeholder.ownership_type})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No named stakeholders identified in the transcript.</p>
          )}
        </div>
        <div>
          <span className="muted">Timeline</span>
          <p>{commercial.timeline ?? "Not stated"}</p>
        </div>
        <div>
          <span className="muted">Budget</span>
          <p>{commercial.budget ?? "Not stated"}</p>
        </div>
        <div>
          <span className="muted">Recommended action</span>
          <p>{summary.recommended_next_action}</p>
        </div>
        <div>
          <span className="muted">Opportunity labels</span>
          <p>
            <strong>Primary:</strong> {summary.primary_opportunity ?? "None"}
            {summary.secondary_opportunities.length > 0 && (
              <>
                <br />
                <strong>Secondary/supporting:</strong> {summary.secondary_opportunities.join(", ")}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
