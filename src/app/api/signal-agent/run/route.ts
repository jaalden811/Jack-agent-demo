import { NextResponse } from "next/server";
import { runRequestSchema } from "@/lib/signal-agent/types";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";

// Env vars (OPENAI_API_KEY) must be read live, never baked in at build time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", detail: parsed.error.message }, { status: 400 });
  }

  if (!parsed.data.transcriptId && !parsed.data.customTranscript) {
    return NextResponse.json({ error: "Provide either transcriptId or customTranscript" }, { status: 400 });
  }

  try {
    const result = await runSignalAgent(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Signal agent run failed",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
