import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordActionFeedback, readActionFeedback, latestActionStatus } from "@/lib/handoff/feedbackStore";
import type { ActionFeedback } from "@/lib/handoff/types";

/**
 * Action-feedback persistence (Sections 10-11). Feedback is append-only
 * evidence; the latest response per action wins for display.
 */

let originalDataDir: string | undefined;

beforeEach(async () => {
  originalDataDir = process.env.LOCAL_DATA_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), "feedback-test-"));
  process.env.LOCAL_DATA_DIR = dir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = originalDataDir;
});

function feedback(overrides: Partial<ActionFeedback> = {}): ActionFeedback {
  return {
    action_id: "act_1",
    run_id: "run_1",
    actor: "specialist",
    response: "accepted",
    reason: null,
    timestamp: new Date().toISOString(),
    resulting_action: null,
    ...overrides
  };
}

describe("action feedback persistence", () => {
  it("Test 19/20: persists feedback and reads it back", async () => {
    const result = await recordActionFeedback(feedback());
    expect(result.persisted).toBe(true);
    const all = await readActionFeedback("run_1");
    expect(all).toHaveLength(1);
    expect(all[0].response).toBe("accepted");
  });

  it("keeps append-only history and reports the latest status per action", async () => {
    await recordActionFeedback(feedback({ response: "accepted" }));
    await recordActionFeedback(feedback({ response: "deferred", reason: "waiting on customer" }));
    await recordActionFeedback(feedback({ action_id: "act_2", response: "completed" }));

    const all = await readActionFeedback("run_1");
    expect(all).toHaveLength(3);

    const latest = await latestActionStatus("run_1");
    expect(latest.act_1.response).toBe("deferred");
    expect(latest.act_1.reason).toBe("waiting on customer");
    expect(latest.act_2.response).toBe("completed");
  });

  it("returns an empty list for an unknown run (no crash)", async () => {
    expect(await readActionFeedback("does_not_exist")).toEqual([]);
  });
});
