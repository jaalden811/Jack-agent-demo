# Circuit AI Integration

Circuit is the single active generative-AI provider for this application. It
replaces OpenAI as the reasoning/synthesis layer. Public search (SerpAPI) and
the deterministic engine are unchanged.

> Status: the **provider foundation** (`src/lib/circuit/**`,
> `src/lib/ai-provider/**`), the **Stage A–D runners**, the **Signal-to-Action
> additive enhancement**, and the **Market + Buyer Intelligence cutover**
> (`src/lib/services.ts`) are implemented, tested, and live-verified. Wiring the
> remaining Signal-to-Action OpenAI call sites through the registry and removing
> the `openai` dependency are subsequent, separately-verifiable steps (see
> "Migration status" below).

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

## 6. The wire contract (source of truth) + confirmation gate
The exact request/response field mapping lives ONLY in
`src/lib/circuit/contract.ts`.

**Token — CONFIRMED and live-verified** against the Cisco Circuit cURL:
`POST {CIRCUIT_TOKEN_URL}` (`https://id.cisco.com/oauth2/default/v1/token`) with
`Authorization: Basic base64(client_id:client_secret)` and body
`grant_type=client_credentials`; response is standard Okta OAuth2
`{ access_token (JWT with exp), token_type, expires_in, scope }`. Because the
token contract is confirmed, `POST /api/circuit/test-auth` mints a real token
whenever the client id/secret/token URL are configured.

**Inference — CONFIRMED + live-verified** against the Cisco Circuit cURL:
`POST {CIRCUIT_INFERENCE_URL}` — OpenAI/Azure-compatible chat/completions where
the model is a **deployment in the URL path**
(`.../openai/deployments/{model}/chat/completions`; `{model}` is substituted
with `CIRCUIT_MODEL`). Auth is the **`api-key: <access-token>`** header (the
minted token — not `Authorization: Bearer`). Body:
`{ messages:[{role,content}], user: "{\"appkey\":\"<APP_KEY>\"}", stop:["<|im_end|>"] }`
(the model is **not** a body field). Response is standard OpenAI/Azure
`choices[0].message.content`. Live smoke test returned
`{ok:true, model:"google/gemini-3.1-flash-lite"}`.

**App Key IS required** by the inference contract and is passed as a JSON string
in the body `user` field (`CIRCUIT_APP_KEY`, secret, `.env.local` only). It is
**never** sent on the token request. (This supersedes the earlier "no App Key"
default — the current inference cURL is the source of truth and contains one.)

The inference client stays gated by `CIRCUIT_CONTRACT_CONFIRMED` (set to `true`
now that the contract is confirmed); when false it returns
`CIRCUIT_CONTRACT_UNCONFIRMED` with no network call.

`GET /api/circuit/status` reports `configured`, `credentialsConfigured`,
`contractConfirmed`, `contractVersion`, `authenticationAccepted`, `state`,
`lastErrorCause`, and `tokenState` (never secrets/token).

## 7. Error model
`src/lib/circuit/errorNormalizer.ts` maps every failure to a stable
`CIRCUIT_*` code with a `retryable` flag. Retry: network, timeout, 429, 5xx.
Never repeatedly retry 400/401/403/404.

## 8. Diagnostics & routes
- `GET /api/circuit/status` — safe live diagnostics (no secrets/token).
- `POST /api/circuit/test-auth` — mints a token to verify credentials.
- `POST /api/circuit/test-inference` — tiny inference to verify the contract.
- `POST /api/circuit/token/refresh` / `POST /api/circuit/token/clear`.

## 9. Migration status

Done:
- Circuit foundation (config, token manager, inference client, error
  normalizer, diagnostics, provider registry) + versioned master prompt loader.
- Zod stage schemas + shared stage runner for Stages A–D (extraction / public
  evidence / qualification / message) with evidence-integrity validation and a
  deterministic fallback for every stage.
- Signal-to-Action pipeline runs Stages A→B→C→D additively (`ai_trace`),
  live-verified against the real endpoint.
- **Market + Buyer Intelligence (`src/lib/services.ts`) cut over to Circuit**:
  org-name entity extraction, org-fit synthesis, and account reranking now route
  through `@/lib/ai-provider/registry` → Circuit (no OpenAI SDK import remains in
  this flow), each with a deterministic fallback. KB retrieval uses deterministic
  local embeddings (Circuit has no embedding endpoint). Live-verified: synthesis
  and reranking both executed on Circuit and produced org-specific output.
- **Stage D wired into message delivery (Phase 7a)**: `applyAiMessageSynthesis`
  prefers Circuit `ai_trace.stage_d` drafts over the legacy OpenAI synthesis and
  the deterministic builder, but only when they pass the same delivery quality
  gate (`@/lib/webex/messageQuality`); otherwise it falls back. Stage D is fed
  the real deterministic opportunity brief and prompted for the exact gate
  skeleton (no fabrication). Live-verified: the preview delivered Circuit Stage D
  content (`synthesized_by_ai: true`).
- **Attendance-aware message routing + modes (Phase 7b)**: the meeting
  participation matrix (`@/lib/meeting-participation`) + team roster
  (`@/lib/team-routing`) derive a per-recipient attendance status and message
  MODE (action delta vs full/contextual handoff), frame each message, annotate
  the delivery results, and order auto-sends by mode. Additive and
  non-authoritative for recipient SELECTION — the Peachtree lane recipients are
  unchanged; attendance only changes HOW each is addressed and the send order.
  Live-verified: a rep who spoke → `ATTENDEE_ACTION_DELTA`, an absent owner →
  `UNKNOWN_CONTEXTUAL_HANDOFF`.

Remaining (tracked, not yet done):
1. Route the remaining Signal-to-Action OpenAI call sites
   (`src/lib/qualification/openai*.ts`, `src/lib/openai/*`,
   `src/lib/signal-agent/openaiSynthesis.ts`) through the provider registry or
   remove them in favor of the Circuit stages + deterministic engine.
3. Remove OpenAI runtime/labels/config/UI and run `npm uninstall openai` once no
   active imports remain (rename residual `openai`/`OPENAI_*` identifiers).
4. Point the Setup/status UI at Circuit provider diagnostics.
