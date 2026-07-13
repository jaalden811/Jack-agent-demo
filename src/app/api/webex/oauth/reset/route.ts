import { NextResponse } from "next/server";
import { resetOAuthHandshakeState } from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Clears a stuck/pending OAuth handshake (the saved CSRF state) and
 * the last recorded connection error, so the user can retry a clean
 * "Connect Webex" attempt from Setup. Does not disconnect an existing
 * successful connection — use POST /api/webex/oauth/disconnect for that. */
export async function POST() {
  await resetOAuthHandshakeState();
  return NextResponse.json({ reset: true });
}
