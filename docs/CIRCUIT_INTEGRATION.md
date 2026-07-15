# Circuit AI Integration

Circuit is the single active generative-AI provider for this application. It
replaces OpenAI as the reasoning/synthesis layer. Public search (SerpAPI) and
the deterministic engine are unchanged.

> Status: this document covers the **provider foundation** that is implemented
> and tested (`src/lib/circuit/**`, `src/lib/ai-provider/**`). Wiring Circuit
> into every former OpenAI call site and removing the `openai` dependency is a
> subsequent, separately-verifiable step (see "Remaining migration" below).

## 1. What Circuit does
Enriches evidence interpretation, qualification, action planning, specialist
handoff, and message generation.

## 2. What Circuit does NOT do
Circuit does not control transcript parsing, score arithmetic, routing,
delivery-target selection, deduplication, evidence identity, or audit truth.
Those remain deterministic and authoritative. A Circuit failure never destroys
the deterministic result.

## 3. Configuration
All settings are read from the server environment (see `.env.example`). Only the
client id + secret are secrets; the access token is short-lived runtime state
and is never an env var. **No App Key** is used or sent.

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `circuit` (or `none` for deterministic-only) |
| `CIRCUIT_CLIENT_ID` / `CIRCUIT_CLIENT_SECRET` | Client-credentials (secret) |
| `CIRCUIT_TOKEN_URL` / `CIRCUIT_INFERENCE_URL` | Endpoints (never hard-coded) |
| `CIRCUIT_MODEL` | Model (never hard-coded; blank → `CIRCUIT_MODEL_REQUIRED`) |
| `CIRCUIT_SCOPE` / `CIRCUIT_AUDIENCE` | Optional token grant fields |
| `CIRCUIT_TIMEOUT_MS` / `CIRCUIT_MAX_RETRIES` | Request policy |
| `CIRCUIT_TOKEN_FALLBACK_TTL_SECONDS` / `CIRCUIT_TOKEN_REFRESH_SKEW_SECONDS` | Token lifecycle |
| `CIRCUIT_PROMPT_VERSION` / `CIRCUIT_SCHEMA_VERSION` | Versioning |

## 4. Token lifecycle
```
client id + client secret
  → POST CIRCUIT_TOKEN_URL (grant_type=client_credentials)
  → { access_token, token_type, expires_in }
  → cache in server memory (single-flight; refresh before expiry - skew)
  → reuse until near expiry; refresh once on an inference 401 and retry once
```
The token is never persisted, logged, hashed for display, or returned to the
browser.

## 5. Inference lifecycle
```
canonical evidence bundle → master prompt → stage prompt
  → Circuit inference (Bearer token, configured model)
  → JSON parse → Zod validation → one repair attempt
  → deterministic fallback on failure
```

## 6. The wire contract (source of truth)
The exact request/response field mapping lives ONLY in
`src/lib/circuit/contract.ts`. The defaults implement a standard OAuth2
client-credentials token grant and an OpenAI-compatible chat-completions
inference shape. **Confirm these against the attached Circuit notebook /
sanitized cURL** and adjust only that file if Circuit differs (e.g. a
Gemini-style `contents`/`candidates` shape). No other file needs to change.

## 7. Error model
`src/lib/circuit/errorNormalizer.ts` maps every failure to a stable
`CIRCUIT_*` code with a `retryable` flag. Retry: network, timeout, 429, 5xx.
Never repeatedly retry 400/401/403/404.

## 8. Diagnostics & routes
- `GET /api/circuit/status` — safe live diagnostics (no secrets/token).
- `POST /api/circuit/test-auth` — mints a token to verify credentials.
- `POST /api/circuit/test-inference` — tiny inference to verify the contract.
- `POST /api/circuit/token/refresh` / `POST /api/circuit/token/clear`.

## 9. Remaining migration (tracked, not yet done)
1. Route the former OpenAI call sites (`src/lib/qualification/openai*.ts`,
   `src/lib/services.ts`, `src/lib/openai/*`) through
   `@/lib/ai-provider/registry` → Circuit, keeping deterministic fallback.
2. Add Zod stage schemas (extraction / public evidence / qualification /
   message) + the versioned master prompt loader.
3. Replace OpenAI labels/config/UI with Circuit; run `npm uninstall openai`
   once no active imports remain.
4. Run live `test-auth` / `test-inference` once real Circuit credentials and
   the confirmed contract are in `.env.local`.
