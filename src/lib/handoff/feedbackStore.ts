import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { ActionFeedback } from "@/lib/handoff/types";

/**
 * Action-feedback persistence (Sections 10-11). Records whether a routed
 * action was accepted / assigned / deferred / completed / rejected /
 * more-research-requested, as append-only feedback evidence for later
 * evaluation. Deliberately does NOT change scoring weights from a single
 * event. Uses the same local-JSON pattern as resultStore/auditLog; a
 * multi-instance deployment should swap the file layer for a database
 * without changing callers.
 */

function feedbackDir(): string {
  const config = getConfig();
  return path.resolve(process.cwd(), config.LOCAL_DATA_DIR, "signal-agent-feedback");
}

function feedbackPath(runId: string): string {
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(feedbackDir(), `${safeId}.jsonl`);
}

export async function recordActionFeedback(feedback: ActionFeedback): Promise<{ persisted: boolean; warning: string | null }> {
  try {
    await mkdir(feedbackDir(), { recursive: true });
    await appendFile(feedbackPath(feedback.run_id), `${JSON.stringify(feedback)}\n`, "utf8");
    return { persisted: true, warning: null };
  } catch (error) {
    return { persisted: false, warning: error instanceof Error ? error.message : "Feedback persistence failed" };
  }
}

export async function readActionFeedback(runId: string): Promise<ActionFeedback[]> {
  try {
    const text = await readFile(feedbackPath(runId), "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ActionFeedback);
  } catch {
    return [];
  }
}

/** Latest feedback per action_id (so the UI shows the current state). */
export async function latestActionStatus(runId: string): Promise<Record<string, ActionFeedback>> {
  const all = await readActionFeedback(runId);
  const latest: Record<string, ActionFeedback> = {};
  for (const item of all) latest[item.action_id] = item;
  return latest;
}

// Response types that are permitted, so the API never persists an
// arbitrary/unknown response value.
export const VALID_FEEDBACK_RESPONSES: ReadonlyArray<ActionFeedback["response"]> = [
  "accepted",
  "assigned",
  "reassigned",
  "deferred",
  "completed",
  "rejected",
  "more_research_requested"
];
