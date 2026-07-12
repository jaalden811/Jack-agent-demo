import type { SignalAgentRunResult } from "@/lib/signal-agent/types";
import { VerdictBadge } from "@/components/signal-agent/VerdictBadge";

const NEXT_ACTION_LABEL: Record<SignalAgentRunResult["next_best_action"], string> = {
  specialist_route: "Route to specialist",
  human_review: "Needs human review",
  suppress: "Suppressed — no action"
};

export function ResultDashboard({ result }: { result: SignalAgentRunResult }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Result</h2>
          <p className="muted">Confidence-scored verdict for the transcript you just ran.</p>
        </div>
        <VerdictBadge verdict={result.intent_label} />
      </div>

      <div className="summary-grid">
        <div>
          <span className="muted">Confidence</span>
          <strong>{Math.round(result.confidence * 100)}%</strong>
        </div>
        <div>
          <span className="muted">Account</span>
          <strong>{result.account ?? "Unknown / not on file"}</strong>
        </div>
        <div>
          <span className="muted">Pain category</span>
          <strong>{result.pain_category_label ?? "No category matched"}</strong>
        </div>
        <div>
          <span className="muted">Domain</span>
          <strong>{result.domain ?? "—"}</strong>
        </div>
        <div>
          <span className="muted">Recommended solution family</span>
          <strong>{result.recommended_solution.length > 0 ? result.recommended_solution.join(", ") : "None — suppressed"}</strong>
        </div>
        <div>
          <span className="muted">Recommended specialist</span>
          <strong>{result.recommended_specialist ?? "Not routed"}</strong>
        </div>
        <div>
          <span className="muted">Next best action</span>
          <strong>{NEXT_ACTION_LABEL[result.next_best_action]}</strong>
        </div>
        <div>
          <span className="muted">Semantic mode</span>
          <strong>{result.semantic_mode === "openai_embeddings" ? "OpenAI embeddings" : "Deterministic fallback"}</strong>
        </div>
      </div>

      {result.additional_labels.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <strong>Additional matched categories</strong>
          <ul className="compact-list">
            {result.additional_labels.map((label) => (
              <li key={label.pain_category}>
                {label.pain_category_label} — {Math.round(label.confidence * 100)}% ({label.intent_label})
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
