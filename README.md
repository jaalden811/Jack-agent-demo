# Cisco Market + Buyer Intelligence Agent

A Next.js + TypeScript web app for Cisco market and buyer intelligence. Users enter a Cisco product, market segment, optional geography/company size/seed accounts, and optional Cisco/product/partner knowledge-base files. The app returns ranked account recommendations with buyer-role hypotheses, public-source evidence, confidence scoring, exports, and explicit missing-data warnings.

## Integrity defaults

- Public-source-only research by default.
- No invented emails, phone numbers, people, titles, or pain points.
- Contact enrichment is disabled unless licensed provider credentials are configured.
- If a person or contact detail cannot be verified, the app returns role/persona-level recommendations and a do-not-invent flag.
- Uploaded KB evidence is labeled separately from public market evidence.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Environment variables

Required for verified live provider-backed runs:

```bash
SEARCH_API_KEY=
SEARCH_PROVIDER=tavily # tavily, brave, exa, or serpapi
```

Generative AI is provided by **Circuit** (the only active AI provider) and is an
**optional enhancement layer** — entity extraction, org-fit synthesis, and
account reranking use Circuit when configured and fall back to the deterministic
engine when it is not. KB semantic retrieval always uses deterministic local
embeddings (Circuit exposes no embedding endpoint). See `.env.example` for the
full `CIRCUIT_*` block:

```bash
AI_PROVIDER=circuit
CIRCUIT_CLIENT_ID=...
CIRCUIT_CLIENT_SECRET=...
CIRCUIT_APP_KEY=...
CIRCUIT_TOKEN_URL=...
CIRCUIT_INFERENCE_URL=...        # {model} placeholder substituted with CIRCUIT_MODEL
CIRCUIT_MODEL=...
CIRCUIT_CONTRACT_CONFIRMED=true  # gate: no live token/inference call until confirmed
```

Expected `.env.local` shape:

```bash
SEARCH_API_KEY=...
SEARCH_PROVIDER=tavily
FIRECRAWL_API_KEY=...
HUNTER_API_KEY=
PEOPLE_DATA_LABS_API_KEY=
CLEARBIT_API_KEY=
# plus the CIRCUIT_* block above for generative AI
```

Recommended:

```bash
FIRECRAWL_API_KEY=
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Optional licensed contact enrichment:

```bash
HUNTER_API_KEY=
PEOPLE_DATA_LABS_API_KEY=
CLEARBIT_API_KEY=
```

App auth placeholders:

```bash
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
```

Do not commit `.env.local`. Cursor MCP configurations should pass secrets with env interpolation such as `${env:SEARCH_API_KEY}` rather than hardcoded values.

## Provider diagnostics and fallback runs

The app shows provider diagnostics before research starts:

- **Ready**: provider key is configured and the feature can run.
- **Missing required provider**: verified live research cannot run without this key.
- **Missing optional provider**: the app can run, but some evidence/contact fields will be lower confidence.
- **Fallback mode active**: one or more required providers are missing; results are explicitly unverified.

If `SEARCH_API_KEY` is missing, only seed/demo accounts can be returned and the run is labeled **Unverified fallback run**. If **Circuit** is not configured, the deterministic engine handles entity extraction, synthesis, and reranking — the run is still valid (Circuit is an optional enhancement, not a required provider) and does not force fallback mode. KB semantic retrieval always uses deterministic local embeddings. If `FIRECRAWL_API_KEY` is missing, evidence remains snippet-only and the app does not claim full-page verification.

After adding real API keys to `.env.local`, rerun old fallback results with the **Rerun with configured APIs** button. Reruns create a new research run using the current providers; old fallback evidence remains visible and is not silently overwritten.

## Verified vs unverified results

- Verified/live runs require a configured search provider. Circuit (generative AI) is an optional enhancement layer, not a requirement for a verified run.
- Full-page evidence requires Firecrawl extraction.
- Snippet-only evidence is labeled and receives lower confidence.
- Every account recommendation includes evidence URLs or clear low-confidence/fallback warnings.
- Named people, emails, phone numbers, and profile URLs are never invented.

## Contact enrichment compliance

Contact enrichment is optional and must use licensed/compliant provider credentials. The app only displays verified business emails when a licensed provider or public source supports the claim. Without a configured provider, the app returns role/persona-level guidance and displays "No verified contact found."

## Data model

The pgvector-ready Supabase schema is in `supabase/schema.sql` and includes:

- `research_runs`
- `kb_documents`
- `kb_chunks`
- `accounts`
- `contacts`
- `evidence`

The app currently persists development runs to `.data/research-runs.json` so it works without database credentials. The service boundary is isolated in `src/lib/storage.ts` for replacing local JSON with Supabase queries.

## Architecture

- UI: `src/app/page.tsx`, `src/components/ResearchWorkspace.tsx`
- API routes:
  - `POST /api/research`
  - `GET /api/research/:runId`
  - `GET /api/research/:runId/export?format=json|csv|md`
  - `POST /api/knowledge-base`
- Services: `src/lib/services.ts`
  - `productCapabilityMapper`
  - `retrieveKbContext`
  - `searchMarketAccounts`
  - `collectEvidence`
  - `personRoleIdentifier`
  - `contactEnricher`
  - `confidenceScorer`
  - `generateReport`

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Manual happy path:

1. Start the app.
2. Enter `Cisco XDR` and `healthcare`.
3. Add seed accounts if `SEARCH_API_KEY` is not configured.
4. Upload a `.txt`, `.md`, `.csv`, or `.docx` KB file.
5. Run research.
6. Confirm results include confidence scores, evidence, KB influence, exports, and missing-data warnings for unverifiable contacts.
7. If the run is labeled fallback, add provider keys and use **Rerun with configured APIs**.

## Known limitations

- PDF extraction is conservative in this serverless-compatible scaffold and should be replaced with a vetted production parser or extraction service.
- Firecrawl and contact enrichment provider clients are behind capability checks; production implementations should only accept provider results that include verification evidence.
- Supabase persistence is documented and schema-ready, while local JSON persistence is used for development.
- The landing page references `/jack.jpg`; place the attached image at `public/jack.jpg`.
