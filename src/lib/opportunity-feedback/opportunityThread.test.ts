import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeMaterialChanges, recordAndBuildThread, type ThreadRunSnapshot } from "@/lib/opportunity-feedback/opportunityThread";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";

let originalDataDir: string | undefined;
beforeEach(async () => {
  originalDataDir = process.env.LOCAL_DATA_DIR;
  process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "thread-test-"));
});
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = originalDataDir;
});

function snap(overrides: Partial<ThreadRunSnapshot> = {}): ThreadRunSnapshot {
  return { run_id: "r", timestamp: "t", account_status: "probable", primary_motion: "m1", action_type: "architecture_workshop", action_title: "Workshop", meddpicc_confirmed: 1, public_signal_count: 0, owner: "Bella", verdict: "REVIEW", ...overrides };
}

describe("opportunity threading", () => {
  it("detects material changes (account identity, new qualification, new signals)", () => {
    const prev = snap();
    const changes = computeMaterialChanges(prev, snap({ account_status: "confirmed", meddpicc_confirmed: 3, public_signal_count: 2 }));
    expect(changes.some((c) => /Account identity improved/.test(c))).toBe(true);
    expect(changes.some((c) => /qualification confirmed/.test(c))).toBe(true);
    expect(changes.some((c) => /public signal/i.test(c))).toBe(true);
  });

  it("reports no material change for identical snapshots", () => {
    expect(computeMaterialChanges(snap(), snap())).toEqual([]);
  });

  it("marks a repeat unchanged run as a duplicate with low novelty", async () => {
    const runA = await runSignalAgent({ transcriptId: "secure_networking_triage", options: { enrichPublicSignals: false } });
    const threadB = await recordAndBuildThread(runA); // record again with the same snapshot content
    // First recordAndBuildThread happened inside runSignalAgent; this second
    // call sees the prior run and finds no material change.
    expect(threadB.previous_run_count).toBeGreaterThanOrEqual(1);
    expect(threadB.duplicate_of).toBeTruthy();
    expect(threadB.novelty).toBeLessThan(0.5);
    expect(runA.opportunity_thread?.previous_run_count).toBe(0);
  }, 60000);
});
