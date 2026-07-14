import { NextResponse } from "next/server";
import { runRequestSchema, TranscriptParseIncompleteError } from "@/lib/signal-agent/types";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { computePeachtreePreview, deliverPeachtreePipeline } from "@/lib/webex/automation";
import { getAutomationReadiness } from "@/lib/webex/automationSettings";
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

    // "Auto-send after analysis" (distinct from the webhook-triggered
    // autopilot) fires immediately after every completed analysis —
    // Demo, Paste, Upload, or a manually-selected Webex transcript —
    // once both messaging channels are ready, unless the user has
    // explicitly disabled it. An explicit per-run override
    // (`options.deliverToWebex`) can also force delivery/preview.
    const readiness = await getAutomationReadiness();
    const shouldDeliver = parsed.data.options?.deliverToWebex ?? readiness.autoSendEnabled;
    const peachtree = shouldDeliver
      ? await deliverPeachtreePipeline(result, transcriptText, webexSource)
      : await computePeachtreePreview(result);

    const response: WebexAutomationRunResult = { ...result, peachtree, webex_source: webexSource ?? null };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof TranscriptParseIncompleteError) {
      // Never silently continue as a normal run, and never auto-send —
      // this is a parser-failure signal, not a low-intent result.
      return NextResponse.json(
        {
          error: error.code,
          detail: error.message,
          transcript_diagnostics: error.diagnostics
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      {
        error: "Signal agent run failed",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
