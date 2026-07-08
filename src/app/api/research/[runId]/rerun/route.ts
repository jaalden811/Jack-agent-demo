import { NextResponse } from "next/server";
import { runResearch } from "@/lib/services";
import { getRun, saveRun } from "@/lib/storage";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const previousRun = await getRun(runId);
    if (!previousRun) {
      return NextResponse.json({ error: "Research run not found" }, { status: 404 });
    }

    const rerun = await runResearch(previousRun.input, []);
    await saveRun(rerun);
    return NextResponse.json(rerun);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Rerun failed",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
