---
name: run-signal-to-action-demo
description: Start the app and run the three Signal-to-Action demo cases (high intent, high signal / incomplete context, noise), validating the six-stage spine end to end without auto-sending real messages.
---

# Run the Signal-to-Action demo

Use this to demonstrate the north star — *every important customer conversation leads to timely, coordinated action* — across three synthetic, generic cases. Never auto-sends real Webex/Outlook messages unless explicitly enabled.

## Safety

- Keep `deliverToWebex`/auto-send OFF for the demo (preview only) unless the operator explicitly opts in.
- Use only the synthetic transcripts in `signal-agent-poc/data/transcripts/` (or inline synthetic text). Never paste a real customer transcript.
- Never print API key values.

## Steps

1. **Start the app** on port 3010:
   - `Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force`
   - `Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue`
   - `npm.cmd run dev -- --port 3010`
   - Open `http://localhost:3010/signal-agent`.

2. **Run the three demo cases** (POST to `/api/signal-agent/run` with `options.deliverToWebex=false`, or paste in the UI):
   - **A — HIGH INTENT:** a synthetic transcript with meaningful pain, quantified impact, funding, timing/renewal, and a next step, plus an explicit `Account:` line → expect `HIGH_INTENT`, account resolved, PURSUE or PURSUE_WITH_DISCOVERY, both Bella + Jack lanes.
   - **B — HIGH SIGNAL / INCOMPLETE CONTEXT:** the same strong signal but with NO account line → expect `HIGH_INTENT`, account `unresolved`, **PURSUE_WITH_DISCOVERY** (not NURTURE), an account-confirmation action, technical discovery proceeding.
   - **C — NOISE:** generic curiosity, no material signal → expect `NOISE`, no lane routed, suppression logged, nothing delivered.

3. **Validate the architecture stages** for each run from the result JSON:
   - `transcript_diagnostics` (capture), `executive_summary.verdict` (evaluate), `account_resolution` (context), `opportunity_scoring.signal_strength` / `.deal_maturity` / `.qualification_completeness` / `.decision` (prioritize), `peachtree.routing` (owner), `peachtree.delivery` (deliver), `run_id` + audit (audit).
   - Confirm the score dimensions are shown distinctly (signal strength ≠ pursuit recommendation).
   - Confirm the Signal-to-Action journey renders solid stages for executed capability and dashed for planned adapters.

4. **Capture screenshots** of: the journey spine, the score-semantics summary, the Bella and Jack messages (materially different), and the NOISE suppression state.

5. **Report pass/fail** per case against the expectations above. Do not trust prior claims — read the actual result JSON and rendered UI.

## Presenter script (short)

> A customer raises a meaningful signal on a call. The system detects it, filters noise, checks intent, resolves the account, gathers public context, picks the right specialist, recommends the next action, delivers it in minutes, and records exactly what happened — so no signal loses momentum.
