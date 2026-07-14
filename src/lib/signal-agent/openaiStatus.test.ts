import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET_KEY = "sk-super-secret-test-key-should-never-leak";

function mockOpenAiModule(overrides: { models?: unknown; embeddings?: unknown; responses?: unknown }) {
  vi.doMock("openai", () => ({
    default: class MockOpenAI {
      apiKey: string;
      models = overrides.models ?? { list: vi.fn().mockResolvedValue({ data: [] }) };
      embeddings = overrides.embeddings ?? { create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] }) };
      responses = overrides.responses ?? { create: vi.fn().mockResolvedValue({ output_text: "ready" }) };
      constructor(params: { apiKey: string }) {
        this.apiKey = params.apiKey;
      }
    }
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("openai");
});

describe("checkOpenAiAuthentication", () => {
  it("reports usable:true when models.list succeeds", async () => {
    mockOpenAiModule({});
    const { checkOpenAiAuthentication } = await import("@/lib/signal-agent/openaiStatus");
    const result = await checkOpenAiAuthentication(SECRET_KEY);
    expect(result.usable).toBe(true);
    expect(result.message).toBe("Ready");
  });

  it("reports a sanitized 401 rejection without leaking the key", async () => {
    const error = Object.assign(new Error("Incorrect API key provided"), { status: 401, error: { type: "invalid_request_error", code: "invalid_api_key" } });
    mockOpenAiModule({ models: { list: vi.fn().mockRejectedValue(error) } });
    const { checkOpenAiAuthentication } = await import("@/lib/signal-agent/openaiStatus");
    const result = await checkOpenAiAuthentication(SECRET_KEY);
    expect(result.usable).toBe(false);
    expect(result.message).toBe("request rejected (invalid or unauthorized key)");
    expect(result.error?.http_status).toBe(401);
    expect(result.error?.error_code).toBe("invalid_api_key");
    expect(JSON.stringify(result)).not.toContain(SECRET_KEY);
  });
});

describe("checkOpenAiEmbeddings", () => {
  it("is independent from synthesis — succeeds even if synthesis is broken", async () => {
    mockOpenAiModule({ responses: { create: vi.fn().mockRejectedValue(new Error("synthesis broken")) } });
    const { checkOpenAiEmbeddings } = await import("@/lib/signal-agent/openaiStatus");
    const result = await checkOpenAiEmbeddings(SECRET_KEY, "text-embedding-3-small");
    expect(result.usable).toBe(true);
  });

  it("reports model unavailable (404) with a sanitized message", async () => {
    const error = Object.assign(new Error("model not found"), { status: 404 });
    mockOpenAiModule({ embeddings: { create: vi.fn().mockRejectedValue(error) } });
    const { checkOpenAiEmbeddings } = await import("@/lib/signal-agent/openaiStatus");
    const result = await checkOpenAiEmbeddings(SECRET_KEY, "bogus-model");
    expect(result.usable).toBe(false);
    expect(result.message).toBe("model unavailable");
    expect(result.error?.http_status).toBe(404);
  });
});

describe("checkOpenAiSynthesis", () => {
  it("never calls the embeddings endpoint — uses responses.create with the synthesis model", async () => {
    const responsesCreate = vi.fn().mockResolvedValue({ output_text: "ready" });
    const embeddingsCreate = vi.fn();
    mockOpenAiModule({ responses: { create: responsesCreate }, embeddings: { create: embeddingsCreate } });
    const { checkOpenAiSynthesis } = await import("@/lib/signal-agent/openaiStatus");
    const result = await checkOpenAiSynthesis(SECRET_KEY, "gpt-4o-mini");
    expect(result.usable).toBe(true);
    expect(responsesCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }));
    expect(embeddingsCreate).not.toHaveBeenCalled();
  });

  it("is independent from embeddings — fails on its own without affecting the embeddings result", async () => {
    const error = Object.assign(new Error("synthesis model rejected"), { status: 404 });
    mockOpenAiModule({ responses: { create: vi.fn().mockRejectedValue(error) } });
    const { checkOpenAiSynthesis, checkOpenAiEmbeddings } = await import("@/lib/signal-agent/openaiStatus");
    const synthesisResult = await checkOpenAiSynthesis(SECRET_KEY, "text-embedding-3-small");
    const embeddingsResult = await checkOpenAiEmbeddings(SECRET_KEY, "text-embedding-3-small");
    expect(synthesisResult.usable).toBe(false);
    expect(synthesisResult.message).toBe("model unavailable");
    expect(embeddingsResult.usable).toBe(true);
  });

  it("reports a rate-limit (429) rejection with a sanitized reason", async () => {
    const error = Object.assign(new Error("rate limited"), { status: 429 });
    mockOpenAiModule({ responses: { create: vi.fn().mockRejectedValue(error) } });
    const { checkOpenAiSynthesis } = await import("@/lib/signal-agent/openaiStatus");
    const result = await checkOpenAiSynthesis(SECRET_KEY, "gpt-4o-mini");
    expect(result.message).toBe("request rejected (rate limited)");
  });
});
