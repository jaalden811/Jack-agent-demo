import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { PersistedRunRecord } from "@/lib/qualification/types";

/**
 * Persists a completed analysis so its read-only public results page
 * (/signal-agent/results/[runId]) can serve the same content the
 * outbound Webex/Outlook message referenced — never a link to data
 * that only ever existed in the sender's browser/session.
 *
 * Uses the same local-JSON-file pattern as @/lib/webex/store.ts and
 * @/lib/signal-agent/auditLog.ts (this codebase has no wired-up
 * Supabase client/schema despite SUPABASE_URL being an accepted env
 * var — see config.hasSupabase). Local disk is a legitimate persistence
 * layer for this app's single-process deployment model; a future
 * multi-instance deployment should replace this module's two functions
 * with a real database-backed implementation without changing callers.
 */

function resultsDir(): string {
  const config = getConfig();
  // path.resolve (not path.join), matching @/lib/webex/store.ts: an
  // absolute LOCAL_DATA_DIR — as used by tests that isolate storage
  // into a temp directory — is honored as an absolute root instead of
  // being nested under process.cwd().
  return path.resolve(process.cwd(), config.LOCAL_DATA_DIR, "signal-agent-results");
}

function resultPath(runId: string): string {
  // Defense in depth: runId is generated internally (UUID), but never
  // trust a path built from external input without sanitizing.
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(resultsDir(), `${safeId}.json`);
}

export async function persistRunResult(record: PersistedRunRecord): Promise<{ persisted: boolean; warning: string | null }> {
  try {
    const dir = resultsDir();
    await mkdir(dir, { recursive: true });
    await writeFile(resultPath(record.run_id), JSON.stringify(record, null, 2), "utf8");
    return { persisted: true, warning: null };
  } catch (error) {
    return { persisted: false, warning: error instanceof Error ? error.message : "Result persistence failed" };
  }
}

export async function readRunResult(runId: string): Promise<PersistedRunRecord | null> {
  try {
    const text = await readFile(resultPath(runId), "utf8");
    return JSON.parse(text) as PersistedRunRecord;
  } catch {
    return null;
  }
}
