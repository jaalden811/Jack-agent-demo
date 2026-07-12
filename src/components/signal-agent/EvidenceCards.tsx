import type { SignalAgentRunResult } from "@/lib/signal-agent/types";

function EmptyNote({ children }: { children: string }) {
  return <p className="muted" style={{ fontSize: "0.9rem" }}>{children}</p>;
}

export function EvidenceCards({ result }: { result: SignalAgentRunResult }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Evidence</h2>
          <p className="muted">Everything the scoring engine actually matched — no black box.</p>
        </div>
      </div>

      <div className="evidence-grid">
        <div className="signal-row">
          <strong>Matched transcript snippets</strong>
          {result.matched_text.length > 0 ? (
            <ul className="evidence-list">
              {result.matched_text.map((text, index) => (
                <li key={index}>“{text}”</li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No verbatim pain language matched.</EmptyNote>
          )}
        </div>

        <div className="signal-row">
          <strong>Matched keywords</strong>
          {result.matched_keywords.length > 0 ? (
            <div className="chip-row">
              {result.matched_keywords.map((keyword) => (
                <span className="chip" key={keyword}>{keyword}</span>
              ))}
            </div>
          ) : (
            <EmptyNote>No keyword-level matches.</EmptyNote>
          )}
        </div>

        <div className="signal-row">
          <strong>Matched semantic cues</strong>
          {result.matched_semantic_cues.length > 0 ? (
            <ul className="evidence-list">
              {result.matched_semantic_cues.map((cue) => (
                <li key={cue.cue}>
                  {cue.cue} <span className="muted">(similarity {cue.similarity.toFixed(2)})</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No semantic cues cleared the candidate threshold.</EmptyNote>
          )}
        </div>

        <div className="signal-row">
          <strong>Negative cues / penalties</strong>
          {result.negative_cues.length > 0 ? (
            <ul className="evidence-list">
              {result.negative_cues.map((cue, index) => (
                <li key={index} className="negative-cue">{cue}</li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No negation or wrong-domain cues detected.</EmptyNote>
          )}
        </div>

        <div className="signal-row">
          <strong>Account corroboration</strong>
          {result.corroboration.length > 0 ? (
            <ul className="evidence-list">
              {result.corroboration.map((item, index) => (
                <li key={index}>
                  {item.signal} <span className="muted">({item.source})</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No structured account signal corroborated this pain point.</EmptyNote>
          )}
        </div>

        <div className="signal-row">
          <strong>Why this solution</strong>
          <p>{result.why_this_solution}</p>
        </div>

        <div className="signal-row">
          <strong>Why not an adjacent solution</strong>
          <p>{result.why_not_adjacent_solution}</p>
          {result.adjacent_solutions.length > 0 && (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Adjacent options considered: {result.adjacent_solutions.join(", ")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
