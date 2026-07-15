import { getConfig } from "@/lib/config";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { readIdentityRecord, readTokenRecord } from "@/lib/webex/store";
import type { WebexSenderMode } from "@/lib/webex/types";

export const MESSAGE_WRITE_SCOPE = "spark:messages_write";

export type ResolvedWebexSender = {
  accessToken: string | null;
  mode: WebexSenderMode;
  senderIdentity: string | null;
  /** The connected user's own email — used to detect a self-direct
   * (recipient == connected identity) message, which Webex cannot
   * deliver as a 1:1 (Phase 18B). */
  senderEmail: string | null;
  messageScopeGranted: boolean;
};

/**
 * Picks the token used to send Webex direct messages. Default and
 * preferred mode is the connected user's own OAuth token (requires
 * `spark:messages_write`, already part of the default WEBEX_SCOPES) — a
 * separate bot is only used as an optional fallback, and its absence
 * must never block delivery.
 */
export async function resolveWebexSender(): Promise<ResolvedWebexSender> {
  const tokenRecord = await readTokenRecord();
  const grantedScopes = tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [];
  const messageScopeGranted = grantedScopes.includes(MESSAGE_WRITE_SCOPE);

  if (tokenRecord && messageScopeGranted) {
    const { accessToken } = await getValidAccessToken();
    if (accessToken) {
      const identity = await readIdentityRecord();
      return {
        accessToken,
        mode: "connected_user",
        senderIdentity: identity?.displayName ?? identity?.email ?? null,
        senderEmail: identity?.email ?? null,
        messageScopeGranted: true
      };
    }
  }

  const botToken = getConfig().WEBEX_BOT_ACCESS_TOKEN ?? null;
  if (botToken) {
    return { accessToken: botToken, mode: "bot", senderIdentity: "Signal Agent bot", senderEmail: null, messageScopeGranted };
  }

  return { accessToken: null, mode: "unavailable", senderIdentity: null, senderEmail: null, messageScopeGranted };
}
