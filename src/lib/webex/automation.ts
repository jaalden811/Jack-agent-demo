import { createHash } from "node:crypto";
import { getConfig } from "@/lib/config";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import { loadRoutingConfig, classifyLifecycle, buildLaneRouting } from "@/lib/webex/peachtreeRouting";
import { buildMessagesForRouting, buildEmailsForRouting } from "@/lib/webex/messageBuilder";
import { deliverMessages } from "@/lib/webex/delivery";
import { resolveWebexSender } from "@/lib/webex/senderResolution";
import { sendOutlookEmail } from "@/lib/outlook/send";
import { getProcessedTranscript, markTranscriptProcessed, addLanesSent, appendWebexAudit } from "@/lib/webex/store";
import type { ChannelDeliveryResult, PeachtreePilotResult, WebexLane, WebexTranscriptSource } from "@/lib/webex/types";

/**
 * Shared pipeline that turns a completed Signal-to-Solution result into
 * the Peachtree pilot's lifecycle classification, two-lane routing
 * decisions, tailored Webex + email message previews, and (optionally)
 * real delivery on both channels — reused identically by "auto-send
 * after analysis", the "Retry failed delivery" action, and the
 * autonomous Webex webhook handler.
 *
 * Deduplication key: `<id>:lane:channel` (e.g. `run_123:sales:webex`),
 * where `<id>` is the analysis run ID for a fresh single analysis, and
 * the stable Webex-transcript-derived ID for autonomous/repeated runs
 * over the exact same transcript content — so re-running the same
 * transcript never re-delivers to a lane/channel that already
 * succeeded. One lane or channel failing never blocks any other
 * lane/channel; each is attempted and recorded independently.
 */

export function computeTranscriptId(transcriptText: string, webexSource: WebexTranscriptSource | null): string {
  if (webexSource?.transcriptId) return webexSource.transcriptId;
  return `local-${createHash("sha256").update(transcriptText).digest("hex").slice(0, 16)}`;
}

function channelKey(lane: WebexLane, channel: "webex" | "email"): string {
  return `${lane}:${channel}`;
}

function previewOnlyDelivery(
  laneRouting: ReturnType<typeof buildLaneRouting>,
  runId: string,
  note: string
): ChannelDeliveryResult[] {
  return laneRouting.flatMap((decision) =>
    (["webex", "email"] as const).map((channel) => ({
      lane: decision.lane,
      channel,
      recipient_name: decision.recipient_name,
      recipient_email: decision.recipient_email,
      applicable: true,
      attempted: false,
      delivered: false,
      message_id: null,
      status_code: null,
      error: note,
      error_code: null,
      sent_at: null,
      delivery_key: `${runId}:${decision.lane}:${channel}`
    }))
  );
}

/** Preview-only: computes lifecycle + routing + message/email drafts
 * without sending anything or touching the idempotency guard. */
export function computePeachtreePreview(result: SecureNetworkingTriageResult): PeachtreePilotResult {
  const config = loadRoutingConfig();
  const lifecycle = classifyLifecycle(result);
  const routing = buildLaneRouting(result, config, lifecycle);
  const runId = result.timestamp;
  const baseUrl = getConfig().WEBEX_PUBLIC_BASE_URL ?? null;
  const messages = buildMessagesForRouting({ result, routing, runId, baseUrl });
  const emails = buildEmailsForRouting({ result, routing, runId, baseUrl });

  return {
    lifecycle,
    routing,
    messages,
    emails,
    delivery: previewOnlyDelivery(routing, runId, "Preview only. Enable auto-send, or use Analyze & Route, to deliver this."),
    routing_config_version: config.metadata.version,
    auto_send_enabled: false
  };
}

/** Delivers (or retries) any (lane, channel) pairs not already
 * successfully sent for this transcript, enforcing the idempotency
 * guard, and persists the audit trail + processed-transcript record.
 * Already-succeeded (lane, channel) pairs are always skipped, so
 * calling this again (the "Retry failed delivery" action) only ever
 * re-attempts pairs that previously failed or were never attempted. */
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
  const emails = buildEmailsForRouting({ result, routing, runId, baseUrl });

  const alreadyProcessed = await getProcessedTranscript(transcriptId);
  const alreadySentKeys = new Set<string>(alreadyProcessed?.lanesSent ?? []);

  const skipped: ChannelDeliveryResult[] = [];
  const messagesToSend = messages.filter((message) => {
    if (!alreadySentKeys.has(channelKey(message.lane, "webex"))) return true;
    skipped.push({
      lane: message.lane,
      channel: "webex",
      recipient_name: message.recipient_name,
      recipient_email: message.recipient_email,
      applicable: true,
      attempted: false,
      delivered: true,
      message_id: null,
      status_code: null,
      error: "Already delivered for this transcript — skipped to avoid a duplicate message.",
      error_code: null,
      sent_at: alreadyProcessed?.processedAt ?? null,
      delivery_key: `${runId}:${message.lane}:webex`
    });
    return false;
  });
  const emailsToSend = emails.filter((email) => {
    if (!alreadySentKeys.has(channelKey(email.lane, "email"))) return true;
    skipped.push({
      lane: email.lane,
      channel: "email",
      recipient_name: email.recipient_name,
      recipient_email: email.recipient_email,
      applicable: true,
      attempted: false,
      delivered: true,
      message_id: null,
      status_code: null,
      error: "Already delivered for this transcript — skipped to avoid a duplicate email.",
      error_code: null,
      sent_at: alreadyProcessed?.processedAt ?? null,
      delivery_key: `${runId}:${email.lane}:email`
    });
    return false;
  });

  const sender = await resolveWebexSender();
  const webexResults = await deliverMessages(messagesToSend, { accessToken: sender.accessToken, mode: sender.mode }, runId);

  const emailResults: ChannelDeliveryResult[] = [];
  for (const email of emailsToSend) {
    const base = {
      lane: email.lane,
      channel: "email" as const,
      recipient_name: email.recipient_name,
      recipient_email: email.recipient_email,
      applicable: true,
      delivery_key: `${runId}:${email.lane}:email`
    };
    if (!email.recipient_email) {
      emailResults.push({ ...base, attempted: false, delivered: false, message_id: null, status_code: null, error: `No recipient email configured for the ${email.lane} lane.`, error_code: "mail_send_missing", sent_at: null });
      continue;
    }
    const sent = await sendOutlookEmail({ toEmail: email.recipient_email, subject: email.subject, html: email.html, text: email.text });
    emailResults.push({
      ...base,
      attempted: true,
      delivered: sent.accepted,
      message_id: null,
      status_code: sent.status_code,
      error: sent.error,
      error_code: sent.error_code,
      sent_at: sent.sent_at
    });
  }

  const delivery = [...skipped, ...webexResults, ...emailResults];
  const newlySucceededKeys = [...webexResults, ...emailResults].filter((item) => item.delivered).map((item) => channelKey(item.lane, item.channel));

  await markTranscriptProcessed({
    transcriptId,
    processedAt: new Date().toISOString(),
    lanesSent: Array.from(new Set([...alreadySentKeys, ...newlySucceededKeys])),
    verdict: result.executive_summary.verdict,
    runId
  });
  if (newlySucceededKeys.length > 0) {
    await addLanesSent(transcriptId, newlySucceededKeys);
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

  for (const item of [...webexResults, ...emailResults]) {
    await appendWebexAudit({
      event: "message_sent",
      timestamp: item.sent_at ?? new Date().toISOString(),
      transcriptId,
      lane: item.lane,
      channel: item.channel,
      recipient_email: item.recipient_email,
      message_id: item.message_id,
      delivered: item.delivered,
      error: item.error
    });
  }

  return { lifecycle, routing, messages, emails, delivery, routing_config_version: config.metadata.version, auto_send_enabled: true };
}
