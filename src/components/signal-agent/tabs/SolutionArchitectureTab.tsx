import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

export function SolutionArchitectureTab({ result }: { result: SecureNetworkingTriageResult }) {
  return (
    <div className="tab-content">
      {result.solution_architecture.length > 0 ? (
        <div className="architecture-diagram">
          {result.solution_architecture.map((layer, index) => (
            <div className="architecture-layer" key={`${layer.layer}-${layer.product}-${index}`}>
              <div className="architecture-layer-name">{layer.layer}</div>
              <div className="architecture-arrow">→</div>
              <div className="architecture-product">
                <strong>{layer.product}</strong>
                <span className="muted">{layer.role}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No solution architecture was generated — the primary match was suppressed (NOISE).</p>
      )}

      <h3>Adjacent solutions considered</h3>
      {result.matches.map((match) => (
        <div key={match.entry_id} className="signal-row" style={{ marginBottom: 10 }}>
          <strong>{match.pain_category}</strong>
          {match.solution_decision.adjacent_solutions_considered.length > 0 ? (
            <ul className="evidence-list">
              {match.solution_decision.adjacent_solutions_considered.map((decision, index) => (
                <li key={index}>
                  <span className={`decision-tag decision-${decision.decision}`}>{decision.decision}</span> {decision.solution} —{" "}
                  {decision.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              No adjacent solutions defined for this category.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
