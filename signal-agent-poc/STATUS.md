# Signal-to-Solution Triage — Project Status Log

This is the canonical running status/notepad for the Signal-to-Solution
Triage feature (Next.js app under `src/`, Python POC under
`signal-agent-poc/`). No other status/notepad file exists for this
project — append new dated entries here rather than creating a second
one.

## 2026-07-13 — Provider, OAuth, and transcript-analysis repair

### Evidence observed

- Webex basic OAuth succeeded.
- `spark:people_read` succeeded.
- `spark:messages_write` succeeded.
- `meeting:schedules_read` succeeded.
- `meeting:transcripts_read` was the first and only rejected scope.
- Webex client ID, client secret, redirect URI, and requested scope configuration were present.
- No public webhook URL was configured.
- Webhook registration and transcript autopilot were therefore unavailable.
- OpenAI was configured with `text-embedding-3-small` as the displayed model.
- OpenAI embeddings and synthesis were both unavailable, and the provider test returned `request rejected`.
- A timestamped customer transcript analyzed successfully through fallback logic, but participant count was `0`.
- The analysis failed to populate named stakeholders despite names, titles, and ownership statements in the transcript.
- The result selected Splunk Observability Cloud but represented the opportunity too narrowly as cloud-native application and infrastructure observability.

### Root causes

1. Webex transcript scope was incorrectly treated as mandatory for the entire Webex connection.
2. `meeting:transcripts_read` is optional and was not accepted by the current Webex Integration registration.
3. Local webhook automation cannot operate without a public HTTPS callback.
4. OpenAI embedding and synthesis configuration were conflated into one model field.
5. An embedding-only model was being used or tested as though it could perform synthesis.
6. The transcript parser did not reliably recognize timestamped speaker turns and participant headers.
7. Stakeholder extraction did not distinguish participants, explicitly named owners, and inferred functional owners.
8. Deterministic fallback preserved basic classification but produced an overly shallow result.

### Decisions

- Preserve the normalized Webex scope parser.
- Keep core Webex OAuth independent from optional transcript permission.
- Treat transcript access as a separately enabled capability.
- Preserve preview-only outbound delivery.
- Require a real public HTTPS URL before webhook registration.
- Add a manual transcript-import path for local development.
- Separate OpenAI embedding and synthesis models and diagnostics.
- Preserve deterministic analysis when OpenAI capabilities are unavailable.
- Keep all product and routing logic config-driven.
- Never fabricate a named stakeholder.
- Permit evidence-backed functional-owner inference.
- Keep the existing Next.js application and Python POC intact.

### Required manual actions

- Edit the Webex Integration and select `meeting:transcripts_read`.
- Save/update the Webex Integration after changing scopes.
- Reset the application's stored Webex OAuth state.
- Reconnect and verify the granted-scope response.
- Configure a public HTTPS callback before attempting Webex webhook autopilot.
- Configure separate OpenAI embedding and synthesis model settings.
- Re-run the independent OpenAI embedding and synthesis tests.

### Acceptance state

- Core Webex connection works without transcript access.
- Transcript permission failure no longer blocks outbound Webex functionality.
- Transcript autopilot remains disabled until transcript scope and webhook prerequisites are satisfied.
- OpenAI diagnostics identify embedding and synthesis failures independently.
- Timestamped transcripts populate participants and customer stakeholders.
- Analysis output distinguishes named stakeholders from inferred functional owners.
- End-to-end analysis remains functional through deterministic fallback.

### Implementation notes (this session)

- Webex: `spark:people_read` + `spark:messages_write` + `meeting:schedules_read` are now the required "core" scope set (`@/lib/webex/scopePolicy`); `meeting:transcripts_read` is requested only by the new, separate "Enable transcript access" flow (`GET /api/webex/oauth/enable-transcripts`). A rejection there is classified as `transcript_scope_rejected` with the exact instruction: *"Core Webex OAuth works, but transcript access was rejected. Edit the Webex Integration, enable meeting:transcripts_read, save the integration, reset OAuth state, and reconnect."* Autopilot, webhook registration, and manual transcript import are all separately gated on the transcript scope actually being granted (never merely on "core OAuth succeeded"). `GET /api/webex/status` now returns a `capabilities` object (`core_oauth`, `identity`, `messaging`, `meeting_schedules`, `meeting_transcripts`, `manual_transcript_import_available`, `outbound_delivery_available`) instead of one binary connected flag.
- OpenAI: added `OPENAI_SYNTHESIS_MODEL` (default `gpt-4o-mini`, with `OPENAI_MODEL` accepted as a backward-compatible alias) alongside the existing `OPENAI_EMBEDDING_MODEL`. Synthesis now calls the Responses API with the synthesis model; embeddings continue to call the embeddings endpoint with the embedding model — the two capabilities are tested and can fail independently (`@/lib/signal-agent/openaiStatus`: `checkOpenAiAuthentication`, `checkOpenAiEmbeddings`, `checkOpenAiSynthesis`, each returning a sanitized `{http_status, error_type, error_code, message}` — never the key). `SecureNetworkingTriageResult.providers.analysis_mode` reports which capability combination produced the result (`deterministic` / `embeddings_assisted` / `synthesis_assisted` / `embeddings_and_synthesis`).
- Transcript parsing: `@/lib/signal-agent/transcript#ingestTranscript` now recognizes `[MM:SS] Name:`, `MM:SS — Name:`, `MM:SS - Name:`, the legacy `[Name]:`, and plain `Name:` speaker-turn formats, plus standalone `Name — Title` / `Name (Title)` participant-header lines, building a structural `ParticipantRecord[]` (title, organization, customer/vendor/internal classification, turn count, first/last evidence index) — never inferring a Cisco seller as a customer owner regardless of how often they spoke.
- Stakeholders: `@/lib/signal-agent/stakeholderExtraction` implements the three-tier model — call participants, explicitly named stakeholders (a titled or speaking customer participant), and inferred functional owners (a generic organizational-function mention with no named individual — `name` is always `null` there, never fabricated).
- Added a realistic multi-stakeholder fixture transcript (`signal-agent-poc/data/transcripts/cross_domain_data_platform_deal_signal.txt`, demo id `cross_domain_data_platform`) and end-to-end acceptance tests confirming: not NOISE, correct participant count, named stakeholders across reliability/applications/infrastructure/security/security-architecture/finance-vendor-management, inferred enterprise-architecture/cloud-platform functional owners, the $1.8M impact, October/January/March dates, the 20-minute proof-of-value target, a multi-label result (primary: cloud-native observability; secondary: SIEM/data platform; supporting: SOC detection & response) grounded in real transcript evidence, and that the Cisco seller is never labeled a customer decision owner.

## 2026-07-14 — SerpAPI enrichment, OpenAI qualification pipeline (MEDDPICC, evidence-backed messages), and the dead "Open full analysis" link fix

### Dead-link root cause and fix

The "Open full analysis" link previously built by `@/lib/webex/messageBuilder#analysisUrl` pointed at `/signal-agent?run=<id>` — a route/query-param combination the app never read anywhere, so the link would 404/no-op even when reachable — and, whenever `WEBEX_PUBLIC_BASE_URL` was unset (the default), it degraded to a bare relative path (`/signal-agent?run=...`), which can never resolve for a remote Webex/Outlook recipient (it resolves relative to whatever page/app they're viewing it from).

Fix, end to end:
- New config: `APP_PUBLIC_BASE_URL`, `SIGNAL_SHARE_LINK_TTL_HOURS` (default 168), `SIGNAL_SHARE_LINK_SECRET`.
- `@/lib/signal-agent/publicUrl`: rejects any base URL that is not HTTPS, or resolves to `localhost`, `127.0.0.1`, `0.0.0.0`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`, IPv6 loopback/ULA/link-local, or a `.local`/`.internal` hostname — checked both on the configured base URL and again on the fully-constructed URL (defense in depth).
- `@/lib/signal-agent/shareLink`: HMAC-SHA256-signed, JSON-encoded (never a naive delimiter split, so a run ID or ISO timestamp containing "." or ":" can't corrupt parsing), expiring read-only token.
- `@/lib/signal-agent/resultStore`: persists each completed run as local JSON (`.data/signal-agent-results/<runId>.json` via `LOCAL_DATA_DIR`, matching the existing Webex-store/audit-log pattern) — this codebase has no wired-up Supabase client/schema despite `SUPABASE_URL` being an accepted env var, so local disk is the persistence layer for this single-process deployment; a future multi-instance deployment should replace this module's two functions with a real DB-backed implementation without changing callers.
- `@/lib/signal-agent/analysisLink#buildAnalysisLink`: the exact 7-step checklist — validate base URL → compute expiry → persist → sign → construct → re-validate the constructed URL → only then `included: true`. Returns a specific machine-readable `reason` (`no_public_base_url` / `validation_failed` / `persistence_failed` / `public_url_ready`) on every outcome.
- New public, read-only page: `src/app/signal-agent/results/[runId]/page.tsx` — verifies the token before rendering anything, shows executive summary/account resolution/MEDDPICC/stakeholders/architecture/public evidence/sales+technical next actions/source trace/delivery status, and renders a clear error for a missing/invalid/expired token instead of leaking or crashing.
- `@/lib/webex/messageBuilder`: `[Open full analysis](url)` is rendered only when `analysis_link.included && analysis_link.url`; otherwise the message uses the plain-text `**Analysis reference:** Run \`{runId}\`` — never a dead or relative hyperlink, matching the spec's exact fallback text.
- Verified live end-to-end against a running dev server (see "Verification performed" below).

### New capabilities

- **SerpAPI connector** (`src/lib/connectors/serpapi/`: `client`, `queryPlanner`, `resultNormalizer`, `sourceScoring`, `signalExtractor`, `canonicalUrl`, `errorMapping`, `cache`, `runEnrichment`, `types`) — a dedicated connector for the qualification pipeline, reusing the existing `SEARCH_PROVIDER=serpapi` / `SEARCH_API_KEY` (no second key variable). Queries are generated only from real transcript signals (account/stakeholder candidates, detected products, incident/competitor mentions, lifecycle stage) — never a generic dump, never run for `Unknown`/demo accounts or a `NOISE` verdict, capped at 8 queries/run with a 24h application cache. The existing generic multi-provider search client (`@/lib/services`, used by the separate Cisco Market Intel research app) and the legacy `@/lib/signal-agent/publicSignals#fetchPublicSignals` (still populating `result.public_signals`) are both untouched.
- **OpenAI qualification pipeline** (`src/lib/qualification/`): Stage A (`openaiEvidenceExtraction.ts`) extracts a structured, evidence-ID-linked opportunity record from the transcript via the Responses API with strict Structured Outputs; Stage B (`openaiPublicEvidence.ts`) classifies only normalized SerpAPI candidates (never the raw response, never an invented URL); Stage C (`meddpiccMerge.ts`, deterministic code, not a model call) merges Stage A's MEDDPICC with Stage B's public evidence, mechanically enforcing that public evidence can never upgrade Economic Buyer/Champion/Metrics/Decision Process/Paper Process (only Identify Pain/Decision Criteria/Competition may move from MISSING to PARTIAL, never to CONFIRMED); Stage D (`openaiMessageSynthesis.ts`) drafts the four lane-specific Webex/email messages from the structured qualification object. `@/lib/qualification/accountResolution` implements the documented 7-source identity-resolution priority order and blocks generic/demo names from broad enrichment. Every stage degrades independently and safely (a specific `fallback_reason` is recorded) when OpenAI/SerpAPI is unavailable — deterministic taxonomy scoring, routing, and delivery are never blocked.
- `SecureNetworkingTriageResult` gained `run_id`, `account_resolution`, `meddpicc`, `public_enrichment`, `ai_processing`, `analysis_link`.
- `webex/automation.ts#applyAiMessageSynthesis` swaps in Stage D content only after it validates (non-empty, under a hard length ceiling, no localhost link, no link when none was authorized) — any failure falls back to the existing deterministic templates without blocking delivery.
- New "Sources & enrichment" UI tab: OpenAI stage-by-stage trace, account resolution, full SerpAPI query trace (purpose/query/results/accepted/rejected/latency/cache/error), every accepted public source with its score and snippet, and the analysis-link status/reason. The public-enrichment toggle now defaults ON once SerpAPI is confirmed usable (never overriding an explicit user choice).

### Verification performed

- `npm test`: 395/395 passing. `npm run typecheck`: clean. `npm run lint`: clean (one pre-existing, unrelated warning). `npm run build`: clean, `/signal-agent/results/[runId]` compiles as a dynamic route.
- Live dev-server verification (no browser tool available in this environment, verified via HTTP): with `APP_PUBLIC_BASE_URL=https://demo.example.com`, a real analysis produced a working `analysis_link` whose URL loaded the correct account/MEDDPICC/evidence on `/signal-agent/results/[runId]`, and distinct sales vs. technical Webex messages were generated. With `APP_PUBLIC_BASE_URL=https://localhost:3010`, the link was correctly rejected (`reason: validation_failed`) and the message used the plain-text run reference instead. Missing/garbage/nonexistent-run tokens each rendered a clear "invalid" message instead of crashing or leaking data. Regression-tested against the existing `cross_domain_data_platform` fixture: account resolves to "Meridian Health Systems" (97% confidence, from the transcript's own Account: line + a CRM match — not fabricated), Metrics and Identify Pain are CONFIRMED, Economic Buyer is MISSING and Champion is HYPOTHESIS (never CONFIRMED from title/participation alone), and SerpAPI correctly reports `configured: false` in this environment (no `SEARCH_API_KEY` set).
- An independent verifier subagent reviewed all 14 acceptance criteria from the implementation spec (query-planning grounding, search gating, Structured Outputs usage, evidence-ID enforcement, the public-evidence-can't-confirm-private-facts rule, no stakeholder overclaiming, distinct sales/technical messages, auto-send/fallback safety, no dead/localhost links, correct private-IP-range regex boundaries, token-gated read-only results page, full build/test/lint/typecheck, API contract completeness, and no API-key leakage) and returned 14/14 PASS with no FAIL/PARTIAL findings; one minor test-coverage nitpick (missing explicit 172.15/172.32 boundary assertions) was addressed by adding two boundary-case tests to `publicUrl.test.ts`.

### Known limitations / follow-ups

- Result persistence is local-JSON-file only (no Supabase wiring exists anywhere in this codebase to build on); this is correct for the current single-process deployment but should move to a real database before a multi-instance/serverless deployment.
- Stage D (message synthesis) and Stages A/B were not verified against a live OpenAI/SerpAPI account in this session (no API keys configured in this environment) — all code paths were exercised via their deterministic-fallback branches, which is the majority of the safety-critical logic (the MEDDPICC-never-confirms-private-facts rule, the dead-link fix, and the search-gating logic are all deterministic and were verified live). A follow-up run with real `OPENAI_API_KEY`/`SEARCH_API_KEY` values should confirm the Structured Outputs schemas validate against the live API and that generated message content reads well.
