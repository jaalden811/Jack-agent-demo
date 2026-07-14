import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Renders the five INDEPENDENT score dimensions with explicit labels so
 * the UI never conflates "is this conversation important" (signal
 * strength) with "what should we do now" (pursuit recommendation) —
 * directly addressing the confusing "HIGH INTENT 83% / NURTURE 54"
 * display. Every value is read from the API result; no scoring logic
 * lives here.
 */

const MATURITY_LABEL: Record<string, string> = {
  PROBLEM_DISCOVERY: "Problem discovery",
  SOLUTION_DISCOVERY: "Solution discovery",
  VALIDATION: "Validation",
  COMMERCIAL_EVALUATION: "Commercial evaluation",
  PROCUREMENT: "Procurement",
  COMMIT: "Commit"
};

export function ScoreSemanticsSummary({ result }: { result: SecureNetworkingTriageResult }) {
  const scoring = result.opportunity_scoring;
  const account = result.account_resolution;
  const accountLabel =
    account.status === "confirmed" || account.status === "probable"
      ? `${account.name ?? "Resolved"} (${account.status})`
      : `${account.status === "unresolved" ? "Unresolved" : account.status} — confirmation required`;
  const motion = scoring.decision.replace(/_/g, " ");

  return (
    <section className="panel score-semantics">
      <div className="score-semantics-grid">
        <div>
          <span className="muted">Signal strength</span>
          <p>
            <strong>{scoring.signal_strength.band}</strong> — {scoring.signal_strength.score}%
          </p>
          <span className="muted small">Is this conversation important?</span>
        </div>
        <div>
          <span className="muted">Deal maturity</span>
          <p>
            <strong>{MATURITY_LABEL[scoring.deal_maturity] ?? scoring.deal_maturity}</strong>
          </p>
          <span className="muted small">How far along is the deal?</span>
        </div>
        <div>
          <span className="muted">Qualification completeness</span>
          <p>
            <strong>{scoring.qualification_completeness}%</strong>
          </p>
          <span className="muted small">How much do we understand?</span>
        </div>
        <div>
          <span className="muted">External account fit</span>
          <p>
            <strong>{scoring.external_fit_score === null ? "Unavailable" : `${scoring.external_fit_score}/100`}</strong>
          </p>
          <span className="muted small">Does public context strengthen it?</span>
        </div>
        <div>
          <span className="muted">Account resolution</span>
          <p>
            <strong>{accountLabel}</strong>
          </p>
          <span className="muted small">Who is this?</span>
        </div>
        <div className="score-semantics-motion">
          <span className="muted">Recommended motion</span>
          <p>
            <strong>{motion}</strong> — {Math.round(scoring.final_pursuit_score)}/100
          </p>
          <span className="muted small">What should the team do now? (confidence {Math.round(scoring.confidence * 100)}%)</span>
        </div>
      </div>
    </section>
  );
}
