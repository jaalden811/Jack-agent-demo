import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { OutlookErrorRecord } from "@/lib/outlook/types";

/**
 * File-based persistence for the Outlook/Microsoft Graph integration —
 * mirrors @/lib/webex/store.ts. Lives under LOCAL_DATA_DIR/outlook/
 * (default `.data/outlook/`), already gitignored. Never returned
 * directly to the browser — API routes always project through a
 * secrets-safe shape (see @/app/api/outlook/status/route.ts).
 */

function outlookDir() {
  const config = getConfig();
  return path.resolve(process.cwd(), config.LOCAL_DATA_DIR, "outlook");
}

async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path.join(outlookDir(), fileName), "utf8");
    return JSON.parse(text) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(fileName: string, data: unknown): Promise<void> {
  const dir = outlookDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), JSON.stringify(data, null, 2), "utf8");
}

// ─── OAuth token storage ───────────────────────────────────────────────────

export type OutlookTokenRecord = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: string;
  scope: string;
  obtainedAt: string;
  lastRefreshedAt: string | null;
  lastRefreshError: string | null;
};

export async function readTokenRecord(): Promise<OutlookTokenRecord | null> {
  return readJsonFile<OutlookTokenRecord | null>("tokens.json", null);
}

export async function writeTokenRecord(record: OutlookTokenRecord): Promise<void> {
  await writeJsonFile("tokens.json", record);
}

export async function clearTokenRecord(): Promise<void> {
  await writeJsonFile("tokens.json", null);
}

// ─── Connected identity cache ──────────────────────────────────────────────

export type OutlookIdentityRecord = {
  id: string;
  displayName: string;
  email: string | null;
  cachedAt: string;
};

export async function readIdentityRecord(): Promise<OutlookIdentityRecord | null> {
  return readJsonFile<OutlookIdentityRecord | null>("identity.json", null);
}

export async function writeIdentityRecord(record: OutlookIdentityRecord): Promise<void> {
  await writeJsonFile("identity.json", record);
}

export async function clearIdentityRecord(): Promise<void> {
  await writeJsonFile("identity.json", null);
}

// ─── OAuth CSRF state + PKCE verifier (short-lived) ────────────────────────

type OAuthStateRecord = { state: string; codeVerifier: string; createdAt: string };

export async function saveOAuthState(state: string, codeVerifier: string): Promise<void> {
  await writeJsonFile("oauth-state.json", { state, codeVerifier, createdAt: new Date().toISOString() } satisfies OAuthStateRecord);
}

export async function consumeOAuthState(candidate: string): Promise<{ valid: boolean; codeVerifier: string | null }> {
  const record = await readJsonFile<OAuthStateRecord | null>("oauth-state.json", null);
  if (!record || record.state !== candidate) return { valid: false, codeVerifier: null };
  await writeJsonFile("oauth-state.json", null);
  return { valid: true, codeVerifier: record.codeVerifier };
}

// ─── Last OAuth error ───────────────────────────────────────────────────────

export async function readLastOAuthError(): Promise<OutlookErrorRecord | null> {
  return readJsonFile<OutlookErrorRecord | null>("last-oauth-error.json", null);
}

export async function writeLastOAuthError(record: OutlookErrorRecord | null): Promise<void> {
  await writeJsonFile("last-oauth-error.json", record);
}
