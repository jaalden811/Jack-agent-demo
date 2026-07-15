import { sendWebexMessage, WebexApiError } from "@/lib/webex/client";
import type { ChannelDeliveryResult, WebexLane, WebexMessagePreview, WebexSenderMode } from "@/lib/webex/types";

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
  sender: {
    accessToken: string | null;
    mode: WebexSenderMode;
    senderEmail?: string | null;
    /** Optional per-lane Webex space (room) IDs from configuration. When a
     * lane's 1:1 recipient is the connected user, delivery falls back to
     * the configured room instead of refusing (Phase 17). No room ID is
     * ever hard-coded — this map is entirely config/user-driven. */
    laneRoomIds?: Partial<Record<WebexLane, string>>;
  },
  deliveryKeyId: string
): Promise<ChannelDeliveryResult[]> {
  const results: ChannelDeliveryResult[] = [];
  const senderEmail = sender.senderEmail?.trim().toLowerCase() ?? null;
  const laneRoomIds = sender.laneRoomIds ?? {};

  for (const message of messages) {
    const base = {
      lane: message.lane,
      channel: "webex" as const,
      recipient_name: message.recipient_name,
      recipient_email: message.recipient_email,
      applicable: true,
      delivery_key: buildKey(deliveryKeyId, message.lane)
    };

    const configuredRoomId = laneRoomIds[message.lane]?.trim() || null;
    const isSelfDirect = Boolean(senderEmail && message.recipient_email && message.recipient_email.trim().toLowerCase() === senderEmail && sender.mode === "connected_user");

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

    // Resolve the target: a configured room when the 1:1 is not possible
    // (self-direct) or no recipient email exists; otherwise the 1:1 email.
    const useRoom = configuredRoomId && (isSelfDirect || !message.recipient_email);
    const target: { toPersonEmail?: string; roomId?: string } | null = useRoom
      ? { roomId: configuredRoomId as string }
      : message.recipient_email && !isSelfDirect
        ? { toPersonEmail: message.recipient_email }
        : null;

    if (!target) {
      // No valid target: either the self-direct case with no room, or no
      // recipient at all. Never attempt a self-direct 1:1 (Phase 17).
      const selfDirectNoRoom = isSelfDirect;
      results.push({
        ...base,
        attempted: false,
        delivered: false,
        message_id: null,
        status_code: null,
        error: selfDirectNoRoom
          ? `The ${message.lane} recipient is the connected Webex user — a 1:1 message to yourself is not supported. Select a Webex space for this lane or use the Outlook fallback.`
          : `No delivery target configured for the ${message.lane} lane (no recipient email and no selected Webex space).`,
        error_code: selfDirectNoRoom ? "self_direct_message_unsupported" : "delivery_target_required",
        sent_at: null,
        retryable: false
      });
      continue;
    }

    try {
      const sent = await sendWebexMessage(sender.accessToken, { ...target, markdown: message.markdown });
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
      const targetLabel = target.roomId ? `space ${target.roomId}` : message.recipient_email;

      results.push({
        ...base,
        attempted: true,
        delivered: false,
        message_id: null,
        status_code: status,
        error: `Could not deliver to ${targetLabel}: ${rawMessage}`,
        error_code,
        sent_at: null,
        retryable
      });
    }
  }

  return results;
}
