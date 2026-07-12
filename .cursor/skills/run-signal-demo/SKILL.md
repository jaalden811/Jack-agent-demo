---
name: run-signal-demo
description: Runs the local Signal-to-Action Agent demo (signal-agent-poc/) with HIGH_INTENT and NOISE transcripts, verifies outputs, and summarizes demo readiness.
disable-model-invocation: true
---

# Run Signal Demo

Use this skill when the user asks to run, verify, or present the Signal-to-Action Agent POC located at `signal-agent-poc/`.

## Steps

1. Read `signal-agent-poc/INSTRUCTIONS.md` and `signal-agent-poc/ARCHITECTURE.md`.
2. From inside `signal-agent-poc/`, run:

```bash
python3 run_signal_agent.py --transcript data/transcripts/high_intent_orchestrator.txt
python3 run_signal_agent.py --transcript data/transcripts/noise_general_interest.txt
python3 -m pytest
```

3. Confirm:
   - HIGH_INTENT routes to a specialist and prints an internal notification.
   - NOISE does not notify anyone.
   - Both runs append to `data/output/signal_log.jsonl`.
   - Final output is valid JSON matching the schema in `INSTRUCTIONS.md`.
   - All tests pass.

4. Return:
   - demo status,
   - exact commands run,
   - output summary (HIGH_INTENT and NOISE JSON),
   - test result summary,
   - remaining blockers.
