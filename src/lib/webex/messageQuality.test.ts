import { describe, expect, it } from "vitest";
import { validateMessageQuality, type MessageQualityContext } from "@/lib/webex/messageQuality";

// Concise, action-first messages — the delivered push is a nudge to act, not a
// full brief. Both lanes carry account, why-you, why-now, ONE recommended
// action, and the expected outcome, and must be materially different.
const CONCISE_SALES = [
  "**REVIEW · AECOM** — commercial",
  "**Why you:** Commercial owner for the observability opportunity at AECOM.",
  "**Why now:** The customer asked for a scenario-based working session before their next planning cycle.",
  "**Recommended action:** Book the scenario working session with architecture and enterprise risk.",
  "**Expected outcome:** Customer validation of the correlation workflow and a confirmed follow-up."
].join("\n");

const CONCISE_TECHNICAL = [
  "**REVIEW · AECOM** — technical",
  "**Why you:** Technical owner — scope the workshop and validate the current environment.",
  "**Why now:** The team requested credible synthetic scenarios covering identity and degraded-service incidents.",
  "**Recommended action:** Define the target data sources and architecture for the operational scenario.",
  "**Expected outcome:** Validated data sources and agreed pass/fail criteria."
].join("\n");

function ctx(overrides: Partial<MessageQualityContext> = {}): MessageQualityContext {
  return { verdict: "REVIEW", allowedUrls: [], charCeiling: 2600, byteCeiling: 7439, account: "AECOM", ...overrides };
}

describe("validateMessageQuality (concise, action-first)", () => {
  it("passes a concise, distinct sales/technical pair", () => {
    const result = validateMessageQuality({ salesMarkdown: CONCISE_SALES, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.failures).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a too-detailed (over-budget) message", () => {
    const huge = `${CONCISE_SALES}\n${"extra detail ".repeat(120)}`;
    const result = validateMessageQuality({ salesMarkdown: huge, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/too detailed|concise budget/i);
  });

  it("rejects a message with no clear recommended action", () => {
    const noAction = ["**REVIEW · AECOM**", "**Why you:** Commercial owner.", "**Why now:** Timely.", "**Expected outcome:** Something."].join("\n");
    const result = validateMessageQuality({ salesMarkdown: noAction, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/recommended action/i);
  });

  it("rejects a message missing why-now", () => {
    const noWhyNow = ["**REVIEW · AECOM**", "**Why you:** Commercial owner.", "**Recommended action:** Book the session.", "**Expected outcome:** Validation."].join("\n");
    const result = validateMessageQuality({ salesMarkdown: noWhyNow, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/why-now/i);
  });

  it("rejects a vague action", () => {
    const vague = ["**REVIEW · AECOM**", "**Why you:** Commercial owner.", "**Why now:** Timely.", "**Recommended action:** Follow up with the customer.", "**Expected outcome:** Progress."].join("\n");
    const result = validateMessageQuality({ salesMarkdown: vague, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/vague action/i);
  });

  it("rejects a message that never references the account", () => {
    const noAccount = ["**REVIEW**", "**Why you:** Commercial owner.", "**Why now:** Timely.", "**Recommended action:** Book the session.", "**Expected outcome:** Validation."].join("\n");
    const result = validateMessageQuality({ salesMarkdown: noAccount, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/account is not referenced/i);
  });

  it("rejects a localhost link", () => {
    const bad = `${CONCISE_SALES}\n[Open full analysis](http://localhost:3010/x)`;
    const result = validateMessageQuality({ salesMarkdown: bad, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/localhost/i);
  });

  it("rejects an invented URL not in the allowed set", () => {
    const bad = `${CONCISE_SALES}\nSee https://totally-made-up.example.com/story`;
    const result = validateMessageQuality({ salesMarkdown: bad, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/not in the allowed set/i);
  });

  it("accepts a URL that IS in the allowed set", () => {
    const withUrl = `${CONCISE_SALES}\nSee https://sec.gov/report`;
    const result = validateMessageQuality({ salesMarkdown: withUrl, technicalMarkdown: CONCISE_TECHNICAL, context: ctx({ allowedUrls: ["https://sec.gov/report"] }) });
    expect(result.valid).toBe(true);
  });

  it("rejects a secret-shaped token", () => {
    const bad = `${CONCISE_SALES}\nkey sk-abcdef1234567890abcdef`;
    const result = validateMessageQuality({ salesMarkdown: bad, technicalMarkdown: CONCISE_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/secret/i);
  });

  it("rejects sales and technical messages that are not materially different", () => {
    const result = validateMessageQuality({ salesMarkdown: CONCISE_SALES, technicalMarkdown: CONCISE_SALES, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/materially different/i);
  });
});
