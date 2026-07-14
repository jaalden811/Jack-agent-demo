import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getValidAccessToken } from "@/lib/webex/tokenManager";
import { createWebhook, deleteWebhook, listWebhooks } from "@/lib/webex/client";
import { readTokenRecord, readWebhookRecord, writeWebhookRecord } from "@/lib/webex/store";
import { TRANSCRIPT_SCOPE } from "@/lib/webex/scopePolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEBHOOK_NAME = "Peachtree Signal Agent — meeting transcript created";
const RESOURCE = "meetingTranscripts";
const EVENT = "created";

export async function POST() {
  const config = getConfig();
  if (!config.webexPublicBaseUrlUsable) {
    return NextResponse.json({ error: "A public URL is required for Webex transcript webhooks." }, { status: 400 });
  }

  const { accessToken } = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Webex is not connected." }, { status: 401 });
  }

  const tokenRecord = await readTokenRecord();
  const grantedScopes = tokenRecord?.scope ? tokenRecord.scope.split(/\s+/).filter(Boolean) : [];
  if (!grantedScopes.includes(TRANSCRIPT_SCOPE)) {
    return NextResponse.json(
      { error: "Enable transcript access (meeting:transcripts_read) before registering the transcript webhook." },
      { status: 400 }
    );
  }

  const targetUrl = `${config.WEBEX_PUBLIC_BASE_URL!.replace(/\/$/, "")}/api/webex/webhooks/transcripts`;

  // Avoid duplicate registrations: check our own record first, then
  // double-check against Webex's own webhook list in case state drifted.
  const existing = await readWebhookRecord();
  if (existing && existing.targetUrl === targetUrl) {
    return NextResponse.json({ registered: true, webhookId: existing.webhookId, targetUrl, alreadyRegistered: true });
  }

  try {
    const remoteWebhooks = await listWebhooks(accessToken);
    const duplicate = remoteWebhooks.find((webhook) => webhook.resource === RESOURCE && webhook.event === EVENT && webhook.targetUrl === targetUrl);
    if (duplicate) {
      await writeWebhookRecord({
        webhookId: duplicate.id,
        targetUrl,
        resource: RESOURCE,
        event: EVENT,
        registeredAt: new Date().toISOString(),
        lastEventAt: null,
        lastEventTranscriptId: null
      });
      return NextResponse.json({ registered: true, webhookId: duplicate.id, targetUrl, alreadyRegistered: true });
    }

    const created = await createWebhook(accessToken, {
      name: WEBHOOK_NAME,
      targetUrl,
      resource: RESOURCE,
      event: EVENT,
      secret: config.WEBEX_WEBHOOK_SECRET
    });

    await writeWebhookRecord({
      webhookId: created.id,
      targetUrl,
      resource: RESOURCE,
      event: EVENT,
      registeredAt: new Date().toISOString(),
      lastEventAt: null,
      lastEventTranscriptId: null
    });

    return NextResponse.json({ registered: true, webhookId: created.id, targetUrl, alreadyRegistered: false });
  } catch (error) {
    return NextResponse.json(
      { error: "Could not register the Webex webhook", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}

export async function DELETE() {
  const existing = await readWebhookRecord();
  if (!existing) {
    return NextResponse.json({ removed: true, note: "No webhook was registered." });
  }

  const { accessToken } = await getValidAccessToken();
  if (accessToken) {
    try {
      await deleteWebhook(accessToken, existing.webhookId);
    } catch {
      // Best-effort — even if the remote delete fails (e.g. token expired),
      // still clear the local record so the UI reflects "not registered."
    }
  }

  await writeWebhookRecord(null);
  return NextResponse.json({ removed: true });
}
