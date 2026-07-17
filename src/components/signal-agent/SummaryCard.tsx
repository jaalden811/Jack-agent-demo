import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { VerdictBadge } from "@/components/signal-agent/VerdictBadge";

export function SummaryCard({ result }: { result: SecureNetworkingTriageResult }) {
  const { executive_summary: summary } = result;
  const primaryMatch = result.matches[0];
  const solutionMotion = primaryMatch?.recommended_solutions.join(" + ") || "None — suppressed";
  const specialists = result.recommended_specialists;

  return (
    <section className="panel summary-card">
      <div className="summary-headline">
        <VerdictBadge verdict={summary.verdict} />
        <span className="summary-confidence">{Math.round(summary.confidence * 100)}% confidence</span>
        <span
          className={`topbar-pill ${result.analysis_mode === "circuit" ? "ok" : "warn"}`}
          title="Which interpretation layer produced the canonical fields this run (Circuit vs deterministic fallback)"
        >
          Analysis mode: {result.analysis_mode === "circuit" ? "circuit" : result.analysis_mode === "circuit_partial" ? "circuit (partial)" : "deterministic fallback"}
        </span>
        <span className="topbar-pill pending" title="Structural call participants detected by the transcript parser">
          Participants: {result.transcript_meta.participant_count}
        </span>
      </div>

      <div className="summary-body">
        <div>
          <span className="muted">Primary opportunity</span>
          <strong>{summary.primary_opportunity ?? "No category matched"}</strong>
        </div>
        <div>
          <span className="muted">Primary solution motion</span>
          <strong>{solutionMotion}</strong>
        </div>
        <div>
          <span className="muted">Recommended team</span>
          {specialists.length > 0 ? (
            <ul className="compact-list">
              {specialists.map((specialist) => (
                <li key={specialist}>{specialist}</li>
              ))}
            </ul>
          ) : (
            <strong>Not routed</strong>
          )}
        </div>
      </div>

      {summary.secondary_opportunities.length > 0 && (
        <p className="muted" style={{ marginTop: 10 }}>
          Secondary/supporting: {summary.secondary_opportunities.join(", ")}
        </p>
      )}
    </section>
  );
}
