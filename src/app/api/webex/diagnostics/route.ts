import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { normalizeScopes } from "@/lib/webex/scopes";
import { SCOPE_DIAGNOSTIC_TESTS } from "@/lib/webex/scopeDiagnostics";
import { readIdentityRecord, readLastOAuthError, readScopeTestResults, readTokenRecord } from "@/lib/webex/store";
import type { WebexDiagnostics, WebexScopeTestResult } from "@/lib/webex/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Focused diagnostics response for the "Connect Webex" failure path —
 * exactly the fields needed to root-cause a failed OAuth connection,
 * including which incremental scope diagnostic tests have run. Never
 * returns a client ID/secret value, access token, or refresh token. */
export async function GET() {
  const config = getConfig();
  const [tokenRecord, identity, { health }, lastError, scopeTestRecords] = await Promise.all([
    readTokenRecord(),
    readIdentityRecord(),
    getValidAccessToken(),
    readLastOAuthError(),
    readScopeTestResults()
  ]);

  const scopeTestsById = new Map(scopeTestRecords.map((record) => [record.testId, record]));
  const scope_tests: WebexScopeTestResult[] = SCOPE_DIAGNOSTIC_TESTS.map((test) => {
    const record = scopeTestsById.get(test.id);
    return {
      test_id: test.id,
      label: test.label,
      scopes: test.scopes,
      status: record?.status ?? "not_run",
      error_code: record?.errorCode ?? null,
      error_message: record?.errorMessage ?? null,
      occurred_at: record?.occurredAt ?? null
    };
  });

  const diagnostics: WebexDiagnostics = {
    configured: config.hasWebexOAuth,
    connected: Boolean(tokenRecord),
    redirect_uri: config.WEBEX_REDIRECT_URI,
    requested_scopes_raw: config.WEBEX_SCOPES,
    requested_scopes: normalizeScopes(config.WEBEX_SCOPES),
    authorization_url_origin: "https://webexapis.com",
    client_id_configured: Boolean(config.WEBEX_CLIENT_ID),
    client_secret_configured: Boolean(config.WEBEX_CLIENT_SECRET),
    granted_scopes: tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [],
    connected_user: tokenRecord ? { name: identity?.displayName ?? null, email: identity?.email ?? null } : null,
    token_refresh_status: health,
    last_error_code: lastError?.code ?? null,
    last_error_message: lastError?.message ?? null,
    last_failed_scope_set: lastError?.scopes ?? [],
    scope_tests
  };

  return NextResponse.json(diagnostics, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
