import { NextResponse } from "next/server";
import { readWebhookRecord } from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const record = await readWebhookRecord();
  return NextResponse.json({
    registered: Boolean(record),
    webhookId: record?.webhookId ?? null,
    targetUrl: record?.targetUrl ?? null,
    lastEventAt: record?.lastEventAt ?? null,
    lastEventTranscriptId: record?.lastEventTranscriptId ?? null
  });
}
