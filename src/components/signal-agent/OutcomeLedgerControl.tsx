"use client";

import { useState } from "react";
import type { OutcomeEvent, OutcomeEventType } from "@/lib/orchestration/types";

/**
 * Records and lists append-only OutcomeEvents for an ActionCase. Outcomes are
 * observed facts (owner accepted, step completed, meeting held, opportunity
 * created, …) — never AI-caused. The server store rejects causal attribution;
 * this control only ever offers safe, associative language. Additive.
 */

const OUTCOME_TYPES: Array<{ value: OutcomeEventType; label: string }> = [
  { value: "owner_accepted", label: "Owner accepted the recommendation" },
  { value: "step_completed", label: "An internal step was completed" },
  { value: "customer_meeting_held", label: "The customer meeting was held" },
  { value: "opportunity_created", label: "An opportunity was created" },
  { value: "stage_changed", label: "The opportunity stage changed" },
  { value: "close_date_changed", label: "The close date changed" },
  { value: "amount_changed", label: "The amount changed" },
  { value: "product_added", label: "Product scope expanded" },
  { value: "customer_declined", label: "The customer declined" },
  { value: "false_positive_confirmed", label: "The signal was a false positive" }
];

export function OutcomeLedgerControl({
  runId,
  actionCaseId,
  existingEvents,
  nextMeasurements,
  outcomeSummary
}: {
  runId: string;
  actionCaseId: string | null;
  existingEvents: OutcomeEvent[];
  nextMeasurements: string[];
  outcomeSummary: string | null;
}) {
  const [events, setEvents] = useState<OutcomeEvent[]>(existingEvents);
  const [type, setType] = useState<OutcomeEventType>("owner_accepted");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function record() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/signal-agent/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId, action_case_id: actionCaseId, type, source: "user", note: note.trim() || null, attribution_language: "observed after action" })
      });
      const data = (await res.json()) as { ok?: boolean; event?: OutcomeEvent; error?: string };
      if (!res.ok || !data.ok || !data.event) throw new Error(data.error ?? `(${res.status})`);
      setEvents((prev) => [...prev, data.event!]);
      setNote("");
      setStatus("Outcome recorded (observed fact — causation not established).");
    } catch (error) {
      setStatus(`Could not record outcome ${error instanceof Error ? error.message : ""}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="outcome-ledger">
      {outcomeSummary && <p className="muted">{outcomeSummary}</p>}

      {events.length > 0 && (
        <ul className="action-list">
          {events.map((e) => (
            <li key={e.id}>
              <span className="chip chip-success">{e.type.replace(/_/g, " ")}</span>{" "}
              <span className="muted">
                {e.attributionLanguage} · {new Date(e.observedAt).toLocaleDateString()} · source {e.source}
              </span>
              {e.note && <div className="muted">{e.note}</div>}
            </li>
          ))}
        </ul>
      )}

      <div className="outcome-record">
        <span className="meta-label">Record an observed outcome</span>
        <div className="outcome-record-row">
          <select value={type} onChange={(ev) => setType(ev.target.value as OutcomeEventType)} aria-label="Outcome type" disabled={busy}>
            {OUTCOME_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input type="text" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Optional note (observed fact — no causation claims)" maxLength={500} disabled={busy} />
          <button type="button" className="button secondary" onClick={record} disabled={busy}>
            {busy ? "Recording…" : "Record"}
          </button>
        </div>
      </div>

      {nextMeasurements.length > 0 && (
        <>
          <span className="meta-label">Measure next</span>
          <ul className="action-list">
            {nextMeasurements.map((m, i) => (
              <li key={i} className="muted">
                {m}
              </li>
            ))}
          </ul>
        </>
      )}

      {status && (
        <p className="action-status-note" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
