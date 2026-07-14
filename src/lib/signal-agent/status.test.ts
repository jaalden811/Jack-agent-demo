import { describe, expect, it } from "vitest";
import { describeOpenAiFailure } from "@/lib/signal-agent/openaiStatus";

// describeOpenAiFailure now delegates to the central error normalizer
// (@/lib/openai/errorNormalizer). These assertions pin the safe,
// classification-specific wording surfaced in the Setup drawer.
describe("describeOpenAiFailure — specific safe reasons for the Setup drawer (Section 8)", () => {
  it("maps a timeout to a timeout-specific message", () => {
    expect(describeOpenAiFailure({ name: "APIConnectionTimeoutError" })).toContain("timed out");
    expect(describeOpenAiFailure({ code: "ETIMEDOUT" })).toContain("timed out");
  });

  it("maps 401 to an authentication-rejected reason without echoing the key", () => {
    const message = describeOpenAiFailure({ status: 401 });
    expect(message).toContain("401");
    expect(message.toLowerCase()).toContain("rejected the api key");
  });

  it("maps 403 to a permission-rejected reason, distinct from 401", () => {
    const message = describeOpenAiFailure({ status: 403 });
    expect(message).toContain("403");
    expect(message.toLowerCase()).toContain("permission rejected");
  });

  it("maps 404 to a model-unavailable reason", () => {
    expect(describeOpenAiFailure({ status: 404 }).toLowerCase()).toContain("model unavailable");
  });

  it("maps a plain 429 to a rate-limited reason", () => {
    expect(describeOpenAiFailure({ status: 429 }).toLowerCase()).toContain("rate limited");
  });

  it("maps a 429 with insufficient_quota to a quota-exceeded reason, distinct from rate limiting", () => {
    const message = describeOpenAiFailure({ status: 429, code: "insufficient_quota" });
    expect(message.toLowerCase()).toContain("quota");
    expect(message.toLowerCase()).not.toContain("rate limited");
  });

  it("maps 400 to an invalid-request reason", () => {
    expect(describeOpenAiFailure({ status: 400 }).toLowerCase()).toContain("invalid");
  });

  it("maps a 5xx to a server-error reason", () => {
    expect(describeOpenAiFailure({ status: 503 }).toLowerCase()).toContain("server error");
  });

  it("falls back to a generic safe reason for anything else, never a raw error dump", () => {
    const message = describeOpenAiFailure(new Error("some internal SDK detail with a key sk-abcdef123456"));
    expect(message).toContain("unrecognized error shape");
    expect(message).not.toContain("sk-abcdef123456");
  });
});
