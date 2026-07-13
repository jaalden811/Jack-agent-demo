import { sendDirectMessage, WebexApiError } from "@/lib/webex/client";
import type { ChannelDeliveryResult, WebexMessagePreview, WebexSenderMode } from "@/lib/webex/types";

/**
 * Sends the built messages via the connected user's own Webex OAuth
 * access token by default (mode "connected_user"), falling back to an
 * optional bot token only if one is configured. Delivery is never
 * blocked by a missing bot. One lane failing (e.g. Bella's email not
 * resolvable) never blocks the other lane's delivery; each is attempted
 * and recorded independently. Transient failures are already retried
 * once inside @/lib/webex/client's webexFetch.
 */

function buildKey(runOrTranscriptId: string, lane: WebexMessagePreview["lane"]): string {
  return `${runOrTranscriptId}:${lane}:webex`;
}

export async function deliverMessages(
  messages: WebexMessagePreview[],
  sender: { accessToken: string | null; mode: WebexSenderMode },
  deliveryKeyId: string
): Promise<ChannelDeliveryResult[]> {
  const results: ChannelDeliveryResult[] = [];

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
        sent_at: null
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
        error_code: "recipient_not_found",
        sent_at: null
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
        sent_at: new Date().toISOString()
      });
    } catch (error) {
      const status = error instanceof WebexApiError ? error.status ?? null : null;
      const rawMessage = error instanceof Error ? error.message : "Unknown error";
      const lower = rawMessage.toLowerCase();
      const errorCode =
        status === 401 || lower.includes("token")
          ? "token_refresh_failed"
          : lower.includes("scope")
            ? "missing_messages_scope"
            : lower.includes("not found") || lower.includes("could not resolve")
              ? "recipient_not_found"
              : "webex_api_rejected";

      results.push({
        ...base,
        attempted: true,
        delivered: false,
        message_id: null,
        status_code: status,
        error: `Could not deliver to ${message.recipient_email}: ${rawMessage}`,
        error_code: errorCode,
        sent_at: null
      });
    }
  }

  return results;
}
