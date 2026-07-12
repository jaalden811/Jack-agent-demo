"""Skill 4 — Evaluate intent: HIGH_INTENT vs NOISE.

Logic only; no file I/O beyond reading config/thresholds.json. This is the
"promote trigger" from the diagram: it decides whether a signal is real
enough to fan out to specialists and internal notifications, or whether it
should be logged and dropped.

Contract (see ../INSTRUCTIONS.md):
    Input:  {"painpoint_result": "dict", "account_result": "dict", "thresholds_path": "str"}
    Output: {
        "verdict": "HIGH_INTENT | NOISE",
        "why": "string",
        "corroborating_signals": ["string"],
        "score": 0,
    }

A signal is HIGH_INTENT only when:
    - a pain point maps to a solution (match_confidence != "none"), AND
    - at least `min_corroborating_signals` structured signal(s) corroborate it:
        - open_opportunity is true,
        - an explicit budget_signal is present,
        - or the account's install_base overlaps the pain point's
          related_install_base.
Otherwise the verdict is NOISE.
"""

from __future__ import annotations

import json
from pathlib import Path

_CONFIDENCE_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3}


def _load_thresholds(thresholds_path: str) -> dict:
    path = Path(thresholds_path)
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _install_base_overlap(account_install_base: list[str], related_install_base: list[str]) -> list[str]:
    normalized_related = {item.lower() for item in related_install_base}
    return [item for item in account_install_base if item.lower() in normalized_related]


def evaluate_intent(painpoint_result: dict, account_result: dict, thresholds_path: str) -> dict:
    thresholds = _load_thresholds(thresholds_path)
    scoring = thresholds.get("scoring", {})
    confidence_points = scoring.get("pain_point_match_points", {})
    signal_points = scoring.get("corroborating_signal_points", 20)
    score_threshold = scoring.get("high_intent_score_threshold", 50)
    min_confidence_rank = _CONFIDENCE_RANK.get(thresholds.get("min_pain_point_confidence", "low"), 1)
    min_corroborating_signals = thresholds.get("min_corroborating_signals", 1)

    solution = painpoint_result.get("solution")
    pain_point = painpoint_result.get("pain_point")
    match_confidence = painpoint_result.get("match_confidence", "none")

    pain_point_mapped = bool(
        pain_point
        and solution
        and _CONFIDENCE_RANK.get(match_confidence, 0) >= min_confidence_rank
    )

    corroborating_signals: list[str] = []
    if account_result.get("open_opportunity"):
        corroborating_signals.append("open_opportunity")
    if account_result.get("budget_signal"):
        corroborating_signals.append("budget_signal")

    overlap = _install_base_overlap(
        account_result.get("install_base", []),
        painpoint_result.get("related_install_base", []),
    )
    if overlap:
        corroborating_signals.append("matching_install_base")

    score = confidence_points.get(match_confidence, 0)
    score += signal_points * len(corroborating_signals)
    score = min(score, 100)

    has_enough_corroboration = len(corroborating_signals) >= min_corroborating_signals

    is_high_intent = (
        pain_point_mapped
        and (not thresholds.get("require_solution_mapping", True) or bool(solution))
        and (not thresholds.get("require_corroborating_signal", True) or has_enough_corroboration)
        and score >= score_threshold
    )

    if is_high_intent:
        signal_summary = ", ".join(corroborating_signals)
        why = (
            f"Pain point '{pain_point}' mapped to solution '{solution}' "
            f"with {match_confidence} confidence, corroborated by: {signal_summary}. "
            f"Score {score}/100 meets threshold {score_threshold}."
        )
        return {
            "verdict": "HIGH_INTENT",
            "why": why,
            "corroborating_signals": corroborating_signals,
            "score": score,
        }

    reasons = []
    if not pain_point_mapped:
        reasons.append(
            "no configured pain point/solution was matched with sufficient confidence"
        )
    if thresholds.get("require_corroborating_signal", True) and not has_enough_corroboration:
        reasons.append(
            "no corroborating structured account signal (open opportunity, budget "
            "signal, or matching install base) was found"
        )
    if not reasons:
        reasons.append(f"score {score} did not reach the HIGH_INTENT threshold of {score_threshold}")

    why = "Marked NOISE: " + "; ".join(reasons) + "."
    return {
        "verdict": "NOISE",
        "why": why,
        "corroborating_signals": corroborating_signals,
        "score": score,
    }
