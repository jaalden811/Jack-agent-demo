import { NextResponse } from "next/server";
import { getMyIdentity } from "@/lib/webex/client";
import { exchangeAndBuildRecord } from "@/lib/webex/tokenManager";
import { writeTokenRecord } from "@/lib/webex/store";
import { classifyAuthorizeRedirectError, classifyWebexOAuthError } from "@/lib/webex/oauthDiagnostics";
import { consumeOAuthState, writeIdentityRecord, writeLastOAuthError, type WebexOAuthErrorRecord } from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectWithParam(request: Request, param: string): NextResponse {
  const url = new URL(request.url);
  const target = new URL("/signal-agent", `${url.protocol}//${url.host}`);
  target.searchParams.set("webex", param);
  return NextResponse.redirect(target);
}

async function failWith(request: Request, record: WebexOAuthErrorRecord): Promise<NextResponse> {
  await writeLastOAuthError(record);
  return redirectWithParam(request, "error");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (errorParam) {
    return failWith(request, classifyAuthorizeRedirectError(errorParam, errorDescription));
  }

  if (!code || !state) {
    return failWith(request, {
      code: "token_exchange_failed",
      message: "Webex redirected back without a code or state parameter.",
      occurredAt: new Date().toISOString()
    });
  }

  const stateValid = await consumeOAuthState(state);
  if (!stateValid) {
    return failWith(request, {
      code: "state_mismatch",
      message: "The OAuth state returned by Webex did not match the state this server issued.",
      occurredAt: new Date().toISOString()
    });
  }

  let accessToken: string;
  try {
    const tokenRecord = await exchangeAndBuildRecord(code);
    accessToken = tokenRecord.accessToken;
    try {
      await writeTokenRecord(tokenRecord);
    } catch (error) {
      return failWith(request, classifyWebexOAuthError(error, "token_store"));
    }
  } catch (error) {
    return failWith(request, classifyWebexOAuthError(error, "token_exchange"));
  }

  try {
    const identity = await getMyIdentity(accessToken);
    await writeIdentityRecord({
      personId: identity.id,
      displayName: identity.displayName,
      email: identity.emails?.[0] ?? null,
      cachedAt: new Date().toISOString()
    });
  } catch (error) {
    return failWith(request, classifyWebexOAuthError(error, "identity_lookup"));
  }

  await writeLastOAuthError(null);
  return redirectWithParam(request, "connected");
}
