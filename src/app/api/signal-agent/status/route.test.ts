import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/signal-agent/status/route";

// The AI provider is Circuit (an optional enhancement). The status route reports
// a safe, config-derived Circuit block (no secret, no network probe); semantic
// retrieval is deterministic.
describe("GET /api/signal-agent/status", () => {
  it("reports the Circuit AI-provider block (safe, config-derived)", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.ai_provider.provider).toBe("circuit");
    // Not configured in this env → optional/non-fatal, never operational.
    expect(json.ai_provider.configured).toBe(false);
    expect(json.ai_provider.operational).toBe(false);
    expect(typeof json.ai_provider.state).toBe("string");
    expect(typeof json.ai_provider.message).toBe("string");
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
