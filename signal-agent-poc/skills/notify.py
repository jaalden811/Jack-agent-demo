"""Skill 6 — Notify (the only write/notify skill).

This is the single write-capable module in the POC. It is the only skill
allowed to append to `data/output/signal_log.jsonl` or simulate sending a
message (Ground Rule 6). Every other skill in this package is read-only.

Contract (see ../INSTRUCTIONS.md):
    Input:  {"context": "dict"}
    Output: {
        "channel": "console | webex | outlook",
        "notification_text": "string | null",
        "logged": true,
        "log_path": "data/output/signal_log.jsonl",
    }

Behavior:
    - verdict == "NOISE": no notification is drafted or printed (Ground
      Rule 13 — "Do not notify anyone"). Only an audit record is appended.
    - verdict == "HIGH_INTENT": draft the internal notification, print it
      to the console (channel="console" for POC v1), and append the full
      audit record.

Never contacts the customer. Never sends anything to Webex or Outlook in
this POC — see the TODO stubs below for the future adapter seams.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_LOG_PATH = Path(__file__).resolve().parent.parent / "data" / "output" / "signal_log.jsonl"


def _format_install_base(install_base: list[str]) -> str:
    return ", ".join(install_base) if install_base else "none on file"


def _format_deal_snapshot(account_result: dict) -> str:
    stage = account_result.get("stage") or "no active stage on file"
    deal_value = account_result.get("deal_value") or 0
    install_base = _format_install_base(account_result.get("install_base", []))
    budget_signal = account_result.get("budget_signal") or "no explicit budget signal on file"
    return f"stage={stage}, value=${deal_value:,}, install_base=[{install_base}], budget_signal={budget_signal}"


def _draft_notification_text(context: dict) -> str:
    account = context.get("account") or "Unknown account"
    pain_point = context.get("pain_point") or "unspecified pain point"
    solution = context.get("solution") or "unspecified solution"
    why = context.get("why") or ""
    account_result = context.get("account_result") or {}
    specialist_result = context.get("specialist_result") or {}

    specialist = specialist_result.get("specialist", "Unassigned")
    role = specialist_result.get("role", "Unknown")
    handle = specialist_result.get("handle", "")

    lines = [
        f"Signal detected: {pain_point}",
        "",
        f"Account: {account}",
        f"Mapped solution: {solution}",
        f"Why now: {why}",
        f"Deal snapshot: {_format_deal_snapshot(account_result)}",
        f"Recommended action: Loop in {specialist} for a technical/solution review of {solution} with {account}.",
        f"Owner: {specialist} ({role}, {handle})",
        "",
        "Do not contact the customer directly from this automation.",
    ]
    return "\n".join(lines)


def _append_log_record(log_path: Path, record: dict) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")


def _send_via_webex(notification_text: str, handle: str) -> None:
    """TODO(POC v2): replace with a real Webex CLI/API adapter.

    This must post `notification_text` to an internal Webex space/room only
    (never to the customer), using a bot token read from the environment
    (e.g. WEBEX_BOT_TOKEN / WEBEX_NOTIFY_ROOM_ID in .env). Not implemented
    in this POC — no Webex endpoint is called.
    """
    raise NotImplementedError("Webex adapter is a stub in this POC; console is the only live channel.")


def _send_via_outlook(notification_text: str, handle: str) -> None:
    """TODO(POC v2): replace with a real Outlook CLI/Graph adapter.

    This must send `notification_text` as an internal email to the
    specialist's `handle` only (never to the customer), using credentials
    read from the environment (e.g. OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET
    / OUTLOOK_TENANT_ID in .env). Not implemented in this POC — no Outlook
    endpoint is called.
    """
    raise NotImplementedError("Outlook adapter is a stub in this POC; console is the only live channel.")


def notify(context: dict, log_path: str | Path | None = None) -> dict:
    resolved_log_path = Path(log_path) if log_path else DEFAULT_LOG_PATH
    verdict = context.get("verdict")
    timestamp = context.get("timestamp") or datetime.now(timezone.utc).isoformat()

    if verdict == "NOISE":
        record = {
            "timestamp": timestamp,
            "verdict": "NOISE",
            "account": context.get("account"),
            "pain_point": context.get("pain_point"),
            "solution": context.get("solution"),
            "why": context.get("why"),
            "corroborating_signals": context.get("corroborating_signals", []),
            "specialist": None,
            "channel": None,
            "notification_text": None,
        }
        _append_log_record(resolved_log_path, record)
        return {
            "channel": None,
            "notification_text": None,
            "logged": True,
            "log_path": str(resolved_log_path),
        }

    specialist_result = context.get("specialist_result") or {}
    channel = specialist_result.get("channel", "console")
    notification_text = _draft_notification_text(context)

    if channel == "console":
        print(notification_text)
    elif channel == "webex":
        # Stub only — falls back to console output so the demo never
        # silently drops a HIGH_INTENT notification.
        print("[stub: would post to Webex — see skills/notify.py TODO]")
        print(notification_text)
    elif channel == "outlook":
        print("[stub: would send via Outlook — see skills/notify.py TODO]")
        print(notification_text)
    else:
        print(notification_text)

    record = {
        "timestamp": timestamp,
        "verdict": "HIGH_INTENT",
        "account": context.get("account"),
        "pain_point": context.get("pain_point"),
        "solution": context.get("solution"),
        "why": context.get("why"),
        "corroborating_signals": context.get("corroborating_signals", []),
        "specialist": specialist_result.get("specialist"),
        "channel": channel,
        "notification_text": notification_text,
    }
    _append_log_record(resolved_log_path, record)

    return {
        "channel": channel,
        "notification_text": notification_text,
        "logged": True,
        "log_path": str(resolved_log_path),
    }
