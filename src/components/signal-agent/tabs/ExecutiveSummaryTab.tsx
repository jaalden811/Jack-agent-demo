import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

export function ExecutiveSummaryTab({ result }: { result: SecureNetworkingTriageResult }) {
  const { executive_summary: summary, stakeholders, commercial_signals: commercial } = result;

  return (
    <div className="tab-content">
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
