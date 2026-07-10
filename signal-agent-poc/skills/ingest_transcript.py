"""Skill 1 — Ingest a call transcript.

Read-only. Maps to the diagram's customer/email triage boxes: it turns a raw
transcript file into a normalized shape (account, participants, candidate
pain language, excerpt) without making any judgment about intent.

Contract (see ../INSTRUCTIONS.md):
    Input:  {"transcript_path": "str"}
    Output: {
        "account": "string | null",
        "participants": ["string"],
        "candidate_pain_language": ["string"],
        "raw_excerpt": "string",
    }
"""

from __future__ import annotations

import re
from pathlib import Path

MAX_EXCERPT_CHARS = 600
MIN_SENTENCE_CHARS = 8

_ACCOUNT_LINE_RE = re.compile(r"^Account:\s*(.+)$", re.IGNORECASE)
_PARTICIPANTS_LINE_RE = re.compile(r"^Participants:\s*(.+)$", re.IGNORECASE)
_PARTICIPANT_ENTRY_RE = re.compile(r"([^,(]+?)\s*\(([^)]*)\)")
_SPEAKER_LINE_RE = re.compile(r"^\[([^\]]+)\]:\s*(.+)$")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _split_sentences(utterance: str) -> list[str]:
    sentences = []
    for sentence in _SENTENCE_SPLIT_RE.split(utterance):
        sentence = sentence.strip()
        if len(sentence) >= MIN_SENTENCE_CHARS:
            sentences.append(sentence)
    return sentences


def ingest_transcript(transcript_path: str) -> dict:
    """Read a transcript file and extract account, participants, and
    candidate pain language. Does not write anything and does not classify
    intent — that belongs to skills/detect_painpoint.py and
    skills/evaluate_intent.py.
    """
    path = Path(transcript_path)
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    account: str | None = None
    participants: list[str] = []
    customer_names: set[str] = set()

    for line in lines:
        stripped = line.strip()

        if account is None:
            match = _ACCOUNT_LINE_RE.match(stripped)
            if match:
                account = match.group(1).strip() or None
                continue

        match = _PARTICIPANTS_LINE_RE.match(stripped)
        if match:
            for name, role in _PARTICIPANT_ENTRY_RE.findall(match.group(1)):
                name = name.strip()
                role = role.strip()
                if not name:
                    continue
                participants.append(f"{name} ({role})" if role else name)
                if "customer" in role.lower():
                    customer_names.add(name)

    candidate_pain_language: list[str] = []
    customer_lines: list[str] = []

    # Prefer lines explicitly attributed to a participant tagged "Customer".
    for line in lines:
        match = _SPEAKER_LINE_RE.match(line.strip())
        if not match:
            continue
        speaker, utterance = match.group(1).strip(), match.group(2).strip()
        if speaker in customer_names:
            customer_lines.append(utterance)
            candidate_pain_language.extend(_split_sentences(utterance))

    # Fallback: no "(Customer, ...)" tag was present in the Participants
    # line, so use every spoken line rather than silently dropping content.
    if not customer_names:
        for line in lines:
            match = _SPEAKER_LINE_RE.match(line.strip())
            if not match:
                continue
            utterance = match.group(2).strip()
            customer_lines.append(utterance)
            candidate_pain_language.extend(_split_sentences(utterance))

    raw_excerpt = " ".join(customer_lines).strip()
    if len(raw_excerpt) > MAX_EXCERPT_CHARS:
        raw_excerpt = raw_excerpt[:MAX_EXCERPT_CHARS].rsplit(" ", 1)[0] + "..."

    return {
        "account": account,
        "participants": participants,
        "candidate_pain_language": candidate_pain_language,
        "raw_excerpt": raw_excerpt,
    }
