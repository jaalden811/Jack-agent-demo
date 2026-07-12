import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { AuditSummary, SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Appends every run to signal-agent-poc/data/output/signal_log.jsonl —
 * the same audit file the Python POC uses — so both stay compatible.
 * Any filesystem failure (read-only serverless FS, missing directory
 * permissions, etc.) is caught and reported as a warning; it never
 * crashes the request.
 */

export const AUDIT_LOG_RELATIVE_PATH = "signal-agent-poc/data/output/signal_log.jsonl";

function auditLogPath() {
  return path.join(process.cwd(), AUDIT_LOG_RELATIVE_PATH);
}

export async function appendAuditRecord(result: SecureNetworkingTriageResult): Promise<{ logged: boolean; warning: string | null }> {
  try {
    const filePath = auditLogPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    // Persist the record without the nested `audit` field itself (that
    // field only becomes accurate once this write finishes, so a
    // placeholder logged:false would be misleading) and without the full
    // raw transcript text (kept in the API response for "View transcript"
    // but excluded here to keep the audit log compact).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { audit, transcript_meta, ...record } = result;
    const compactRecord = { ...record, transcript_meta: { ...transcript_meta, raw_text: undefined } };
    await appendFile(filePath, `${JSON.stringify(compactRecord)}\n`, "utf8");
    return { logged: true, warning: null };
  } catch {
    return {
      logged: false,
      warning: "Audit log write failed (local/dev filesystem issue); this run was not persisted to signal_log.jsonl."
    };
  }
}

export async function readRecentAuditRecords(limit = 10): Promise<AuditSummary> {
  try {
    const filePath = auditLogPath();
    const text = await readFile(filePath, "utf8");
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    const records = lines
      .slice(-limit)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return { parse_error: true, raw: line };
        }
      });
    return { available: true, totalRecords: lines.length, records, warning: null };
  } catch (error) {
    const isMissingFile = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    return {
      available: false,
      totalRecords: 0,
      records: [],
      warning: isMissingFile ? "No audit log yet — run the agent at least once to create one." : "Audit log could not be read."
    };
  }
}
