import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { readIdentityRecord, readTokenRecord, readWebhookRecord, readRecentWebexAudit, readAutopilotOverride } from "@/lib/webex/store";
import type { WebexStatus } from "@/lib/webex/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const [tokenRecord, identity, webhook, { health }, recentAudit, autopilotOverride] = await Promise.all([
    readTokenRecord(),
    readIdentityRecord(),
    readWebhookRecord(),
    getValidAccessToken(),
    readRecentWebexAudit(20),
    readAutopilotOverride()
  ]);

  const connected = Boolean(tokenRecord);

  const lastTranscriptRecord = recentAudit.find((record) => record.event === "transcript_processed");
  const lastMessages = recentAudit
    .filter((record) => record.event === "message_sent")
    .slice(0, 4)
    .map((record) => ({
      lane: String(record.lane ?? ""),
      recipient_email: String(record.recipient_email ?? ""),
      message_id: String(record.message_id ?? ""),
      sent_at: String(record.timestamp ?? "")
    }));

  const autopilotUnavailableReason = !config.webexPublicBaseUrlUsable
    ? "A public URL is required for Webex transcript webhooks."
    : !connected
      ? "Connect Webex before enabling autopilot."
      : !config.hasWebexBot
        ? "Configure WEBEX_BOT_ACCESS_TOKEN before enabling autopilot."
        : null;

  const status: WebexStatus = {
    connected,
    connected_user: { name: identity?.displayName ?? null, email: identity?.email ?? null },
    granted_scopes: tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [],
    token_refresh_health: health,
    bot_configured: config.hasWebexBot,
    sales_recipient_configured: config.hasSalesRecipient,
    technical_recipient_configured: config.hasTechnicalRecipient,
    webhook_registered: Boolean(webhook),
    webhook_target: webhook?.targetUrl ?? null,
    autopilot_enabled: autopilotOverride ?? config.WEBEX_AUTOPILOT_ENABLED,
    autopilot_available: autopilotUnavailableReason === null,
    autopilot_unavailable_reason: autopilotUnavailableReason,
    last_transcript_processed: lastTranscriptRecord
      ? {
          transcript_id: String(lastTranscriptRecord.transcriptId ?? ""),
          processed_at: String(lastTranscriptRecord.timestamp ?? ""),
          verdict: String(lastTranscriptRecord.verdict ?? "")
        }
      : null,
    last_messages_sent: lastMessages
  };

  return NextResponse.json(status, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
