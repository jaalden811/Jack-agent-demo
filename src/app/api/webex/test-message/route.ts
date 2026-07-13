import { NextResponse } from "next/server";
import { z } from "zod";
import { sendDirectMessage, WebexApiError } from "@/lib/webex/client";
import { loadRoutingConfig, getRecipientEmail } from "@/lib/webex/peachtreeRouting";
import { resolveWebexSender } from "@/lib/webex/senderResolution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ lane: z.enum(["sales", "technical"]) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "lane must be 'sales' or 'technical'" }, { status: 400 });
  }

  const sender = await resolveWebexSender();
  if (!sender.accessToken) {
    return NextResponse.json(
      { error: "Webex delivery is unavailable — connect Webex (or configure an optional bot token) first." },
      { status: 400 }
    );
  }

  const routingConfig = loadRoutingConfig();
  const recipient = routingConfig.recipients[parsed.data.lane];
  const email = getRecipientEmail(parsed.data.lane, routingConfig);
  if (!email) {
    return NextResponse.json({ error: `No recipient email configured for the ${parsed.data.lane} lane.` }, { status: 400 });
  }

  const markdown = [
    `**Peachtree Signal Agent — connection test**`,
    "",
    `This is a one-time test message confirming Webex delivery (sender mode: ${sender.mode}) can reach the ${parsed.data.lane} lane (${recipient.name}).`,
    "",
    "No customer or transcript data is included in this message."
  ].join("\n");

  try {
    const sent = await sendDirectMessage(sender.accessToken, { toPersonEmail: email, markdown });
    return NextResponse.json({ delivered: true, message_id: sent.id, recipient_email: email, sender_mode: sender.mode });
  } catch (error) {
    const detail = error instanceof WebexApiError ? error.message : error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ delivered: false, error: detail, recipient_email: email }, { status: 502 });
  }
}
