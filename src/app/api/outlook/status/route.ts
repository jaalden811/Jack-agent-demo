import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getValidAccessToken } from "@/lib/outlook/tokenManager";
import { readIdentityRecord, readLastOAuthError, readTokenRecord } from "@/lib/outlook/store";
import type { OutlookStatus } from "@/lib/outlook/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const [tokenRecord, identity, { health }, lastError] = await Promise.all([
    readTokenRecord(),
    readIdentityRecord(),
    getValidAccessToken(),
    readLastOAuthError()
  ]);

  const connected = Boolean(tokenRecord);
  const grantedScopes = tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [];

  const status: OutlookStatus = {
    configured: config.hasMicrosoftOAuth,
    connected,
    connected_user: { name: identity?.displayName ?? null, email: identity?.email ?? null },
    redirect_uri: config.MICROSOFT_REDIRECT_URI,
    requested_scopes: config.MICROSOFT_SCOPES.split(/\s+/).filter(Boolean),
    granted_scopes: grantedScopes,
    mail_send_available: connected && grantedScopes.some((scope) => scope.toLowerCase().includes("mail.send")),
    token_refresh_status: health,
    last_error_code: lastError?.code ?? null,
    last_error_message: lastError?.message ?? null
  };

  return NextResponse.json(status, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
