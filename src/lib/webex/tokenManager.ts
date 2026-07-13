import { getConfig } from "@/lib/config";
import { exchangeCodeForToken, refreshAccessToken, type WebexTokenResponse } from "@/lib/webex/client";
import { readTokenRecord, writeTokenRecord, type WebexTokenRecord } from "@/lib/webex/store";

/**
 * Central place that turns a raw Webex OAuth token response into a
 * persisted WebexTokenRecord, and that hands back a currently-valid
 * access token to every other Webex route — refreshing automatically
 * when the stored token is at or near expiry.
 */

const REFRESH_SKEW_MS = 2 * 60 * 1000; // refresh 2 minutes before expiry

function toRecord(response: WebexTokenResponse, now: Date): WebexTokenRecord {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type,
    expiresAt: new Date(now.getTime() + response.expires_in * 1000).toISOString(),
    refreshExpiresAt: response.refresh_token_expires_in
      ? new Date(now.getTime() + response.refresh_token_expires_in * 1000).toISOString()
      : null,
    scope: response.scope ?? "",
    obtainedAt: now.toISOString(),
    lastRefreshedAt: null,
    lastRefreshError: null
  };
}

export async function completeOAuthExchange(code: string): Promise<WebexTokenRecord> {
  const config = getConfig();
  if (!config.WEBEX_CLIENT_ID || !config.WEBEX_CLIENT_SECRET) {
    throw new Error("WEBEX_CLIENT_ID/WEBEX_CLIENT_SECRET are not configured.");
  }
  const response = await exchangeCodeForToken({
    clientId: config.WEBEX_CLIENT_ID,
    clientSecret: config.WEBEX_CLIENT_SECRET,
    code,
    redirectUri: config.WEBEX_REDIRECT_URI
  });
  const record = toRecord(response, new Date());
  await writeTokenRecord(record);
  return record;
}

export type TokenHealth = "healthy" | "refreshing_soon" | "expired" | "refresh_failed" | "not_connected";

export async function getValidAccessToken(): Promise<{ accessToken: string | null; health: TokenHealth }> {
  const existing = await readTokenRecord();
  if (!existing) return { accessToken: null, health: "not_connected" };

  const expiresAt = new Date(existing.expiresAt).getTime();
  const now = Date.now();

  if (expiresAt - now > REFRESH_SKEW_MS) {
    return { accessToken: existing.accessToken, health: "healthy" };
  }

  const config = getConfig();
  if (!config.WEBEX_CLIENT_ID || !config.WEBEX_CLIENT_SECRET) {
    return { accessToken: existing.accessToken, health: expiresAt > now ? "refreshing_soon" : "expired" };
  }

  try {
    const response = await refreshAccessToken({
      clientId: config.WEBEX_CLIENT_ID,
      clientSecret: config.WEBEX_CLIENT_SECRET,
      refreshToken: existing.refreshToken
    });
    const refreshed = toRecord(response, new Date());
    refreshed.lastRefreshedAt = new Date().toISOString();
    await writeTokenRecord(refreshed);
    return { accessToken: refreshed.accessToken, health: "healthy" };
  } catch (error) {
    const failed: WebexTokenRecord = {
      ...existing,
      lastRefreshError: error instanceof Error ? error.message : "Token refresh failed"
    };
    await writeTokenRecord(failed);
    return { accessToken: expiresAt > now ? existing.accessToken : null, health: "refresh_failed" };
  }
}
