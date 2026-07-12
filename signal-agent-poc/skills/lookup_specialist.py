"""Skill 5 — Resolve the specialist owner for a mapped solution.

Read-only. Maps to the "specialist lookup" box in the action fanout.

Contract (see ../INSTRUCTIONS.md):
    Input:  {"solution": "str", "specialists_csv_path": "str"}
    Output: {
        "specialist": "string",
        "role": "string",
        "channel": "console | webex | outlook",
        "handle": "string",
        "routing_reason": "string",
    }
"""

from __future__ import annotations

import csv
from pathlib import Path


def _normalize(value: str) -> str:
    return " ".join(value.lower().split())


def _unassigned_result(solution: str | None) -> dict:
    return {
        "specialist": "Unassigned",
        "role": "Unknown",
        "channel": "console",
        "handle": "",
        "routing_reason": f"No specialist is configured for solution '{solution}'.",
    }


def lookup_specialist(solution: str | None, specialists_csv_path: str) -> dict:
    if not solution:
        return _unassigned_result(solution)

    normalized_target = _normalize(solution)
    path = Path(specialists_csv_path)

    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            if _normalize(row.get("solution") or "") != normalized_target:
                continue
            return {
                "specialist": (row.get("specialist") or "").strip(),
                "role": (row.get("role") or "").strip(),
                "channel": (row.get("channel") or "console").strip() or "console",
                "handle": (row.get("handle") or "").strip(),
                "routing_reason": (row.get("routing_reason") or "").strip(),
            }

    return _unassigned_result(solution)
