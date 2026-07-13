import { NextResponse } from "next/server";
import { getMyIdentity } from "@/lib/outlook/client";
import { exchangeAndBuildRecord } from "@/lib/outlook/tokenManager";
import { classifyAuthorizeRedirectError, classifyOutlookError } from "@/lib/outlook/oauthDiagnostics";
import { consumeOAuthState, writeIdentityRecord, writeLastOAuthError, writeTokenRecord } from "@/lib/outlook/store";
import type { OutlookErrorRecord } from "@/lib/outlook/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectWithParam(request: Request, param: string): NextResponse {
  const url = new URL(request.url);
  const target = new URL("/signal-agent", `${url.protocol}//${url.host}`);
  target.searchParams.set("outlook", param);
  return NextResponse.redirect(target);
}

async function failWith(request: Request, record: OutlookErrorRecord): Promise<NextResponse> {
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
      message: "Microsoft redirected back without a code or state parameter.",
      occurredAt: new Date().toISOString()
    });
  }

  const { valid, codeVerifier } = await consumeOAuthState(state);
  if (!valid || !codeVerifier) {
    return failWith(request, {
      code: "state_mismatch",
      message: "The OAuth state returned by Microsoft did not match the state this server issued.",
      occurredAt: new Date().toISOString()
    });
  }

  let accessToken: string;
  try {
    const tokenRecord = await exchangeAndBuildRecord(code, codeVerifier);
    accessToken = tokenRecord.accessToken;
    try {
      await writeTokenRecord(tokenRecord);
    } catch (error) {
      return failWith(request, classifyOutlookError(error, "token_store"));
    }
  } catch (error) {
    return failWith(request, classifyOutlookError(error, "token_exchange"));
  }

  try {
    const identity = await getMyIdentity(accessToken);
    await writeIdentityRecord({
      id: identity.id,
      displayName: identity.displayName ?? identity.userPrincipalName ?? "Connected Microsoft account",
      email: identity.mail ?? identity.userPrincipalName ?? null,
      cachedAt: new Date().toISOString()
    });
  } catch (error) {
    return failWith(request, classifyOutlookError(error, "identity_lookup"));
  }

  await writeLastOAuthError(null);
  return redirectWithParam(request, "connected");
}
