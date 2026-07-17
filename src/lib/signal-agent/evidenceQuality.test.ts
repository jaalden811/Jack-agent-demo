import { describe, expect, it } from "vitest";
import { isSubstantiveStatement, refineEvidenceItems } from "@/lib/signal-agent/evidenceQuality";

describe("isSubstantiveStatement", () => {
  it("rejects context-free fragments and bare agreements", () => {
    for (const f of ["So not zero.", "Then skills.", "Also internal politics.", "There are diagrams.", "Yes.", "Good answer.", "Definitely.", "Fair answer."]) {
      expect(isSubstantiveStatement(f)).toBe(false);
    }
  });

  it("accepts complete statements", () => {
    expect(isSubstantiveStatement("We have a decentralized operating model because the business requires it.")).toBe(true);
    expect(isSubstantiveStatement("We also need openness.")).toBe(true);
  });
});

describe("refineEvidenceItems", () => {
  it("keeps substantive quotes, de-dupes per category, caps, and drops fragment-only categories", () => {
    const items = [
      { cat: "skills", text: "Then skills." },
      { cat: "skills", text: "We do not have an unlimited number of people who can maintain detections." },
      { cat: "skills", text: "We do not have an unlimited number of people who can maintain detections." },
      { cat: "politics", text: "Also internal politics." }
    ];
    const out = refineEvidenceItems(items, { text: (i) => i.text, category: (i) => i.cat, cap: 4 });
    expect(out.length).toBe(1);
    expect(out[0].cat).toBe("skills");
    expect(out.some((i) => i.text === "Then skills.")).toBe(false);
    expect(out.some((i) => i.cat === "politics")).toBe(false);
  });

  it("preserves original order and enforces the per-category cap", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ cat: "c", text: `A complete substantive statement number ${i} here.` }));
    const out = refineEvidenceItems(items, { text: (i) => i.text, category: (i) => i.cat, cap: 3 });
    expect(out.length).toBe(3);
    expect(out[0].text).toContain("number 0");
  });
});
