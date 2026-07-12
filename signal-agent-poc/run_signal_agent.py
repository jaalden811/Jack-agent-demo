#!/usr/bin/env python3
"""Signal-to-Action Agent POC — entry point.

Runs the full local spine described in ARCHITECTURE.md:

    ingest transcript -> detect pain point -> lookup account
    -> evaluate intent -> (NOISE: log + stop) | (HIGH_INTENT: lookup
    specialist -> notify -> log)

Usage:
    python run_signal_agent.py --transcript data/transcripts/high_intent_orchestrator.txt
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

POC_ROOT = Path(__file__).resolve().parent
if str(POC_ROOT) not in sys.path:
    sys.path.insert(0, str(POC_ROOT))

from skills.detect_painpoint import detect_painpoint  # noqa: E402
from skills.evaluate_intent import evaluate_intent  # noqa: E402
from skills.ingest_transcript import ingest_transcript  # noqa: E402
from skills.lookup_account import lookup_account  # noqa: E402
from skills.lookup_specialist import lookup_specialist  # noqa: E402
from skills.notify import notify  # noqa: E402

CONFIG_DIR = POC_ROOT / "config"
DATA_DIR = POC_ROOT / "data"

PAINPOINT_MAP_PATH = CONFIG_DIR / "painpoint_solution_map.json"
ACCOUNTS_CSV_PATH = DATA_DIR / "accounts.csv"
SPECIALISTS_CSV_PATH = CONFIG_DIR / "specialists.csv"
THRESHOLDS_PATH = CONFIG_DIR / "thresholds.json"


def _resolve_transcript_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.is_file():
        return candidate
    fallback = POC_ROOT / raw_path
    if fallback.is_file():
        return fallback
    raise FileNotFoundError(f"Transcript not found at '{raw_path}' or '{fallback}'.")


def run(transcript_path: str, log_path: str | Path | None = None) -> dict:
    """Execute the full spine for one transcript and return the final
    output-schema JSON object described in INSTRUCTIONS.md.

    `log_path` is an optional override of the default
    `data/output/signal_log.jsonl` destination, primarily so tests can
    redirect audit records to a scratch file instead of the real log.
    """
    resolved_transcript_path = _resolve_transcript_path(transcript_path)

    ingested = ingest_transcript(str(resolved_transcript_path))
    painpoint_result = detect_painpoint(ingested, str(PAINPOINT_MAP_PATH))
    account_result = lookup_account(ingested.get("account"), str(ACCOUNTS_CSV_PATH))
    intent_result = evaluate_intent(painpoint_result, account_result, str(THRESHOLDS_PATH))

    timestamp = datetime.now(timezone.utc).isoformat()
    account = ingested.get("account")
    pain_point = painpoint_result.get("pain_point")
    solution = painpoint_result.get("solution")
    verdict = intent_result["verdict"]
    why = intent_result["why"]

    if verdict == "NOISE":
        # Ground Rule 13: stop and log the reason. Do not notify anyone.
        notify(
            {
                "verdict": "NOISE",
                "account": account,
                "pain_point": pain_point,
                "solution": solution,
                "why": why,
                "corroborating_signals": intent_result["corroborating_signals"],
                "timestamp": timestamp,
            },
            log_path=log_path,
        )
        return {
            "account": account,
            "pain_point": pain_point,
            "solution": solution,
            "verdict": verdict,
            "why": why,
            "specialist": None,
            "channel": None,
            "notification_text": None,
            "timestamp": timestamp,
        }

    specialist_result = lookup_specialist(solution, str(SPECIALISTS_CSV_PATH))
    notify_result = notify(
        {
            "verdict": "HIGH_INTENT",
            "account": account,
            "pain_point": pain_point,
            "solution": solution,
            "why": why,
            "corroborating_signals": intent_result["corroborating_signals"],
            "account_result": account_result,
            "specialist_result": specialist_result,
            "timestamp": timestamp,
        },
        log_path=log_path,
    )

    return {
        "account": account,
        "pain_point": pain_point,
        "solution": solution,
        "verdict": verdict,
        "why": why,
        "specialist": specialist_result.get("specialist"),
        "channel": notify_result.get("channel"),
        "notification_text": notify_result.get("notification_text"),
        "timestamp": timestamp,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Signal-to-Action Agent POC on a transcript.")
    parser.add_argument(
        "--transcript",
        required=True,
        help="Path to a transcript .txt file (e.g. data/transcripts/high_intent_orchestrator.txt)",
    )
    parser.add_argument(
        "--log-path",
        default=None,
        help="Override the audit log destination (default: data/output/signal_log.jsonl)",
    )
    args = parser.parse_args(argv)

    try:
        result = run(args.transcript, log_path=args.log_path)
    except FileNotFoundError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
