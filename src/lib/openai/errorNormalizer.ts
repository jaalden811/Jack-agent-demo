/**
 * Single, robust normalizer that converts any error thrown while talking
 * to OpenAI — official SDK APIError subclasses, nested `cause` chains,
 * native fetch/network failures, AbortError/timeouts, plain
 * response-shaped objects, re-serialized errors, and truly unknown
 * values — into one safe, structured diagnostic. It never exposes the
 * API key, Authorization header, raw request/response body, prompt
 * content, or the full SDK object.
 *
 * Why this exists: the previous per-call classifiers read only a narrow
 * `{ status, code, error.code }` shape and never inspected `.cause`, so
 * a wrapped SDK error (e.g. an APIConnectionError wrapping a fetch
 * failure, or a re-thrown error from a retry helper) collapsed into
 * "unrecognized error shape / HTTP — / unclassified" even when a real
 * 429 `insufficient_quota` was available further down the chain.
 */

export type OpenAiSafeClassification =
  | "OPENAI_AUTHENTICATION_REJECTED"
  | "OPENAI_PERMISSION_REJECTED"
  | "OPENAI_MODEL_UNAVAILABLE"
  | "OPENAI_QUOTA_EXCEEDED"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_INVALID_REQUEST"
  | "OPENAI_TIMEOUT"
  | "OPENAI_SERVER_ERROR"
  | "OPENAI_NETWORK_FAILURE"
  | "OPENAI_UNKNOWN_ERROR";

export type OpenAiOperation = "authentication" | "embeddings" | "synthesis" | "extraction" | "qualification" | "message_synthesis" | "public_evidence";

export type NormalizedOpenAiError = {
  operation: OpenAiOperation;
  configured: boolean;
  operational: false;
  http_status: number | null;
  error_type: string | null;
  error_code: string | null;
  safe_classification: OpenAiSafeClassification;
  safe_message: string;
  request_id: string | null;
  retryable: boolean;
  checked_at: string;
};

const SAFE_MESSAGE_BY_CLASSIFICATION: Record<OpenAiSafeClassification, string> = {
  OPENAI_AUTHENTICATION_REJECTED: "OpenAI rejected the API key (HTTP 401) — the configured key was not accepted.",
  OPENAI_PERMISSION_REJECTED: "OpenAI permission rejected (HTTP 403) — the key is valid but lacks access to this resource/project.",
  OPENAI_MODEL_UNAVAILABLE: "Configured model unavailable (HTTP 404) — the model was not found or is not accessible to this project.",
  OPENAI_QUOTA_EXCEEDED: "OpenAI authenticated, but this project has no available API quota (HTTP 429, insufficient_quota). This will not resolve on retry.",
  OPENAI_RATE_LIMITED: "OpenAI rate limited the request (HTTP 429) — too many requests; safe to retry after a short backoff.",
  OPENAI_INVALID_REQUEST: "OpenAI rejected the request as invalid (HTTP 400) — the request was malformed for the configured model/parameters.",
  OPENAI_TIMEOUT: "The OpenAI request timed out before a response was received.",
  OPENAI_SERVER_ERROR: "OpenAI returned a server error (HTTP 5xx) — a provider-side failure; safe to retry later.",
  OPENAI_NETWORK_FAILURE: "Could not reach OpenAI — a network or connection failure occurred before a response was received.",
  OPENAI_UNKNOWN_ERROR: "OpenAI request failed with an unrecognized error shape — see http_status/error_type/error_code for any available detail."
};

const RETRYABLE: ReadonlySet<OpenAiSafeClassification> = new Set(["OPENAI_RATE_LIMITED", "OPENAI_TIMEOUT", "OPENAI_NETWORK_FAILURE", "OPENAI_SERVER_ERROR"]);

// Node/undici system error codes that indicate a transport-level failure
// rather than an HTTP response. Kept distinct from OpenAI's own body
// `code` (e.g. "insufficient_quota") which is a provider error code.
const TIMEOUT_SYSTEM_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const NETWORK_SYSTEM_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_SOCKET"]);

type ExtractedFields = {
  status: number | null;
  providerCode: string | null;
  providerType: string | null;
  systemCode: string | null;
  requestId: string | null;
  names: string[];
  messageLower: string;
  isAbort: boolean;
};

function readHeaderRequestId(headers: unknown): string | null {
  if (!headers) return null;
  // A WHATWG Headers instance (SDK ≥ v4) exposes .get().
  if (typeof (headers as { get?: unknown }).get === "function") {
    try {
      const value = (headers as { get: (name: string) => string | null }).get("x-request-id");
      if (value) return value;
    } catch {
      // ignore malformed header objects
    }
  }
  if (typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const candidate = record["x-request-id"] ?? record["X-Request-Id"] ?? record["x-request-ID"];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

/** Walks the error and its `.cause` chain (bounded depth), merging the
 * first defined value for each field — so a status/code/type/request-id
 * available anywhere in the chain is never lost. */
function extractFields(error: unknown): ExtractedFields {
  const fields: ExtractedFields = { status: null, providerCode: null, providerType: null, systemCode: null, requestId: null, names: [], messageLower: "", isAbort: false };
  const messages: string[] = [];

  let current: unknown = error;
  let depth = 0;
  const seen = new Set<unknown>();

  while (current && depth < 6 && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    const e = current as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : (current as object)?.constructor?.name;
    if (typeof name === "string" && name) fields.names.push(name);
    if (typeof e.message === "string") messages.push(e.message);
    if (name === "AbortError" || name === "APIUserAbortError" || (e as { type?: string }).type === "aborted") fields.isAbort = true;

    // HTTP status can appear as `status`, `statusCode`, or `response.status`.
    if (fields.status === null) {
      const status = e.status ?? e.statusCode ?? (e.response as { status?: unknown })?.status;
      if (typeof status === "number") fields.status = status;
    }

    // A `code` here is ambiguous: on an APIError it is the OpenAI body
    // code (e.g. "insufficient_quota"); on a Node system error it is an
    // errno (e.g. "ETIMEDOUT"). Route it to the right bucket by shape.
    const rawCode = e.code;
    if (typeof rawCode === "string") {
      if (TIMEOUT_SYSTEM_CODES.has(rawCode) || NETWORK_SYSTEM_CODES.has(rawCode)) {
        fields.systemCode = fields.systemCode ?? rawCode;
      } else {
        fields.providerCode = fields.providerCode ?? rawCode;
      }
    }

    // OpenAI SDK APIError exposes top-level `type`; the JSON body is on
    // `error` (already the body's `error` object: { message, type, code }).
    fields.providerType = fields.providerType ?? firstString(e.type, (e.error as { type?: unknown })?.type);
    fields.providerCode = fields.providerCode ?? firstString((e.error as { code?: unknown })?.code);
    fields.providerType = fields.providerType ?? firstString((e.error as { type?: unknown })?.type);

    fields.requestId = fields.requestId ?? firstString(e.requestID, e.request_id, e.requestId) ?? readHeaderRequestId(e.headers);

    current = e.cause;
  }

  fields.messageLower = messages.join(" ").toLowerCase();
  return fields;
}

function classify(fields: ExtractedFields): OpenAiSafeClassification {
  if (fields.isAbort || fields.systemCode !== null) {
    if (fields.isAbort || (fields.systemCode && TIMEOUT_SYSTEM_CODES.has(fields.systemCode))) return "OPENAI_TIMEOUT";
    return "OPENAI_NETWORK_FAILURE";
  }
  // Connection-layer SDK errors carry no HTTP status.
  if (fields.status === null) {
    if (fields.names.some((n) => n === "APIConnectionTimeoutError")) return "OPENAI_TIMEOUT";
    if (fields.names.some((n) => n === "APIConnectionError")) return "OPENAI_NETWORK_FAILURE";
    // Defensive: a body code survived even though the status did not.
    if (fields.providerCode === "insufficient_quota") return "OPENAI_QUOTA_EXCEEDED";
    if (fields.messageLower.includes("timed out") || fields.messageLower.includes("timeout")) return "OPENAI_TIMEOUT";
    if (fields.messageLower.includes("network") || fields.messageLower.includes("fetch failed") || fields.messageLower.includes("connection error")) return "OPENAI_NETWORK_FAILURE";
    return "OPENAI_UNKNOWN_ERROR";
  }

  const status = fields.status;
  if (status === 401) return "OPENAI_AUTHENTICATION_REJECTED";
  if (status === 403) return "OPENAI_PERMISSION_REJECTED";
  if (status === 404) return "OPENAI_MODEL_UNAVAILABLE";
  if (status === 429) {
    if (fields.providerCode === "insufficient_quota" || fields.providerType === "insufficient_quota" || fields.messageLower.includes("quota") || fields.messageLower.includes("billing")) return "OPENAI_QUOTA_EXCEEDED";
    return "OPENAI_RATE_LIMITED";
  }
  if (status === 400 || status === 422) return "OPENAI_INVALID_REQUEST";
  if (status === 408) return "OPENAI_TIMEOUT";
  if (status >= 500) return "OPENAI_SERVER_ERROR";
  return "OPENAI_UNKNOWN_ERROR";
}

export function normalizeOpenAiError(error: unknown, operation: OpenAiOperation, options: { configured?: boolean } = {}): NormalizedOpenAiError {
  const fields = extractFields(error);
  const classification = classify(fields);
  return {
    operation,
    configured: options.configured ?? true,
    operational: false,
    http_status: fields.status,
    error_type: fields.providerType,
    error_code: fields.providerCode,
    safe_classification: classification,
    safe_message: SAFE_MESSAGE_BY_CLASSIFICATION[classification],
    request_id: fields.requestId,
    retryable: RETRYABLE.has(classification),
    checked_at: new Date().toISOString()
  };
}

export function safeMessageForClassification(classification: OpenAiSafeClassification): string {
  return SAFE_MESSAGE_BY_CLASSIFICATION[classification];
}

export function isRetryableClassification(classification: OpenAiSafeClassification): boolean {
  return RETRYABLE.has(classification);
}

/** Development-only structural trace for a genuinely unknown error —
 * records only the SHAPE (constructor name, which fields exist), never
 * any property VALUE, since values may contain secrets or prompt text. */
export type SafeStructuralTrace = {
  is_error: boolean;
  constructor_name: string;
  own_property_names: string[];
  has_status: boolean;
  has_code: boolean;
  has_type: boolean;
  has_cause: boolean;
};

export function safeStructuralTrace(error: unknown): SafeStructuralTrace {
  const isError = error instanceof Error;
  const constructorName = (error as object)?.constructor?.name ?? typeof error;
  let ownPropertyNames: string[] = [];
  try {
    ownPropertyNames = error && typeof error === "object" ? Object.getOwnPropertyNames(error).filter((n) => n !== "stack" && n !== "message") : [];
  } catch {
    ownPropertyNames = [];
  }
  const e = (error ?? {}) as Record<string, unknown>;
  return {
    is_error: isError,
    constructor_name: typeof constructorName === "string" ? constructorName : "unknown",
    own_property_names: ownPropertyNames,
    has_status: "status" in e || "statusCode" in e,
    has_code: "code" in e,
    has_type: "type" in e,
    has_cause: "cause" in e
  };
}

// ─── Provider state model (Section 3) ────────────────────────────────────────

export type OpenAiProviderState = "missing" | "configured" | "authenticated" | "operational" | "quota_exhausted" | "permission_rejected" | "model_unavailable" | "temporarily_unavailable";

export type OpenAiProviderStateModel = {
  state: OpenAiProviderState;
  configured: boolean;
  authenticated: boolean;
  operational: boolean;
  requires_key_replacement: boolean;
  required_action: string;
};

/** Derives the single overall provider state from the three independent
 * capability classifications. Crucially: an `insufficient_quota` failure
 * is NEVER a reason to rotate/replace the key — the key authenticated
 * fine; the project simply needs quota. */
export function deriveOpenAiProviderState(params: {
  configured: boolean;
  authenticationOk: boolean;
  authenticationClassification: OpenAiSafeClassification | null;
  operationalOk: boolean;
  worstClassification: OpenAiSafeClassification | null;
}): OpenAiProviderStateModel {
  if (!params.configured) {
    return { state: "missing", configured: false, authenticated: false, operational: false, requires_key_replacement: false, required_action: "Add an OPENAI_API_KEY to enable OpenAI-enhanced analysis." };
  }

  const authClass = params.authenticationClassification;
  if (!params.authenticationOk) {
    if (authClass === "OPENAI_AUTHENTICATION_REJECTED") {
      return { state: "configured", configured: true, authenticated: false, operational: false, requires_key_replacement: true, required_action: "Replace the OpenAI API key — the current key was rejected (HTTP 401)." };
    }
    if (authClass === "OPENAI_PERMISSION_REJECTED") {
      return { state: "permission_rejected", configured: true, authenticated: false, operational: false, requires_key_replacement: false, required_action: "Grant this key/project access to the required OpenAI resources (HTTP 403)." };
    }
    // Quota/rate/network at the auth probe still means the key itself is
    // plausibly valid; do not recommend key replacement.
    if (authClass === "OPENAI_QUOTA_EXCEEDED") {
      return { state: "quota_exhausted", configured: true, authenticated: true, operational: false, requires_key_replacement: false, required_action: "Add API quota to the existing OpenAI project — the key is valid but has no available quota." };
    }
    return { state: "temporarily_unavailable", configured: true, authenticated: false, operational: false, requires_key_replacement: false, required_action: "Retry — OpenAI was temporarily unreachable during the authentication probe." };
  }

  // Authenticated. Now reflect the worst operational classification.
  if (params.operationalOk) {
    return { state: "operational", configured: true, authenticated: true, operational: true, requires_key_replacement: false, required_action: "None — OpenAI is authenticated and operational." };
  }
  switch (params.worstClassification) {
    case "OPENAI_QUOTA_EXCEEDED":
      return { state: "quota_exhausted", configured: true, authenticated: true, operational: false, requires_key_replacement: false, required_action: "Add API quota to the existing OpenAI project" };
    case "OPENAI_PERMISSION_REJECTED":
      return { state: "permission_rejected", configured: true, authenticated: true, operational: false, requires_key_replacement: false, required_action: "Grant this key/project access to the configured models." };
    case "OPENAI_MODEL_UNAVAILABLE":
      return { state: "model_unavailable", configured: true, authenticated: true, operational: false, requires_key_replacement: false, required_action: "Configure a model the project can access, or request access to the configured model." };
    case "OPENAI_RATE_LIMITED":
    case "OPENAI_TIMEOUT":
    case "OPENAI_SERVER_ERROR":
    case "OPENAI_NETWORK_FAILURE":
      return { state: "temporarily_unavailable", configured: true, authenticated: true, operational: false, requires_key_replacement: false, required_action: "Retry shortly — OpenAI was temporarily unavailable." };
    default:
      return { state: "authenticated", configured: true, authenticated: true, operational: false, requires_key_replacement: false, required_action: "Investigate the operation-level diagnostic detail." };
  }
}
