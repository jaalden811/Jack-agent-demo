import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { readAutopilotOverride, readTokenRecord, writeAutopilotOverride } from "@/lib/webex/store";
import { resolveWebexSender } from "@/lib/webex/senderResolution";
import { TRANSCRIPT_SCOPE } from "@/lib/webex/scopePolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ enabled: z.boolean() });

async function hasTranscriptScope(): Promise<boolean> {
  const tokenRecord = await readTokenRecord();
  const scopes = tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [];
  return scopes.includes(TRANSCRIPT_SCOPE);
}

export async function GET() {
  const override = await readAutopilotOverride();
  const config = getConfig();
  const [sender, transcriptGranted] = await Promise.all([resolveWebexSender(), hasTranscriptScope()]);
  const enabled = override ?? config.WEBEX_AUTOPILOT_ENABLED;
  return NextResponse.json({ enabled, available: config.webexPublicBaseUrlUsable && sender.mode !== "unavailable" && transcriptGranted });
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

  const config = getConfig();
  if (parsed.data.enabled) {
    if (!config.webexPublicBaseUrlUsable) {
      return NextResponse.json({ error: "A public URL is required for Webex transcript webhooks." }, { status: 400 });
    }
    if (!(await hasTranscriptScope())) {
      return NextResponse.json({ error: "Enable transcript access (meeting:transcripts_read) before enabling autopilot." }, { status: 400 });
    }
  }

  await writeAutopilotOverride(parsed.data.enabled);
  return NextResponse.json({ enabled: parsed.data.enabled });
}
