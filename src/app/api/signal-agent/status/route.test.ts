import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/signal-agent/status/route";

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.SEARCH_API_KEY;
  delete process.env.OPENAI_SYNTHESIS_MODEL;
  delete process.env.OPENAI_MODEL;
});

describe("GET /api/signal-agent/status", () => {
  it("reports OpenAI as not configured with a specific reason when no key is set", async () => {
    const response = await GET(new Request("http://localhost/api/signal-agent/status"));
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.openai.configured).toBe(false);
    expect(json.openai.authentication.usable).toBe(false);
    expect(json.openai.embeddings.usable).toBe(false);
    expect(json.openai.synthesis.usable).toBe(false);
    expect(json.openai.authentication.message).toBe("no configured key");
    expect(json.openai.authentication.message).not.toBe("fallback");
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

  it("reports 'disabled by user' for all capabilities when the caller explicitly turns OpenAI off", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key-abcdefghijklmnop";
    try {
      const response = await GET(new Request("http://localhost/api/signal-agent/status?useOpenAI=false"));
      const json = await response.json();
      expect(json.openai.configured).toBe(true);
      expect(json.openai.authentication.usable).toBe(false);
      expect(json.openai.embeddings.usable).toBe(false);
      expect(json.openai.synthesis.usable).toBe(false);
      expect(json.openai.authentication.message).toBe("disabled by user");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("exposes separate embedding_model and synthesis_model, defaulting synthesis to gpt-4o-mini", async () => {
    const response = await GET(new Request("http://localhost/api/signal-agent/status"));
    const json = await response.json();
    expect(json.openai.embedding_model).toBe("text-embedding-3-small");
    expect(json.openai.synthesis_model).toBe("gpt-4o-mini");
    expect(json.openai.embedding_model).not.toBe(json.openai.synthesis_model);
  });

  it("respects an explicitly configured OPENAI_SYNTHESIS_MODEL", async () => {
    process.env.OPENAI_SYNTHESIS_MODEL = "gpt-4.1-mini";
    try {
      const response = await GET(new Request("http://localhost/api/signal-agent/status"));
      const json = await response.json();
      expect(json.openai.synthesis_model).toBe("gpt-4.1-mini");
    } finally {
      delete process.env.OPENAI_SYNTHESIS_MODEL;
    }
  });

  it("accepts the legacy OPENAI_MODEL env var as a synthesis-model alias", async () => {
    process.env.OPENAI_MODEL = "gpt-4o";
    try {
      const response = await GET(new Request("http://localhost/api/signal-agent/status"));
      const json = await response.json();
      expect(json.openai.synthesis_model).toBe("gpt-4o");
    } finally {
      delete process.env.OPENAI_MODEL;
    }
  });
});
