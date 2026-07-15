import { describe, expect, it } from "vitest";
import { loadCircuitMasterPrompt, getMasterPromptVersion } from "@/lib/circuit/prompts/promptLoader";

/**
 * Master-prompt loader coverage (Phase 5). The prompt is Circuit's
 * reasoning contract; it is versioned and contains the required sections.
 */

describe("Circuit master prompt loader", () => {
  it("loads the versioned master prompt", () => {
    const { version, text } = loadCircuitMasterPrompt();
    expect(version).toBe(getMasterPromptVersion());
    expect(text.length).toBeGreaterThan(500);
  });

  it("includes the core reasoning-contract sections", () => {
    const { text } = loadCircuitMasterPrompt();
    for (const marker of ["Evidence classifications", "Speaker-side", "Next Best Action", "Do-not-reask", "JSON-only output"]) {
      expect(text).toContain(marker);
    }
  });

  it("names Circuit (not OpenAI) as the engine", () => {
    const { text } = loadCircuitMasterPrompt();
    expect(text).toContain("Circuit");
    expect(text.toLowerCase()).not.toContain("openai");
  });
});
