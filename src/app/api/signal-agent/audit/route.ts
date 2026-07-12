import { NextResponse } from "next/server";
import { readRecentAuditRecords } from "@/lib/signal-agent/auditLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;

  const summary = await readRecentAuditRecords(limit);
  return NextResponse.json(summary, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" }
  });
}
