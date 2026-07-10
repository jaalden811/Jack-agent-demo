# Signal-to-Action Agent — Local POC

A local, offline proof-of-concept for the enterprise **Signal-to-Action** orchestration architecture:

```
Sources → customer lookup / email triage → promote trigger
  → AI orchestration / evaluation (detect pain point → cross-check account data → classify)
  → Action fanout (specialist lookup → internal notification)
  → Audit record (signal_log.jsonl)
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full enterprise-to-POC mapping and [`INSTRUCTIONS.md`](./INSTRUCTIONS.md) for the ground rules, skill contracts, and acceptance criteria this POC was built against.

## What this POC does

1. Reads a local call-transcript file (`data/transcripts/*.txt`) — a stand-in for a Gong/Webex/Outlook signal.
2. Detects buying-signal pain language using deterministic keyword matching against `config/painpoint_solution_map.json` (OpenAI synthesis is optional and never required).
3. Cross-references a local `data/accounts.csv` — a stand-in for Salesforce / the account graph — for corroborating structured signals (open opportunity, budget signal, matching install base).
4. Classifies the signal as `HIGH_INTENT` or `NOISE` using `config/thresholds.json`.
5. If `HIGH_INTENT`: resolves the owning specialist from `config/specialists.csv`, drafts an **internal-only** notification, prints it to the console, and appends an audit record.
6. If `NOISE`: logs the reason and stops. **No one is notified.**
7. Every run — regardless of verdict — appends exactly one record to `data/output/signal_log.jsonl`.

This is intentionally console-only and file-based. No Webex, Outlook, Salesforce, Gong, or Cisco endpoint is ever called. See "Extension path" in `ARCHITECTURE.md` for how a real Webex/Outlook adapter would slot in behind `skills/notify.py` without changing the rest of the spine.

## Setup

Requires Python 3.10+. No third-party packages are required to run the demo.

```bash
cd signal-agent-poc
cp .env.example .env   # optional — only needed if you want OpenAI-assisted synthesis
python3 -m pip install -r requirements-dev.txt  # only needed to run the test suite
```

`.env` is already listed in `.gitignore` and is never read into logs or printed. `OPENAI_API_KEY` is entirely optional — the deterministic matcher in `skills/detect_painpoint.py` is the required fallback and is what the demo runs on by default.

## Run the demo

From inside `signal-agent-poc/`:

```bash
# HIGH_INTENT: a real buying signal with corroborating account data
python3 run_signal_agent.py --transcript data/transcripts/high_intent_orchestrator.txt

# NOISE: general interest with no mapped pain point or corroboration
python3 run_signal_agent.py --transcript data/transcripts/noise_general_interest.txt
```

Each run prints exactly one final JSON object (the schema from `INSTRUCTIONS.md`) and appends one line to `data/output/signal_log.jsonl`.

## Run the tests

```bash
python3 -m pytest
```

The suite covers:

- `tests/test_high_intent.py` — the HIGH_INTENT transcript routes to the correct specialist, prints an internal notification, and logs the record.
- `tests/test_noise.py` — the NOISE transcript never notifies anyone but still logs the reason.
- `tests/test_output_schema.py` — the final JSON schema, read/write skill separation, `.env` hygiene, and the absence of hard-coded secrets or references to live enterprise endpoints.

## Project layout

```text
signal-agent-poc/
├── INSTRUCTIONS.md          # ground rules, skill contracts, acceptance criteria
├── ARCHITECTURE.md          # enterprise-to-POC architecture mapping
├── README.md                # this file
├── requirements.txt         # runtime deps (none — stdlib only)
├── requirements-dev.txt     # + pytest, for running tests
├── .env.example              # variable names only, no values
├── run_signal_agent.py       # entry point / orchestrator
├── config/
│   ├── painpoint_solution_map.json
│   ├── specialists.csv
│   └── thresholds.json
├── data/
│   ├── transcripts/
│   │   ├── high_intent_orchestrator.txt
│   │   └── noise_general_interest.txt
│   ├── accounts.csv
│   └── output/
│       └── signal_log.jsonl   # created/appended at runtime
├── skills/                    # one file, one responsibility
│   ├── ingest_transcript.py   # read-only
│   ├── detect_painpoint.py    # read-only
│   ├── lookup_account.py      # read-only
│   ├── evaluate_intent.py     # logic only
│   ├── lookup_specialist.py   # read-only
│   └── notify.py              # the only write/notify skill
└── tests/
    ├── test_high_intent.py
    ├── test_noise.py
    └── test_output_schema.py
```

## Read/write separation

Only `skills/notify.py` may write anything to disk or simulate sending a message. Every other skill is read-only and returns a plain dict — enforced by convention, by code review, and by `tests/test_output_schema.py::test_read_only_skills_do_not_write_files`.

## Extension path

- **Phase 2** — swap the console `print()` inside `skills/notify.py` for a real Webex CLI/API or Outlook CLI/Graph adapter. The `TODO` stubs (`_send_via_webex`, `_send_via_outlook`) mark exactly where this goes; the rest of the spine (ingest → detect → lookup → evaluate) does not change.
- **Phase 3** — replace `data/accounts.csv` with a call into an approved account-graph API, behind the same `lookup_account(account_name, ...)` signature.
- **Phase 4** — replace the local file drop in `data/transcripts/` with an event-driven trigger (e.g. a webhook that writes the transcript payload and invokes `run_signal_agent.run(...)`).
- **Phase 5** — package the evaluation + notification workflow as a Cursor skill/subagent for repeatable use across accounts.
