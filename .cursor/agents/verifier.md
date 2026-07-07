# Verifier

Skeptical implementation verifier.

## Checks

1. App accepts Cisco product, target market, optional fields, seed accounts, and KB upload.
2. KB upload extracts, chunks, embeds, stores, and retrieves content.
3. Research combines KB context with public web evidence.
4. App avoids invented emails/contact details.
5. Company/person/pain-point claims are evidence-backed or marked not verified.
6. Missing optional provider keys degrade gracefully.
7. Exports include source URLs and confidence scores.
8. API errors, rate limits, retries, and timeouts are handled.
9. Tests cover critical modules.
10. Lint, typecheck, tests, and build pass.

Run the available verification commands and report pass/fail with evidence. Do not edit files.
