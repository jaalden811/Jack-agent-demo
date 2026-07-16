import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeSellerProfile } from "@/lib/personalization/profileSchema";
import { saveSellerProfile } from "@/lib/personalization/profileStore";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";

/**
 * Integration proof of the core product invariant: changing the seller
 * profile changes personal relevance / message emphasis but NEVER the
 * deterministic opportunity scores.
 */

let originalDataDir: string | undefined;

beforeEach(async () => {
  originalDataDir = process.env.LOCAL_DATA_DIR;
  process.env.LOCAL_DATA_DIR = await mkdtemp(path.join(tmpdir(), "personalization-test-"));
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = originalDataDir;
});

async function saveProfile(goalId: string) {
  await saveSellerProfile(
    normalizeSellerProfile({
      display_name: "Pilot Seller",
      email: "pilot@example.com", // same id both times -> single active profile
      role_family: "sales",
      lane: "sales",
      territories: ["NA-West"],
      segments: ["enterprise"],
      specialties: ["security", "observability"],
      product_domains: ["soc_detection_response", "cloud_native_observability"],
      measurement_metrics: ["software_attach"],
      goals: [{ goal_id: goalId, weight: 1, target: null, unit: null, timeframe: "year" }]
    })
  );
}

describe("personalization never changes deterministic opportunity scores", () => {
  it("same transcript, different goals -> identical scores, different personal relevance", async () => {
    await saveProfile("expand_security_portfolio");
    const runA = await runSignalAgent({ transcriptId: "secure_networking_triage", options: { enrichPublicSignals: false } });

    await saveProfile("expand_observability");
    const runB = await runSignalAgent({ transcriptId: "secure_networking_triage", options: { enrichPublicSignals: false } });

    // Deterministic factual scores are byte-identical across profiles.
    expect(JSON.stringify(runB.opportunity_scoring)).toEqual(JSON.stringify(runA.opportunity_scoring));
    expect(JSON.stringify(runB.meddpicc)).toEqual(JSON.stringify(runA.meddpicc));
    expect(runB.executive_summary.confidence).toEqual(runA.executive_summary.confidence);

    // Personalization is present and reflects the different goals.
    expect(runA.personalization?.personal_relevance.band).not.toBe("unavailable");
    expect(runA.personalization?.goal_alignment[0]?.goal_id).toBe("expand_security_portfolio");
    expect(runB.personalization?.goal_alignment[0]?.goal_id).toBe("expand_observability");
  }, 60000);

  it("with no profile, personalization is 'unavailable' but the run still succeeds", async () => {
    const run = await runSignalAgent({ transcriptId: "secure_networking_triage", options: { enrichPublicSignals: false } });
    expect(run.personalization?.personal_relevance.band).toBe("unavailable");
    expect(run.opportunity_scoring).toBeTruthy();
  }, 60000);
});
