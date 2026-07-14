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
