import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCircuitConfig, isCircuitConfigured } from "@/lib/circuit/config";
import { buildTokenRequest, parseTokenResponse, buildInferenceRequest, parseInferenceResponse } from "@/lib/circuit/contract";
import { classifyCircuitHttpStatus, classifyCircuitThrown } from "@/lib/circuit/errorNormalizer";
import { getCircuitAccessToken, getCircuitTokenState, invalidateCircuitToken, _resetCircuitTokenCache } from "@/lib/circuit/tokenManager";
import { circuitGenerate } from "@/lib/circuit/client";
import { getCircuitDiagnostics } from "@/lib/circuit/diagnostics";

/**
 * Circuit provider foundation coverage (Phase 21). No live Circuit is
 * required — fetch is mocked. Verifies the OAuth2 client-credentials token
 * flow, error model, and that no secret/token ever leaks into diagnostics.
 */

const CLIENT_SECRET = "test-secret-value-do-not-leak";
const ACCESS_TOKEN = "test-access-token-do-not-leak";

const ENV_KEYS = ["AI_PROVIDER", "CIRCUIT_CLIENT_ID", "CIRCUIT_CLIENT_SECRET", "CIRCUIT_TOKEN_URL", "CIRCUIT_INFERENCE_URL", "CIRCUIT_MODEL", "CIRCUIT_SCOPE", "CIRCUIT_AUDIENCE", "CIRCUIT_APP_KEY", "CIRCUIT_CONTRACT_CONFIRMED", "CIRCUIT_CONTRACT_VERSION"] as const;
const saved: Record<string, string | undefined> = {};

/** Configures Circuit AND confirms the wire contract, so the wire-level
 * tests exercise the token/inference behavior. The contract-gate tests
 * deliberately omit the confirmation. */
function configureCircuit(extra: Record<string, string> = {}) {
  process.env.AI_PROVIDER = "circuit";
  process.env.CIRCUIT_CLIENT_ID = "test-client-id";
  process.env.CIRCUIT_CLIENT_SECRET = CLIENT_SECRET;
  process.env.CIRCUIT_TOKEN_URL = "https://circuit.example/token";
  process.env.CIRCUIT_INFERENCE_URL = "https://circuit.example/inference";
  process.env.CIRCUIT_MODEL = "test-model";
  process.env.CIRCUIT_CONTRACT_CONFIRMED = "true";
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  _resetCircuitTokenCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetCircuitTokenCache();
  vi.restoreAllMocks();
});

describe("Contract-confirmation gate (Phase 1 / Test 7)", () => {
  it("Test 7: an unconfirmed contract fails BEFORE any network request (token)", async () => {
    // Configured, but contract NOT confirmed.
    process.env.AI_PROVIDER = "circuit";
    process.env.CIRCUIT_CLIENT_ID = "test-client-id";
    process.env.CIRCUIT_CLIENT_SECRET = CLIENT_SECRET;
    process.env.CIRCUIT_TOKEN_URL = "https://circuit.example/token";
    process.env.CIRCUIT_INFERENCE_URL = "https://circuit.example/inference";
    process.env.CIRCUIT_MODEL = "test-model";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await getCircuitAccessToken();
    expect(result.token).toBeNull();
    expect(result.error?.code).toBe("CIRCUIT_CONTRACT_UNCONFIRMED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 7: an unconfirmed contract fails BEFORE any network request (inference)", async () => {
    process.env.AI_PROVIDER = "circuit";
    process.env.CIRCUIT_CLIENT_ID = "test-client-id";
    process.env.CIRCUIT_CLIENT_SECRET = CLIENT_SECRET;
    process.env.CIRCUIT_TOKEN_URL = "https://circuit.example/token";
    process.env.CIRCUIT_INFERENCE_URL = "https://circuit.example/inference";
    process.env.CIRCUIT_MODEL = "test-model";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await circuitGenerate({ prompt: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("CIRCUIT_CONTRACT_UNCONFIRMED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("diagnostics report contract state safely when configured but unconfirmed", () => {
    process.env.AI_PROVIDER = "circuit";
    process.env.CIRCUIT_CLIENT_ID = "test-client-id";
    process.env.CIRCUIT_CLIENT_SECRET = CLIENT_SECRET;
    process.env.CIRCUIT_TOKEN_URL = "https://circuit.example/token";
    process.env.CIRCUIT_INFERENCE_URL = "https://circuit.example/inference";
    process.env.CIRCUIT_MODEL = "test-model";
    const d = getCircuitDiagnostics();
    expect(d.configured).toBe(true);
    expect(d.contractConfirmed).toBe(false);
    expect(d.operational).toBe(false);
    expect(d.tokenState).toBe("unconfirmed");
  });
});

describe("Circuit config (Tests 6/10/11)", () => {
  it("Test 6: missing Circuit config is safe (not configured, no throw)", () => {
    expect(isCircuitConfigured(getCircuitConfig())).toBe(false);
    expect(getCircuitDiagnostics().configured).toBe(false);
  });

  it("Test 10/11: model comes from configuration and is not hard-coded", () => {
    configureCircuit({ CIRCUIT_MODEL: "some-configured-model" });
    expect(getCircuitConfig().model).toBe("some-configured-model");
  });

  it("Test 9: no App Key is read or required", () => {
    configureCircuit({ CIRCUIT_APP_KEY: "should-be-ignored" });
    const config = getCircuitConfig();
    expect(isCircuitConfigured(config)).toBe(true);
    expect(JSON.stringify(config)).not.toContain("should-be-ignored");
  });
});

describe("Circuit wire contract (Tests 9/12/20/21)", () => {
  it("Test 12: token request is a client-credentials grant with client id/secret, scope/audience, and NO App Key", () => {
    configureCircuit({ CIRCUIT_SCOPE: "circuit.infer", CIRCUIT_AUDIENCE: "circuit-aud", CIRCUIT_APP_KEY: "nope" });
    const spec = buildTokenRequest(getCircuitConfig());
    expect(spec.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(spec.body).toContain("grant_type=client_credentials");
    expect(spec.body).toContain("client_id=test-client-id");
    expect(spec.body).toContain("scope=circuit.infer");
    expect(spec.body).toContain("audience=circuit-aud");
    expect(spec.body.toLowerCase()).not.toContain("app_key");
    expect(spec.body.toLowerCase()).not.toContain("appkey");
  });

  it("Test 13: parses access_token + expires_in (and a token alias)", () => {
    expect(parseTokenResponse({ access_token: "abc", token_type: "Bearer", expires_in: 3600 })).toEqual({ access_token: "abc", token_type: "Bearer", expires_in: 3600 });
    expect(parseTokenResponse({ token: "xyz" })?.access_token).toBe("xyz");
    expect(parseTokenResponse({ nothing: true })).toBeNull();
  });

  it("Test 20/21: inference request uses Bearer token + configured model; response text path is parsed", () => {
    configureCircuit();
    const spec = buildInferenceRequest({ config: getCircuitConfig(), accessToken: ACCESS_TOKEN, model: "test-model", prompt: "hello", system: "sys" });
    expect(spec.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    const body = JSON.parse(spec.body);
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "hello" }]);

    const parsed = parseInferenceResponse({ model: "test-model", choices: [{ message: { content: "the answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    expect(parsed.text).toBe("the answer");
    expect(parsed.model).toBe("test-model");
    expect(parsed.finish_reason).toBe("stop");
    expect(parsed.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
  });
});

describe("Circuit error model (Tests 23/24/25/26)", () => {
  it("classifies HTTP statuses with correct retryability", () => {
    expect(classifyCircuitHttpStatus(400).code).toBe("CIRCUIT_INVALID_REQUEST");
    expect(classifyCircuitHttpStatus(400).retryable).toBe(false);
    expect(classifyCircuitHttpStatus(401).code).toBe("CIRCUIT_AUTHENTICATION_REJECTED");
    expect(classifyCircuitHttpStatus(403).code).toBe("CIRCUIT_PERMISSION_REJECTED");
    expect(classifyCircuitHttpStatus(429).retryable).toBe(true);
    expect(classifyCircuitHttpStatus(500).retryable).toBe(true);
    expect(classifyCircuitHttpStatus(503).retryable).toBe(true);
  });

  it("Test 23: classifies timeout/network as retryable", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyCircuitThrown(abort).code).toBe("CIRCUIT_TIMEOUT");
    expect(classifyCircuitThrown(new Error("fetch failed")).code).toBe("CIRCUIT_NETWORK_FAILURE");
    expect(classifyCircuitThrown(new Error("fetch failed")).retryable).toBe(true);
  });
});

describe("Circuit token manager (Tests 14/15/16/17)", () => {
  it("Test 14/15: mints a token, caches it (no second network call), honors expiry", async () => {
    configureCircuit();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600 }));
    const first = await getCircuitAccessToken();
    expect(first.token?.access_token).toBe(ACCESS_TOKEN);
    const second = await getCircuitAccessToken();
    expect(second.token?.access_token).toBe(ACCESS_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCircuitTokenState().state).toBe("valid");
  });

  it("Test 17: single-flight — concurrent callers share one token request", async () => {
    configureCircuit();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 3600 });
    });
    const [a, b, c] = await Promise.all([getCircuitAccessToken(), getCircuitAccessToken(), getCircuitAccessToken()]);
    expect(a.token?.access_token).toBe(ACCESS_TOKEN);
    expect(b.token?.access_token).toBe(ACCESS_TOKEN);
    expect(c.token?.access_token).toBe(ACCESS_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Test 16: an expired cached token triggers a refresh", async () => {
    configureCircuit();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 1 })); // ~1s, below skew
    await getCircuitAccessToken();
    // With default 60s skew, a 1s token is already "expired" for reuse.
    expect(getCircuitTokenState().state).toBe("expired");
    await getCircuitAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns CIRCUIT_NOT_CONFIGURED when unconfigured", async () => {
    const result = await getCircuitAccessToken();
    expect(result.token).toBeNull();
    expect(result.error?.code).toBe("CIRCUIT_NOT_CONFIGURED");
  });
});

describe("Circuit inference client (Tests 18/19/22/24/25/26)", () => {
  it("returns CIRCUIT_MODEL_REQUIRED when model is blank", async () => {
    configureCircuit({ CIRCUIT_MODEL: "" });
    const result = await circuitGenerate({ prompt: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("CIRCUIT_MODEL_REQUIRED");
  });

  it("Test 22: succeeds and captures the returned model safely", async () => {
    configureCircuit();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/token")) return jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 3600 });
      return jsonResponse({ model: "returned-model", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    });
    const result = await circuitGenerate({ prompt: "hi" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("ok");
    expect(result.model).toBe("returned-model");
  });

  it("Test 18/19: a 401 refreshes the token once and retries once; a second 401 stops", async () => {
    configureCircuit();
    let inferenceCalls = 0;
    let tokenCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/token")) {
        tokenCalls += 1;
        return jsonResponse({ access_token: `${ACCESS_TOKEN}-${tokenCalls}`, expires_in: 3600 });
      }
      inferenceCalls += 1;
      return jsonResponse({ error: "unauthorized" }, 401);
    });
    const result = await circuitGenerate({ prompt: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("CIRCUIT_AUTHENTICATION_REJECTED");
    // One initial 401 -> refresh -> one retry that also 401s -> stop.
    expect(inferenceCalls).toBe(2);
    expect(tokenCalls).toBe(2);
  });

  it("Test 26: a permanent 400 is not retried", async () => {
    configureCircuit({ CIRCUIT_MAX_RETRIES: "2" });
    let inferenceCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/token")) return jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 3600 });
      inferenceCalls += 1;
      return jsonResponse({ error: "bad" }, 400);
    });
    const result = await circuitGenerate({ prompt: "hi" });
    expect(result.error?.code).toBe("CIRCUIT_INVALID_REQUEST");
    expect(inferenceCalls).toBe(1);
  });

  it("Test 25: a 5xx is retried up to the configured max", async () => {
    configureCircuit({ CIRCUIT_MAX_RETRIES: "2" });
    let inferenceCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/token")) return jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 3600 });
      inferenceCalls += 1;
      return jsonResponse({ error: "server" }, 500);
    });
    const result = await circuitGenerate({ prompt: "hi" });
    expect(result.error?.code).toBe("CIRCUIT_SERVER_ERROR");
    expect(inferenceCalls).toBe(3); // 1 + 2 retries
  });
});

describe("Circuit diagnostics never leak secrets (Tests 7/8)", () => {
  it("Test 7/8: diagnostics contain no client secret and no access token", async () => {
    configureCircuit();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 3600 }));
    invalidateCircuitToken();
    await getCircuitAccessToken();
    const diagnostics = getCircuitDiagnostics();
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(CLIENT_SECRET);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain("test-client-id");
    expect(diagnostics.aiProvider).toBe("circuit");
    expect(diagnostics.tokenState).toBe("valid");
  });
});
