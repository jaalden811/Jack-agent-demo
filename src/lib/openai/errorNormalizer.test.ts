import { describe, expect, it } from "vitest";
import { APIError, AuthenticationError, PermissionDeniedError, NotFoundError, BadRequestError, RateLimitError, InternalServerError, APIConnectionError, APIConnectionTimeoutError } from "openai";
import { normalizeOpenAiError, deriveOpenAiProviderState, safeStructuralTrace } from "@/lib/openai/errorNormalizer";

/** Builds a Headers-like object carrying a request id, exactly as the
 * SDK receives it, so the request-id extraction path is exercised. */
function headersWithRequestId(id: string): Headers {
  const h = new Headers();
  h.set("x-request-id", id);
  return h;
}

describe("normalizeOpenAiError — real OpenAI SDK error shapes", () => {
  it("Test 1: recognizes 429 insufficient_quota from a RateLimitError as OPENAI_QUOTA_EXCEEDED", () => {
    const body = { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota", param: null };
    const err = new RateLimitError(429, { error: body }.error, "quota", headersWithRequestId("req_quota_1"));
    const out = normalizeOpenAiError(err, "embeddings");
    expect(out.safe_classification).toBe("OPENAI_QUOTA_EXCEEDED");
    expect(out.http_status).toBe(429);
    expect(out.error_code).toBe("insufficient_quota");
    expect(out.retryable).toBe(false);
    expect(out.request_id).toBe("req_quota_1");
  });

  it("Test: distinguishes 429 rate_limit_exceeded (retryable) from quota", () => {
    const err = new RateLimitError(429, { message: "Rate limit reached for requests", type: "requests", code: "rate_limit_exceeded" }, "rate", headersWithRequestId("req_rl"));
    const out = normalizeOpenAiError(err, "synthesis");
    expect(out.safe_classification).toBe("OPENAI_RATE_LIMITED");
    expect(out.retryable).toBe(true);
  });

  it("Test 2: recognizes a nested APIError inside .cause", () => {
    const inner = new RateLimitError(429, { message: "quota", type: "insufficient_quota", code: "insufficient_quota" }, "quota", headersWithRequestId("req_nested"));
    const wrapper = new Error("Message synthesis failed");
    (wrapper as { cause?: unknown }).cause = inner;
    const out = normalizeOpenAiError(wrapper, "message_synthesis");
    expect(out.safe_classification).toBe("OPENAI_QUOTA_EXCEEDED");
    expect(out.http_status).toBe(429);
    expect(out.request_id).toBe("req_nested");
  });

  it("Test 3: preserves request id even without an explicit requestID property (from headers)", () => {
    const err = new AuthenticationError(401, { message: "bad key", type: "invalid_request_error", code: "invalid_api_key" }, "401", headersWithRequestId("req_from_headers"));
    const out = normalizeOpenAiError(err, "authentication");
    expect(out.request_id).toBe("req_from_headers");
  });

  it("Test: 401 → OPENAI_AUTHENTICATION_REJECTED", () => {
    const err = new AuthenticationError(401, { message: "bad key", type: "invalid_request_error", code: "invalid_api_key" }, "401", new Headers());
    expect(normalizeOpenAiError(err, "authentication").safe_classification).toBe("OPENAI_AUTHENTICATION_REJECTED");
  });

  it("Test: 403 → OPENAI_PERMISSION_REJECTED", () => {
    const err = new PermissionDeniedError(403, { message: "no access", type: "permission_error", code: null }, "403", new Headers());
    expect(normalizeOpenAiError(err, "synthesis").safe_classification).toBe("OPENAI_PERMISSION_REJECTED");
  });

  it("Test: 404 model missing → OPENAI_MODEL_UNAVAILABLE", () => {
    const err = new NotFoundError(404, { message: "model not found", type: "invalid_request_error", code: "model_not_found" }, "404", new Headers());
    expect(normalizeOpenAiError(err, "synthesis").safe_classification).toBe("OPENAI_MODEL_UNAVAILABLE");
  });

  it("Test: 400 invalid request → OPENAI_INVALID_REQUEST", () => {
    const err = new BadRequestError(400, { message: "bad param", type: "invalid_request_error", code: "invalid_value" }, "400", new Headers());
    expect(normalizeOpenAiError(err, "synthesis").safe_classification).toBe("OPENAI_INVALID_REQUEST");
  });

  it("Test: 5xx → OPENAI_SERVER_ERROR (retryable)", () => {
    const err = new InternalServerError(503, { message: "overloaded", type: "server_error", code: null }, "503", new Headers());
    const out = normalizeOpenAiError(err, "synthesis");
    expect(out.safe_classification).toBe("OPENAI_SERVER_ERROR");
    expect(out.retryable).toBe(true);
  });

  it("Test: timeout (APIConnectionTimeoutError) → OPENAI_TIMEOUT", () => {
    const err = new APIConnectionTimeoutError({ message: "Request timed out." });
    const out = normalizeOpenAiError(err, "embeddings");
    expect(out.safe_classification).toBe("OPENAI_TIMEOUT");
    expect(out.retryable).toBe(true);
  });

  it("Test: fetch/connection failure (APIConnectionError wrapping a system error) → OPENAI_NETWORK_FAILURE", () => {
    const cause = Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
    const err = new APIConnectionError({ message: "Connection error.", cause });
    const out = normalizeOpenAiError(err, "authentication");
    expect(out.safe_classification).toBe("OPENAI_NETWORK_FAILURE");
  });

  it("Test: AbortError → OPENAI_TIMEOUT", () => {
    const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(normalizeOpenAiError(err, "synthesis").safe_classification).toBe("OPENAI_TIMEOUT");
  });

  it("Test: plain response-shaped object error is still classified", () => {
    const err = { status: 429, error: { type: "insufficient_quota", code: "insufficient_quota", message: "quota" }, requestID: "req_plain" };
    const out = normalizeOpenAiError(err, "embeddings");
    expect(out.safe_classification).toBe("OPENAI_QUOTA_EXCEEDED");
    expect(out.http_status).toBe(429);
    expect(out.request_id).toBe("req_plain");
  });

  it("Test 5: an unknown error shape does not hide an available status/code", () => {
    // No status anywhere, no recognizable system code → UNKNOWN, but the
    // classification is explicit and honest, never silently dropped.
    const err = new Error("something odd happened");
    const out = normalizeOpenAiError(err, "synthesis");
    expect(out.safe_classification).toBe("OPENAI_UNKNOWN_ERROR");
    expect(out.http_status).toBeNull();
  });

  it("Test 4 (part): request id extracted from a snake_case request_id property", () => {
    const err = { status: 500, request_id: "req_snake", error: { type: "server_error" } };
    expect(normalizeOpenAiError(err, "synthesis").request_id).toBe("req_snake");
  });
});

describe("safeStructuralTrace — never leaks values", () => {
  it("reports shape only (constructor, which fields exist), not values", () => {
    const err = Object.assign(new Error("secret content sk-abc"), { status: 429, code: "insufficient_quota" });
    const trace = safeStructuralTrace(err);
    expect(trace.is_error).toBe(true);
    expect(trace.has_status).toBe(true);
    expect(trace.has_code).toBe(true);
    // No value fields anywhere on the trace.
    expect(JSON.stringify(trace)).not.toContain("sk-abc");
    expect(JSON.stringify(trace)).not.toContain("insufficient_quota");
  });
});

describe("deriveOpenAiProviderState — quota is never a key-replacement condition (Section 3)", () => {
  it("Test 4: authentication OK + quota-exhausted operations → quota_exhausted, no key replacement", () => {
    const model = deriveOpenAiProviderState({
      configured: true,
      authenticationOk: true,
      authenticationClassification: null,
      operationalOk: false,
      worstClassification: "OPENAI_QUOTA_EXCEEDED"
    });
    expect(model.state).toBe("quota_exhausted");
    expect(model.authenticated).toBe(true);
    expect(model.requires_key_replacement).toBe(false);
    expect(model.required_action).toContain("quota");
  });

  it("a 401 at the auth probe → requires_key_replacement true", () => {
    const model = deriveOpenAiProviderState({
      configured: true,
      authenticationOk: false,
      authenticationClassification: "OPENAI_AUTHENTICATION_REJECTED",
      operationalOk: false,
      worstClassification: "OPENAI_AUTHENTICATION_REJECTED"
    });
    expect(model.requires_key_replacement).toBe(true);
  });

  it("not configured → missing", () => {
    const model = deriveOpenAiProviderState({ configured: false, authenticationOk: false, authenticationClassification: null, operationalOk: false, worstClassification: null });
    expect(model.state).toBe("missing");
  });

  it("fully operational → operational", () => {
    const model = deriveOpenAiProviderState({ configured: true, authenticationOk: true, authenticationClassification: null, operationalOk: true, worstClassification: null });
    expect(model.state).toBe("operational");
    expect(model.operational).toBe(true);
  });
});
