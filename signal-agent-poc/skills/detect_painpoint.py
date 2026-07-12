"""Skill 2 — Detect a pain point and map it to a Cisco solution.

Read-only. Maps to the "detect pain point" box in the AI orchestration /
evaluation layer.

Contract (see ../INSTRUCTIONS.md):
    Input:  {"ingested_transcript": "dict", "painpoint_solution_map_path": "str"}
    Output: {
        "pain_point": "string | null",
        "solution": "string | null",
        "match_confidence": "high | medium | low | none",
        "confidence_note": "string",
        "matched_terms": ["string"],
    }

Matching strategy:
    1. Deterministic keyword/phrase matching against
       config/painpoint_solution_map.json always runs first and is the
       required fallback.
    2. If OPENAI_API_KEY is configured, an optional synthesis pass may be
       used to improve the confidence note. If OpenAI is unavailable,
       unconfigured, or errors for any reason, we silently continue with
       the deterministic result — OpenAI is never required for this skill
       to function.

Note: the returned dict also carries a "related_install_base" field. This
is additive metadata (not part of the minimum required contract above) that
lets skills/evaluate_intent.py check for a matching install base without
re-reading the pain-point map itself. It does not change the required
output shape.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_CONFIDENCE_BY_MATCH_COUNT = {
    0: "none",
    1: "low",
    2: "medium",
}
_HIGH_MATCH_COUNT = 3


def _load_painpoint_map(painpoint_solution_map_path: str) -> list[dict]:
    path = Path(painpoint_solution_map_path)
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _confidence_for_count(count: int) -> str:
    if count >= _HIGH_MATCH_COUNT:
        return "high"
    return _CONFIDENCE_BY_MATCH_COUNT.get(count, "high")


def _deterministic_match(ingested_transcript: dict, painpoint_map: list[dict]) -> dict:
    haystack_parts = list(ingested_transcript.get("candidate_pain_language", []))
    raw_excerpt = ingested_transcript.get("raw_excerpt") or ""
    if raw_excerpt:
        haystack_parts.append(raw_excerpt)
    haystack = " \n ".join(haystack_parts).lower()

    best_entry: dict | None = None
    best_matched_terms: list[str] = []

    for entry in painpoint_map:
        matched_terms = []
        for phrase in entry.get("phrases", []):
            if phrase.lower() in haystack:
                matched_terms.append(phrase)

        if len(matched_terms) > len(best_matched_terms):
            best_entry = entry
            best_matched_terms = matched_terms

    if not best_entry or not best_matched_terms:
        return {
            "pain_point": None,
            "solution": None,
            "match_confidence": "none",
            "confidence_note": "No configured pain-point phrases were found in the transcript.",
            "matched_terms": [],
            "related_install_base": [],
        }

    confidence = _confidence_for_count(len(best_matched_terms))
    matched_preview = ", ".join(f'"{term}"' for term in best_matched_terms)
    confidence_note = (
        f"Deterministic keyword match ({confidence}): found {len(best_matched_terms)} "
        f"configured phrase(s) — {matched_preview} — mapping to "
        f"'{best_entry.get('pain_point')}'."
    )

    return {
        "pain_point": best_entry.get("pain_point"),
        "solution": best_entry.get("solution"),
        "match_confidence": confidence,
        "confidence_note": confidence_note,
        "matched_terms": best_matched_terms,
        "related_install_base": list(best_entry.get("related_install_base", [])),
    }


def _try_openai_augment(ingested_transcript: dict, deterministic_result: dict) -> dict:
    """Optional, best-effort OpenAI synthesis pass.

    Only runs when OPENAI_API_KEY is present. Never raises: any failure
    (missing package, network error, API error, malformed response) causes
    this function to return the deterministic result unchanged, per Ground
    Rule: "If OpenAI is unavailable, continue with deterministic matching."
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return deterministic_result

    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI(api_key=api_key)
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        excerpt = (ingested_transcript.get("raw_excerpt") or "")[:1200]

        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You add a one-sentence rationale to an existing deterministic "
                        "pain-point classification. Do not invent a new pain point or "
                        "solution — only explain the existing match in plain language. "
                        "Respond with a single sentence, no preamble."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Transcript excerpt: {excerpt}\n\n"
                        f"Deterministic pain point: {deterministic_result.get('pain_point')}\n"
                        f"Matched terms: {deterministic_result.get('matched_terms')}"
                    ),
                },
            ],
            timeout=10,
        )
        note = response.choices[0].message.content.strip()
        if note:
            augmented = dict(deterministic_result)
            augmented["confidence_note"] = (
                f"{deterministic_result['confidence_note']} OpenAI synthesis: {note}"
            )
            return augmented
    except Exception:
        # Any failure here must never break the deterministic path.
        return deterministic_result

    return deterministic_result


def detect_painpoint(ingested_transcript: dict, painpoint_solution_map_path: str) -> dict:
    painpoint_map = _load_painpoint_map(painpoint_solution_map_path)
    deterministic_result = _deterministic_match(ingested_transcript, painpoint_map)

    if deterministic_result["pain_point"] is None:
        # Nothing to invent or augment — a "none" match must stay "none".
        return deterministic_result

    return _try_openai_augment(ingested_transcript, deterministic_result)
