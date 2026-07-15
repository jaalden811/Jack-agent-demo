import { NextResponse } from "next/server";
import { getCircuitDiagnostics } from "@/lib/circuit/diagnostics";

// Live, never-cached Circuit diagnostics. Returns only safe metadata —
// never the client secret or access token.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getCircuitDiagnostics(), {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" }
  });
}
