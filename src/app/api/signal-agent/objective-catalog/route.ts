import { NextResponse } from "next/server";
import { listMeasurementMetrics, listObjectives } from "@/lib/personalization/objectiveCatalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The data-driven seller objective catalog (objectives + measurement
 * metrics) so the setup wizard renders options from config, never React. */
export async function GET() {
  return NextResponse.json(
    { objectives: listObjectives(), measurement_metrics: listMeasurementMetrics() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
