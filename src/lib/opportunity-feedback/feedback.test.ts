import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordPursuitFeedback, readPursuitFeedback, latestPursuitFeedback } from "@/lib/opportunity-feedback/feedbackStore";
import { actionStatusForDecision } from "@/lib/opportunity-feedback/types";

let originalDataDir: string | undefined;

beforeEach(async () => {
  originalDataDir = process.env.LOCAL_DATA_DIR;
  process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "opp-feedback-test-"));
});
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = originalDataDir;
});

describe("pursuit feedback", () => {
  it("maps decisions to action status", () => {
    expect(actionStatusForDecision("pursue")).toBe("accepted");
    expect(actionStatusForDecision("need_more_information")).toBe("recommended");
    expect(actionStatusForDecision("not_now")).toBe("deferred");
    expect(actionStatusForDecision("pass")).toBe("rejected");
  });

  it("persists each decision and reports the latest state", async () => {
    await recordPursuitFeedback({ run_id: "run-1", account: "Acme", opportunity_motion_id: "cloud_native_observability", profile_id: "email:s@x.com", decision: "need_more_information" });
    await recordPursuitFeedback({ run_id: "run-1", account: "Acme", opportunity_motion_id: "cloud_native_observability", profile_id: "email:s@x.com", decision: "pursue" });
    const all = await readPursuitFeedback("run-1");
    expect(all.length).toBe(2);
    const latest = await latestPursuitFeedback("run-1");
    expect(latest?.decision).toBe("pursue");
    expect(latest?.action_status).toBe("accepted");
  });

  it("persists Not now with a review date and Pass with a reason", async () => {
    await recordPursuitFeedback({ run_id: "run-2", account: "Acme", opportunity_motion_id: "m", profile_id: null, decision: "not_now", next_review_at: "2026-09-01T00:00:00.000Z" });
    await recordPursuitFeedback({ run_id: "run-3", account: "Acme", opportunity_motion_id: "m", profile_id: null, decision: "pass", reason_code: "no_budget" });
    expect((await latestPursuitFeedback("run-2"))?.next_review_at).toBe("2026-09-01T00:00:00.000Z");
    expect((await latestPursuitFeedback("run-3"))?.reason_code).toBe("no_budget");
  });
});
