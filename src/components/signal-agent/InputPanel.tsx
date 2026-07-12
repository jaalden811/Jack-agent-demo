"use client";

import { useState } from "react";

export function InputPanel({
  onRunDemo,
  onRunCustom,
  useOpenAI,
  onToggleOpenAI,
  loading
}: {
  onRunDemo: (transcriptId: "high_intent" | "noise") => void;
  onRunCustom: (text: string) => void;
  useOpenAI: boolean;
  onToggleOpenAI: (value: boolean) => void;
  loading: boolean;
}) {
  const [customTranscript, setCustomTranscript] = useState("");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Run a signal</h2>
          <p className="muted">
            Run a demo transcript or paste your own. Nothing here contacts a customer — every action stays internal.
          </p>
        </div>
      </div>

      <div className="actions">
        <button type="button" onClick={() => onRunDemo("high_intent")} disabled={loading}>
          {loading ? "Running…" : "Run HIGH_INTENT demo"}
        </button>
        <button type="button" className="button secondary" onClick={() => onRunDemo("noise")} disabled={loading}>
          {loading ? "Running…" : "Run NOISE demo"}
        </button>
      </div>

      <label style={{ marginTop: 18 }} htmlFor="custom-transcript">
        Paste custom transcript
        <textarea
          id="custom-transcript"
          value={customTranscript}
          onChange={(event) => setCustomTranscript(event.target.value)}
          placeholder={
            'Account: Acme Retail\nParticipants: Jordan Lee (Customer, IT Director)\n\n[Jordan Lee]: We have too many consoles, but this is not funded and not a priority this year.'
          }
        />
      </label>

      <div className="actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => onRunCustom(customTranscript)}
          disabled={loading || customTranscript.trim().length === 0}
        >
          {loading ? "Running…" : "Run custom transcript"}
        </button>
      </div>

      <label className="checkbox-row" htmlFor="use-openai">
        <input
          id="use-openai"
          type="checkbox"
          checked={useOpenAI}
          onChange={(event) => onToggleOpenAI(event.target.checked)}
        />
        <span>Use OpenAI semantic matching if configured (falls back to deterministic matching automatically)</span>
      </label>
    </section>
  );
}
