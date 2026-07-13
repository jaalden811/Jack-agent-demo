import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { buildAuthorizeUrl } from "@/lib/webex/client";
import { saveOAuthState } from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  if (!config.WEBEX_CLIENT_ID || !config.WEBEX_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "WEBEX_CLIENT_ID/WEBEX_CLIENT_SECRET are not configured on the server." },
      { status: 400 }
    );
  }

  const state = randomUUID();
  await saveOAuthState(state);

  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.WEBEX_CLIENT_ID,
    redirectUri: config.WEBEX_REDIRECT_URI,
    scopes: config.WEBEX_SCOPES,
    state
  });

  return NextResponse.redirect(authorizeUrl);
}
