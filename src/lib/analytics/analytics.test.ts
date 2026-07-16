import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordProductEvent, readProductEvents, summarizeEvents } from "@/lib/analytics/analyticsStore";

let originalDataDir: string | undefined;
beforeEach(async () => {
  originalDataDir = process.env.LOCAL_DATA_DIR;
  process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "analytics-test-"));
});
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = originalDataDir;
});

describe("product analytics", () => {
  it("records observable events and summarizes them", async () => {
    await recordProductEvent({ type: "alert_generated", metadata: { personal_relevance: 80, objective_ids: ["expand_security_portfolio"] } });
    await recordProductEvent({ type: "alert_generated", metadata: { personal_relevance: 60, objective_ids: ["expand_security_portfolio"] } });
    await recordProductEvent({ type: "alert_suppressed", metadata: { reason_codes: ["noise_suppressed"] } });
    await recordProductEvent({ type: "pursue_selected" });
    await recordProductEvent({ type: "pass_selected" });
    await recordProductEvent({ type: "action_accepted" });
    await recordProductEvent({ type: "assistant_question_asked" });

    const summary = summarizeEvents(await readProductEvents());
    expect(summary.alerts_generated).toBe(2);
    expect(summary.alerts_suppressed).toBe(1);
    expect(summary.pursue_rate).toBe(0.5); // 1 pursue / 2 decisions
    expect(summary.action_acceptance).toBe(0.5); // 1 accepted / 2 generated
    expect(summary.avg_personal_relevance).toBe(70);
    expect(summary.assistant_questions).toBe(1);
    expect(summary.top_seller_objectives[0].objective_id).toBe("expand_security_portfolio");
    expect(summary.top_suppression_reasons[0].reason).toBe("noise_suppressed");
  });
});
