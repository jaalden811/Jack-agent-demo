import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { verifyWebhookSignature, listTranscriptSnippets, downloadTranscriptText, listMeetingTranscripts } from "@/lib/webex/client";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { getProcessedTranscript, recordWebhookEventReceived, appendWebexAudit, readAutopilotOverride } from "@/lib/webex/store";
import { normalizeWebexRawTextToTranscriptText, normalizeWebexSnippetsToTranscriptText, buildWebexSourceMetadata } from "@/lib/webex/transcriptNormalizer";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { deliverPeachtreePipeline } from "@/lib/webex/automation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WebhookEnvelope = {
  id: string;
  resource: string;
  event: string;
  data?: {
    id?: string;
    meetingId?: string;
    scheduledMeetingId?: string;
    meetingSeriesId?: string;
    hostEmail?: string;
    hostUserId?: string;
    siteUrl?: string;
  };
};

/** Runs in the background after the 200 response has already been sent —
 * Webex must never wait for full transcript analysis. This app has no
 * separate job-queue infrastructure, so the supported mechanism is a
 * fire-and-forget async task in the same long-running Node process
 * (this route runs on the Node.js runtime, not Edge). */
async function processTranscriptCreatedEvent(transcriptId: string, meetingId: string | null): Promise<void> {
  try {
    const config = getConfig();
    const autopilotOverride = await readAutopilotOverride();
    const autopilotEnabled = autopilotOverride ?? config.WEBEX_AUTOPILOT_ENABLED;
    if (!autopilotEnabled) {
      await appendWebexAudit({
        event: "processing_skipped",
        timestamp: new Date().toISOString(),
        transcriptId,
        note: "Autopilot is disabled; the event was received but not processed."
      });
      return;
    }

    const already = await getProcessedTranscript(transcriptId);
    if (already) {
      await appendWebexAudit({
        event: "duplicate_webhook_skipped",
        timestamp: new Date().toISOString(),
        transcriptId,
        note: "Transcript already processed; skipped to guarantee at-most-once delivery per lane."
      });
      return;
    }

    const { accessToken } = await getValidAccessToken();
    if (!accessToken) {
      await appendWebexAudit({
        event: "processing_failed",
        timestamp: new Date().toISOString(),
        transcriptId,
        error: "Webex is not connected; cannot fetch the transcript."
      });
      return;
    }

    const allTranscripts = await listMeetingTranscripts(accessToken, {});
    const metadata = allTranscripts.find((transcript) => transcript.id === transcriptId) ?? null;

    let transcriptText: string;
    try {
      const snippets = await listTranscriptSnippets(accessToken, transcriptId);
      transcriptText = normalizeWebexSnippetsToTranscriptText({ snippets, meetingTitle: metadata?.meetingTopic ?? null });
    } catch {
      const rawText = await downloadTranscriptText(accessToken, transcriptId);
      transcriptText = normalizeWebexRawTextToTranscriptText({ rawText, meetingTitle: metadata?.meetingTopic ?? null });
    }

    const webexSource = buildWebexSourceMetadata({
      transcriptId,
      meetingId: metadata?.meetingId ?? meetingId,
      meetingTitle: metadata?.meetingTopic ?? null,
      host: metadata?.hostUserId ?? null,
      meetingDate: metadata?.startTime ?? null
    });

    const result = await runSignalAgent({ customTranscript: transcriptText });
    await deliverPeachtreePipeline(result, transcriptText, webexSource);
  } catch (error) {
    await appendWebexAudit({
      event: "processing_failed",
      timestamp: new Date().toISOString(),
      transcriptId,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const config = getConfig();

  if (config.WEBEX_WEBHOOK_SECRET) {
    const signature = request.headers.get("x-spark-signature");
    if (!verifyWebhookSignature(config.WEBEX_WEBHOOK_SECRET, rawBody, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  }

  let envelope: WebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as WebhookEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Only the documented meetingTranscripts/created event is handled here.
  if (envelope.resource !== "meetingTranscripts" || envelope.event !== "created") {
    return NextResponse.json({ received: true, ignored: true });
  }

  const transcriptId = envelope.data?.id;
  if (!transcriptId) {
    return NextResponse.json({ error: "Webhook payload missing data.id" }, { status: 400 });
  }

  await recordWebhookEventReceived(transcriptId);
  await appendWebexAudit({
    event: "webhook_event_received",
    timestamp: new Date().toISOString(),
    transcriptId,
    webhookEventId: envelope.id,
    meetingId: envelope.data?.meetingId ?? null
  });

  // Respond immediately; analysis + delivery happens after this response
  // is sent (see processTranscriptCreatedEvent's doc comment above).
  void processTranscriptCreatedEvent(transcriptId, envelope.data?.meetingId ?? null);

  return NextResponse.json({ received: true });
}
