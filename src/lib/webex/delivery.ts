import { sendDirectMessage, WebexApiError } from "@/lib/webex/client";
import type { WebexDeliveryResult, WebexMessagePreview } from "@/lib/webex/types";

/**
 * Sends the built messages via the Webex Bot identity
 * (WEBEX_BOT_ACCESS_TOKEN) — never the OAuth-connected user's own
 * identity. One lane failing (e.g. Bella's email not resolvable) never
 * blocks the other lane's delivery; each is attempted and recorded
 * independently. Transient failures are already retried once inside
 * @/lib/webex/client's webexFetch.
 */

export async function deliverMessages(
  messages: WebexMessagePreview[],
  botAccessToken: string | null
): Promise<WebexDeliveryResult[]> {
  const results: WebexDeliveryResult[] = [];

  for (const message of messages) {
    if (!botAccessToken) {
      results.push({
        lane: message.lane,
        recipient_email: message.recipient_email,
        attempted: false,
        delivered: false,
        message_id: null,
        error: "Webex bot token not configured; delivery unavailable. Analysis and routing are preserved.",
        sent_at: null
      });
      continue;
    }

    if (!message.recipient_email) {
      results.push({
        lane: message.lane,
        recipient_email: null,
        attempted: false,
        delivered: false,
        message_id: null,
        error: `No recipient email configured for the ${message.lane} lane.`,
        sent_at: null
      });
      continue;
    }

    try {
      const sent = await sendDirectMessage(botAccessToken, {
        toPersonEmail: message.recipient_email,
        markdown: message.markdown
      });
      results.push({
        lane: message.lane,
        recipient_email: message.recipient_email,
        attempted: true,
        delivered: true,
        message_id: sent.id,
        error: null,
        sent_at: new Date().toISOString()
      });
    } catch (error) {
      const detail =
        error instanceof WebexApiError
          ? `Could not deliver to ${message.recipient_email}: ${error.message}`
          : `Could not deliver to ${message.recipient_email}: ${error instanceof Error ? error.message : "Unknown error"}`;
      results.push({
        lane: message.lane,
        recipient_email: message.recipient_email,
        attempted: true,
        delivered: false,
        message_id: null,
        error: detail,
        sent_at: null
      });
    }
  }

  return results;
}
