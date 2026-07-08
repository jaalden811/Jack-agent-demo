import { NextResponse } from "next/server";
import { getProviderDiagnostics } from "@/lib/services";

// Must re-run on every request so env vars are read from process.env, not build cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const diagnostics = getProviderDiagnostics();
  return NextResponse.json(diagnostics, {
    headers: {
      // Prevent browser and CDN from caching; client must always get the live status.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache"
    }
  });
}
