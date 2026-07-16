import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { DecisionCriterion, ObjectionEntry } from "@/lib/decision-packet/types";

/**
 * Decision Packet tab — the richer analytical layer, rendered with progressive
 * disclosure so the salient shape (how many criteria/objections, overall
 * confidence) reads first, and the evidence expands on demand. Renders
 * structured data only; every claim is evidence-linked and labeled with a
 * confidence and an explicit limitation.
 */

function confidenceBand(confidence: number): string {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}

function groupByCategory(criteria: DecisionCriterion[]): Array<{ label: string; items: DecisionCriterion[] }> {
  const byLabel = new Map<string, DecisionCriterion[]>();
  for (const c of criteria) {
    const list = byLabel.get(c.label) ?? [];
    list.push(c);
    byLabel.set(c.label, list);
  }
  return Array.from(byLabel.entries()).map(([label, items]) => ({ label, items }));
}

function objectionsByType(objections: ObjectionEntry[]): Array<{ label: string; items: ObjectionEntry[] }> {
  const byLabel = new Map<string, ObjectionEntry[]>();
  for (const o of objections) {
    const list = byLabel.get(o.label) ?? [];
    list.push(o);
    byLabel.set(o.label, list);
  }
  return Array.from(byLabel.entries()).map(([label, items]) => ({ label, items }));
}

export function DecisionPacketTab({ result }: { result: SecureNetworkingTriageResult }) {
  const packet = result.decision_packet;
  if (!packet) {
    return (
      <div className="tab-content">
        <p className="muted">No decision packet was assembled for this run.</p>
      </div>
    );
  }

  const { business_impact, decision_criteria, objections, evidence_quality } = packet;
  const criteriaGroups = groupByCategory(decision_criteria);
  const objectionGroups = objectionsByType(objections);

  return (
    <div className="tab-content decision-packet">
      <div className="dp-summary">
        <span className="summary-metric">
          <strong>{evidence_quality.criteria_count}</strong> decision criteria
        </span>
        <span className="summary-metric">
          <strong>{evidence_quality.objection_count}</strong> objections
        </span>
        <span className="summary-metric">
          <strong>{evidence_quality.impact_count}</strong> impact signals
        </span>
        <span className={`topbar-pill ${confidenceBand(evidence_quality.confidence)}`}>
          criteria confidence {Math.round(evidence_quality.confidence * 100)}%
        </span>
      </div>

      {business_impact.length > 0 && (
        <>
          <h3>Business impact</h3>
          <ul className="compact-list">
            {business_impact.map((impact, index) => (
              <li key={index}>
                <span className={`chip ${impact.kind === "quantified" ? "chip-info" : "chip-muted"}`}>{impact.kind}</span> {impact.statement}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Decision criteria</h3>
      {criteriaGroups.length === 0 ? (
        <p className="muted">No explicit decision criteria were stated in this transcript.</p>
      ) : (
        criteriaGroups.map((group) => (
          <details key={group.label} className="dp-group">
            <summary>
              {group.label} <span className="muted">({group.items.length})</span>
            </summary>
            <ul className="compact-list">
              {group.items.map((c) => (
                <li key={c.criterion_id}>
                  <span className={`topbar-pill ${confidenceBand(c.confidence)}`}>{confidenceBand(c.confidence)}</span> {c.statement}
                  {c.speaker ? <span className="muted"> — {c.speaker}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ))
      )}

      <h3>Objections &amp; how to address them</h3>
      {objectionGroups.length === 0 ? (
        <p className="muted">No typed objections were detected in this transcript.</p>
      ) : (
        objectionGroups.map((group) => (
          <details key={group.label} className="dp-group">
            <summary>
              {group.label} <span className="muted">({group.items.length})</span>
            </summary>
            {group.items.map((o) => (
              <div key={o.objection_id} className="dp-objection">
                <p className="dp-objection-statement">{o.statement}</p>
                <p className="dp-objection-response muted">
                  <strong>How to address:</strong> {o.suggested_response}
                </p>
              </div>
            ))}
          </details>
        ))
      )}

      {evidence_quality.limitations.length > 0 && (
        <details className="dp-group">
          <summary>Evidence quality &amp; limitations</summary>
          <ul className="compact-list">
            {evidence_quality.limitations.map((limitation, index) => (
              <li key={index} className="muted">
                {limitation}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
