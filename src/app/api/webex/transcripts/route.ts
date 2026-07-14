import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { listMeetingTranscripts } from "@/lib/webex/client";
import { readTokenRecord } from "@/lib/webex/store";
import { TRANSCRIPT_SCOPE } from "@/lib/webex/scopePolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { accessToken } = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Webex is not connected." }, { status: 401 });
  }

  // Check the granted scope before ever calling Webex, so the caller
  // sees a precise "missing permission" message instead of an opaque
  // Webex API rejection — and so we never confuse "no transcript scope"
  // with "no transcript exists yet" (an empty items[] is not an error).
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

  const url = new URL(request.url);
  const meetingId = url.searchParams.get("meetingId") ?? undefined;
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  try {
    const transcripts = await listMeetingTranscripts(accessToken, { meetingId, from, to });
    return NextResponse.json({
      items: transcripts.map((transcript) => ({
        id: transcript.id,
        meetingTopic: transcript.meetingTopic ?? null,
        meetingId: transcript.meetingId ?? null,
        startTime: transcript.startTime ?? null,
        status: transcript.status ?? null
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Could not list Webex transcripts", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
