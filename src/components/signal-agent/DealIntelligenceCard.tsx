import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Deal Intelligence — the honest, evidence-cited "is this real, why now, what
 * could kill it" read that makes a seller lean in. Deal shape, the momentum
 * that makes it winnable, the landmines to respect, and the value in the
 * customer's own words. Every line traces to the customer's evidence; nothing
 * is invented. Renders nothing when no deal intelligence was produced.
 */
export function DealIntelligenceCard({ result }: { result: SecureNetworkingTriageResult }) {
  const di = result.deal_intelligence;
  if (!di) return null;

  return (
    <section className="panel deal-intel-card" aria-label="Deal intelligence">
      <span className="action-eyebrow">Deal intelligence</span>
      <p className="deal-intel-headline">{di.headline}</p>

      <div className="deal-intel-shape">
        <span className="chip chip-info">{di.deal_shape.label}</span>
        {di.deal_shape.rationale && <span className="muted"> {di.deal_shape.rationale}</span>}
      </div>

      <div className="deal-intel-grid">
        {di.momentum.length > 0 && (
          <div>
            <span className="meta-label">Why this is winnable now</span>
            <ul className="compact-list">
              {di.momentum.slice(0, 4).map((m) => (
                <li key={m.id}>
                  <strong>{m.label}</strong>
                  <span className="muted"> — {m.evidence}</span>
                  {m.speaker ? <span className="muted"> ({m.speaker})</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {di.risks.length > 0 && (
          <div>
            <span className="meta-label">Landmines to respect</span>
            <ul className="compact-list">
              {di.risks.slice(0, 4).map((r) => (
                <li key={r.id}>
                  <strong>{r.label}</strong>
                  <span className="muted"> — {r.evidence}</span>
                  {r.speaker ? <span className="muted"> ({r.speaker})</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {di.value_hypothesis && (
        <p className="deal-intel-value">
          <span className="meta-label">Value hypothesis</span> {di.value_hypothesis}
        </p>
      )}
    </section>
  );
}
