import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

export function InternalBriefTab({ result }: { result: SecureNetworkingTriageResult }) {
  const workshopEvidence = result.matches
    .flatMap((match) => match.intent_evidence)
    .find((item) => item.type === "next_step" && item.text.toLowerCase().includes("workshop"));

  const unknowns = Array.from(
    new Set(
      result.matches.flatMap((match) =>
        [...match.solution_decision.choose_when_evidence, ...match.solution_decision.do_not_choose_conflicts]
          .filter((rule) => rule.status === "not_evidenced")
          .map((rule) => rule.rule)
      )
    )
  ).slice(0, 6);

  return (
    <div className="tab-content">
      <pre className="internal-brief">{result.internal_brief}</pre>

      {result.discovery_questions.length > 0 && (
        <>
          <h3>Discovery questions</h3>
          <ul className="compact-list">
            {result.discovery_questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </>
      )}

      <h3>Proposed workshop</h3>
      <p>{workshopEvidence ? workshopEvidence.text : "No explicit workshop request was detected in this transcript."}</p>

      {unknowns.length > 0 && (
        <>
          <h3>Risks / unknowns</h3>
          <ul className="compact-list">
            {unknowns.map((rule, index) => (
              <li key={index}>{rule} — not yet evidenced in this transcript.</li>
            ))}
          </ul>
        </>
      )}

      {result.providers.synthesis_used ? (
        <p className="muted" style={{ marginTop: 12 }}>
          This brief was drafted with OpenAI synthesis, grounded only in the transcript and the taxonomy categories already matched
          above.
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 12 }}>
          This brief was drafted deterministically{result.providers.fallback_reason ? ` (${result.providers.fallback_reason})` : ""}.
        </p>
      )}
    </div>
  );
}
