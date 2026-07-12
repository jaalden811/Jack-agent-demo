"use client";

import { useState } from "react";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

const INITIAL_SNIPPET_COUNT = 5;

export function ScoreEvidenceTab({ result }: { result: SecureNetworkingTriageResult }) {
  const [showAll, setShowAll] = useState(false);
  const primary = result.matches[0];
  const allSnippets = result.matches.flatMap((match) => match.matched_text);
  const visibleSnippets = showAll ? allSnippets : allSnippets.slice(0, INITIAL_SNIPPET_COUNT);

  if (!primary) {
    return (
      <div className="tab-content">
        <p className="muted">No match was scored.</p>
      </div>
    );
  }

  const breakdown = primary.score_breakdown;

  return (
    <div className="tab-content">
      <h3>Score breakdown — {primary.pain_category}</h3>
      <table className="evidence-table score-table">
        <tbody>
          <tr>
            <td>Keyword</td>
            <td>
              {breakdown.keyword_score.toFixed(2)} × {breakdown.keyword_weight.toFixed(2)}
            </td>
            <td>{(breakdown.keyword_score * breakdown.keyword_weight).toFixed(3)}</td>
          </tr>
          <tr>
            <td>Semantic</td>
            <td>
              {breakdown.semantic_score.toFixed(2)} × {breakdown.semantic_weight.toFixed(2)}
            </td>
            <td>{(breakdown.semantic_score * breakdown.semantic_weight).toFixed(3)}</td>
          </tr>
          <tr>
            <td>Transcript intent</td>
            <td>
              {breakdown.intent_score.toFixed(2)} × {breakdown.intent_weight.toFixed(2)}
            </td>
            <td>{(breakdown.intent_score * breakdown.intent_weight).toFixed(3)}</td>
          </tr>
          <tr>
            <td>Structured account</td>
            <td>
              {breakdown.structured_account_score.toFixed(2)} × {breakdown.structured_account_weight.toFixed(2)}
            </td>
            <td>{(breakdown.structured_account_score * breakdown.structured_account_weight).toFixed(3)}</td>
          </tr>
          <tr>
            <td>Penalties</td>
            <td>—</td>
            <td>-{breakdown.penalty.toFixed(3)}</td>
          </tr>
          <tr className="score-final-row">
            <td>
              <strong>Final</strong>
            </td>
            <td>—</td>
            <td>
              <strong>{breakdown.final.toFixed(3)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ marginTop: 20 }}>Transcript snippets</h3>
      {visibleSnippets.length > 0 ? (
        <ul className="evidence-list">
          {visibleSnippets.map((snippet, index) => (
            <li key={index}>“{snippet}”</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No verbatim pain language matched.</p>
      )}
      {allSnippets.length > INITIAL_SNIPPET_COUNT && (
        <button type="button" className="button secondary" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show fewer" : `Show all evidence (${allSnippets.length})`}
        </button>
      )}
    </div>
  );
}
