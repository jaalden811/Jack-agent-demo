import { mkdir, readFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { OutcomeEvent, OutcomeEventType, OutcomeSource } from "@/lib/orchestration/types";

/**
 * Append-only OutcomeEvent store (LOCAL_DATA_DIR JSONL). Outcome history is
 * never erased or rewritten — every observed event is appended. Attribution is
 * kept SAFE: only associative language is allowed, and any causal claim ("AI
 * caused/generated/created", "guaranteed impact", "definitively caused") is
 * rejected. Causation is never established here.
 */

export const OUTCOME_EVENT_TYPES: OutcomeEventType[] = [
  "owner_accepted",
  "step_completed",
  "customer_meeting_held",
  "opportunity_created",
  "stage_changed",
  "close_date_changed",
  "amount_changed",
  "product_added",
  "customer_declined",
  "false_positive_confirmed"
];
export const OUTCOME_SOURCES: OutcomeSource[] = ["user", "gong", "crm", "webex", "system"];
const SAFE_ATTRIBUTION = ["associated outcome", "influenced milestone", "observed after action", "followed the coordinated action", "temporally associated with the ActionCase"];
const CAUSAL_RE = /\bAI (?:caused|generated|created)\b|\bguaranteed impact\b|\bdefinitively caused\b|\bcaused the (?:revenue|expansion|deal|outcome)\b/i;

function eventsPath(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "outcome-events.jsonl");
}

/** Rejects causal/unsafe text so a persisted outcome can never claim causation. */
export function isSafeAttributionText(text: string | null | undefined): boolean {
  if (!text) return true;
  return !CAUSAL_RE.test(text);
}

export type AppendOutcomeInput = {
  action_case_id?: string | null;
  run_id: string;
  type: OutcomeEventType;
  source: OutcomeSource;
  observedAt?: string | null;
  baselineValue?: string | number | null;
  observedValue?: string | number | null;
  attributionConfidence?: number | null;
  attributionLanguage?: string | null;
  note?: string | null;
  evidenceIds?: string[];
};

export type AppendOutcomeResult = { persisted: boolean; event: OutcomeEvent | null; warning?: string; error?: string };

export async function appendOutcomeEvent(input: AppendOutcomeInput): Promise<AppendOutcomeResult> {
  if (!OUTCOME_EVENT_TYPES.includes(input.type)) return { persisted: false, event: null, error: `type must be one of: ${OUTCOME_EVENT_TYPES.join(", ")}` };
  if (!OUTCOME_SOURCES.includes(input.source)) return { persisted: false, event: null, error: `source must be one of: ${OUTCOME_SOURCES.join(", ")}` };
  if (!input.run_id) return { persisted: false, event: null, error: "run_id is required" };
  // Safe-attribution guard — never persist a causal claim.
  const attributionLanguage = input.attributionLanguage && SAFE_ATTRIBUTION.includes(input.attributionLanguage) ? input.attributionLanguage : "observed after action";
  if (!isSafeAttributionText(input.note)) return { persisted: false, event: null, error: "note must not claim causation" };

  const now = new Date().toISOString();
  const event: OutcomeEvent = {
    id: randomUUID(),
    action_case_id: input.action_case_id ?? null,
    run_id: input.run_id,
    type: input.type,
    source: input.source,
    observedAt: input.observedAt ?? now,
    recordedAt: now,
    baselineValue: input.baselineValue ?? null,
    observedValue: input.observedValue ?? null,
    attributionConfidence: typeof input.attributionConfidence === "number" ? Math.max(0, Math.min(1, input.attributionConfidence)) : 0.6,
    attributionLanguage,
    note: input.note ? input.note.slice(0, 500) : null,
    evidenceIds: (input.evidenceIds ?? []).slice(0, 12)
  };
  try {
    await mkdir(path.dirname(eventsPath()), { recursive: true });
    await appendFile(eventsPath(), `${JSON.stringify(event)}\n`, "utf8");
    return { persisted: true, event };
  } catch (error) {
    return { persisted: false, event: null, warning: error instanceof Error ? error.message : "write failed" };
  }
}

export async function readAllOutcomeEvents(): Promise<OutcomeEvent[]> {
  try {
    const text = await readFile(eventsPath(), "utf8");
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as OutcomeEvent);
  } catch {
    return [];
  }
}

/** Reads outcome events for a run and/or ActionCase (thread) id, oldest-first. */
export async function readOutcomeEvents(filter: { run_id?: string | null; action_case_id?: string | null }): Promise<OutcomeEvent[]> {
  const all = await readAllOutcomeEvents();
  return all.filter((e) => {
    if (filter.action_case_id && e.action_case_id === filter.action_case_id) return true;
    if (filter.run_id && e.run_id === filter.run_id) return true;
    return !filter.run_id && !filter.action_case_id;
  });
}
