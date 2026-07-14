import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getMyIdentity } from "@/lib/webex/client";
import { exchangeAndBuildRecord } from "@/lib/webex/tokenManager";
import { getCoreScopes, getTranscriptEnabledScopes } from "@/lib/webex/scopePolicy";
import { classifyAuthorizeRedirectError, classifyWebexOAuthError } from "@/lib/webex/oauthDiagnostics";
import {
  consumeOAuthState,
  writeIdentityRecord,
  writeLastOAuthError,
  writeScopeTestResult,
  writeTokenRecord,
  type PendingOAuthDiagnostic,
  type WebexOAuthErrorRecord,
  type WebexOAuthPurpose
} from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectWithParam(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL(request.url);
  const target = new URL("/signal-agent", `${url.protocol}//${url.host}`);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return NextResponse.redirect(target);
}

async function failWith(request: Request, record: WebexOAuthErrorRecord): Promise<NextResponse> {
  await writeLastOAuthError(record);
  return redirectWithParam(request, { webex: "error" });
}

/**
 * Handles a scope-diagnostic OAuth round trip (Setup → Webex → "Test
 * basic Webex connection" / "Test identity|messaging|meetings|
 * transcripts"). Completely isolated from the main connection: it never
 * writes tokens.json, identity.json, or the main last-oauth-error.json
 * — only a per-test result in scope-tests.json — so a diagnostic probe
 * can never overwrite the real production connection's state.
 */
async function handleDiagnosticCallback(
  request: Request,
  diagnostic: PendingOAuthDiagnostic,
  params: { code: string | null; errorParam: string | null; errorDescription: string | null }
): Promise<NextResponse> {
  const recordFailure = async (record: WebexOAuthErrorRecord) => {
    await writeScopeTestResult({
      testId: diagnostic.testId,
      scopes: diagnostic.scopes,
      status: "failed",
      errorCode: record.code,
      errorMessage: record.message,
      occurredAt: record.occurredAt
    });
    return redirectWithParam(request, { webex: "diagnostic", test: diagnostic.testId, result: "failed" });
  };

  if (params.errorParam) {
    return recordFailure(classifyAuthorizeRedirectError(params.errorParam, params.errorDescription));
  }
  if (!params.code) {
    return recordFailure({
      code: "token_exchange_failed",
      message: "Webex redirected back without a code parameter.",
      occurredAt: new Date().toISOString()
    });
  }

  let accessToken: string;
  try {
    const tokenRecord = await exchangeAndBuildRecord(params.code);
    accessToken = tokenRecord.accessToken;
  } catch (error) {
    return recordFailure(classifyWebexOAuthError(error, "token_exchange"));
  }

  try {
    await getMyIdentity(accessToken);
  } catch (error) {
    return recordFailure(classifyWebexOAuthError(error, "identity_lookup"));
  }

  await writeScopeTestResult({
    testId: diagnostic.testId,
    scopes: diagnostic.scopes,
    status: "success",
    errorCode: null,
    errorMessage: null,
    occurredAt: new Date().toISOString()
  });
  return redirectWithParam(request, { webex: "diagnostic", test: diagnostic.testId, result: "success" });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Always try to consume state first (whether this redirect carries a
  // code or an error) so a scope-diagnostic probe is correctly routed
  // away from the main connection's state, even when it fails.
  let diagnostic: PendingOAuthDiagnostic | null = null;
  let stateWasValid = false;
  let purpose: WebexOAuthPurpose = "connect";
  if (state) {
    const consumed = await consumeOAuthState(state);
    stateWasValid = consumed.valid;
    diagnostic = consumed.diagnostic;
    purpose = consumed.purpose;
  }

  if (diagnostic) {
    return handleDiagnosticCallback(request, diagnostic, { code, errorParam, errorDescription });
  }

  const config = getConfig();
  const requestedScopes = purpose === "enable_transcripts" ? getTranscriptEnabledScopes(config.WEBEX_SCOPES) : getCoreScopes(config.WEBEX_SCOPES);

  if (errorParam) {
    const classified = classifyAuthorizeRedirectError(errorParam, errorDescription, purpose);
    return failWith(request, { ...classified, scopes: requestedScopes });
  }

  if (!code || !state) {
    return failWith(request, {
      code: "token_exchange_failed",
      message: "Webex redirected back without a code or state parameter.",
      occurredAt: new Date().toISOString(),
      scopes: requestedScopes
    });
  }

  if (!stateWasValid) {
    return failWith(request, {
      code: "state_mismatch",
      message: "The OAuth state returned by Webex did not match the state this server issued.",
      occurredAt: new Date().toISOString(),
      scopes: requestedScopes
    });
  }

  let accessToken: string;
  try {
    const tokenRecord = await exchangeAndBuildRecord(code);
    accessToken = tokenRecord.accessToken;
    try {
      await writeTokenRecord(tokenRecord);
    } catch (error) {
      return failWith(request, { ...classifyWebexOAuthError(error, "token_store", purpose), scopes: requestedScopes });
    }
  } catch (error) {
    return failWith(request, { ...classifyWebexOAuthError(error, "token_exchange", purpose), scopes: requestedScopes });
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
    return failWith(request, { ...classifyWebexOAuthError(error, "identity_lookup", purpose), scopes: requestedScopes });
  }

  await writeLastOAuthError(null);
  return redirectWithParam(request, { webex: purpose === "enable_transcripts" ? "transcripts_enabled" : "connected" });
}
