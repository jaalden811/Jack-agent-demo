import { getValidAccessToken } from "@/lib/outlook/tokenManager";
import { sendMail, GraphApiError } from "@/lib/outlook/client";
import { classifyOutlookError } from "@/lib/outlook/oauthDiagnostics";
import type { OutlookSendResult } from "@/lib/outlook/types";

/** Sends one email via Microsoft Graph using the connected user's token,
 * refreshing it first if needed. Never throws — always returns a result
 * so one lane/channel failing never blocks another. */
export async function sendOutlookEmail(params: { toEmail: string; subject: string; html: string; text: string }): Promise<OutlookSendResult> {
  const { accessToken, health } = await getValidAccessToken();

  if (!accessToken) {
    return {
      accepted: false,
      status_code: null,
      error: "Outlook is not connected — connect Outlook before sending email.",
      error_code: "token_exchange_failed",
      sent_at: null
    };
  }

  if (health === "refresh_failed") {
    return {
      accepted: false,
      status_code: null,
      error: "The Microsoft refresh token was rejected or has expired. Reconnect Outlook.",
      error_code: "token_refresh_failed",
      sent_at: null
    };
  }

  try {
    const result = await sendMail(accessToken, params);
    return { accepted: result.accepted, status_code: result.statusCode, error: null, error_code: null, sent_at: new Date().toISOString() };
  } catch (error) {
    const classified = classifyOutlookError(error, "send_mail");
    return {
      accepted: false,
      status_code: error instanceof GraphApiError ? error.status ?? null : null,
      error: classified.message,
      error_code: classified.code,
      sent_at: null
    };
  }
}
