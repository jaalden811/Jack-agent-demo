import { NextResponse } from "next/server";
import { getMyIdentity } from "@/lib/webex/client";
import { completeOAuthExchange } from "@/lib/webex/tokenManager";
import { consumeOAuthState, writeIdentityRecord } from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectWithParam(request: Request, param: string): NextResponse {
  const url = new URL(request.url);
  const target = new URL("/signal-agent", `${url.protocol}//${url.host}`);
  target.searchParams.set("webex", param);
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return redirectWithParam(request, "error");
  }

  if (!code || !state) {
    return redirectWithParam(request, "error");
  }

  const stateValid = await consumeOAuthState(state);
  if (!stateValid) {
    return redirectWithParam(request, "error");
  }

  try {
    const tokenRecord = await completeOAuthExchange(code);
    const identity = await getMyIdentity(tokenRecord.accessToken);
    await writeIdentityRecord({
      personId: identity.id,
      displayName: identity.displayName,
      email: identity.emails?.[0] ?? null,
      cachedAt: new Date().toISOString()
    });
    return redirectWithParam(request, "connected");
  } catch {
    return redirectWithParam(request, "error");
  }
}
