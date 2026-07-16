import { mkdir, readFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { actionStatusForDecision, type OpportunityFeedback, type PursuitDecision } from "@/lib/opportunity-feedback/types";

/**
 * Append-only pursuit-feedback persistence (LOCAL_DATA_DIR JSONL, same
 * pattern as handoff/feedbackStore). Product-value evidence: whether the
 * recipient intends to pursue. Deliberately does NOT retrain or change score
 * weights from a single response, and never writes to a CRM.
 */

function feedbackDir(): string {
  return path.resolve(process.cwd(), getConfig().LOCAL_DATA_DIR, "opportunity-feedback");
}

function feedbackPath(runId: string): string {
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(feedbackDir(), `${safeId}.jsonl`);
}

export async function recordPursuitFeedback(input: {
  run_id: string;
  account: string;
  opportunity_motion_id: string;
  profile_id: string | null;
  decision: PursuitDecision;
  reason_code?: string | null;
  free_text?: string | null;
  next_review_at?: string | null;
}): Promise<{ persisted: boolean; feedback: OpportunityFeedback | null; warning: string | null }> {
  const feedback: OpportunityFeedback = {
    feedback_id: randomUUID(),
    run_id: input.run_id,
    account: input.account,
    opportunity_motion_id: input.opportunity_motion_id,
    profile_id: input.profile_id ?? null,
    decision: input.decision,
    reason_code: input.reason_code ?? null,
    free_text: input.free_text ?? null,
    timestamp: new Date().toISOString(),
    next_review_at: input.next_review_at ?? null,
    action_status: actionStatusForDecision(input.decision)
  };
  try {
    await mkdir(feedbackDir(), { recursive: true });
    await appendFile(feedbackPath(input.run_id), `${JSON.stringify(feedback)}\n`, "utf8");
    return { persisted: true, feedback, warning: null };
  } catch (error) {
    return { persisted: false, feedback: null, warning: error instanceof Error ? error.message : "Pursuit feedback persistence failed" };
  }
}

export async function readPursuitFeedback(runId: string): Promise<OpportunityFeedback[]> {
  try {
    const text = await readFile(feedbackPath(runId), "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OpportunityFeedback);
  } catch {
    return [];
  }
}

/** Latest pursuit decision for a run (the current opportunity state). */
export async function latestPursuitFeedback(runId: string): Promise<OpportunityFeedback | null> {
  const all = await readPursuitFeedback(runId);
  return all.length > 0 ? all[all.length - 1] : null;
}
