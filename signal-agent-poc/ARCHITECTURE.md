# POC Architecture — Enterprise Signal-to-Action Flow

## Purpose

This POC mirrors the enterprise agent architecture from the diagram using local files and small Python modules.

The diagram has a left-to-right flow:

1. Enterprise systems provide raw and structured signals.
2. Lookup and triage normalize the signal.
3. A promote trigger sends the signal into an AI/evaluation layer.
4. The AI layer chooses whether to summarize, notify, look up specialists, post to Webex, or draft an email.
5. The system logs the action so no signal disappears.

## Enterprise-to-POC Mapping

| Enterprise layer | POC stand-in |
|---|---|
| Gong call / Smart Tracker / live customer signal | `.txt` transcript in `data/transcripts` |
| Salesforce account data | `data/accounts.csv` |
| Webex conversation context | Future adapter; not used in first run |
| Outlook email / `.doc` source | Future adapter; represented by transcript text for now |
| Super Graph / Hasura / federated account graph | Normalized local CSV |
| MCP evaluation layer | Local evaluation module reading `thresholds.json` |
| AI System for Sales / orchestrator | `run_signal_agent.py` driven by `INSTRUCTIONS.md` |
| Promote trigger | Intent threshold in `evaluate_intent.py` |
| Prioritization engine | Confidence + corroboration scoring |
| Specialist ownership | `config/specialists.csv` |
| Webex / Outlook notification | Console print first, CLI stub later |
| Native Gong record | `data/output/signal_log.jsonl` |

## Component Design

The design intentionally uses small modules. Each module maps to one box in the diagram.

```text
signal-agent-poc/
├── INSTRUCTIONS.md
├── ARCHITECTURE.md
├── README.md
├── run_signal_agent.py
├── config/
│   ├── painpoint_solution_map.json
│   ├── specialists.csv
│   └── thresholds.json
├── data/
│   ├── transcripts/
│   ├── accounts.csv
│   └── output/
│       └── signal_log.jsonl
├── skills/
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

## Data-Flow Spine

### Logical Flow

**1. Ingest**

Read transcript. Extract:

- account name,
- participants,
- candidate pain language,
- useful excerpt.

This maps to the diagram's customer/email triage boxes.

**2. Detect Pain Point**

Compare transcript language against `config/painpoint_solution_map.json`.

Return:

- detected pain point,
- mapped solution,
- confidence note,
- matched terms.

This maps to the AI evaluation layer.

**3. Cross-Reference Account Data**

Look up the account in `data/accounts.csv`.

Pull:

- open opportunity,
- stage,
- deal value,
- install base,
- budget signal.

This maps to Salesforce / super graph / customer lookup.

**4. Evaluate Intent**

Apply `config/thresholds.json`.

A signal is `HIGH_INTENT` only when:

- a pain point maps to a solution, and
- structured data corroborates the signal.

Otherwise, mark `NOISE`.

This maps to the promote trigger.

**5. Resolve Specialist**

Map solution to owner in `config/specialists.csv`.

This maps to specialist lookup.

**6. Notify**

For POC v1:

- print to console,
- append JSONL log.

For POC v2:

- replace console with Webex CLI or Outlook CLI action,
- keep the same `notify.py` interface.

This maps to Webex post, internal email, and notify-sales-member actions.

## Design Principles

### Read/write separation

Read-only modules:

- `ingest_transcript.py`
- `detect_painpoint.py`
- `lookup_account.py`
- `evaluate_intent.py`
- `lookup_specialist.py`

Write-capable module:

- `notify.py`

Only `notify.py` can append to `signal_log.jsonl` or simulate a send.

### Least privilege

No admin scopes. No customer outreach. No direct enterprise endpoints in POC v1.

### Deterministic first

The first pass should work without OpenAI. OpenAI can be optional for better synthesis, but deterministic keyword matching must remain the fallback.

### Trigger-as-agent

In the POC, a human drops a transcript into `data/transcripts`. Later, the same instruction payload can become the trigger payload for an event bridge.

### Recoverability

Every run appends to `signal_log.jsonl`, including NOISE runs.

### Swappable adapters

Future adapters should not change the core evaluation spine.

Potential future interfaces:

```python
class TranscriptSource:
    def fetch_transcript(self) -> str: ...

class AccountGraph:
    def lookup_account(self, account_name: str) -> dict: ...

class NotificationChannel:
    def send(self, message: str, recipient: str) -> dict: ...
```

## POC Runtime

Primary run command (from `signal-agent-poc/`):

```bash
python run_signal_agent.py --transcript data/transcripts/high_intent_orchestrator.txt
```

Noise run:

```bash
python run_signal_agent.py --transcript data/transcripts/noise_general_interest.txt
```

Test command:

```bash
python -m pytest
```

## Expected HIGH_INTENT Behavior

The high-intent transcript should:

- detect the "centralized orchestrator" pain language,
- map it to a Cisco solution,
- find the account in `accounts.csv`,
- identify at least one corroborating structured signal,
- classify as `HIGH_INTENT`,
- resolve the specialist,
- print the internal notification,
- log the full JSON record.

## Expected NOISE Behavior

The noise transcript should:

- fail either pain-point mapping or structured corroboration,
- classify as `NOISE`,
- avoid specialist notification,
- log the reason,
- print valid final JSON.

## Extension Path

**Phase 1**

Console-only local POC.

**Phase 2**

Add Webex CLI or Outlook CLI adapter behind `notify.py`.

**Phase 3**

Move account lookup from CSV to approved graph/API source.

**Phase 4**

Move transcript trigger from local file drop to event trigger.

**Phase 5**

Package repeated evaluation and notification workflows as Cursor skills or subagents.
