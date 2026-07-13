import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { readIdentityRecord, readLastOAuthError, readTokenRecord } from "@/lib/webex/store";
import type { WebexDiagnostics } from "@/lib/webex/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Focused diagnostics response for the "Connect Webex" failure path —
 * exactly the fields needed to root-cause a failed OAuth connection,
 * never an access/refresh token. */
export async function GET() {
  const config = getConfig();
  const [tokenRecord, identity, { health }, lastError] = await Promise.all([
    readTokenRecord(),
    readIdentityRecord(),
    getValidAccessToken(),
    readLastOAuthError()
  ]);

  const diagnostics: WebexDiagnostics = {
    configured: config.hasWebexOAuth,
    connected: Boolean(tokenRecord),
    redirect_uri: config.WEBEX_REDIRECT_URI,
    requested_scopes: config.WEBEX_SCOPES.split(/\s+/).filter(Boolean),
    granted_scopes: tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [],
    connected_user: tokenRecord ? { name: identity?.displayName ?? null, email: identity?.email ?? null } : null,
    token_refresh_status: health,
    last_error_code: lastError?.code ?? null,
    last_error_message: lastError?.message ?? null
  };

  return NextResponse.json(diagnostics, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
