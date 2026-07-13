import { createHash } from "node:crypto";
import { getConfig } from "@/lib/config";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { loadRoutingConfig, classifyLifecycle, buildLaneRouting } from "@/lib/webex/peachtreeRouting";
import { buildMessagesForRouting } from "@/lib/webex/messageBuilder";
import { deliverMessages } from "@/lib/webex/delivery";
import { getProcessedTranscript, markTranscriptProcessed, addLanesSent, appendWebexAudit } from "@/lib/webex/store";
import type { PeachtreePilotResult, WebexDeliveryResult, WebexLane, WebexTranscriptSource } from "@/lib/webex/types";

/**
 * Shared pipeline that turns a completed Signal-to-Solution result into
 * the Peachtree pilot's lifecycle classification, two-lane routing
 * decisions, tailored message previews, and (optionally) real Webex
 * delivery — reused identically by the manual "Analyze transcript" flow,
 * the "Retry/Send" button, and the autonomous webhook handler.
 *
 * Idempotency: the dedupe key is `transcriptId:lane`. For a real Webex
 * transcript, transcriptId is the Webex-issued id. For demo/pasted/
 * uploaded transcripts (no stable Webex id), a content hash of the
 * transcript text is used instead, so re-running the exact same
 * transcript never re-delivers to a lane that already succeeded.
 */

export function computeTranscriptId(transcriptText: string, webexSource: WebexTranscriptSource | null): string {
  if (webexSource?.transcriptId) return webexSource.transcriptId;
  return `local-${createHash("sha256").update(transcriptText).digest("hex").slice(0, 16)}`;
}

function previewOnlyDelivery(laneRouting: ReturnType<typeof buildLaneRouting>, note: string): WebexDeliveryResult[] {
  return laneRouting.map((decision) => ({
    lane: decision.lane,
    recipient_email: decision.recipient_email,
    attempted: false,
    delivered: false,
    message_id: null,
    error: note,
    sent_at: null
  }));
}

/** Preview-only: computes lifecycle + routing + message drafts without
 * sending anything or touching the idempotency guard. Used for manual
 * "Analyze transcript" (any input mode) so repeated demo/paste runs never
 * cause unexpected sends. */
export function computePeachtreePreview(result: SecureNetworkingTriageResult): PeachtreePilotResult {
  const config = loadRoutingConfig();
  const lifecycle = classifyLifecycle(result);
  const routing = buildLaneRouting(result, config, lifecycle);
  const runId = result.timestamp;
  const messages = buildMessagesForRouting({ result, routing, runId, baseUrl: getConfig().WEBEX_PUBLIC_BASE_URL ?? null });

  return {
    lifecycle,
    routing,
    messages,
    delivery: previewOnlyDelivery(
      routing,
      "Preview only. Use the autonomous webhook, or the Retry/Send action, to deliver this via Webex."
    ),
    routing_config_version: config.metadata.version
  };
}

/** Delivers (or retries) any lanes not already successfully sent for this
 * transcript, enforcing the idempotency guard, and persists the audit
 * trail + processed-transcript record. Used by the autonomous webhook
 * (always) and by the manual "Retry / Send via Webex" action. */
export async function deliverPeachtreePipeline(
  result: SecureNetworkingTriageResult,
  transcriptText: string,
  webexSource: WebexTranscriptSource | null
): Promise<PeachtreePilotResult> {
  const config = loadRoutingConfig();
  const lifecycle = classifyLifecycle(result);
  const routing = buildLaneRouting(result, config, lifecycle);
  const transcriptId = computeTranscriptId(transcriptText, webexSource);
  const runId = result.timestamp;
  const baseUrl = getConfig().WEBEX_PUBLIC_BASE_URL ?? null;
  const messages = buildMessagesForRouting({ result, routing, runId, baseUrl });

  const alreadyProcessed = await getProcessedTranscript(transcriptId);
  const alreadySentLanes = new Set<WebexLane>((alreadyProcessed?.lanesSent ?? []) as WebexLane[]);

  const messagesToSend = messages.filter((message) => !alreadySentLanes.has(message.lane));
  const skippedResults: WebexDeliveryResult[] = messages
    .filter((message) => alreadySentLanes.has(message.lane))
    .map((message) => ({
      lane: message.lane,
      recipient_email: message.recipient_email,
      attempted: false,
      delivered: true,
      message_id: null,
      error: "Already delivered for this transcript — skipped to avoid a duplicate message.",
      sent_at: alreadyProcessed?.processedAt ?? null
    }));

  const botToken = getConfig().WEBEX_BOT_ACCESS_TOKEN ?? null;
  const sentResults = await deliverMessages(messagesToSend, botToken);

  const delivery = [...skippedResults, ...sentResults];
  const successfulLanes = sentResults.filter((item) => item.delivered).map((item) => item.lane);

  await markTranscriptProcessed({
    transcriptId,
    processedAt: new Date().toISOString(),
    lanesSent: Array.from(new Set([...alreadySentLanes, ...successfulLanes])),
    verdict: result.executive_summary.verdict,
    runId
  });
  if (successfulLanes.length > 0) {
    await addLanesSent(transcriptId, successfulLanes);
  }

  await appendWebexAudit({
    event: "transcript_processed",
    timestamp: new Date().toISOString(),
    transcriptId,
    meetingId: webexSource?.meetingId ?? null,
    meetingTitle: webexSource?.meetingTitle ?? null,
    transcriptSource: webexSource?.source ?? "manual",
    runId,
    lifecycleStage: lifecycle.lifecycle_stage,
    verdict: result.executive_summary.verdict,
    routing,
    recipientEmails: routing.map((item) => item.recipient_email),
    processedStatus: "processed"
  });

  for (const item of sentResults) {
    await appendWebexAudit({
      event: "message_sent",
      timestamp: item.sent_at ?? new Date().toISOString(),
      transcriptId,
      lane: item.lane,
      recipient_email: item.recipient_email,
      message_id: item.message_id,
      delivered: item.delivered,
      error: item.error
    });
  }

  return { lifecycle, routing, messages, delivery, routing_config_version: config.metadata.version };
}
