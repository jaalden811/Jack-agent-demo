"use client";

import { useEffect, useState } from "react";
import type { WebexStatus } from "@/lib/webex/types";

type MeetingItem = { id: string; title: string | null; start: string | null; hostEmail: string | null };
type TranscriptItem = { id: string; meetingTopic: string | null; meetingId: string | null; startTime: string | null };
type TranscriptDetail = {
  transcriptId: string;
  meetingId: string | null;
  meetingTitle: string | null;
  host: string | null;
  meetingDate: string | null;
  snippetCount: number;
  transcriptText: string;
};

export function WebexTranscriptMode({
  loading,
  onAnalyze
}: {
  loading: boolean;
  onAnalyze: (
    customTranscript: string,
    webexSource: { transcriptId: string; meetingId: string | null; meetingTitle: string | null; host: string | null; meetingDate: string | null; source: "webex" }
  ) => void;
}) {
  const [status, setStatus] = useState<WebexStatus | null>(null);
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>("");
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string>("");
  const [detail, setDetail] = useState<TranscriptDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refreshStatus() {
    fetch("/api/webex/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => undefined);
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function testConnection() {
    setBusy("test");
    try {
      const response = await fetch("/api/webex/status");
      const data: WebexStatus = await response.json();
      setStatus(data);
      setNotice(data.connected ? `Connected as ${data.connected_user.name ?? data.connected_user.email ?? "unknown"}.` : "Not connected.");
    } finally {
      setBusy(null);
    }
  }

  async function loadMeetingsAndTranscripts() {
    setBusy("load");
    setNotice(null);
    try {
      const [meetingsResponse, transcriptsResponse] = await Promise.all([fetch("/api/webex/meetings"), fetch("/api/webex/transcripts")]);
      const meetingsData = await meetingsResponse.json();
      const transcriptsData = await transcriptsResponse.json();
      if (!meetingsResponse.ok || !transcriptsResponse.ok) {
        setNotice(meetingsData.error ?? transcriptsData.error ?? "Could not load meetings/transcripts.");
        return;
      }
      setMeetings(meetingsData.items ?? []);
      setTranscripts(transcriptsData.items ?? []);
      if ((transcriptsData.items ?? []).length === 0) {
        setNotice("No transcripts are available yet for the connected user.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function previewTranscript() {
    if (!selectedTranscriptId) return;
    setBusy("preview");
    setNotice(null);
    try {
      const response = await fetch(`/api/webex/transcripts/${encodeURIComponent(selectedTranscriptId)}`);
      const data = await response.json();
      if (!response.ok) {
        setNotice(data.detail ?? data.error ?? "Could not load transcript.");
        return;
      }
      setDetail(data);
    } finally {
      setBusy(null);
    }
  }

  function analyze() {
    if (!detail) return;
    onAnalyze(detail.transcriptText, {
      transcriptId: detail.transcriptId,
      meetingId: detail.meetingId,
      meetingTitle: detail.meetingTitle,
      host: detail.host,
      meetingDate: detail.meetingDate,
      source: "webex"
    });
  }

  return (
    <div className="webex-transcript-mode">
      <div className="summary-grid">
        <div>
          <span className="muted">Connection</span>
          <strong className={status?.connected ? "provider-yes" : "provider-no"}>{status?.connected ? "Connected" : "Not connected"}</strong>
        </div>
        <div>
          <span className="muted">Identity</span>
          <strong>{status?.connected_user.name ?? status?.connected_user.email ?? "—"}</strong>
        </div>
      </div>

      {notice && <div className="warning slim">{notice}</div>}

      <div className="actions">
        {!status?.connected && (
          <a className="button secondary" href="/api/webex/oauth/start">
            1. Connect Webex
          </a>
        )}
        <button type="button" className="button secondary" onClick={testConnection} disabled={busy === "test"}>
          2. Test connection
        </button>
        <button type="button" className="button secondary" onClick={loadMeetingsAndTranscripts} disabled={busy === "load" || !status?.connected}>
          3. Load recent meetings/transcripts
        </button>
      </div>

      {transcripts.length > 0 && (
        <>
          <label htmlFor="webex-meeting-select">
            Recent meetings ({meetings.length})
            <select id="webex-meeting-select" value={selectedMeetingId} onChange={(event) => setSelectedMeetingId(event.target.value)}>
              <option value="">All meetings</option>
              {meetings.map((meeting) => (
                <option key={meeting.id} value={meeting.id}>
                  {meeting.title ?? meeting.id} {meeting.start ? `— ${meeting.start}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="webex-transcript-select">
            4. Select transcript
            <select id="webex-transcript-select" value={selectedTranscriptId} onChange={(event) => setSelectedTranscriptId(event.target.value)}>
              <option value="">Choose a transcript…</option>
              {transcripts
                .filter((transcript) => !selectedMeetingId || transcript.meetingId === selectedMeetingId)
                .map((transcript) => (
                  <option key={transcript.id} value={transcript.id}>
                    {transcript.meetingTopic ?? transcript.id} {transcript.startTime ? `— ${transcript.startTime}` : ""}
                  </option>
                ))}
            </select>
          </label>

          <div className="actions">
            <button type="button" className="button secondary" onClick={previewTranscript} disabled={busy === "preview" || !selectedTranscriptId}>
              5. Preview transcript
            </button>
          </div>
        </>
      )}

      {detail && (
        <>
          <div className="transcript-collapsed">
            <div className="summary-grid">
              <div>
                <span className="muted">Meeting</span>
                <strong>{detail.meetingTitle ?? "Untitled"}</strong>
              </div>
              <div>
                <span className="muted">Snippets</span>
                <strong>{detail.snippetCount}</strong>
              </div>
            </div>
          </div>
          <pre className="raw-json transcript-view">{detail.transcriptText}</pre>
          <div className="actions">
            <button type="button" onClick={analyze} disabled={loading}>
              {loading ? "Running…" : "6. Analyze transcript"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
