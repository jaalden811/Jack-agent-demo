import { NextResponse } from "next/server";
import { getProviderDiagnostics } from "@/lib/services";

// Must re-run on every request so env vars are read from process.env, not build cache.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getProviderDiagnostics());
}
