"use client";

import { useState } from "react";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { WebexAutomationRunResult } from "@/lib/webex/types";
import type { NormalizedPublicSignal } from "@/lib/opportunity-fit/types";

/**
 * "SerpAPI signals" tab (Section 11): account resolution, categorized
 * strategic signal cards, the weighted opportunity-score breakdown,
 * and the pursuit recommendation. Purely presentational except for the
 * account-correction control (Section 12), which re-runs analysis
 * against the original transcript with a corrected account name —
 * never silently rewriting transcript evidence itself.
 */

function AccountResolutionSection({ result, onResultUpdate }: { result: SecureNetworkingTriageResult; onResultUpdate?: (result: WebexAutomationRunResult) => void }) {
  const account = result.account_resolution;
  const [correctionValue, setCorrectionValue] = useState("");
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerunWithAccount(name: string) {
    if (!name.trim() || !onResultUpdate) return;
    setRerunning(true);
    setError(null);
    try {
      const response = await fetch("/api/signal-agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customTranscript: result.transcript_meta.raw_text, userEnteredAccount: name.trim(), options: { deliverToWebex: false } })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.detail ?? "Re-run failed.");
        return;
      }
      onResultUpdate(data as WebexAutomationRunResult);
    } catch {
      setError("Re-run failed — network error.");
    } finally {
      setRerunning(false);
    }
  }

  return (
    <>
      <h3>A. Account resolution</h3>
      <div className="detail-grid">
        <div>
          <span className="muted">Resolved account</span>
          <p>{account.name ?? "Not identified in the available evidence"}</p>
        </div>
        <div>
          <span className="muted">Domain</span>
          <p>{account.domain ?? "—"}</p>
        </div>
        <div>
          <span className="muted">Status</span>
          <p style={{ textTransform: "capitalize" }}>{account.status}</p>
        </div>
        <div>
          <span className="muted">Confidence</span>
          <p>{Math.round(account.confidence * 100)}%</p>
        </div>
        <div>
          <span className="muted">Source</span>
          <p>{(account.source ?? "none").replace(/_/g, " ")}</p>
        </div>
      </div>
      {account.action_required && <div className="warning slim">{account.action_required}</div>}
      {!account.name && (
        <div className="warning slim">
          Account not identified in the available evidence.
          <br />
          Add an account name or select a probable match to enable public-company qualification.
          <br />
          The opportunity may still be routed based on transcript evidence alone.
        </div>
      )}
      {account.alternatives.length > 0 && (
        <>
          <p className="muted" style={{ fontSize: "0.82rem", marginTop: 8 }}>
            Alternate candidates:
          </p>
          <ul className="compact-list">
            {account.alternatives.map((alt, i) => (
              <li key={i}>
                {alt.name} {alt.domain ? `(${alt.domain})` : ""} — {Math.round(alt.confidence * 100)}%
                {onResultUpdate && (
                  <button type="button" className="button secondary" style={{ marginLeft: 8, fontSize: "0.75rem", padding: "2px 8px" }} onClick={() => rerunWithAccount(alt.name)} disabled={rerunning}>
                    Use this account
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {onResultUpdate && (
        <div className="checkbox-row" style={{ marginTop: 10, alignItems: "center", gap: 8 }}>
          <input
            type="text"
            placeholder="Enter or correct the account name"
            value={correctionValue}
            onChange={(e) => setCorrectionValue(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className="button secondary" onClick={() => rerunWithAccount(correctionValue)} disabled={rerunning || !correctionValue.trim()}>
            {rerunning ? "Re-running…" : "Set account & rerun enrichment"}
          </button>
        </div>
      )}
      {error && <div className="warning slim">{error}</div>}
    </>
  );
}

const CATEGORY_LABELS: Record<NormalizedPublicSignal["category"], string> = {
  strategic_objective: "Strategic objectives",
  executive_priority: "Executive priorities",
  trigger_event: "Trigger events",
  technology_alignment: "Technology alignment",
  buying_capacity: "Buying capacity",
  competition: "Competition",
  timing: "Timing",
  negative_signal: "Negative signals"
};

function SignalCard({ signal }: { signal: NormalizedPublicSignal }) {
  return (
    <div className="signal-row" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <strong>{signal.claim.length > 140 ? `${signal.claim.slice(0, 140)}…` : signal.claim}</strong>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          confidence {Math.round(signal.confidence * 100)}% · relevance {Math.round(signal.transcript_relevance * 100)}%
        </span>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "4px 0" }}>
        <a href={signal.source_url} target="_blank" rel="noopener noreferrer">
          {signal.source_title}
        </a>{" "}
        ({signal.source_domain}) {signal.published_at ? `· ${new Date(signal.published_at).toLocaleDateString()}` : ""}
        {signal.corroborating_urls.length > 0 ? ` · +${signal.corroborating_urls.length} corroborating source(s)` : ""}
      </p>
      <p className="muted" style={{ fontSize: "0.78rem" }}>
        Evidence class: {signal.evidence_class.replace(/_/g, " ")} · Supports: {signal.supports.join(", ") || "none"}
      </p>
      {signal.limitations.length > 0 && <p className="muted" style={{ fontSize: "0.76rem" }}>Limitations: {signal.limitations.join("; ")}</p>}
    </div>
  );
}

function StrategicSignalsSection({ result }: { result: SecureNetworkingTriageResult }) {
  const { serpapi_signals: serp } = result;
  const byCategory = new Map<NormalizedPublicSignal["category"], NormalizedPublicSignal[]>();
  for (const signal of serp.signals) {
    const list = byCategory.get(signal.category) ?? [];
    list.push(signal);
    byCategory.set(signal.category, list);
  }

  return (
    <>
      <h3>B. Strategic signals</h3>
      <div className="detail-grid">
        <div>
          <span className="muted">Status</span>
          <p>{serp.status}</p>
        </div>
        <div>
          <span className="muted">Strong / supporting / weak</span>
          <p>
            {serp.strong_signal_count} / {serp.supporting_signal_count} / {serp.weak_signal_count}
          </p>
        </div>
        <div>
          <span className="muted">Rejected results</span>
          <p>{serp.rejected_result_count}</p>
        </div>
      </div>
      {serp.reason && <p className="muted" style={{ fontSize: "0.82rem" }}>Reason: {serp.reason}</p>}

      {Array.from(byCategory.entries()).map(([category, signals]) => (
        <div key={category} style={{ marginTop: 12 }}>
          <h4>{CATEGORY_LABELS[category]}</h4>
          {signals.map((signal) => (
            <SignalCard key={signal.signal_id} signal={signal} />
          ))}
        </div>
      ))}

      {serp.queries.length > 0 && (
        <>
          <h4>Query trace</h4>
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Purpose</th>
                <th>Query</th>
                <th>Returned</th>
                <th>Accepted</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {serp.queries.map((q) => (
                <tr key={q.query_id}>
                  <td>{q.purpose.replace(/_/g, " ")}</td>
                  <td className="url-wrap">{q.query}</td>
                  <td>{q.results_returned}</td>
                  <td>{q.results_accepted}</td>
                  <td>{q.duration_ms}ms</td>
                  <td className="muted">{q.error_code ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function WeightedScoreSection({ result }: { result: SecureNetworkingTriageResult }) {
  const scoring = result.opportunity_scoring;
  const rows: Array<{ label: string; score: number | null; weight: number; contribution: number | null }> = [
    { label: "Transcript opportunity", score: scoring.transcript_score, weight: scoring.weights.transcript_opportunity_score ?? 0, contribution: null },
    { label: "Qualification quality", score: scoring.qualification_score, weight: scoring.weights.qualification_quality_score ?? 0, contribution: null },
    { label: "External account fit", score: scoring.external_fit_score, weight: scoring.weights.external_fit_score ?? 0, contribution: null },
    { label: "Account confidence", score: scoring.account_confidence_score, weight: scoring.weights.account_resolution_confidence ?? 0, contribution: null }
  ];

  return (
    <>
      <h3>C. Weighted opportunity score</h3>
      <table className="evidence-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Score</th>
            <th>Weight</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.score === null ? "unavailable" : row.score}</td>
              <td>{row.weight ? `${Math.round(row.weight * 100)}%` : "—"}</td>
              <td>{row.score === null ? "—" : Math.round(row.score * row.weight * 100) / 100}</td>
            </tr>
          ))}
          <tr>
            <td>
              <strong>Final pursuit score</strong>
            </td>
            <td colSpan={3}>
              <strong>{scoring.final_pursuit_score}</strong> ({scoring.decision}, confidence {Math.round(scoring.confidence * 100)}%)
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: "0.78rem" }}>
        Score version: {scoring.score_version}
      </p>
      {scoring.gates.filter((g) => g.triggered).length > 0 && (
        <>
          <h4>Triggered gates</h4>
          <ul className="compact-list">
            {scoring.gates
              .filter((g) => g.triggered)
              .map((g) => (
                <li key={g.gate}>
                  {g.gate.replace(/_/g, " ")} — effect: {g.effect}
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}

function RecommendationSection({ result }: { result: SecureNetworkingTriageResult }) {
  const scoring = result.opportunity_scoring;
  const positives = scoring.factors.filter((f) => f.score_contribution >= 0);
  const negatives = scoring.factors.filter((f) => f.score_contribution < 0);

  return (
    <>
      <h3>D. Recommendation</h3>
      <p>
        <strong>{scoring.decision}</strong> — {scoring.final_pursuit_score}/100 (confidence {Math.round(scoring.confidence * 100)}%)
      </p>
      <h4>Strongest positive factors</h4>
      {positives.length === 0 ? <p className="muted">None identified.</p> : <ul className="compact-list">{positives.map((f, i) => <li key={i}>{f.factor}</li>)}</ul>}
      <h4>Strongest risks</h4>
      {negatives.length === 0 ? <p className="muted">None identified.</p> : <ul className="compact-list">{negatives.map((f, i) => <li key={i}>{f.factor}</li>)}</ul>}
    </>
  );
}

export function SerpApiSignalsTab({ result, onResultUpdate }: { result: SecureNetworkingTriageResult; onResultUpdate?: (result: WebexAutomationRunResult) => void }) {
  return (
    <div className="tab-content">
      <AccountResolutionSection result={result} onResultUpdate={onResultUpdate} />
      <StrategicSignalsSection result={result} />
      <WeightedScoreSection result={result} />
      <RecommendationSection result={result} />
    </div>
  );
}
