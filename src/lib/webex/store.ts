import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";

/**
 * File-based persistence for the Webex pilot integration — OAuth token
 * metadata, connected-user identity cache, webhook registration state,
 * the processed-transcript idempotency guard, and the full audit trail.
 *
 * Lives under LOCAL_DATA_DIR/webex/ (default `.data/webex/`), which is
 * already gitignored at the repo root — the same pattern @/lib/storage.ts
 * uses for research runs. Nothing here is ever returned directly to the
 * browser; API routes must always project these records through a
 * secrets-safe shape (see @/app/api/webex/status/route.ts).
 */

function webexDir() {
  const config = getConfig();
  // path.resolve (not path.join) so an absolute LOCAL_DATA_DIR — as used
  // by tests that isolate storage into a temp directory — is honored as
  // an absolute root instead of being nested under process.cwd().
  return path.resolve(process.cwd(), config.LOCAL_DATA_DIR, "webex");
}

async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path.join(webexDir(), fileName), "utf8");
    return JSON.parse(text) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(fileName: string, data: unknown): Promise<void> {
  const dir = webexDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), JSON.stringify(data, null, 2), "utf8");
}

// ─── OAuth token storage ───────────────────────────────────────────────────

export type WebexTokenRecord = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: string; // ISO timestamp
  refreshExpiresAt: string | null;
  scope: string;
  obtainedAt: string;
  lastRefreshedAt: string | null;
  lastRefreshError: string | null;
};

export async function readTokenRecord(): Promise<WebexTokenRecord | null> {
  return readJsonFile<WebexTokenRecord | null>("tokens.json", null);
}

export async function writeTokenRecord(record: WebexTokenRecord): Promise<void> {
  await writeJsonFile("tokens.json", record);
}

export async function clearTokenRecord(): Promise<void> {
  await writeJsonFile("tokens.json", null);
}

// ─── Connected identity cache ──────────────────────────────────────────────

export type WebexIdentityRecord = {
  personId: string;
  displayName: string;
  email: string | null;
  cachedAt: string;
};

export async function readIdentityRecord(): Promise<WebexIdentityRecord | null> {
  return readJsonFile<WebexIdentityRecord | null>("identity.json", null);
}

export async function writeIdentityRecord(record: WebexIdentityRecord): Promise<void> {
  await writeJsonFile("identity.json", record);
}

export async function clearIdentityRecord(): Promise<void> {
  await writeJsonFile("identity.json", null);
}

// ─── OAuth CSRF state (short-lived) ────────────────────────────────────────

type OAuthStateRecord = { state: string; createdAt: string };

export async function saveOAuthState(state: string): Promise<void> {
  await writeJsonFile("oauth-state.json", { state, createdAt: new Date().toISOString() } satisfies OAuthStateRecord);
}

export async function consumeOAuthState(candidate: string): Promise<boolean> {
  const record = await readJsonFile<OAuthStateRecord | null>("oauth-state.json", null);
  if (!record || record.state !== candidate) return false;
  await writeJsonFile("oauth-state.json", null);
  return true;
}

// ─── Last OAuth error (for surfacing a specific reason, never a token) ────

export type WebexOAuthErrorCode =
  | "redirect_uri_mismatch"
  | "invalid_client"
  | "invalid_client_secret"
  | "invalid_scope"
  | "user_denied"
  | "state_mismatch"
  | "token_exchange_failed"
  | "identity_lookup_failed"
  | "token_store_failed";

export type WebexOAuthErrorRecord = {
  code: WebexOAuthErrorCode;
  message: string;
  occurredAt: string;
};

export async function readLastOAuthError(): Promise<WebexOAuthErrorRecord | null> {
  return readJsonFile<WebexOAuthErrorRecord | null>("last-oauth-error.json", null);
}

export async function writeLastOAuthError(record: WebexOAuthErrorRecord | null): Promise<void> {
  await writeJsonFile("last-oauth-error.json", record);
}

// ─── Webhook registration state ────────────────────────────────────────────

export type WebexWebhookRecord = {
  webhookId: string;
  targetUrl: string;
  resource: string;
  event: string;
  registeredAt: string;
  lastEventAt: string | null;
  lastEventTranscriptId: string | null;
};

export async function readWebhookRecord(): Promise<WebexWebhookRecord | null> {
  return readJsonFile<WebexWebhookRecord | null>("webhook.json", null);
}

export async function writeWebhookRecord(record: WebexWebhookRecord | null): Promise<void> {
  await writeJsonFile("webhook.json", record);
}

export async function recordWebhookEventReceived(transcriptId: string): Promise<void> {
  const record = await readWebhookRecord();
  if (!record) return;
  await writeWebhookRecord({ ...record, lastEventAt: new Date().toISOString(), lastEventTranscriptId: transcriptId });
}

// ─── Processed-transcript idempotency guard ────────────────────────────────

export type ProcessedTranscriptRecord = {
  transcriptId: string;
  processedAt: string;
  lanesSent: string[]; // e.g. ["sales", "technical"] — which lanes already received a message
  verdict: string;
  runId: string;
};

type ProcessedTranscriptStore = Record<string, ProcessedTranscriptRecord>;

export async function getProcessedTranscript(transcriptId: string): Promise<ProcessedTranscriptRecord | null> {
  const store = await readJsonFile<ProcessedTranscriptStore>("processed-transcripts.json", {});
  return store[transcriptId] ?? null;
}

export async function markTranscriptProcessed(record: ProcessedTranscriptRecord): Promise<void> {
  const store = await readJsonFile<ProcessedTranscriptStore>("processed-transcripts.json", {});
  store[record.transcriptId] = record;
  await writeJsonFile("processed-transcripts.json", store);
}

export async function addLanesSent(transcriptId: string, lanes: string[]): Promise<void> {
  const store = await readJsonFile<ProcessedTranscriptStore>("processed-transcripts.json", {});
  const existing = store[transcriptId];
  if (!existing) return;
  store[transcriptId] = { ...existing, lanesSent: Array.from(new Set([...existing.lanesSent, ...lanes])) };
  await writeJsonFile("processed-transcripts.json", store);
}

// ─── Autopilot enable/disable (runtime override of WEBEX_AUTOPILOT_ENABLED) ─

export async function readAutopilotOverride(): Promise<boolean | null> {
  return readJsonFile<boolean | null>("autopilot.json", null);
}

export async function writeAutopilotOverride(enabled: boolean): Promise<void> {
  await writeJsonFile("autopilot.json", enabled);
}

// ─── Auto-send-after-analysis override (distinct from webhook autopilot) ───
// Auto-send fires immediately after any completed analysis (Demo, Paste,
// Upload, or a manually-selected Webex transcript) with no public URL
// required. Default (when no override is stored) is computed from
// whether both messaging channels are ready — see
// @/lib/webex/automationSettings.

export async function readAutoSendOverride(): Promise<boolean | null> {
  return readJsonFile<boolean | null>("auto-send.json", null);
}

export async function writeAutoSendOverride(enabled: boolean): Promise<void> {
  await writeJsonFile("auto-send.json", enabled);
}

// ─── Audit trail (append-only JSONL) ───────────────────────────────────────

export type WebexAuditRecord = Record<string, unknown> & {
  timestamp: string;
  transcriptId: string;
};

const AUDIT_FILE = "audit.jsonl";

export async function appendWebexAudit(record: WebexAuditRecord): Promise<{ logged: boolean; warning: string | null }> {
  try {
    const dir = webexDir();
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, AUDIT_FILE), `${JSON.stringify(record)}\n`, "utf8");
    return { logged: true, warning: null };
  } catch {
    return { logged: false, warning: "Webex audit log write failed (local/dev filesystem issue)." };
  }
}

export async function readRecentWebexAudit(limit = 10): Promise<WebexAuditRecord[]> {
  try {
    const text = await readFile(path.join(webexDir(), AUDIT_FILE), "utf8");
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    return lines
      .slice(-limit)
      .reverse()
      .map((line) => JSON.parse(line) as WebexAuditRecord);
  } catch {
    return [];
  }
}
