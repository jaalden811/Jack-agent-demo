import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { normalizeSellerProfile } from "@/lib/personalization/profileSchema";
import { readSellerProfile, resolveActiveSellerProfile, saveSellerProfile } from "@/lib/personalization/profileStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET the current (owner) seller profile, or a specific profile by id. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profile_id");
  const profile = profileId ? await readSellerProfile(profileId) : await resolveActiveSellerProfile();
  return NextResponse.json({ profile }, { headers: { "Cache-Control": "no-store" } });
}

/** Create or update the owner's seller profile from the setup wizard. */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const existingId = body && typeof body === "object" && "profile_id" in body ? String((body as Record<string, unknown>).profile_id) : null;
    const existing = existingId ? await readSellerProfile(existingId) : null;
    const profile = normalizeSellerProfile(body, existing);
    const result = await saveSellerProfile(profile);
    if (!result.persisted) {
      return NextResponse.json({ error: "Could not persist profile", detail: result.warning }, { status: 500 });
    }
    return NextResponse.json({ profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid profile", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not save profile" }, { status: 500 });
  }
}
