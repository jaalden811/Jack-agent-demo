# Cisco Market Intelligence Skill

Use this skill when building or running Cisco product + market account intelligence workflows.

## Workflow

1. Collect user inputs:
   - Cisco product
   - Target market or segment
   - Optional geography, company size, max results, seed accounts, and KB files
2. Ingest KB:
   - Extract text
   - Chunk content
   - Embed chunks
   - Retrieve relevant product-market context
3. Map Cisco product:
   - Capabilities
   - Value propositions
   - Pain categories
   - Buyer personas
4. Research market:
   - Search public sources
   - Fetch/store evidence when compliant
   - Identify account fit
5. Identify buyers:
   - Prefer verified public/licensed person evidence
   - Degrade to role/persona-level guidance when unverifiable
6. Score:
   - Fit
   - Pain evidence
   - Buyer identification
   - Contact verification
   - Overall confidence
7. Report:
   - Include source URLs, titles, dates/snippets, KB influence, confidence scores, outreach angle, and do-not-invent flags.

## Integrity requirements

- Do not invent contact data.
- Cite every claim or mark it unavailable.
- Keep optional provider behavior behind env-configured interfaces.
