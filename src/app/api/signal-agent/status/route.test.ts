import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/signal-agent/status/route";

// OpenAI has been removed as a provider. The status route reports a static
// "removed" OpenAI block (the AI provider is Circuit; semantic retrieval is
// deterministic) and never probes a network provider for it.
describe("GET /api/signal-agent/status", () => {
  it("reports OpenAI as removed/not configured (static, no probe)", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.openai.configured).toBe(false);
    expect(json.openai.authentication.usable).toBe(false);
    expect(json.openai.embeddings.usable).toBe(false);
    expect(json.openai.synthesis.usable).toBe(false);
    // Deterministic/Circuit — never an OpenAI model.
    expect(json.openai.embedding_model).toBe("deterministic-local");
    expect(json.openai.synthesis_model).toBe("circuit");
    expect(json.openai.provider_state.state).toBe("missing");
  });

  it("reports the taxonomy as loaded from the Cisco mapping JSON", async () => {
    const response = await GET();
    const json = await response.json();

    expect(json.taxonomy.loaded).toBe(true);
    expect(json.taxonomy.file).toContain("cisco_painpoint_solution_map.json");
    expect(json.taxonomy.categories).toBeGreaterThanOrEqual(30);
    expect(json.reference_report.file).toContain("cisco_portfolio_painpoint_mapping_report.md");
  });

  it("never returns any key-shaped value in the response", async () => {
    const response = await GET();
    const text = await response.text();
    expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
  });
});
