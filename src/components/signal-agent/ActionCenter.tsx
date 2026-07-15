"use client";

import { useState } from "react";
import type { WebexAutomationRunResult } from "@/lib/webex/types";
import type { ActionFeedbackResponse } from "@/lib/handoff/types";

/**
 * Action Center (Section 15) — the first-class, visually dominant result
 * block: the recommended Next Best Action, owner, priority, timing, why
 * now, readiness, and accept/assign/defer/complete controls that persist
 * feedback. Everything renders from the assembled result; no fixture
 * content is hard-coded.
 */

const FEEDBACK_ACTIONS: Array<{ response: ActionFeedbackResponse; label: string }> = [
  { response: "accepted", label: "Accept" },
  { response: "assigned", label: "Assign to me" },
  { response: "deferred", label: "Defer" },
  { response: "completed", label: "Mark completed" },
  { response: "rejected", label: "Reject" },
  { response: "more_research_requested", label: "Request more research" }
];

const PRIORITY_TONE: Record<string, string> = { critical: "danger", high: "warning", medium: "info", low: "muted" };
const READINESS_TONE: Record<string, string> = { ready: "success", ready_with_gaps: "warning", blocked: "danger" };

export function ActionCenter({ result }: { result: WebexAutomationRunResult }) {
  const action = result.next_best_action;
  const salesReady = result.specialist_handoffs?.sales?.readiness_status ?? "blocked";
  const techReady = result.specialist_handoffs?.technical?.readiness_status ?? "blocked";
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<ActionFeedbackResponse | null>(null);

  if (!action || action.action_type === "suppress") {
    return (
      <section className="panel action-center action-center-suppressed">
        <span className="action-eyebrow">Action Center</span>
        <p className="muted">No qualified opportunity signal — no specialist action recommended for this transcript.</p>
      </section>
    );
  }

  async function sendFeedback(response: ActionFeedbackResponse) {
    setBusy(response);
    setStatus(null);
    try {
      const res = await fetch("/api/signal-agent/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: result.run_id, action_id: action.action_id, actor: action.primary_owner || "specialist", response })
      });
      if (!res.ok) throw new Error(`(${res.status})`);
      setStatus(`Recorded: ${response.replace(/_/g, " ")}`);
    } catch (error) {
      setStatus(`Could not record feedback ${error instanceof Error ? error.message : ""}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel action-center">
      <div className="action-center-head">
        <span className="action-eyebrow">Recommended next action</span>
        <div className="action-badges">
          <span className={`chip chip-${PRIORITY_TONE[action.priority] ?? "muted"}`}>{action.priority} priority</span>
          <span className="chip chip-info">{action.owner_lane}</span>
        </div>
      </div>

      <h2 className="action-title">{action.title}</h2>
      <p className="action-summary">{action.summary}</p>

      <div className="action-grid">
        <div className="action-meta">
          <span className="meta-label">Owner</span>
          <span className="meta-value">{action.primary_owner || "—"}</span>
        </div>
        <div className="action-meta">
          <span className="meta-label">Timing</span>
          <span className="meta-value">{action.recommended_timing ?? "As soon as possible"}</span>
        </div>
        <div className="action-meta">
          <span className="meta-label">Due basis</span>
          <span className="meta-value">{action.due_basis.replace(/_/g, " ")}</span>
        </div>
        <div className="action-meta">
          <span className="meta-label">Confidence</span>
          <span className="meta-value tabular">{Math.round(action.confidence * 100)}%</span>
        </div>
      </div>

      {action.why_now.length > 0 && (
        <div className="action-block">
          <span className="meta-label">Why now</span>
          <ul className="action-list">
            {action.why_now.slice(0, 4).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {action.success_criteria.length > 0 && (
        <div className="action-block">
          <span className="meta-label">Success criteria</span>
          <ul className="action-list">
            {action.success_criteria.slice(0, 4).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="action-readiness">
        <span className={`chip chip-${READINESS_TONE[salesReady] ?? "muted"}`}>Bella handoff: {salesReady.replace(/_/g, " ")} ({result.specialist_handoffs?.sales?.readiness_score ?? 0})</span>
        <span className={`chip chip-${READINESS_TONE[techReady] ?? "muted"}`}>Jack handoff: {techReady.replace(/_/g, " ")} ({result.specialist_handoffs?.technical?.readiness_score ?? 0})</span>
      </div>

      <div className="action-controls" role="group" aria-label="Action response">
        {FEEDBACK_ACTIONS.map((fa) => (
          <button key={fa.response} type="button" className="button secondary" disabled={busy !== null} onClick={() => sendFeedback(fa.response)}>
            {busy === fa.response ? "Saving…" : fa.label}
          </button>
        ))}
      </div>
      {status && <p className="action-status-note" role="status">{status}</p>}
    </section>
  );
}
