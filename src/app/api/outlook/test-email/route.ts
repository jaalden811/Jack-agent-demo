import { NextResponse } from "next/server";
import { z } from "zod";
import { loadRoutingConfig, getRecipientEmail } from "@/lib/webex/peachtreeRouting";
import { sendOutlookEmail } from "@/lib/outlook/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const testEmailSchema = z.object({ lane: z.enum(["sales", "technical"]) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = testEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", detail: parsed.error.message }, { status: 400 });
  }

  const config = loadRoutingConfig();
  const recipient = config.recipients[parsed.data.lane];
  const email = getRecipientEmail(parsed.data.lane, config);
  if (!email) {
    return NextResponse.json({ accepted: false, error: `No recipient email configured for the ${parsed.data.lane} lane.` }, { status: 400 });
  }

  const result = await sendOutlookEmail({
    toEmail: email,
    subject: "[Test] Signal-to-Solution Triage — Outlook connection check",
    html: `<p>This is a test email confirming Outlook delivery is connected for the Peachtree Select pilot.</p><p>Recipient: ${recipient.name} (${recipient.assignment_label}).</p>`,
    text: `This is a test email confirming Outlook delivery is connected for the Peachtree Select pilot.\nRecipient: ${recipient.name} (${recipient.assignment_label}).`
  });

  return NextResponse.json({ ...result, recipient_email: email }, { status: result.accepted ? 200 : 200 });
}
