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

Required for live provider-backed runs:

```bash
OPENAI_API_KEY=
SEARCH_API_KEY=
SEARCH_PROVIDER=tavily # tavily, brave, exa, or serpapi
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

## Known limitations

- PDF extraction is conservative in this serverless-compatible scaffold and should be replaced with a vetted production parser or extraction service.
- Firecrawl and contact enrichment provider clients are behind capability checks; production implementations should only accept provider results that include verification evidence.
- Supabase persistence is documented and schema-ready, while local JSON persistence is used for development.
