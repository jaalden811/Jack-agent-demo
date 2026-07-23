import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendOutcomeEvent, readOutcomeEvents, isSafeAttributionText } from "@/lib/orchestration/outcomeStore";

/**
 * Append-only OutcomeEvent store: roundtrip, filtering, and the safe-attribution
 * guard (no causal claims persisted). Uses an isolated LOCAL_DATA_DIR.
 */

let dir: string;
let savedLocal: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "outcome-store-"));
  savedLocal = process.env.LOCAL_DATA_DIR;
  process.env.LOCAL_DATA_DIR = dir;
});
afterEach(() => {
  if (savedLocal === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = savedLocal;
  rmSync(dir, { recursive: true, force: true });
});

describe("outcomeStore", () => {
  it("appends and reads back an outcome event, filtered by run_id and action_case_id", async () => {
    const a = await appendOutcomeEvent({ run_id: "run-A", action_case_id: "thread-1", type: "owner_accepted", source: "user" });
    const b = await appendOutcomeEvent({ run_id: "run-B", action_case_id: "thread-1", type: "customer_meeting_held", source: "webex" });
    expect(a.persisted).toBe(true);
    expect(b.persisted).toBe(true);
    // By run.
    const byRun = await readOutcomeEvents({ run_id: "run-A" });
    expect(byRun.map((e) => e.type)).toEqual(["owner_accepted"]);
    // By ActionCase (thread) — both runs share the thread.
    const byCase = await readOutcomeEvents({ action_case_id: "thread-1" });
    expect(byCase.length).toBe(2);
    // Every event is append-only with an id, recordedAt, and safe attribution.
    for (const e of byCase) {
      expect(e.id).toBeTruthy();
      expect(e.recordedAt).toBeTruthy();
      expect(e.attributionLanguage).toMatch(/observed after action|associated|influenced|followed|temporally/);
    }
  });

  it("rejects an invalid type or source", async () => {
    // @ts-expect-error invalid type on purpose
    const bad = await appendOutcomeEvent({ run_id: "r", type: "revenue_magic", source: "user" });
    expect(bad.persisted).toBe(false);
    expect(bad.error).toMatch(/type must be one of/);
  });

  it("never persists a causal attribution claim", async () => {
    expect(isSafeAttributionText("Observed after the workshop.")).toBe(true);
    expect(isSafeAttributionText("The AI generated the expansion.")).toBe(false);
    const res = await appendOutcomeEvent({ run_id: "r", type: "amount_changed", source: "crm", note: "AI caused the revenue increase." });
    expect(res.persisted).toBe(false);
    expect(res.error).toMatch(/causation/);
  });

  it("normalizes an unsafe attribution_language to a safe default", async () => {
    const res = await appendOutcomeEvent({ run_id: "r", type: "owner_accepted", source: "user", attributionLanguage: "AI definitively caused" });
    expect(res.persisted).toBe(true);
    expect(res.event!.attributionLanguage).toBe("observed after action");
  });
});
