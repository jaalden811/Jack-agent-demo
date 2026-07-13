import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { buildAuthorizeUrl, generateCodeChallenge, generateCodeVerifier } from "@/lib/outlook/client";
import { saveOAuthState } from "@/lib/outlook/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET are not configured on the server." },
      { status: 400 }
    );
  }

  const state = randomUUID();
  const codeVerifier = generateCodeVerifier();
  await saveOAuthState(state, codeVerifier);

  const authorizeUrl = buildAuthorizeUrl({
    tenantId: config.MICROSOFT_TENANT_ID,
    clientId: config.MICROSOFT_CLIENT_ID,
    redirectUri: config.MICROSOFT_REDIRECT_URI,
    scopes: config.MICROSOFT_SCOPES,
    state,
    codeChallenge: generateCodeChallenge(codeVerifier)
  });

  return NextResponse.redirect(authorizeUrl);
}
