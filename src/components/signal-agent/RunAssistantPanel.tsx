"use client";

import { useState } from "react";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { buildRunAssistantContext } from "@/lib/run-assistant/contextFromResult";
import type { AssistantExchange } from "@/lib/run-assistant/types";

/**
 * Run-scoped "Ask about this opportunity" panel. Grounds answers in this run's
 * evidence only; shows evidence citations; never invents. Read-only — it never
 * changes scores or routing.
 */

export function RunAssistantPanel({ result }: { result: SecureNetworkingTriageResult }) {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<AssistantExchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!result.assistant?.available) return null;
  const suggestions = result.assistant.suggested_questions ?? [];

  async function ask(q: string) {
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      const run_context = buildRunAssistantContext(result);
      const res = await fetch("/api/signal-agent/run-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: result.run_id, question: query, run_context }) });
      const j = (await res.json()) as { exchange?: AssistantExchange; error?: string };
      if (!res.ok || !j.exchange) throw new Error(j.error ?? "Could not get an answer");
      setExchanges((prev) => [...prev, j.exchange as AssistantExchange]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get an answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel run-assistant" aria-label="Ask about this opportunity">
      <div className="summary-headline" style={{ marginBottom: 8 }}>
        <strong>Ask about this call</strong>
        <span className="topbar-pill pending" title="Answers are grounded in this run's evidence only">grounded</span>
      </div>

      {exchanges.length > 0 && (
        <ul className="compact-list assistant-log">
          {exchanges.map((x) => (
            <li key={x.exchange_id} style={{ marginBottom: 8 }}>
              <p><strong>Q:</strong> {x.question}</p>
              <p><strong>A:</strong> {x.answer.answer}</p>
              {x.answer.evidence.length > 0 && (
                <p className="muted" style={{ fontSize: "0.8rem" }}>Evidence: {x.answer.evidence.map((e) => `${e.evidence_id} (${e.source_type})`).join(", ")}</p>
              )}
              {x.answer.missing_information.length > 0 && (
                <p className="muted" style={{ fontSize: "0.8rem" }}>Missing: {x.answer.missing_information.join("; ")}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="chip-row" style={{ marginBottom: 8 }}>
        {suggestions.slice(0, 6).map((s) => (
          <button key={s} type="button" className="chip chip-info" disabled={busy} onClick={() => ask(s)}>{s}</button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="assistant-input"
      >
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a grounded question about this call…" aria-label="Ask a question about this call" disabled={busy} />
        <button type="submit" className="button primary" disabled={busy || question.trim().length < 2}>{busy ? "Asking…" : "Ask"}</button>
      </form>
      {error && <p className="chip-danger" style={{ marginTop: 6, fontSize: "0.8rem" }}>{error}</p>}
    </section>
  );
}
