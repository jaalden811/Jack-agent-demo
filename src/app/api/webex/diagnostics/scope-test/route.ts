import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { buildAuthorizeUrl } from "@/lib/webex/client";
import { saveOAuthState } from "@/lib/webex/store";
import { findScopeDiagnosticTest, SCOPE_DIAGNOSTIC_TESTS } from "@/lib/webex/scopeDiagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ testId: z.enum(["identity", "messaging", "meetings", "transcripts"]) });

/**
 * Initiates one of the four incremental scope diagnostic tests
 * (identity / messaging / meetings / transcripts). Each test uses the
 * exact same Client ID, redirect URI, and OAuth state mechanism as a
 * real connection attempt — only the requested scope set differs —
 * isolating which single additional scope Webex rejects.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `testId must be one of: ${SCOPE_DIAGNOSTIC_TESTS.map((t) => t.id).join(", ")}` }, { status: 400 });
  }

  const config = getConfig();
  if (!config.WEBEX_CLIENT_ID || !config.WEBEX_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "WEBEX_CLIENT_ID/WEBEX_CLIENT_SECRET are not configured on the server." },
      { status: 400 }
    );
  }

  const test = findScopeDiagnosticTest(parsed.data.testId);
  if (!test) {
    return NextResponse.json({ error: "Unknown scope diagnostic test." }, { status: 400 });
  }

  const state = randomUUID();
  await saveOAuthState(state, { testId: test.id, scopes: test.scopes });

  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.WEBEX_CLIENT_ID,
    redirectUri: config.WEBEX_REDIRECT_URI,
    scopes: test.scopes,
    state
  });

  return NextResponse.json({ authorize_url: authorizeUrl, scopes: test.scopes, test_id: test.id });
}
