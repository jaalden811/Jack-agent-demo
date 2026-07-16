import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runSignalAgent } from "@/lib/signal-agent/runAgent";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";
import { clearAccountsCache } from "@/lib/signal-agent/accountContext";
import { buildDeterministicBrief } from "@/lib/webex/opportunityBrief";

/**
 * Deterministic-brief richness tests (Section 14/17). Run through the
 * real analysis spine with OpenAI/SerpAPI OFF, so these prove the brief
 * is rich WITHOUT any provider — the exact "product remains useful
 * before quota is added" requirement.
 */

const OFF = {};

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.SEARCH_API_KEY;
  clearCatalogCache();
  clearAccountsCache();
});

async function briefForSplunkFixture() {
  const text = readFileSync("signal-agent-poc/data/transcripts/splunk_platform_rationalization.txt", "utf8");
  const result = await runSignalAgent({ customTranscript: text, options: OFF });
  return buildDeterministicBrief(result);
}

describe("buildDeterministicBrief — rich without OpenAI", () => {
  it("produces an opportunity thesis, ≥3 why-now signals, full MEDDPICC, actions, and risks", async () => {
    const brief = await briefForSplunkFixture();
    expect(brief.opportunity_thesis.length).toBeGreaterThan(20);
    expect(brief.why_now.length).toBeGreaterThanOrEqual(3);
    expect(brief.meddpicc_lines.length).toBe(8);
    expect(brief.sales_actions.length).toBeGreaterThanOrEqual(3);
    expect(brief.technical_actions.length).toBeGreaterThanOrEqual(3);
    expect(brief.top_risks.length).toBeGreaterThanOrEqual(1);
  });

  it("Test 11: sales actions are specific — never the vague 'Progress Splunk commercial motion' label", async () => {
    const brief = await briefForSplunkFixture();
    expect(brief.sales_actions.join(" ")).not.toContain("Progress Splunk commercial motion");
    // At least one action references a concrete qualification/commercial lever.
    expect(brief.sales_actions.some((a) => /sponsor|budget|renewal|business case|procurement|timeline/i.test(a))).toBe(true);
  });

  it("Test 12: technical actions are specific (architecture, requirements, POV)", async () => {
    const brief = await briefForSplunkFixture();
    expect(brief.technical_actions.some((a) => /architecture|data flow|proof-of-value|requirements|integration/i.test(a))).toBe(true);
  });

  it("Test 8: stakeholder roles are evidence-backed, not the generic 'Customer stakeholder' label", async () => {
    const brief = await briefForSplunkFixture();
    expect(brief.stakeholder_lines.length).toBeGreaterThan(0);
    // Every line carries a functional role separator.
    expect(brief.stakeholder_lines.every((l) => l.includes(" — "))).toBe(true);
    // Named (non-role-only) lines also carry a buying-role phrase after ";".
    expect(brief.stakeholder_lines.filter((l) => !l.includes("(role only)")).every((l) => l.includes(";"))).toBe(true);
    // The generic placeholder must not survive into a rendered role line.
    expect(brief.stakeholder_lines.some((l) => /Customer stakeholder; /.test(l))).toBe(false);
  });

  it("Test 9: role-only authorities never receive a fabricated name", async () => {
    // A transcript that references a CIO/CISO by role only must not yield
    // a stakeholder line inventing a person's name for that role.
    const text = ["00:00 — Dana: The CIO would sponsor this and the CISO controls security sign-off.", "00:05 — Dana: We have $2M of impact and budget approved to fix it this quarter."].join("\n");
    const result = await runSignalAgent({ customTranscript: text, options: OFF });
    const brief = buildDeterministicBrief(result);
    // Any role-only line is explicitly marked "(role only)" and never
    // presents a fabricated proper name as the authority.
    for (const line of brief.stakeholder_lines) {
      if (/cio|ciso/i.test(line)) expect(line.toLowerCase()).toContain("role only");
    }
  });

  it("account_action is present when the account is unresolved, absent when confirmed", async () => {
    const unresolved = await runSignalAgent({ customTranscript: "00:00 — Sam: We have too many consoles.", options: OFF });
    expect(buildDeterministicBrief(unresolved).account_action).toBeTruthy();

    const resolved = await runSignalAgent({ customTranscript: "Account: Northgate Materials Science\n00:00 — Sam: We have too many consoles and $2M impact with budget approved.", options: OFF });
    expect(buildDeterministicBrief(resolved).account_action).toBeNull();
  });
});
