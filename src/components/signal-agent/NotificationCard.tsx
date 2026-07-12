import type { SignalAgentRunResult } from "@/lib/signal-agent/types";

export function NotificationCard({ result }: { result: SignalAgentRunResult }) {
  const suppressed = result.intent_label === "NOISE" || !result.notification_text;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Internal notification</h2>
          <p className="muted">Internal-only. This automation never contacts the customer.</p>
        </div>
        <span className="safety-badge">No customer contacted</span>
      </div>

      {suppressed ? (
        <div className="warning">
          <strong>Suppressed — no internal notification sent.</strong>
          <p style={{ margin: "6px 0 0" }}>{result.why_this_solution}</p>
        </div>
      ) : (
        <>
          {result.intent_label === "REVIEW" && (
            <div className="warning slim">Needs human review before a specialist acts on this signal.</div>
          )}
          <pre className="notification-draft">{result.notification_text}</pre>
        </>
      )}
    </section>
  );
}
