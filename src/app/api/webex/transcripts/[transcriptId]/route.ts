import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { listMeetingTranscripts, listTranscriptSnippets, downloadTranscriptText } from "@/lib/webex/client";
import { normalizeWebexRawTextToTranscriptText, normalizeWebexSnippetsToTranscriptText, buildWebexSourceMetadata } from "@/lib/webex/transcriptNormalizer";
import { readTokenRecord } from "@/lib/webex/store";
import { TRANSCRIPT_SCOPE } from "@/lib/webex/scopePolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ transcriptId: string }> }) {
  const { transcriptId } = await params;
  const { accessToken } = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Webex is not connected." }, { status: 401 });
  }

  const tokenRecord = await readTokenRecord();
  const grantedScopes = tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [];
  if (!grantedScopes.includes(TRANSCRIPT_SCOPE)) {
    return NextResponse.json(
      {
        error: "Transcript access is not granted for the connected Webex account.",
        error_code: "transcript_scope_missing",
        detail: "Click \"Enable transcript access\" in Setup → Webex, then reconnect, before importing a transcript."
      },
      { status: 403 }
    );
  }

  try {
    // The Meeting Transcripts API has no single "get transcript by id"
    // endpoint — metadata (title, meetingId, host) comes from the list
    // endpoint, matched by id.
    const allTranscripts = await listMeetingTranscripts(accessToken, {});
    const metadata = allTranscripts.find((transcript) => transcript.id === transcriptId) ?? null;

    let transcriptText: string;
    let snippetCount = 0;
    try {
      const snippets = await listTranscriptSnippets(accessToken, transcriptId);
      snippetCount = snippets.length;
      transcriptText = normalizeWebexSnippetsToTranscriptText({
        snippets,
        meetingTitle: metadata?.meetingTopic ?? null
      });
    } catch {
      const rawText = await downloadTranscriptText(accessToken, transcriptId);
      transcriptText = normalizeWebexRawTextToTranscriptText({ rawText, meetingTitle: metadata?.meetingTopic ?? null });
    }

    const source = buildWebexSourceMetadata({
      transcriptId,
      meetingId: metadata?.meetingId ?? null,
      meetingTitle: metadata?.meetingTopic ?? null,
      host: metadata?.hostUserId ?? null,
      meetingDate: metadata?.startTime ?? null
    });

    return NextResponse.json({
      transcriptId,
      meetingId: source.meetingId,
      meetingTitle: source.meetingTitle,
      host: source.host,
      meetingDate: source.meetingDate,
      source: "webex",
      snippetCount,
      transcriptText
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Could not retrieve Webex transcript", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
