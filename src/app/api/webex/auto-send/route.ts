import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAutoSendOverride } from "@/lib/webex/store";
import { getAutomationReadiness } from "@/lib/webex/automationSettings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ enabled: z.boolean() });

/** Auto-send after analysis — works for Demo/Paste/Upload/manually
 * selected Webex transcripts, no public URL required. Distinct from the
 * webhook-triggered autopilot at /api/webex/autopilot. */
export async function GET() {
  const readiness = await getAutomationReadiness();
  return NextResponse.json({
    enabled: readiness.autoSendEnabled,
    overridden: readiness.autoSendOverridden,
    webex_ready: readiness.webexReady,
    outlook_ready: readiness.outlookReady
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
  }

  await writeAutoSendOverride(parsed.data.enabled);
  return NextResponse.json({ enabled: parsed.data.enabled });
}
