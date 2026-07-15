import { describe, expect, it } from "vitest";
import { validateMessageQuality, type MessageQualityContext } from "@/lib/webex/messageQuality";

const RICH_SALES = [
  "**Sales action — HIGH INTENT (100%)**",
  "**Pursuit:** PURSUE — 87/100 (confidence 73%)",
  "**Account:** Northgate Materials Science",
  "**Opportunity thesis**",
  "A credible opportunity centered on observability driven by funded investment.",
  "**Why now**",
  "- $2M delayed-order impact.",
  "- Funding approved.",
  "- Renewals in January and March.",
  "**MEDDPICC**",
  "- M — Confirmed: quantified impact.",
  "- EB — Missing: not yet established.",
  "**Bella next**",
  "- Validate the executive sponsor and budget owner.",
  "- Confirm the renewal windows.",
  "- Anchor the business case to the stated impact.",
  "You received this because the transcript produced a Sales / Commercial action for the Peachtree Select pilot."
].join("\n");

const RICH_TECHNICAL = [
  "**Technical action — HIGH INTENT**",
  "**Account:** Northgate Materials Science",
  "**Customer pain**",
  "Fragmented telemetry and slow incident isolation across cloud and data center.",
  "**Current environment:** Azure, AKS, VMware",
  "**Jack next — architecture & validation**",
  "- Define the target architecture and data flows.",
  "- Validate the stated technical requirements.",
  "- Scope a proof-of-value with success criteria and cost controls.",
  "You received this because the transcript produced a Technical / Specialist action for the Peachtree Select pilot."
].join("\n");

function ctx(overrides: Partial<MessageQualityContext> = {}): MessageQualityContext {
  return { verdict: "HIGH_INTENT", allowedUrls: [], charCeiling: 2600, byteCeiling: 7439, requireRichBrief: true, ...overrides };
}

describe("validateMessageQuality", () => {
  it("passes a rich, distinct sales/technical pair", () => {
    const result = validateMessageQuality({ salesMarkdown: RICH_SALES, technicalMarkdown: RICH_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("Test 18: rejects a localhost link", () => {
    const bad = `${RICH_SALES}\n[Open full analysis](http://localhost:3010/x)`;
    const result = validateMessageQuality({ salesMarkdown: bad, technicalMarkdown: RICH_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/localhost/i);
  });

  it("Test 17: rejects an invented URL not in the allowed set", () => {
    const bad = `${RICH_SALES}\nSee https://totally-made-up.example.com/story`;
    const result = validateMessageQuality({ salesMarkdown: bad, technicalMarkdown: RICH_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/not in the allowed set/i);
  });

  it("accepts a URL that IS in the allowed set", () => {
    const withUrl = `${RICH_SALES}\nSee https://sec.gov/report`;
    const result = validateMessageQuality({ salesMarkdown: withUrl, technicalMarkdown: RICH_TECHNICAL, context: ctx({ allowedUrls: ["https://sec.gov/report"] }) });
    expect(result.valid).toBe(true);
  });

  it("rejects a secret-shaped token", () => {
    const bad = `${RICH_SALES}\nkey sk-abcdef1234567890abcdef`;
    const result = validateMessageQuality({ salesMarkdown: bad, technicalMarkdown: RICH_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/secret/i);
  });

  it("Test 13: rejects sales and technical messages that are not materially different", () => {
    const result = validateMessageQuality({ salesMarkdown: RICH_SALES, technicalMarkdown: RICH_SALES, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/materially different/i);
  });

  it("rejects a shallow message with too few actions / why-now signals", () => {
    const shallow = ["**Sales action — HIGH INTENT**", "**Account:** X", "**Opportunity thesis**", "Something.", "**Why now**", "- One signal.", "**MEDDPICC**", "- M — Confirmed.", "**Bella next**", "- One action."].join("\n");
    const result = validateMessageQuality({ salesMarkdown: shallow, technicalMarkdown: RICH_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/three/i);
  });

  it("rejects a message exceeding the channel ceiling", () => {
    const huge = `${RICH_SALES}\n${"x".repeat(3000)}`;
    const result = validateMessageQuality({ salesMarkdown: huge, technicalMarkdown: RICH_TECHNICAL, context: ctx() });
    expect(result.valid).toBe(false);
    expect(result.failures.join(" ")).toMatch(/ceiling/i);
  });
});
