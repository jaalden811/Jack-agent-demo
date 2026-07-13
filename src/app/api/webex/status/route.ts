import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { resolveWebexSender } from "@/lib/webex/senderResolution";
import { normalizeScopes } from "@/lib/webex/scopes";
import { getAutomationReadiness } from "@/lib/webex/automationSettings";
import { readIdentityRecord, readTokenRecord, readWebhookRecord, readRecentWebexAudit, readLastOAuthError } from "@/lib/webex/store";
import type { WebexStatus } from "@/lib/webex/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const [tokenRecord, identity, webhook, { health }, recentAudit, lastError, sender, automation] = await Promise.all([
    readTokenRecord(),
    readIdentityRecord(),
    readWebhookRecord(),
    getValidAccessToken(),
    readRecentWebexAudit(20),
    readLastOAuthError(),
    resolveWebexSender(),
    getAutomationReadiness()
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
      : sender.mode === "unavailable"
        ? "Connect Webex (or configure an optional bot token) before enabling autopilot."
        : null;

  const status: WebexStatus = {
    configured: config.hasWebexOAuth,
    connected,
    connected_user: { name: identity?.displayName ?? null, email: identity?.email ?? null },
    redirect_uri: config.WEBEX_REDIRECT_URI,
    requested_scopes: normalizeScopes(config.WEBEX_SCOPES),
    granted_scopes: tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [],
    token_refresh_health: health,
    webex_delivery: {
      available: sender.mode !== "unavailable",
      sender_mode: sender.mode,
      sender_identity: sender.senderIdentity,
      message_scope_granted: sender.messageScopeGranted
    },
    bot_configured: config.hasWebexBot,
    webhook_registered: Boolean(webhook),
    webhook_target: webhook?.targetUrl ?? null,
    autopilot_enabled: automation.autopilotEnabled,
    autopilot_available: autopilotUnavailableReason === null,
    autopilot_unavailable_reason: autopilotUnavailableReason,
    auto_send_enabled: automation.autoSendEnabled,
    last_transcript_processed: lastTranscriptRecord
      ? {
          transcript_id: String(lastTranscriptRecord.transcriptId ?? ""),
          processed_at: String(lastTranscriptRecord.timestamp ?? ""),
          verdict: String(lastTranscriptRecord.verdict ?? "")
        }
      : null,
    last_messages_sent: lastMessages,
    last_error_code: lastError?.code ?? null,
    last_error_message: lastError?.message ?? null
  };

  return NextResponse.json(status, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
