import { NextResponse } from "next/server";
import { invalidateCircuitToken, getCircuitAccessToken } from "@/lib/circuit/tokenManager";

// Forces a fresh Circuit token. Never returns the token — only the
// resulting safe state.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  invalidateCircuitToken();
  const { token, error } = await getCircuitAccessToken();
  return NextResponse.json(
    { refreshed: Boolean(token), error_code: error ? error.code : null, at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
