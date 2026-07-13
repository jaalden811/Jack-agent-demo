export type OutlookErrorCode =
  | "redirect_uri_mismatch"
  | "invalid_client"
  | "invalid_client_secret"
  | "invalid_scope"
  | "user_denied"
  | "state_mismatch"
  | "token_exchange_failed"
  | "identity_lookup_failed"
  | "token_store_failed"
  | "mail_send_missing"
  | "token_refresh_failed"
  | "graph_rejected";

export type OutlookErrorRecord = {
  code: OutlookErrorCode;
  message: string;
  occurredAt: string;
};

/** Wire shape for GET /api/outlook/status. Never includes access tokens,
 * refresh tokens, or client secrets. */
export type OutlookStatus = {
  configured: boolean;
  connected: boolean;
  connected_user: { name: string | null; email: string | null };
  redirect_uri: string;
  requested_scopes: string[];
  granted_scopes: string[];
  mail_send_available: boolean;
  token_refresh_status: "healthy" | "refreshing_soon" | "expired" | "refresh_failed" | "not_connected";
  last_error_code: OutlookErrorCode | null;
  last_error_message: string | null;
};

export type OutlookSendResult = {
  accepted: boolean;
  status_code: number | null;
  error: string | null;
  error_code: OutlookErrorCode | null;
  sent_at: string | null;
};
