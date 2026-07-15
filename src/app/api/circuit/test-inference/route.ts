import { NextResponse } from "next/server";
import { testCircuitInference } from "@/lib/circuit/diagnostics";

// Server-side only: runs a tiny inference to verify the contract. Returns
// safe metadata (ok, error code, returned model) — never the token or the
// raw provider body.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const result = await testCircuitInference();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
