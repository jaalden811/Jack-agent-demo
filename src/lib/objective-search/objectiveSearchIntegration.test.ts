import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeSellerProfile } from "@/lib/personalization/profileSchema";
import { saveSellerProfile } from "@/lib/personalization/profileStore";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";

/**
 * End-to-end: the objective-aware planner governs the run's public-evidence
 * flow. Without a SEARCH_API_KEY the controller suppresses execution
 * (provider_not_configured) — proving the planner + controller (not the legacy
 * generic path) own execution. The legacy opportunity-fit execution is
 * skipped, and the canonical search trace is surfaced under search_plan.
 */

let originalDataDir: string | undefined;
beforeEach(async () => {
  originalDataDir = process.env.LOCAL_DATA_DIR;
  process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "obj-search-int-"));
});
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = originalDataDir;
});

describe("objective planner governs the run's public-evidence flow", () => {
  it("surfaces the canonical search trace and does not use the legacy generic path", async () => {
    await saveSellerProfile(
      normalizeSellerProfile({
        display_name: "Pilot", email: "pilot@example.com", role_family: "sales", lane: "sales",
        specialties: ["security"], product_domains: ["soc_detection_response"],
        goals: [{ goal_id: "expand_security_portfolio", weight: 1, target: null, unit: null, timeframe: "year" }]
      })
    );

    const run = await runSignalAgent({ transcriptId: "secure_networking_triage", options: { enrichPublicSignals: true } });

    // The canonical trace is the objective planner's (single source of truth).
    expect(run.personalization?.search_plan.planner_version).toBe("objective-planner-v1");
    // No SEARCH_API_KEY in this environment => controller executes nothing.
    expect(run.personalization?.search_plan.queries_executed).toBe(0);
    // serpapi_signals is governed by the planner path (never the legacy
    // signalCatalog execution).
    expect(run.serpapi_signals.status).toBe("not_run");
    // Deterministic opportunity scoring is still produced.
    expect(run.opportunity_scoring).toBeTruthy();
  }, 60000);
});
