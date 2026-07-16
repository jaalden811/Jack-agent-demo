"use client";

import { useRef, useState } from "react";

function parseCsvRow(headerLine: string, dataLine: string): Record<string, string> {
  const headers = headerLine.split(",").map((header) => header.trim());
  const values = dataLine.split(",").map((value) => value.trim());
  const row: Record<string, string> = {};
  headers.forEach((header, index) => {
    row[header] = values[index] ?? "";
  });
  return row;
}

export function ContextCard({
  accountOverrideText,
  onAccountOverrideTextChange,
  enrichPublicSignals,
  onToggleEnrich
}: {
  accountOverrideText: string;
  onAccountOverrideTextChange: (value: string) => void;
  enrichPublicSignals: boolean;
  onToggleEnrich: (value: boolean) => void;
}) {
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleCsvUpload(file: File) {
    setCsvError(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length < 2) throw new Error("CSV needs a header row and at least one data row");
      const row = parseCsvRow(lines[0], lines[1]);
      onAccountOverrideTextChange(JSON.stringify(row, null, 2));
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : "Could not parse CSV");
    }
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Optional context</h2>
          <p className="muted">Supplement the transcript with account data or enrichment — all optional, all additive.</p>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="button secondary" onClick={() => fileInputRef.current?.click()}>
          Upload account CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleCsvUpload(file);
            event.target.value = "";
          }}
        />
      </div>
      {csvError && <div className="warning slim">{csvError}</div>}

      <label htmlFor="account-json" style={{ marginTop: 14 }}>
        Paste account JSON (overrides/extends any matched CSV row)
        <textarea
          id="account-json"
          value={accountOverrideText}
          onChange={(event) => onAccountOverrideTextChange(event.target.value)}
          placeholder={'{\n  "open_opportunity": "true",\n  "budget_signal": "FY26 budget approved"\n}'}
        />
      </label>

      <label className="checkbox-row" htmlFor="enrich-signals">
        <input id="enrich-signals" type="checkbox" checked={enrichPublicSignals} onChange={(event) => onToggleEnrich(event.target.checked)} />
        <span>Enrich with public account and stakeholder signals (SerpAPI; optional, never blocks analysis)</span>
      </label>
    </section>
  );
}
