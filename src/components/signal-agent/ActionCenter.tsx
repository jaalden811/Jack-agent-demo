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
// Coordination-timing badges: do-now steps are prominent; later/conditional steps
// are visibly muted so they never carry do-now priority.
const TIMING_BADGE: Record<string, string> = {
  immediate: "Do now",
  before_customer_meeting: "Before customer meeting",
  after_validation: "After validation",
  at_funding_gate: "Later — funding gate",
  if_blocked: "Only if blocked",
  monitor: "Monitor"
};
const TIMING_TONE: Record<string, string> = {
  immediate: "info",
  before_customer_meeting: "info",
  after_validation: "muted",
  at_funding_gate: "muted",
  if_blocked: "muted",
  monitor: "muted"
};

export function ActionCenter({ result }: { result: WebexAutomationRunResult }) {
  const action = result.next_best_action;
  const plan = result.internal_action_plan ?? null;
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
        <span className="action-eyebrow">Next internal move</span>
        <div className="action-badges">
          <span className={`chip chip-${PRIORITY_TONE[action.priority] ?? "muted"}`}>{action.priority} priority</span>
          <span className="chip chip-info">{action.owner_lane}</span>
        </div>
      </div>

      {plan ? (
        (() => {
          const isImmediate = (p: (typeof plan.coordinate_with)[number]) => p.requirement === "required" || p.requirement === "recommended";
          const immediate = plan.coordinate_with.filter(isImmediate);
          const later = plan.coordinate_with.filter((p) => !isImmediate(p));
          return (
        <div className="internal-plan">
          <div className="internal-plan-lead">
            <span className="chip chip-info">Owner: {plan.primary_owner.name ?? plan.primary_owner.role}</span>
            {immediate.map((p, i) => (
              <span key={i} className="chip chip-muted">Coordinate: {p.name ?? p.role}</span>
            ))}
          </div>
          <h2 className="action-title">{plan.your_move}</h2>
          <p className="action-summary">{plan.routed_reason}</p>

          {immediate.length > 0 && (
            <div className="action-block">
              <span className="meta-label">Coordinate now</span>
              <ul className="action-list">
                {immediate.map((p, i) => (
                  <li key={i}>
                    <span className={`chip chip-${TIMING_TONE[p.timing] ?? "info"}`}>{TIMING_BADGE[p.timing] ?? "Do now"}</span>{" "}
                    <strong>{p.name ?? p.role}</strong>
                    {p.name ? ` (${p.role})` : ""} — {p.why}
                    {p.prepare.length > 0 && <div className="muted">Prepare: {p.prepare.join("; ")}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="action-block">
            <span className="meta-label">Customer next step</span>
            <p className="action-summary">
              {/[.!?]$/.test(plan.customer_engagement.next_step) ? plan.customer_engagement.next_step : `${plan.customer_engagement.next_step}.`}
            </p>
          </div>

          {plan.customer_engagement.stakeholders.length > 0 && (
            <div className="action-block">
              <span className="meta-label">Customer engagement</span>
              <ul className="action-list">
                {plan.customer_engagement.stakeholders.map((s, i) => (
                  <li key={i}>
                    <span className="chip chip-muted">Customer</span> <strong>{s.name ?? s.role}</strong>
                    {s.name ? ` — ${s.role}` : ""}{s.engagement ? `: ${s.engagement}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {later.length > 0 && (
            <div className="action-block internal-plan-later">
              <span className="meta-label">Later — only if triggered</span>
              <ul className="action-list">
                {later.map((p, i) => (
                  <li key={i}>
                    <span className={`chip chip-${TIMING_TONE[p.timing] ?? "muted"}`}>{TIMING_BADGE[p.timing] ?? "Later"}</span>{" "}
                    <strong>{p.name ?? p.role}</strong> — {p.condition ? `${p.condition}. ` : ""}{p.why}
                    <div className="muted">Why this appears: this is a future {p.timing === "if_blocked" ? "escalation" : "funding-gate"} action, not a prerequisite for the current step.</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.suggested_coordination && plan.suggested_coordination.length > 0 && (
            <div className="action-block">
              <span className="meta-label">Consider also looping in <span className="chip chip-muted">AI suggested</span></span>
              <ul className="action-list">
                {plan.suggested_coordination.map((s, i) => (
                  <li key={i}>
                    <strong>{s.role}</strong> — {s.why} <span className="muted">({s.trigger})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
          );
        })()
      ) : (
        <>
          <h2 className="action-title">{action.title}</h2>
          <p className="action-summary">{action.summary}</p>
        </>
      )}

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
