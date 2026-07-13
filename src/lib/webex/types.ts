import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";
import type { WebexOAuthErrorCode, ScopeTestStatus } from "@/lib/webex/store";

export type WebexLane = "sales" | "technical";
export type DeliveryChannel = "webex" | "email";
export type WebexSenderMode = "connected_user" | "bot" | "unavailable";

/** Wire shape for GET /api/webex/status. Never includes access tokens,
 * refresh tokens, client secrets, or bot tokens. */
export type WebexStatus = {
  configured: boolean;
  connected: boolean;
  connected_user: { name: string | null; email: string | null };
  redirect_uri: string;
  requested_scopes: string[];
  granted_scopes: string[];
  token_refresh_health: "healthy" | "refreshing_soon" | "expired" | "refresh_failed" | "not_connected";
  webex_delivery: {
    available: boolean;
    sender_mode: WebexSenderMode;
    sender_identity: string | null;
    message_scope_granted: boolean;
  };
  bot_configured: boolean;
  webhook_registered: boolean;
  webhook_target: string | null;
  autopilot_enabled: boolean;
  autopilot_available: boolean;
  autopilot_unavailable_reason: string | null;
  auto_send_enabled: boolean;
  last_transcript_processed: { transcript_id: string; processed_at: string; verdict: string } | null;
  last_messages_sent: Array<{ lane: string; recipient_email: string; message_id: string; sent_at: string }>;
  last_error_code: WebexOAuthErrorCode | null;
  last_error_message: string | null;
};

export type WebexScopeTestResult = {
  test_id: string;
  label: string;
  scopes: string[];
  status: ScopeTestStatus | "not_run";
  error_code: WebexOAuthErrorCode | null;
  error_message: string | null;
  occurred_at: string | null;
};

/** Shape returned by GET /api/webex/diagnostics — everything needed to
 * diagnose and complete a failed Webex connection without ever exposing
 * a client ID/secret value, access token, or refresh token. */
export type WebexDiagnostics = {
  configured: boolean;
  connected: boolean;
  redirect_uri: string;
  requested_scopes_raw: string;
  requested_scopes: string[];
  authorization_url_origin: string;
  client_id_configured: boolean;
  client_secret_configured: boolean;
  granted_scopes: string[];
  connected_user: { name: string | null; email: string | null } | null;
  token_refresh_status: WebexStatus["token_refresh_health"];
  last_error_code: WebexOAuthErrorCode | null;
  last_error_message: string | null;
  last_failed_scope_set: string[];
  scope_tests: WebexScopeTestResult[];
};

export type RuleEvaluationStatusLite = "matched" | "contradicted" | "not_evidenced";

export type LifecycleStage = "LAND" | "ADOPT" | "EXPAND" | "RENEW";

export type LifecycleClassification = {
  lifecycle_stage: LifecycleStage;
  lifecycle_reason: string;
};

export type LaneRoutingDecision = {
  lane: WebexLane;
  recipient_name: string;
  recipient_email: string | null;
  assigned_role: string;
  reason: string[];
  actions: string[];
  signal_types: string[];
  lifecycle_stage: LifecycleStage;
  automatic_delivery: boolean;
};

export type WebexMessagePreview = {
  lane: WebexLane;
  recipient_name: string;
  recipient_email: string | null;
  subject: string;
  markdown: string;
  character_count: number;
};

export type EmailMessagePreview = {
  lane: WebexLane;
  recipient_name: string;
  recipient_email: string | null;
  subject: string;
  html: string;
  text: string;
};

/** One delivery attempt/result for a single (lane, channel) pair. The
 * dedupe key is `runId:lane:channel` (also `transcriptId:lane:channel`
 * for autonomous Webex-webhook transcripts) — see @/lib/webex/automation. */
export type ChannelDeliveryResult = {
  lane: WebexLane;
  channel: DeliveryChannel;
  recipient_name: string;
  recipient_email: string | null;
  applicable: boolean;
  attempted: boolean;
  delivered: boolean;
  message_id: string | null;
  status_code: number | null;
  error: string | null;
  error_code: string | null;
  sent_at: string | null;
  delivery_key: string;
};

/** Full routing + delivery result attached to a Signal Agent run for the
 * Peachtree pilot. */
export type PeachtreePilotResult = {
  lifecycle: LifecycleClassification;
  routing: LaneRoutingDecision[];
  messages: WebexMessagePreview[];
  emails: EmailMessagePreview[];
  delivery: ChannelDeliveryResult[];
  routing_config_version: string;
  auto_send_enabled: boolean;
};

export type WebexTranscriptSource = {
  transcriptId: string;
  meetingId: string | null;
  meetingTitle: string | null;
  host: string | null;
  meetingDate: string | null;
  source: "webex";
};

export type WebexAutomationRunResult = SecureNetworkingTriageResult & {
  peachtree: PeachtreePilotResult;
  webex_source: WebexTranscriptSource | null;
};
