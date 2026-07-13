"use client";

import { useState } from "react";
import type { WebexAutomationRunResult } from "@/lib/webex/types";

export function RoutingPreviewTab({
  result,
  onResultUpdate
}: {
  result: WebexAutomationRunResult;
  onResultUpdate: (result: WebexAutomationRunResult) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const { peachtree } = result;

  const hasFailedOrUndelivered = peachtree.delivery.some((item) => item.attempted && !item.delivered);

  async function retryDelivery() {
    setRetrying(true);
    try {
      const response = await fetch("/api/webex/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, webexSource: result.webex_source })
      });
      const data = await response.json();
      if (response.ok) {
        onResultUpdate({ ...result, peachtree: data.peachtree });
      }
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="tab-content">
      <div className="detail-grid">
        <div>
          <span className="muted">Detected lifecycle stage</span>
          <p>
            <strong>{peachtree.lifecycle.lifecycle_stage}</strong> — {peachtree.lifecycle.lifecycle_reason}
          </p>
        </div>
        <div>
          <span className="muted">Routing config</span>
          <p>v{peachtree.routing_config_version}</p>
        </div>
        <div>
          <span className="muted">Auto-send</span>
          <p>{peachtree.auto_send_enabled ? "Enabled for this run" : "Off — preview only"}</p>
        </div>
      </div>

      {peachtree.routing.length === 0 ? (
        <div className="warning slim">NOISE — no sales or technical action was routed for this transcript.</div>
      ) : (
        <>
          <h3>Actions by lane</h3>
          {(["sales", "technical"] as const).map((lane) => {
            const decision = peachtree.routing.find((item) => item.lane === lane);
            if (!decision) return null;
            return (
              <div key={lane} className="signal-row" style={{ marginBottom: 10 }}>
                <strong>{lane === "sales" ? "Sales / Commercial" : "Technical / Specialist"} actions</strong>
                <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0" }}>
                  Recipient: {decision.recipient_name} ({decision.recipient_email ?? "not configured"}) — {decision.assigned_role}
                </p>
                <ul className="evidence-list">
                  {decision.actions.map((action, index) => (
                    <li key={index}>{action}</li>
                  ))}
                </ul>
                <p className="muted" style={{ fontSize: "0.8rem" }}>
                  Reason: {decision.reason.join("; ")}
                </p>
              </div>
            );
          })}

          <h3>Webex message preview</h3>
          {peachtree.messages.map((message) => (
            <div key={`webex-${message.lane}`} className="signal-row" style={{ marginBottom: 10 }}>
              <strong>{message.subject}</strong>
              <p className="muted" style={{ fontSize: "0.82rem" }}>
                To: {message.recipient_email ?? "not configured"} · {message.character_count} characters
              </p>
              <pre className="internal-brief">{message.markdown}</pre>
            </div>
          ))}

          <h3>Email preview</h3>
          {peachtree.emails.map((email) => (
            <div key={`email-${email.lane}`} className="signal-row" style={{ marginBottom: 10 }}>
              <strong>{email.subject}</strong>
              <p className="muted" style={{ fontSize: "0.82rem" }}>
                To: {email.recipient_email ?? "not configured"}
              </p>
              <pre className="internal-brief">{email.text}</pre>
            </div>
          ))}

          <h3>Delivery status</h3>
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Lane</th>
                <th>Channel</th>
                <th>Recipient</th>
                <th>Status</th>
                <th>Message ID / code</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {peachtree.delivery.map((item, index) => (
                <tr key={index}>
                  <td>{item.lane}</td>
                  <td>{item.channel}</td>
                  <td>{item.recipient_email ?? "—"}</td>
                  <td>{item.delivered ? "Delivered" : item.attempted ? "Failed" : "Not sent"}</td>
                  <td>{item.message_id ?? item.status_code ?? "—"}</td>
                  <td>{item.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasFailedOrUndelivered && (
            <div className="actions">
              <button type="button" className="button secondary" onClick={retryDelivery} disabled={retrying}>
                {retrying ? "Sending…" : "Retry failed delivery"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
