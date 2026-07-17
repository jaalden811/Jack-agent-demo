import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Deal Intelligence — the honest, evidence-cited "is this real, why now, what
 * could kill it" read. Punchy by default: the bottom line, the deal shape, and
 * an at-a-glance row. Everything else (why-now, landmines, who to work, public
 * research, value hypothesis) is one click away under "Show full detail". Every
 * line traces to evidence; nothing is invented. Renders nothing when absent.
 */
export function DealIntelligenceCard({ result }: { result: SecureNetworkingTriageResult }) {
  const di = result.deal_intelligence;
  if (!di) return null;

  const champion = di.power_map.find((p) => p.role_id === "business_champion");
  const hasDetail = di.momentum.length > 0 || di.risks.length > 0 || di.power_map.length > 0 || di.public_context.length > 0 || Boolean(di.value_hypothesis);

  return (
    <section className="panel deal-intel-card" aria-label="Deal intelligence">
      <span className="action-eyebrow">Deal intelligence</span>

      {/* Punchy top line */}
      <p className="deal-intel-headline">{di.headline}</p>
      <div className="deal-intel-shape">
        <span className="chip chip-info">{di.deal_shape.label}</span>
        {di.deal_shape.rationale && <span className="muted"> {di.deal_shape.rationale}</span>}
      </div>

      {/* At a glance */}
      <div className="deal-intel-glance">
        {champion && <span className="chip chip-success">Champion: {champion.name}</span>}
        {di.momentum[0] && <span className="chip chip-muted">Top momentum: {di.momentum[0].label}</span>}
        {di.risks[0] && <span className="chip chip-warning">Top landmine: {di.risks[0].label}</span>}
        {di.public_context.length > 0 && <span className="chip chip-info">{di.public_context.length} public signal{di.public_context.length > 1 ? "s" : ""}</span>}
      </div>

      {hasDetail && (
        <details className="deal-intel-detail">
          <summary>Show full detail</summary>

          <div className="deal-intel-grid">
            {di.momentum.length > 0 && (
              <div>
                <span className="meta-label">Why this is winnable now</span>
                <ul className="compact-list">
                  {di.momentum.slice(0, 5).map((m) => (
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
                  {di.risks.slice(0, 5).map((r) => (
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

          {di.power_map.length > 0 && (
            <div className="deal-intel-people">
              <span className="meta-label">Who to work — and how</span>
              <ul className="compact-list">
                {di.power_map.map((p) => (
                  <li key={p.name}>
                    <strong>{p.name}</strong> — {p.role_label}{" "}
                    <span className={`chip chip-${p.stance === "supportive" ? "success" : p.stance === "skeptical" ? "warning" : "muted"}`}>{p.stance}</span>
                    <br />
                    <span className="muted">{p.play}</span>
                    {p.evidence ? <span className="muted"> — “{p.evidence}”</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {di.public_context.length > 0 && (
            <div className="deal-intel-people">
              <span className="meta-label">Public context (research)</span>
              <ul className="compact-list">
                {di.public_context.map((s) => (
                  <li key={s.id}>
                    {s.label} <span className="muted">— {s.evidence}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {di.value_hypothesis && (
            <p className="deal-intel-value">
              <span className="meta-label">Value hypothesis</span> {di.value_hypothesis}
            </p>
          )}
        </details>
      )}
    </section>
  );
}
