import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { buildAuthorizeUrl } from "@/lib/webex/client";
import { saveOAuthState } from "@/lib/webex/store";
import { MINIMAL_SCOPE_TEST } from "@/lib/webex/scopeDiagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Initiates a throw-away OAuth attempt using only `spark:people_read`
 * — proving Client ID, redirect URI, state handling, and the OAuth
 * callback work independently of any meeting/message scope. Never
 * touches the main connection's token/identity state, and never
 * replaces the configured production scope set (@/lib/config's
 * WEBEX_SCOPES is untouched by this route).
 *
 * Returns the authorize URL rather than redirecting directly, because
 * this is invoked via fetch() from the Setup drawer; the browser must
 * still perform the actual top-level navigation to Webex.
 */
export async function POST() {
  const config = getConfig();
  if (!config.WEBEX_CLIENT_ID || !config.WEBEX_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "WEBEX_CLIENT_ID/WEBEX_CLIENT_SECRET are not configured on the server." },
      { status: 400 }
    );
  }

  const state = randomUUID();
  await saveOAuthState(state, { testId: MINIMAL_SCOPE_TEST.id, scopes: MINIMAL_SCOPE_TEST.scopes });

  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.WEBEX_CLIENT_ID,
    redirectUri: config.WEBEX_REDIRECT_URI,
    scopes: MINIMAL_SCOPE_TEST.scopes,
    state
  });

  return NextResponse.json({ authorize_url: authorizeUrl, scopes: MINIMAL_SCOPE_TEST.scopes, test_id: MINIMAL_SCOPE_TEST.id });
}
