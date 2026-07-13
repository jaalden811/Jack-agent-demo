import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/** Wire shape for GET /api/webex/status. Never includes access tokens,
 * refresh tokens, client secrets, or bot tokens. */
export type WebexStatus = {
  connected: boolean;
  connected_user: { name: string | null; email: string | null };
  granted_scopes: string[];
  token_refresh_health: "healthy" | "refreshing_soon" | "expired" | "refresh_failed" | "not_connected";
  bot_configured: boolean;
  sales_recipient_configured: boolean;
  technical_recipient_configured: boolean;
  webhook_registered: boolean;
  webhook_target: string | null;
  autopilot_enabled: boolean;
  autopilot_available: boolean;
  autopilot_unavailable_reason: string | null;
  last_transcript_processed: { transcript_id: string; processed_at: string; verdict: string } | null;
  last_messages_sent: Array<{ lane: string; recipient_email: string; message_id: string; sent_at: string }>;
};

export type WebexLane = "sales" | "technical";

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

export type WebexDeliveryResult = {
  lane: WebexLane;
  recipient_email: string | null;
  attempted: boolean;
  delivered: boolean;
  message_id: string | null;
  error: string | null;
  sent_at: string | null;
};

/** Full routing + delivery result attached to a Signal Agent run for the
 * Peachtree pilot. */
export type PeachtreePilotResult = {
  lifecycle: LifecycleClassification;
  routing: LaneRoutingDecision[];
  messages: WebexMessagePreview[];
  delivery: WebexDeliveryResult[];
  routing_config_version: string;
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
