import { NextResponse } from "next/server";
import { invalidateCircuitToken, getCircuitTokenState } from "@/lib/circuit/tokenManager";

// Clears the in-memory cached Circuit token. Never returns the token.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  invalidateCircuitToken();
  return NextResponse.json({ cleared: true, tokenState: getCircuitTokenState().state, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
