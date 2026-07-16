import { beforeEach, describe, expect, it } from "vitest";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { detectQualitativeImpact } from "@/lib/signal-agent/intentExtraction";
import { ingestTranscript } from "@/lib/signal-agent/transcript";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";

/**
 * Slice 2 — intent recalibration. A sophisticated enterprise discovery call
 * describes material impact QUALITATIVELY (no dollar figure) and deliberately
 * avoids procurement language, yet convenes stakeholders and requests a
 * scenario-based working session. That is genuine discovery momentum and must
 * NOT be silently suppressed as NOISE — even when account context is supplied.
 */

const OFF = { enrichPublicSignals: false } as const;

// Synthetic, generic transcript (no real company). Sam is the customer voice
// (describes "our" environment, states impact, requests a next step); Dana is
// the seller (asks discovery questions, proposes the session).
const DISCOVERY_MOMENTUM_TRANSCRIPT = [
  "Account: Northwind Engineering Group",
  "00:00 — Dana: Thanks for the time. We understood this was less a product evaluation and more a conversation about operational visibility.",
  "00:15 — Priya: To be clear from our side, this is not a procurement timeline and we are not running a formal evaluation yet.",
  "00:30 — Dana: Understood. What prompted the review?",
  "00:45 — Sam: When a major incident hits, it may be hundreds of specialists unable to work efficiently, and a delivery deadline becoming harder to meet. That is material business risk for us.",
  "01:05 — Sam: Our reliability, infrastructure, application, and security teams each look at a different console, and nobody can build one reliable timeline across our environment.",
  "01:30 — Dana: What would a good next step look like for you?",
  "01:45 — Sam: I'd like a working session around two or three scenarios, not a generic platform presentation. Architecture and security should join.",
  "02:00 — Priya: Procurement does not need to join yet."
].join("\n");

beforeEach(() => {
  clearCatalogCache();
  clearAccountsCache();
});

describe("qualitative material-impact detection", () => {
  it("detects non-numeric impact ('hundreds of specialists unable to work', 'material business risk')", () => {
    const transcript = ingestTranscript(DISCOVERY_MOMENTUM_TRANSCRIPT);
    expect(detectQualitativeImpact(transcript)).toBe(true);
  });

  it("does not fire on a thin transcript with no impact language", () => {
    const transcript = ingestTranscript(
      ["Account: Northwind Engineering Group", "00:00 — Sam: We are just exploring options and comparing dashboards."].join("\n")
    );
    expect(detectQualitativeImpact(transcript)).toBe(false);
  });
});

describe("discovery-momentum verdict rescue", () => {
  it("is NOT suppressed as NOISE when account context is supplied (rescue works in both modes)", async () => {
    const result = await runSignalAgent({
      customTranscript: DISCOVERY_MOMENTUM_TRANSCRIPT,
      accountOverride: { open_opportunity: "true", budget_signal: "FY26 budget approved" },
      options: OFF
    });
    expect(result.executive_summary.verdict).not.toBe("NOISE");
  });

  it("does not collapse to DO_NOT_PURSUE — pain + an accepted next step is an active opportunity", async () => {
    const result = await runSignalAgent({
      customTranscript: DISCOVERY_MOMENTUM_TRANSCRIPT,
      accountOverride: { open_opportunity: "true", budget_signal: "FY26 budget approved" },
      options: OFF
    });
    expect(result.opportunity_scoring.decision).not.toBe("DO_NOT_PURSUE");
  });

  it("keeps qualitative impact OUT of quantified_impact (numeric deterministic fields unchanged)", async () => {
    const result = await runSignalAgent({ customTranscript: DISCOVERY_MOMENTUM_TRANSCRIPT, options: OFF });
    // The qualitative sentence must never masquerade as a quantified figure.
    for (const q of result.commercial_signals.quantified_impact) {
      expect(q.toLowerCase()).not.toContain("hundreds of specialists");
    }
  });
});
