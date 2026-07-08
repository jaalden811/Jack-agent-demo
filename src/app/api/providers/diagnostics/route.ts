import { NextResponse } from "next/server";
import { getProviderDiagnostics } from "@/lib/services";

export async function GET() {
  return NextResponse.json(getProviderDiagnostics());
}
