"use client";

import { useRef, useState } from "react";
import type { TranscriptMeta } from "@/lib/signal-agent/types";
import type { WebexTranscriptSource } from "@/lib/webex/types";
import { WebexTranscriptMode } from "@/components/signal-agent/webex/WebexTranscriptMode";

export type TranscriptRunPayload = {
  transcriptId?: "high_intent" | "noise" | "secure_networking_triage";
  customTranscript?: string;
  webexSource?: WebexTranscriptSource;
};

const DEMO_OPTIONS: Array<{ id: "secure_networking_triage" | "high_intent" | "noise"; label: string }> = [
  { id: "secure_networking_triage", label: "Secure networking deal signal (regression fixture)" },
  { id: "high_intent", label: "Collaboration modernization (HIGH_INTENT)" },
  { id: "noise", label: "General curiosity (NOISE)" }
];

export function TranscriptCard({
  onRun,
  loading,
  lastTranscriptMeta,
  onViewTranscript
}: {
  onRun: (payload: TranscriptRunPayload) => void;
  loading: boolean;
  lastTranscriptMeta: TranscriptMeta | null;
  onViewTranscript: () => void;
}) {
  const [mode, setMode] = useState<"demo" | "paste" | "webex">("demo");
  const [demoId, setDemoId] = useState<"secure_networking_triage" | "high_intent" | "noise">("secure_networking_triage");
  const [pastedText, setPastedText] = useState("");
  const [title, setTitle] = useState("");
  const [accountName, setAccountName] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileUpload(file: File) {
    setUploadError(null);
    try {
      if (file.name.toLowerCase().endsWith(".txt")) {
        const text = await file.text();
        setPastedText(text);
        setMode("paste");
        return;
      }
      if (file.name.toLowerCase().endsWith(".docx")) {
        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch("/api/signal-agent/extract-text", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.detail ?? data?.error ?? "Extraction failed");
        setPastedText(data.text);
        setMode("paste");
        return;
      }
      setUploadError("Only .txt or .docx files are supported.");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    }
  }

  function buildCustomTranscript(): string {
    let text = pastedText;
    if (accountName.trim() && !/^account:/im.test(text)) {
      text = `Account: ${accountName.trim()}\n${text}`;
    }
    return text;
  }

  function handleRun() {
    if (mode === "demo") {
      onRun({ transcriptId: demoId });
    } else {
      onRun({ customTranscript: buildCustomTranscript() });
    }
  }

  const canRun = mode === "demo" || pastedText.trim().length > 0;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Transcript</h2>
          <p className="muted">Run a demo transcript or bring your own — nothing here contacts a customer.</p>
        </div>
      </div>

      {lastTranscriptMeta ? (
        <div className="transcript-collapsed">
          <div className="summary-grid">
            <div>
              <span className="muted">Title</span>
              <strong>{lastTranscriptMeta.title ?? "Custom transcript"}</strong>
            </div>
            <div>
              <span className="muted">Account</span>
              <strong>{lastTranscriptMeta.account ?? "Not stated"}</strong>
            </div>
            <div>
              <span className="muted">Participants</span>
              <strong>{lastTranscriptMeta.participant_count}</strong>
            </div>
            <div>
              <span className="muted">Sentences analyzed</span>
              <strong>{lastTranscriptMeta.sentence_count}</strong>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="button secondary" onClick={onViewTranscript}>
              View transcript
            </button>
          </div>
        </div>
      ) : null}

      <div className="mode-toggle">
        <button type="button" className={`button secondary ${mode === "demo" ? "active" : ""}`} onClick={() => setMode("demo")}>
          Demo
        </button>
        <button type="button" className={`button secondary ${mode === "paste" ? "active" : ""}`} onClick={() => setMode("paste")}>
          Paste / upload
        </button>
        <button type="button" className={`button secondary ${mode === "webex" ? "active" : ""}`} onClick={() => setMode("webex")}>
          Webex
        </button>
      </div>

      {mode === "demo" ? (
        <label htmlFor="demo-select">
          Choose a demo transcript
          <select id="demo-select" value={demoId} onChange={(event) => setDemoId(event.target.value as typeof demoId)}>
            {DEMO_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label htmlFor="transcript-text">
            Paste transcript
            <textarea
              id="transcript-text"
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              placeholder="Account: Acme Retail&#10;Participants: Jordan Lee (Customer, IT Director)&#10;&#10;[Jordan Lee]: ..."
            />
          </label>
          <div className="actions">
            <button type="button" className="button secondary" onClick={() => fileInputRef.current?.click()}>
              Upload .txt or .docx
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.docx"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFileUpload(file);
                event.target.value = "";
              }}
            />
          </div>
          {uploadError && <div className="warning slim">{uploadError}</div>}

          <div className="grid" style={{ marginTop: 14 }}>
            <label htmlFor="transcript-title">
              Transcript title
              <input id="transcript-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional label for this run" />
            </label>
            <label htmlFor="account-name">
              Account name
              <input
                id="account-name"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="Optional — used if the transcript has no 'Account:' line"
              />
            </label>
          </div>
        </>
      )}

      {mode === "webex" && (
        <WebexTranscriptMode
          loading={loading}
          onAnalyze={(customTranscript, webexSource) => onRun({ customTranscript, webexSource })}
        />
      )}

      {mode !== "webex" && (
        <div className="actions">
          <button type="button" onClick={handleRun} disabled={loading || !canRun}>
            {loading ? "Running…" : "Run analysis"}
          </button>
        </div>
      )}
    </section>
  );
}
