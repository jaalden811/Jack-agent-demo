import { describe, expect, it } from "vitest";
import { describeOpenAiFailure } from "@/lib/signal-agent/status";

describe("describeOpenAiFailure — specific safe reasons for the Setup drawer", () => {
  it("maps a timeout to 'timeout'", () => {
    expect(describeOpenAiFailure({ name: "APIConnectionTimeoutError" })).toBe("timeout");
    expect(describeOpenAiFailure({ code: "ETIMEDOUT" })).toBe("timeout");
  });

  it("maps 401/403 to a rejected-key reason without echoing the key", () => {
    expect(describeOpenAiFailure({ status: 401 })).toBe("request rejected (invalid or unauthorized key)");
    expect(describeOpenAiFailure({ status: 403 })).toBe("request rejected (invalid or unauthorized key)");
  });

  it("maps 404 to 'model unavailable'", () => {
    expect(describeOpenAiFailure({ status: 404 })).toBe("model unavailable");
  });

  it("maps 429 to a rate-limited reason", () => {
    expect(describeOpenAiFailure({ status: 429 })).toBe("request rejected (rate limited)");
  });

  it("maps a 5xx to a provider-error reason", () => {
    expect(describeOpenAiFailure({ status: 503 })).toBe("request rejected (provider error)");
  });

  it("falls back to a generic safe reason for anything else, never a raw error dump", () => {
    const message = describeOpenAiFailure(new Error("some internal SDK detail with a key sk-abcdef123456"));
    expect(message).toBe("request rejected");
    expect(message).not.toContain("sk-abcdef123456");
  });
});
