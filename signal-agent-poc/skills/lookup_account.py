"""Skill 3 — Look up structured account data.

Read-only. Maps to the "cross-check account data" / Salesforce / super-graph
box in the diagram. In this POC, `data/accounts.csv` stands in for
Salesforce / the federated account graph.

Contract (see ../INSTRUCTIONS.md):
    Input:  {"account_name": "str", "accounts_csv_path": "str"}
    Output: {
        "account": "string",
        "matched": true,
        "open_opportunity": true,
        "stage": "string",
        "deal_value": 0,
        "install_base": ["string"],
        "budget_signal": "string | null",
    }
"""

from __future__ import annotations

import csv
import re
from pathlib import Path


def _normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def _no_match_result(account_name: str | None) -> dict:
    return {
        "account": account_name or "",
        "matched": False,
        "open_opportunity": False,
        "stage": "",
        "deal_value": 0,
        "install_base": [],
        "budget_signal": None,
    }


def lookup_account(account_name: str | None, accounts_csv_path: str) -> dict:
    if not account_name:
        return _no_match_result(account_name)

    normalized_target = _normalize(account_name)
    path = Path(accounts_csv_path)

    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            row_account = (row.get("account") or "").strip()
            if _normalize(row_account) != normalized_target:
                continue

            install_base_raw = (row.get("install_base") or "").strip()
            install_base = [item.strip() for item in install_base_raw.split("|") if item.strip()]

            budget_signal = (row.get("budget_signal") or "").strip() or None

            try:
                deal_value = int(float(row.get("deal_value") or 0))
            except ValueError:
                deal_value = 0

            return {
                "account": row_account,
                "matched": True,
                "open_opportunity": (row.get("open_opportunity") or "").strip().lower() == "true",
                "stage": (row.get("stage") or "").strip(),
                "deal_value": deal_value,
                "install_base": install_base,
                "budget_signal": budget_signal,
            }

    return _no_match_result(account_name)
