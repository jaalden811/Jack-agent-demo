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

  async function loadMeetingsAndTranscripts(): Promise<TranscriptItem[]> {
    setBusy("load");
    setNotice(null);
    try {
      const [meetingsResponse, transcriptsResponse] = await Promise.all([fetch("/api/webex/meetings"), fetch("/api/webex/transcripts")]);
      const meetingsData = await meetingsResponse.json();
      const transcriptsData = await transcriptsResponse.json();
      if (!meetingsResponse.ok || !transcriptsResponse.ok) {
        const detail = transcriptsData.detail ?? meetingsData.detail;
        const message = transcriptsData.error ?? meetingsData.error ?? "Could not load meetings/transcripts.";
        setNotice(detail ? `${message} ${detail}` : message);
        return [];
      }
      setMeetings(meetingsData.items ?? []);
      const items: TranscriptItem[] = transcriptsData.items ?? [];
      setTranscripts(items);
      if (items.length === 0) {
        setNotice("No transcripts are available yet for the connected user.");
      }
      return items;
    } finally {
      setBusy(null);
    }
  }

  async function fetchDetail(transcriptId: string): Promise<TranscriptDetail | null> {
    const response = await fetch(`/api/webex/transcripts/${encodeURIComponent(transcriptId)}`);
    const data = await response.json();
    if (!response.ok) {
      setNotice(data.detail ?? data.error ?? "Could not load transcript.");
      return null;
    }
    return data as TranscriptDetail;
  }

  async function previewTranscript() {
    if (!selectedTranscriptId) return;
    setBusy("preview");
    setNotice(null);
    try {
      const data = await fetchDetail(selectedTranscriptId);
      if (data) setDetail(data);
    } finally {
      setBusy(null);
    }
  }

  function latestTranscript(items: TranscriptItem[]): TranscriptItem | null {
    if (items.length === 0) return null;
    return [...items].sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""))[0];
  }

  async function analyzeLatest() {
    setBusy("latest");
    setNotice(null);
    try {
      const items = transcripts.length > 0 ? transcripts : await loadMeetingsAndTranscripts();
      const latest = latestTranscript(items);
      if (!latest) {
        setNotice("No Webex transcripts are available yet for the connected user.");
        return;
      }
      setSelectedTranscriptId(latest.id);
      const data = await fetchDetail(latest.id);
      if (!data) return;
      setDetail(data);
      setNotice(`Loaded latest transcript: ${data.meetingTitle ?? latest.id} (${data.meetingDate ?? "date unknown"}).`);
      onAnalyze(data.transcriptText, {
        transcriptId: data.transcriptId,
        meetingId: data.meetingId,
        meetingTitle: data.meetingTitle,
        host: data.host,
        meetingDate: data.meetingDate,
        source: "webex"
      });
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

      {status?.connected && !status.capabilities.meeting_transcripts && (
        <div className="warning slim">
          Webex core connection is working, but transcript access (meeting:transcripts_read) has not been granted yet.{" "}
          <a href="/api/webex/oauth/enable-transcripts">Enable transcript access</a> before importing a transcript.
        </div>
      )}

      <div className="actions">
        {!status?.connected && (
          <a className="button secondary" href="/api/webex/oauth/start">
            1. Connect Webex
          </a>
        )}
        <button type="button" className="button secondary" onClick={() => void loadMeetingsAndTranscripts()} disabled={busy === "load" || !status?.connected}>
          2. Load recent meetings/transcripts
        </button>
        <button type="button" onClick={analyzeLatest} disabled={busy === "latest" || !status?.connected || loading}>
          {busy === "latest" ? "Loading…" : "Analyze latest available transcript"}
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
            3. Select transcript
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
              4. Preview transcript
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
              {loading ? "Running…" : "5. Analyze & Route"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
