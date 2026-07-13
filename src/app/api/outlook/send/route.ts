import { NextResponse } from "next/server";
import { z } from "zod";
import { sendOutlookEmail } from "@/lib/outlook/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sendSchema = z.object({
  toEmail: z.string().email(),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1)
});

/** Generic send endpoint — accepts an already-built message (subject +
 * HTML + text body). The automation pipeline (@/lib/webex/automation)
 * builds the actual routed-brief email content and calls
 * @/lib/outlook/send directly in-process; this route exists for the
 * "Send test email" action and any client-driven retry. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", detail: parsed.error.message }, { status: 400 });
  }

  const result = await sendOutlookEmail(parsed.data);
  return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
}
