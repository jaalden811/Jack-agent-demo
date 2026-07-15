import { NextResponse } from "next/server";
import { testCircuitAuthentication } from "@/lib/circuit/diagnostics";

// Server-side only: mints a Circuit token to verify credentials. Returns a
// safe pass/fail result — never the token.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const result = await testCircuitAuthentication();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
