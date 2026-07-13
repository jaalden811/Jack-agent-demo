import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { listMeetingTranscripts } from "@/lib/webex/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { accessToken } = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Webex is not connected." }, { status: 401 });
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
