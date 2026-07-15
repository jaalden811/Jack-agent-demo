import { sendDirectMessage, WebexApiError } from "@/lib/webex/client";
import type { ChannelDeliveryResult, WebexMessagePreview, WebexSenderMode } from "@/lib/webex/types";

/**
 * Sends the built messages via the connected user's own Webex OAuth
 * access token by default (mode "connected_user"), falling back to an
 * optional bot token only if one is configured. Delivery is never
 * blocked by a missing bot. One lane failing never blocks the other
 * lane; each is attempted and recorded independently. Transient failures
 * are already retried once inside @/lib/webex/client's webexFetch.
 *
 * A same-user self-direct message (recipient email == connected
 * identity) is NOT attempted — Webex cannot deliver a 1:1 to yourself
 * (it would otherwise fail opaquely or create an invalid direct room).
 * Every failure is classified as retryable (transient) or permanent so
 * the UI can explain why it failed and whether a retry could succeed.
 */

function buildKey(runOrTranscriptId: string, lane: WebexMessagePreview["lane"]): string {
  return `${runOrTranscriptId}:${lane}:webex`;
}

/** Classifies a Webex delivery failure into a safe error code + whether
 * it is worth retrying (Phase 19). Transient: network/timeout/429/5xx.
 * Permanent: invalid recipient, forbidden, 400/404, missing scope. */
export function classifyWebexDeliveryError(status: number | null, rawMessage: string): { error_code: string; retryable: boolean } {
  const lower = rawMessage.toLowerCase();
  if (status === 429 || (status !== null && status >= 500) || lower.includes("timeout") || lower.includes("timed out") || lower.includes("network") || lower.includes("fetch failed")) {
    return { error_code: status === 429 ? "rate_limited" : "webex_transient_failure", retryable: true };
  }
  if (status === 401 || lower.includes("token")) return { error_code: "token_refresh_failed", retryable: false };
  if (lower.includes("scope")) return { error_code: "missing_messages_scope", retryable: false };
  if (status === 404 || lower.includes("not found") || lower.includes("could not resolve")) return { error_code: "recipient_not_found", retryable: false };
  if (status === 403) return { error_code: "forbidden_target", retryable: false };
  if (status === 400) return { error_code: "invalid_payload", retryable: false };
  return { error_code: "webex_api_rejected", retryable: false };
}

export async function deliverMessages(
  messages: WebexMessagePreview[],
  sender: { accessToken: string | null; mode: WebexSenderMode; senderEmail?: string | null },
  deliveryKeyId: string
): Promise<ChannelDeliveryResult[]> {
  const results: ChannelDeliveryResult[] = [];
  const senderEmail = sender.senderEmail?.trim().toLowerCase() ?? null;

  for (const message of messages) {
    const base = {
      lane: message.lane,
      channel: "webex" as const,
      recipient_name: message.recipient_name,
      recipient_email: message.recipient_email,
      applicable: true,
      delivery_key: buildKey(deliveryKeyId, message.lane)
    };

    if (!sender.accessToken || sender.mode === "unavailable") {
      results.push({
        ...base,
        attempted: false,
        delivered: false,
        message_id: null,
        status_code: null,
        error: "Webex delivery is unavailable — connect Webex (or configure an optional bot token) before sending.",
        error_code: "sender_unavailable",
        sent_at: null,
        retryable: false
      });
      continue;
    }

    if (!message.recipient_email) {
      results.push({
        ...base,
        attempted: false,
        delivered: false,
        message_id: null,
        status_code: null,
        error: `No recipient email configured for the ${message.lane} lane.`,
        error_code: "delivery_target_required",
        sent_at: null,
        retryable: false
      });
      continue;
    }

    // Phase 18B: never attempt a self-direct 1:1 message. When the lane's
    // recipient is the connected user themselves, Webex has no valid 1:1
    // room to create — this must fall back to a selected room / Outlook,
    // not fail opaquely.
    if (senderEmail && message.recipient_email.trim().toLowerCase() === senderEmail && sender.mode === "connected_user") {
      results.push({
        ...base,
        attempted: false,
        delivered: false,
        message_id: null,
        status_code: null,
        error: `The ${message.lane} recipient is the connected Webex user — a 1:1 message to yourself is not supported. Route this lane to a selected Webex space or Outlook.`,
        error_code: "self_direct_message_unsupported",
        sent_at: null,
        retryable: false
      });
      continue;
    }

    try {
      const sent = await sendDirectMessage(sender.accessToken, {
        toPersonEmail: message.recipient_email,
        markdown: message.markdown
      });
      results.push({
        ...base,
        attempted: true,
        delivered: true,
        message_id: sent.id,
        status_code: 200,
        error: null,
        error_code: null,
        sent_at: new Date().toISOString(),
        retryable: null
      });
    } catch (error) {
      const status = error instanceof WebexApiError ? error.status ?? null : null;
      const rawMessage = error instanceof Error ? error.message : "Unknown error";
      const { error_code, retryable } = classifyWebexDeliveryError(status, rawMessage);

      results.push({
        ...base,
        attempted: true,
        delivered: false,
        message_id: null,
        status_code: status,
        error: `Could not deliver to ${message.recipient_email}: ${rawMessage}`,
        error_code,
        sent_at: null,
        retryable
      });
    }
  }

  return results;
}
