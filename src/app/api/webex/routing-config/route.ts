import { NextResponse } from "next/server";
import { loadRoutingConfig, getRoutingConfigPath, clearRoutingConfigCache } from "@/lib/webex/peachtreeRouting";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const config = loadRoutingConfig();
    return NextResponse.json({ path: getRoutingConfigPath(), config });
  } catch (error) {
    return NextResponse.json(
      { error: "Could not load routing config", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** Reload: clears the in-process cache and re-reads
 * peachtree_pilot_routing.json from disk so edits take effect without a
 * server restart. */
export async function POST() {
  clearRoutingConfigCache();
  try {
    const config = loadRoutingConfig();
    return NextResponse.json({ reloaded: true, path: getRoutingConfigPath(), config });
  } catch (error) {
    return NextResponse.json(
      { error: "Could not reload routing config", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
