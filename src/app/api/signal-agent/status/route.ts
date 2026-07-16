import { NextResponse } from "next/server";
import { getSignalAgentStatus } from "@/lib/signal-agent/status";

// Read env vars and probe providers live on every request — never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getSignalAgentStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" }
  });
}
