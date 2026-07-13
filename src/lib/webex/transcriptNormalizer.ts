import type { WebexTranscriptSnippet } from "@/lib/webex/client";
import type { WebexTranscriptSource } from "@/lib/webex/types";

/**
 * Normalizes Webex meeting-transcript snippets (speaker, timestamp, text)
 * into the same "[Speaker]: text" transcript text format the existing
 * Signal Agent `ingestTranscript()` already parses — so Webex transcripts
 * flow through the exact same engine as pasted/demo transcripts, with no
 * separate ingestion path to maintain.
 *
 * Webex does not label any participant as "the customer," so participants
 * are listed without a role tag; ingestTranscript()'s existing fallback
 * (no "(Customer, ...)" tag found -> treat every speaker as a candidate)
 * already handles this correctly.
 */

function formatOffset(offsetMs: number | undefined): string {
  if (offsetMs === undefined) return "";
  const totalSeconds = Math.floor(offsetMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function normalizeWebexSnippetsToTranscriptText(params: {
  snippets: WebexTranscriptSnippet[];
  meetingTitle: string | null;
  accountNameOverride?: string | null;
}): string {
  const { snippets, meetingTitle, accountNameOverride } = params;

  const accountLine = accountNameOverride?.trim() || meetingTitle?.trim() || "Unknown Webex meeting";
  const participantNames = Array.from(new Set(snippets.map((snippet) => snippet.personName).filter((name): name is string => Boolean(name))));

  const lines: string[] = [`Account: ${accountLine}`, `Participants: ${participantNames.join(", ")}`, "Source: webex"];
  if (meetingTitle) lines.push(`Meeting title: ${meetingTitle}`);
  lines.push("");

  for (const snippet of snippets) {
    const speaker = snippet.personName ?? "Unknown speaker";
    const text = (snippet.text ?? "").trim();
    if (!text) continue;
    const offset = formatOffset(snippet.offsetMillisecond);
    lines.push(`[${speaker}]${offset ? ` (${offset})` : ""}: ${text}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

/** Fallback normalizer for the raw .txt download when snippets are
 * unavailable — Webex's plain-text transcript export already resembles
 * "Speaker: text" lines closely enough for ingestTranscript() to parse
 * directly, so this only prepends the required Account/Participants/
 * Source header. */
export function normalizeWebexRawTextToTranscriptText(params: { rawText: string; meetingTitle: string | null; accountNameOverride?: string | null }): string {
  const { rawText, meetingTitle, accountNameOverride } = params;
  const accountLine = accountNameOverride?.trim() || meetingTitle?.trim() || "Unknown Webex meeting";
  const header = [`Account: ${accountLine}`, "Source: webex", meetingTitle ? `Meeting title: ${meetingTitle}` : "", ""].filter(Boolean);
  return [...header, rawText.trim()].join("\n");
}

export function buildWebexSourceMetadata(params: {
  transcriptId: string;
  meetingId: string | null;
  meetingTitle: string | null;
  host: string | null;
  meetingDate: string | null;
}): WebexTranscriptSource {
  return {
    transcriptId: params.transcriptId,
    meetingId: params.meetingId,
    meetingTitle: params.meetingTitle,
    host: params.host,
    meetingDate: params.meetingDate,
    source: "webex"
  };
}
