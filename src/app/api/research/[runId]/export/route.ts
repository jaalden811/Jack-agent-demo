import { NextResponse } from "next/server";
import { exportRun } from "@/lib/services";
import { getRun } from "@/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Research run not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "json") as "json" | "csv" | "md";
  if (!["json", "csv", "md"].includes(format)) {
    return NextResponse.json({ error: "Unsupported export format" }, { status: 400 });
  }

  const body = exportRun(run, format);
  const contentType =
    format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="cisco-market-intel-${run.id}.${format}"`
    }
  });
}
