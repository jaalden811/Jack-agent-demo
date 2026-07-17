import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWebexSender } from "@/lib/webex/senderResolution";
import { listWebexRooms, WebexApiError } from "@/lib/webex/client";
import { readSelectedSpaces, writeSelectedSpace } from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lists the connected user's Webex group spaces + the currently selected space
 * per lane (GET), and persists a lane's selected space (POST). This is how the
 * technical lane gets a real destination instead of a blocked self-DM. Never
 * returns tokens/secrets; a missing scope is surfaced precisely.
 */
export async function GET() {
  const selected = await readSelectedSpaces();
  const sender = await resolveWebexSender();
  if (!sender.accessToken || sender.mode !== "connected_user") {
    return NextResponse.json(
      { spaces: [], selected, error: "Connect Webex as a user to choose a delivery space.", scope_required: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const rooms = await listWebexRooms(sender.accessToken, { max: 100 });
    return NextResponse.json(
      { spaces: rooms.map((r) => ({ id: r.id, title: r.title })), selected, error: null, scope_required: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const status = error instanceof WebexApiError ? error.status : undefined;
    if (status === 401 || status === 403) {
      return NextResponse.json(
        {
          spaces: [],
          selected,
          error: "Webex spaces access is not granted on this connection — reconnect Webex to grant the spaces (spark:rooms_read) scope.",
          scope_required: "spark:rooms_read"
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { spaces: [], selected, error: "Could not list Webex spaces. Try again shortly.", scope_required: null },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

const postSchema = z.object({
  lane: z.enum(["sales", "technical"]),
  room_id: z.string().min(1).max(256).nullable(),
  title: z.string().max(256).nullable().optional()
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const { lane, room_id, title } = parsed.data;
  const selected = await writeSelectedSpace(lane, room_id ? { roomId: room_id, title: title ?? null } : null);
  return NextResponse.json({ selected }, { headers: { "Cache-Control": "no-store" } });
}
