import { NextResponse } from "next/server";
import { getSignalAgentStatus } from "@/lib/signal-agent/status";

// Read env vars and probe providers live on every request — never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const useOpenAiParam = url.searchParams.get("useOpenAI");
  const useOpenAI = useOpenAiParam === null ? true : useOpenAiParam !== "false";

  const status = await getSignalAgentStatus({ useOpenAI });
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" }
  });
}
