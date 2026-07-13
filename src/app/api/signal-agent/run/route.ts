import { NextResponse } from "next/server";
import { runRequestSchema } from "@/lib/signal-agent/types";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { computePeachtreePreview, deliverPeachtreePipeline } from "@/lib/webex/automation";
import type { WebexAutomationRunResult } from "@/lib/webex/types";

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
    const rawWebexSource = parsed.data.webexSource;
    const webexSource = rawWebexSource
      ? {
          transcriptId: rawWebexSource.transcriptId,
          meetingId: rawWebexSource.meetingId ?? null,
          meetingTitle: rawWebexSource.meetingTitle ?? null,
          host: rawWebexSource.host ?? null,
          meetingDate: rawWebexSource.meetingDate ?? null,
          source: "webex" as const
        }
      : null;
    const transcriptText = result.transcript_meta.raw_text;

    // Manual analysis (any input mode, including an imported Webex
    // transcript) only ever previews the Peachtree routing/messages by
    // default — real delivery is reserved for the autonomous webhook and
    // the explicit "Retry / Send via Webex" action, so re-running a demo
    // or pasted transcript never causes an unexpected send.
    const peachtree = parsed.data.options?.deliverToWebex
      ? await deliverPeachtreePipeline(result, transcriptText, webexSource)
      : computePeachtreePreview(result);

    const response: WebexAutomationRunResult = { ...result, peachtree, webex_source: webexSource ?? null };
    return NextResponse.json(response);
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
