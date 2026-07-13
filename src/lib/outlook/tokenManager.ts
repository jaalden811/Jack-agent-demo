import { getConfig } from "@/lib/config";
import { exchangeCodeForToken, refreshAccessToken, type MicrosoftTokenResponse } from "@/lib/outlook/client";
import { readTokenRecord, writeTokenRecord, type OutlookTokenRecord } from "@/lib/outlook/store";

const REFRESH_SKEW_MS = 2 * 60 * 1000;

function toRecord(response: MicrosoftTokenResponse, now: Date, previousRefreshToken: string | null): OutlookTokenRecord {
  return {
    accessToken: response.access_token,
    // Microsoft may omit refresh_token on a refresh response if the
    // refresh token itself is unchanged — retain the previous one.
    refreshToken: response.refresh_token ?? previousRefreshToken,
    tokenType: response.token_type,
    expiresAt: new Date(now.getTime() + response.expires_in * 1000).toISOString(),
    scope: response.scope ?? "",
    obtainedAt: now.toISOString(),
    lastRefreshedAt: null,
    lastRefreshError: null
  };
}

export async function exchangeAndBuildRecord(code: string, codeVerifier: string): Promise<OutlookTokenRecord> {
  const config = getConfig();
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET) {
    throw new Error("MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET are not configured.");
  }
  const response = await exchangeCodeForToken({
    tenantId: config.MICROSOFT_TENANT_ID,
    clientId: config.MICROSOFT_CLIENT_ID,
    clientSecret: config.MICROSOFT_CLIENT_SECRET,
    code,
    redirectUri: config.MICROSOFT_REDIRECT_URI,
    codeVerifier,
    scopes: config.MICROSOFT_SCOPES
  });
  return toRecord(response, new Date(), null);
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
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET || !existing.refreshToken) {
    return { accessToken: existing.accessToken, health: expiresAt > now ? "refreshing_soon" : "expired" };
  }

  try {
    const response = await refreshAccessToken({
      tenantId: config.MICROSOFT_TENANT_ID,
      clientId: config.MICROSOFT_CLIENT_ID,
      clientSecret: config.MICROSOFT_CLIENT_SECRET,
      refreshToken: existing.refreshToken,
      scopes: config.MICROSOFT_SCOPES
    });
    const refreshed = toRecord(response, new Date(), existing.refreshToken);
    refreshed.lastRefreshedAt = new Date().toISOString();
    await writeTokenRecord(refreshed);
    return { accessToken: refreshed.accessToken, health: "healthy" };
  } catch (error) {
    const failed: OutlookTokenRecord = {
      ...existing,
      lastRefreshError: error instanceof Error ? error.message : "Token refresh failed"
    };
    await writeTokenRecord(failed);
    return { accessToken: expiresAt > now ? existing.accessToken : null, health: "refresh_failed" };
  }
}
