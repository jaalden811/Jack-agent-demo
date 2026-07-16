import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { latestPursuitFeedback } from "@/lib/opportunity-feedback/feedbackStore";
import type { SecureNetworkingTriageResult } from "@/lib/signal-agent/types";

/**
 * Local opportunity threading. Groups related runs by resolved account +
 * primary opportunity motion (never by transcript title) so repeat runs show
 * "what changed since last time" and repeat unchanged opportunities don't
 * create alert fatigue. Reuses the LOCAL_DATA_DIR JSON store pattern; no CRM,
 * no database. Never rewrites historical deterministic scores.
 */

export type ThreadRunSnapshot = {
  run_id: string;
  timestamp: string;
  account_status: string;
  primary_motion: string;
  action_type: string;
  action_title: string;
  meddpicc_confirmed: number;
  public_signal_count: number;
  owner: string;
  verdict: string;
};

export type OpportunityThreadRecord = {
  thread_id: string;
  account: string;
  primary_motion: string;
  first_seen: string;
  last_seen: string;
  runs: ThreadRunSnapshot[];
};

export type OpportunityThreadBlock = {
  thread_id: string;
  previous_run_count: number;
  material_changes: string[];
  previous_decision: string | null;
  novelty: number;
  duplicate_of: string | null;
};

const MAX_RUNS_KEPT = 25;

function threadsDir(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "opportunity-threads");
}

export function normalizeAccountKey(account: string | null): string {
  return (account ?? "unknown").trim().toLowerCase().replace(/\s+/g, "-");
}

export function threadKey(account: string | null, motion: string): string {
  return `${normalizeAccountKey(account)}::${(motion || "unknown").toLowerCase()}`;
}

function threadPath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_:-]/g, "_");
  return path.join(threadsDir(), `${safe}.json`);
}

async function readThreadByKey(key: string): Promise<OpportunityThreadRecord | null> {
  try {
    return JSON.parse(await readFile(threadPath(key), "utf8")) as OpportunityThreadRecord;
  } catch {
    return null;
  }
}

function snapshotFromResult(result: SecureNetworkingTriageResult, primaryMotion: string): ThreadRunSnapshot {
  const nba = result.next_best_action;
  const meddpiccConfirmed = Object.values(result.meddpicc ?? {}).filter((d) => (d as { status?: string }).status === "CONFIRMED").length;
  return {
    run_id: result.run_id,
    timestamp: result.timestamp,
    account_status: result.account_resolution?.status ?? "unresolved",
    primary_motion: primaryMotion,
    action_type: nba?.action_type ?? "none",
    action_title: nba?.title ?? "",
    meddpicc_confirmed: meddpiccConfirmed,
    public_signal_count: (result.public_signals ?? []).length,
    owner: nba?.primary_owner ?? "",
    verdict: result.executive_summary.verdict
  };
}

const ACCOUNT_STATUS_RANK: Record<string, number> = { unresolved: 0, probable: 1, confirmed: 2 };

/** Human-readable material changes between the previous and current snapshot. */
export function computeMaterialChanges(previous: ThreadRunSnapshot, current: ThreadRunSnapshot): string[] {
  const changes: string[] = [];
  if ((ACCOUNT_STATUS_RANK[current.account_status] ?? 0) > (ACCOUNT_STATUS_RANK[previous.account_status] ?? 0)) {
    changes.push(`Account identity improved (${previous.account_status} → ${current.account_status}).`);
  }
  if (current.primary_motion !== previous.primary_motion) changes.push(`Primary opportunity motion changed (${previous.primary_motion} → ${current.primary_motion}).`);
  if (current.action_title && current.action_title !== previous.action_title) changes.push("Recommended next action changed.");
  if (current.meddpicc_confirmed > previous.meddpicc_confirmed) changes.push(`New qualification confirmed (${previous.meddpicc_confirmed} → ${current.meddpicc_confirmed} MEDDPICC dimensions).`);
  if (current.public_signal_count > previous.public_signal_count) changes.push("New public signal(s) since last time.");
  if (current.verdict !== previous.verdict) changes.push(`Intent verdict changed (${previous.verdict} → ${current.verdict}).`);
  return changes;
}

/** Records the current run into its thread and returns the thread block +
 * novelty/duplicate signals for the notification policy. Never throws. */
export async function recordAndBuildThread(result: SecureNetworkingTriageResult): Promise<OpportunityThreadBlock> {
  const account = result.account_resolution?.name ?? result.executive_summary.account ?? null;
  const primaryMotion = result.matches[0]?.entry_id ?? result.executive_summary.primary_opportunity ?? "unknown";
  const key = threadKey(account, primaryMotion);
  const current = snapshotFromResult(result, primaryMotion);

  let record: OpportunityThreadRecord | null = null;
  try {
    record = await readThreadByKey(key);
  } catch {
    record = null;
  }
  const previous = record && record.runs.length > 0 ? record.runs[record.runs.length - 1] : null;
  const materialChanges = previous ? computeMaterialChanges(previous, current) : [];

  const previousDecision = previous ? (await latestPursuitFeedback(previous.run_id))?.decision ?? null : null;

  // Persist (append current run; cap history). Best-effort — never blocks a run.
  try {
    const now = result.timestamp;
    const updated: OpportunityThreadRecord = record
      ? { ...record, last_seen: now, runs: [...record.runs, current].slice(-MAX_RUNS_KEPT) }
      : { thread_id: key, account: account ?? "unknown", primary_motion: primaryMotion, first_seen: now, last_seen: now, runs: [current] };
    await mkdir(threadsDir(), { recursive: true });
    await writeFile(threadPath(key), JSON.stringify(updated, null, 2), "utf8");
  } catch {
    /* best-effort persistence */
  }

  const novelty = !previous ? 1 : materialChanges.length > 0 ? 0.7 : 0.2;
  const duplicateOf = previous && materialChanges.length === 0 ? previous.run_id : null;

  return {
    thread_id: key,
    previous_run_count: record ? record.runs.length : 0,
    material_changes: previous ? (materialChanges.length > 0 ? materialChanges : ["No material change since last time."]) : [],
    previous_decision: previousDecision,
    novelty,
    duplicate_of: duplicateOf
  };
}

/** Read a thread by account + motion (for the UI timeline). */
export async function readOpportunityThread(account: string | null, motion: string): Promise<OpportunityThreadRecord | null> {
  return readThreadByKey(threadKey(account, motion));
}
