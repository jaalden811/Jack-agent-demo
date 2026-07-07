import { NextResponse } from "next/server";
import { getRun } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Research run not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}
