import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/signal-agent/status/route";

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.SEARCH_API_KEY;
});

describe("GET /api/signal-agent/status", () => {
  it("reports OpenAI as not configured with a specific reason when no key is set", async () => {
    const response = await GET(new Request("http://localhost/api/signal-agent/status"));
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.openai.configured).toBe(false);
    expect(json.openai.usable).toBe(false);
    expect(json.openai.message).toBe("no configured key");
    expect(json.openai.message).not.toBe("fallback");
  });

  it("reports the taxonomy as loaded from the Cisco mapping JSON", async () => {
    const response = await GET(new Request("http://localhost/api/signal-agent/status"));
    const json = await response.json();

    expect(json.taxonomy.loaded).toBe(true);
    expect(json.taxonomy.file).toContain("cisco_painpoint_solution_map.json");
    expect(json.taxonomy.categories).toBeGreaterThanOrEqual(30);
    expect(json.reference_report.file).toContain("cisco_portfolio_painpoint_mapping_report.md");
  });

  it("never returns key values in the response", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key-abcdefghijklmnop";
    try {
      const response = await GET(new Request("http://localhost/api/signal-agent/status?useOpenAI=false"));
      const text = await response.text();
      expect(text).not.toContain("sk-test-not-a-real-key");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("reports 'embeddings disabled by user' when the caller explicitly turns OpenAI off", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key-abcdefghijklmnop";
    try {
      const response = await GET(new Request("http://localhost/api/signal-agent/status?useOpenAI=false"));
      const json = await response.json();
      expect(json.openai.configured).toBe(true);
      expect(json.openai.usable).toBe(false);
      expect(json.openai.message).toBe("embeddings disabled by user");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("exposes configured/model/embeddings_enabled/synthesis_enabled/last_check for the Setup drawer's AI providers tab", async () => {
    const response = await GET(new Request("http://localhost/api/signal-agent/status"));
    const json = await response.json();
    expect(json.openai).toHaveProperty("configured");
    expect(json.openai).toHaveProperty("model");
    expect(json.openai).toHaveProperty("embeddings_enabled");
    expect(json.openai).toHaveProperty("synthesis_enabled");
    expect(json.openai).toHaveProperty("last_check");
    expect(json.openai.embeddings_enabled).toBe(false);
    expect(json.openai.synthesis_enabled).toBe(false);
  });

});
