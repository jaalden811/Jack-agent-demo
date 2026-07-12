import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/signal-agent/catalog/route";
import { clearCatalogCache } from "@/lib/signal-agent/loadCatalog";

beforeEach(() => {
  clearCatalogCache();
});

describe("GET /api/signal-agent/catalog", () => {
  it("loads categories dynamically from the JSON file, not from a hard-coded list", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.source).toBe("cisco_mapping");
    expect(json.entry_count).toBe(json.entries.length);
    expect(json.entries.length).toBeGreaterThanOrEqual(30);
    expect(json.domains.length).toBeGreaterThan(0);

    const ids = json.entries.map((entry: { id: string }) => entry.id);
    expect(ids).toContain("data_center_networking");
    expect(ids).toContain("sase_remote_access");
  });

  it("never includes API keys or secret-shaped values", async () => {
    const response = await GET();
    const text = await response.text();
    expect(text.toLowerCase()).not.toContain("openai_api_key");
    expect(text).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });
});
