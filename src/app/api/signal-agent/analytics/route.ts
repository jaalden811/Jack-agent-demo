import { NextResponse } from "next/server";
import { readProductEvents, recordProductEvent, summarizeEvents } from "@/lib/analytics/analyticsStore";
import { VALID_PRODUCT_EVENT_TYPES, type ProductEventType } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Compact local product-value analytics summary. */
export async function GET() {
  const summary = summarizeEvents(await readProductEvents());
  return NextResponse.json({ summary }, { headers: { "Cache-Control": "no-store" } });
}

/** Record an observable client-side product event (e.g. full_brief_opened,
 * progressive_section_opened). Server-derived events are recorded elsewhere. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const type = body.type;
  if (typeof type !== "string" || !VALID_PRODUCT_EVENT_TYPES.includes(type as ProductEventType)) {
    return NextResponse.json({ error: "Unknown event type" }, { status: 400 });
  }
  await recordProductEvent({
    type: type as ProductEventType,
    run_id: typeof body.run_id === "string" ? body.run_id.slice(0, 64) : null,
    account: typeof body.account === "string" ? body.account.slice(0, 120) : null,
    profile_id: typeof body.profile_id === "string" ? body.profile_id.slice(0, 120) : null,
    metadata: typeof body.metadata === "object" && body.metadata ? (body.metadata as Record<string, unknown>) : {}
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
