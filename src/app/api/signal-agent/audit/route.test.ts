import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/signal-agent/audit/route";

describe("GET /api/signal-agent/audit", () => {
  it("returns a summary shape without ever including secrets", async () => {
    const response = await GET(new Request("http://localhost/api/signal-agent/audit?limit=5"));
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(typeof json.available).toBe("boolean");
    expect(Array.isArray(json.records)).toBe(true);

    const text = JSON.stringify(json);
    expect(text.toLowerCase()).not.toContain("openai_api_key");
    expect(text).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });
});
