import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { buildAuthorizeUrl } from "@/lib/webex/client";
import { getTranscriptEnabledScopes } from "@/lib/webex/scopePolicy";
import { saveOAuthState } from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Enable transcript access" — re-authorizes with the core scopes PLUS
 * the optional `meeting:transcripts_read` scope. This is the only route
 * that ever requests the transcript scope; a rejection here is
 * classified as the specific `transcript_scope_rejected` error (not a
 * generic connection failure) and never invalidates the existing core
 * connection — the previous token/identity remain until this flow
 * actually completes.
 */
export async function GET() {
  const config = getConfig();
  if (!config.WEBEX_CLIENT_ID || !config.WEBEX_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "WEBEX_CLIENT_ID/WEBEX_CLIENT_SECRET are not configured on the server." },
      { status: 400 }
    );
  }

  const state = randomUUID();
  await saveOAuthState(state, null, "enable_transcripts");

  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.WEBEX_CLIENT_ID,
    redirectUri: config.WEBEX_REDIRECT_URI,
    scopes: getTranscriptEnabledScopes(config.WEBEX_SCOPES),
    state
  });

  return NextResponse.redirect(authorizeUrl);
}
