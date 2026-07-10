# Gong-to-Circuit Signal-to-Action Agent — POC Instructions

## Objective

Build a local proof-of-concept agent that takes a customer call transcript, detects a buying-signal pain point, verifies whether the signal is a real opportunity by cross-referencing structured account data, and, if real, enriches and routes an internal notification to the correct specialist.

This is a local POC of the enterprise architecture shown in the diagram:

Sources → customer lookup / email triage → promote trigger → AI evaluation → notify sales members → specialist and messaging actions.

> **Workspace note:** this POC lives in `signal-agent-poc/` (rather than the outer repo root) because the outer workspace already hosts an unrelated Next.js application with its own `README.md`, `.env.example`, and `.gitignore`. Every path below is relative to `signal-agent-poc/`, which is this POC's project root. See `../README.md` for a one-line pointer.

## Ground Rules

These rules are constants. Do not override them at runtime.

1. Operate only on local files under `data/`, `config/`, `skills/`, and the root runner files (all relative to this POC's root, `signal-agent-poc/`).
2. Never contact the customer.
3. Notifications are internal only.
4. Read operations and write/notify operations must remain separated.
5. Skills 1–5 are read-only.
6. Only `skills/notify.py` may write records or simulate sending a message.
7. Start with console notification only.
8. Do not call Webex, Outlook, Salesforce, Gong, Cisco, or any unexposed enterprise endpoint.
9. Do not hard-code secrets.
10. Store runtime keys only in `.env`.
11. Add `.env` to `.gitignore`.
12. Do not print API key values, partial key values, prefixes, suffixes, or key lengths.
13. If evaluation is `NOISE`, stop and log the reason. Do not notify anyone.
14. Every run must append a record to `data/output/signal_log.jsonl`.

## Inputs

The POC uses local stand-ins for enterprise systems.

| Enterprise system | POC stand-in |
|---|---|
| Gong call transcript / call tracker | `data/transcripts/*.txt` |
| Salesforce / super graph | `data/accounts.csv` |
| Pain-point dictionary | `config/painpoint_solution_map.json` |
| Specialist routing table | `config/specialists.csv` |
| Intent thresholds | `config/thresholds.json` |
| Webex / Outlook action | Console print first, CLI stub later |

## Required Folder Structure

```text
signal-agent-poc/
├── INSTRUCTIONS.md
├── ARCHITECTURE.md
├── README.md
├── .gitignore
├── .env.example
├── run_signal_agent.py
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
│       └── signal_log.jsonl
├── skills/
│   ├── __init__.py
│   ├── ingest_transcript.py
│   ├── detect_painpoint.py
│   ├── lookup_account.py
│   ├── evaluate_intent.py
│   ├── lookup_specialist.py
│   └── notify.py
└── tests/
    ├── test_high_intent.py
    ├── test_noise.py
    └── test_output_schema.py
```

## Skill Contracts

Each skill must expose one primary function. Keep each file small and single-purpose.

### 1. `skills/ingest_transcript.py`

Read-only.

Input:

```json
{"transcript_path": "str"}
```

Output:

```json
{
  "account": "string | null",
  "participants": ["string"],
  "candidate_pain_language": ["string"],
  "raw_excerpt": "string"
}
```

Responsibilities:

- Read the transcript.
- Extract account name.
- Extract participants if present.
- Extract candidate pain-point language.
- Do not classify intent here.
- Do not write files.

### 2. `skills/detect_painpoint.py`

Read-only.

Input:

```json
{"ingested_transcript": "dict", "painpoint_solution_map_path": "str"}
```

Output:

```json
{
  "pain_point": "string | null",
  "solution": "string | null",
  "match_confidence": "high | medium | low | none",
  "confidence_note": "string",
  "matched_terms": ["string"]
}
```

Responsibilities:

- Load `config/painpoint_solution_map.json`.
- Compare transcript language against dictionary entries.
- Use deterministic keyword/phrase matching first.
- Optionally use OpenAI only if `OPENAI_API_KEY` is configured.
- If OpenAI is unavailable, continue with deterministic matching.
- Do not invent pain points.
- Do not write files.

### 3. `skills/lookup_account.py`

Read-only.

Input:

```json
{"account_name": "str", "accounts_csv_path": "str"}
```

Output:

```json
{
  "account": "string",
  "matched": true,
  "open_opportunity": true,
  "stage": "string",
  "deal_value": 0,
  "install_base": ["string"],
  "budget_signal": "string | null"
}
```

Responsibilities:

- Load `data/accounts.csv`.
- Normalize account names for matching.
- Pull opportunity, stage, deal value, install base, and budget signal.
- Return `matched: false` if no account is found.
- Do not write files.

### 4. `skills/evaluate_intent.py`

Logic only.

Input:

```json
{"painpoint_result": "dict", "account_result": "dict", "thresholds_path": "str"}
```

Output:

```json
{
  "verdict": "HIGH_INTENT | NOISE",
  "why": "string",
  "corroborating_signals": ["string"],
  "score": 0
}
```

Responsibilities:

- Load `config/thresholds.json`.
- Mark `HIGH_INTENT` only when:
  - a pain point maps to a solution, and
  - at least one corroborating structured signal exists:
    - open opportunity,
    - explicit budget signal,
    - or matching install base.
- Otherwise mark `NOISE`.
- Explain the decision with evidence.
- Do not write files.

### 5. `skills/lookup_specialist.py`

Read-only.

Input:

```json
{"solution": "str", "specialists_csv_path": "str"}
```

Output:

```json
{
  "specialist": "string",
  "role": "string",
  "channel": "console | webex | outlook",
  "handle": "string",
  "routing_reason": "string"
}
```

Responsibilities:

- Load `config/specialists.csv`.
- Match mapped solution to a specialist owner.
- Return the configured channel and handle.
- Do not send a message.
- Do not write files.

### 6. `skills/notify.py`

Write/notify skill.

Input:

```json
{"context": "dict"}
```

Output:

```json
{
  "channel": "console | webex | outlook",
  "notification_text": "string",
  "logged": true,
  "log_path": "data/output/signal_log.jsonl"
}
```

Responsibilities:

- Draft the internal notification.
- Include:
  - what happened,
  - why the signal is legitimate,
  - corroborating account data,
  - customer/deal snapshot,
  - recommended next step,
  - specialist owner.
- If channel is `console`, print only the internal notification.
- Leave TODO stubs for Webex and Outlook CLI integrations.
- Append one JSONL record to `data/output/signal_log.jsonl`.
- Never contact the customer.

## End-to-End Steps

The entry script `run_signal_agent.py` must execute this spine:

1. Select a transcript from `data/transcripts`.
2. Ingest transcript.
3. Detect pain point.
4. Look up account.
5. Evaluate intent.
6. If verdict is `NOISE`:
   - write a log record,
   - print the JSON result,
   - stop.
7. If verdict is `HIGH_INTENT`:
   - look up specialist,
   - draft notification,
   - route via console,
   - append JSONL audit record,
   - print final JSON result.

## Output Schema

Every run must print exactly one final JSON object matching this shape:

```json
{
  "account": "...",
  "pain_point": "...",
  "solution": "...",
  "verdict": "HIGH_INTENT | NOISE",
  "why": "...",
  "specialist": "...",
  "channel": "...",
  "notification_text": "...",
  "timestamp": "..."
}
```

For `NOISE`, `specialist`, `channel`, and `notification_text` may be `null`, but the log record must still exist.

## Demo Data Requirements

Two transcripts:

### HIGH_INTENT transcript

The customer says something close to:

> We need a centralized orchestrator for all these hubs. Every team has their own tool, and we cannot coordinate actions across the environment.

The account must exist in `data/accounts.csv` and must have at least one corroborating structured signal, such as an open opportunity, budget signal, or matching install base.

### NOISE transcript

The customer mentions general curiosity or broad market interest but no mapped pain point or corroborating structured signal.

## Suggested Pain-Point Map

Keep the demo dictionary small.

```json
[
  {
    "pain_point": "fragmented collaboration and tool sprawl",
    "phrases": [
      "centralized orchestrator",
      "all these hubs",
      "coordinate actions",
      "tool sprawl"
    ],
    "solution": "Cisco Collaboration Orchestration"
  },
  {
    "pain_point": "security operations overload",
    "phrases": [
      "too many alerts",
      "cannot triage incidents",
      "security operations backlog"
    ],
    "solution": "Cisco XDR"
  },
  {
    "pain_point": "network visibility gaps",
    "phrases": [
      "no visibility",
      "hard to see traffic",
      "blind spots"
    ],
    "solution": "Cisco ThousandEyes"
  }
]
```

## Notification Format

For `HIGH_INTENT`, notification text must be human-readable and internal.

Required structure:

```text
Signal detected: [pain point]

Account: [account]
Mapped solution: [solution]
Why now: [corroborating evidence]
Deal snapshot: [stage, value, install base, budget signal]
Recommended action: [specific internal next step]
Owner: [specialist, role, handle]

Do not contact the customer directly from this automation.
```

## Verification

The project is complete only when these checks pass (run from `signal-agent-poc/`):

```bash
python run_signal_agent.py --transcript data/transcripts/high_intent_orchestrator.txt
python run_signal_agent.py --transcript data/transcripts/noise_general_interest.txt
python -m pytest
```

Acceptance criteria:

- HIGH_INTENT transcript routes to the correct specialist.
- HIGH_INTENT transcript prints a notification.
- NOISE transcript does not notify anyone.
- Both runs append to `data/output/signal_log.jsonl`.
- Final output is valid JSON.
- No API keys are hard-coded.
- `.env` is ignored by git.
- Webex and Outlook integrations are stubs only.
- No unexposed enterprise endpoints are referenced.
- Each skill file has one clear responsibility.
