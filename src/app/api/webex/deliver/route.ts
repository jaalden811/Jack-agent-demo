import { NextResponse } from "next/server";
import { deliverPeachtreePipeline } from "@/lib/webex/automation";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { WebexTranscriptSource } from "@/lib/webex/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Explicit "Retry failed delivery" / "Send via Webex" action for the
 * Routing Preview tab. Reuses the exact same pipeline as the autonomous
 * webhook (deliverPeachtreePipeline), so idempotency (transcriptId:lane)
 * is enforced identically — lanes already delivered are skipped, only
 * failed/undelivered lanes are (re)attempted.
 */
export async function POST(request: Request) {
  let body: { result?: SecureNetworkingTriageResult; webexSource?: WebexTranscriptSource | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = body.result;
  if (!result || !result.transcript_meta || !result.executive_summary) {
    return NextResponse.json({ error: "A full Signal Agent result is required." }, { status: 400 });
  }

  try {
    const peachtree = await deliverPeachtreePipeline(result, result.transcript_meta.raw_text, body.webexSource ?? null);
    return NextResponse.json({ peachtree });
  } catch (error) {
    return NextResponse.json(
      { error: "Delivery failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
