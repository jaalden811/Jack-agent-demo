import { NextResponse } from "next/server";
import { clearIdentityRecord, clearTokenRecord } from "@/lib/webex/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  await clearTokenRecord();
  await clearIdentityRecord();
  return NextResponse.json({ disconnected: true });
}
