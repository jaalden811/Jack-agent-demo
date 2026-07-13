import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { listMeetings } from "@/lib/webex/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { accessToken } = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Webex is not connected." }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const titleFilter = url.searchParams.get("title")?.toLowerCase() ?? null;

  try {
    const meetings = await listMeetings(accessToken, { from, to, meetingType: "meeting", max: 100 });
    const filtered = titleFilter ? meetings.filter((meeting) => meeting.title?.toLowerCase().includes(titleFilter)) : meetings;

    return NextResponse.json({
      items: filtered.map((meeting) => ({
        id: meeting.id,
        title: meeting.title ?? null,
        start: meeting.start ?? null,
        end: meeting.end ?? null,
        hostEmail: meeting.hostEmail ?? null,
        hostDisplayName: meeting.hostDisplayName ?? null,
        webLink: meeting.webLink ?? null,
        state: meeting.state ?? null
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Could not list Webex meetings", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
