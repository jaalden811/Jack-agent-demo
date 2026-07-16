import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { normalizeEmailKey } from "@/lib/personalization/profileSchema";
import type { SellerProfile } from "@/lib/personalization/types";

/**
 * Seller-profile persistence. Reuses the local-JSON store pattern
 * (LOCAL_DATA_DIR) used by resultStore/feedbackStore — no new database. The
 * canonical profile is server-side (server-side message generation needs it),
 * keyed by profile_id (person:<id> or email:<normalized>). A multi-instance
 * deployment can swap the file layer without changing callers.
 */

function profilesDir(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "seller-profiles");
}

function safeKey(profileId: string): string {
  return profileId.replace(/[^a-zA-Z0-9_@.:-]/g, "_");
}

function profilePath(profileId: string): string {
  return path.join(profilesDir(), `${safeKey(profileId)}.json`);
}

export async function saveSellerProfile(profile: SellerProfile): Promise<{ persisted: boolean; warning: string | null }> {
  try {
    await mkdir(profilesDir(), { recursive: true });
    await writeFile(profilePath(profile.profile_id), JSON.stringify(profile, null, 2), "utf8");
    return { persisted: true, warning: null };
  } catch (error) {
    return { persisted: false, warning: error instanceof Error ? error.message : "Profile persistence failed" };
  }
}

export async function readSellerProfile(profileId: string): Promise<SellerProfile | null> {
  try {
    const text = await readFile(profilePath(profileId), "utf8");
    return JSON.parse(text) as SellerProfile;
  } catch {
    return null;
  }
}

export async function listSellerProfiles(): Promise<SellerProfile[]> {
  try {
    const files = await readdir(profilesDir());
    const profiles: SellerProfile[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        profiles.push(JSON.parse(await readFile(path.join(profilesDir(), file), "utf8")) as SellerProfile);
      } catch {
        /* skip unreadable */
      }
    }
    return profiles;
  } catch {
    return [];
  }
}

/** The "current seller" profile for the local pilot (no auth): the single
 * active profile, or the most-recently-updated active profile. Returns null
 * when none exists so the product degrades to non-personalized behavior. */
export async function resolveActiveSellerProfile(): Promise<SellerProfile | null> {
  const active = (await listSellerProfiles()).filter((p) => p.active);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  return active.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0];
}

/** Resolve a profile by person_id first, then normalized internal email. */
export async function resolveSellerProfile(input: { personId?: string | null; email?: string | null }): Promise<SellerProfile | null> {
  if (input.personId && input.personId.trim()) {
    const byPerson = await readSellerProfile(`person:${input.personId.trim()}`);
    if (byPerson) return byPerson;
  }
  if (input.email && input.email.trim()) {
    const byEmail = await readSellerProfile(`email:${normalizeEmailKey(input.email)}`);
    if (byEmail) return byEmail;
    // Fall back to a linked person profile that carries the same email.
    const all = await listSellerProfiles();
    const match = all.find((p) => normalizeEmailKey(p.email) === normalizeEmailKey(input.email as string));
    if (match) return match;
  }
  return null;
}
