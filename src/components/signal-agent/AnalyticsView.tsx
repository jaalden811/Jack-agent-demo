"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSummary } from "@/lib/analytics/types";

/** Compact local product-value analytics. Observable events only (no message
 * open/read). No enterprise analytics API. */
export function AnalyticsView() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/signal-agent/analytics")
      .then((r) => r.json())
      .then((j) => setSummary(j.summary as AnalyticsSummary))
      .catch(() => setError("Could not load analytics."));
  }, []);

  if (error) return <div className="setup-step"><p className="chip-danger">{error}</p></div>;
  if (!summary) return <div className="setup-step"><p className="muted">Loading analytics…</p></div>;

  const metrics: Array<{ label: string; value: string }> = [
    { label: "Alerts generated", value: String(summary.alerts_generated) },
    { label: "Alerts suppressed", value: String(summary.alerts_suppressed) },
    { label: "Pursue rate", value: `${Math.round(summary.pursue_rate * 100)}%` },
    { label: "Action acceptance", value: `${Math.round(summary.action_acceptance * 100)}%` },
    { label: "Action completion", value: `${Math.round(summary.action_completion * 100)}%` },
    { label: "Assistant questions", value: String(summary.assistant_questions) },
    { label: "Research requests", value: String(summary.public_research_requests) },
    { label: "Avg personal relevance", value: summary.avg_personal_relevance == null ? "—" : String(summary.avg_personal_relevance) }
  ];

  return (
    <div className="setup-step">
      <p className="muted" style={{ fontSize: "0.85rem" }}>Local product-value analytics from observable events only (never message open/read).</p>
      <div className="summary-grid">
        {metrics.map((m) => (
          <div key={m.label} className="summary-metric">
            <span className="muted">{m.label}</span>
            <strong>{m.value}</strong>
          </div>
        ))}
      </div>
      {summary.top_suppression_reasons.length > 0 && (
        <>
          <h4 style={{ marginBottom: 4 }}>Top suppression reasons</h4>
          <ul className="compact-list">
            {summary.top_suppression_reasons.map((r) => (
              <li key={r.reason}>{r.reason.replace(/_/g, " ")} — {r.count}</li>
            ))}
          </ul>
        </>
      )}
      {summary.top_seller_objectives.length > 0 && (
        <>
          <h4 style={{ marginBottom: 4 }}>Top seller objectives</h4>
          <ul className="compact-list">
            {summary.top_seller_objectives.map((o) => (
              <li key={o.objective_id}>{o.objective_id.replace(/_/g, " ")} — {o.count}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
