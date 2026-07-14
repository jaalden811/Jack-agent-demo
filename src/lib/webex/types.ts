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
  /** Capability-based status — never a single binary connected/not-
   * connected flag. Transcript access is a separately-granted, optional
   * capability; core OAuth (identity/messaging/meeting schedules) can be
   * fully connected and usable even when transcript access is not. */
  capabilities: {
    core_oauth: boolean;
    identity: boolean;
    messaging: boolean;
    meeting_schedules: boolean;
    meeting_transcripts: boolean;
    manual_transcript_import_available: boolean;
    outbound_delivery_available: boolean;
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
  /** The scopes "Connect Webex" actually requests (excludes the optional
   * transcript scope) — see @/lib/webex/scopePolicy. */
  core_scopes: string[];
  transcript_scope: string;
  transcript_scope_granted: boolean;
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
  /** True when OpenAI Stage D produced this content from the structured
   * qualification object; false when the deterministic template
   * (@/lib/webex/messageBuilder) was used instead — e.g. OpenAI
   * disabled/unconfigured/failed. Always safe to send either way. */
  synthesized_by_ai: boolean;
};

export type EmailMessagePreview = {
  lane: WebexLane;
  recipient_name: string;
  recipient_email: string | null;
  subject: string;
  html: string;
  text: string;
  synthesized_by_ai: boolean;
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
