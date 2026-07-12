"""Verifies the final JSON output schema and other cross-cutting
acceptance criteria from INSTRUCTIONS.md (skill read/write boundaries,
no hard-coded secrets, .env hygiene)."""

import json
import os
import re
from pathlib import Path

import run_signal_agent

REQUIRED_KEYS = {
    "account",
    "pain_point",
    "solution",
    "verdict",
    "why",
    "specialist",
    "channel",
    "notification_text",
    "timestamp",
}

HIGH_INTENT_TRANSCRIPT = "data/transcripts/high_intent_orchestrator.txt"
NOISE_TRANSCRIPT = "data/transcripts/noise_general_interest.txt"


def _assert_valid_schema(result: dict) -> None:
    assert set(result.keys()) == REQUIRED_KEYS
    assert result["verdict"] in {"HIGH_INTENT", "NOISE"}
    # Must be JSON-serializable, matching "print exactly one final JSON object".
    json.dumps(result)


def test_high_intent_output_matches_schema(tmp_path):
    log_path = tmp_path / "signal_log.jsonl"
    result = run_signal_agent.run(HIGH_INTENT_TRANSCRIPT, log_path=log_path)
    _assert_valid_schema(result)
    assert result["specialist"] is not None
    assert result["channel"] is not None
    assert result["notification_text"] is not None


def test_noise_output_matches_schema(tmp_path):
    log_path = tmp_path / "signal_log.jsonl"
    result = run_signal_agent.run(NOISE_TRANSCRIPT, log_path=log_path)
    _assert_valid_schema(result)
    assert result["specialist"] is None
    assert result["channel"] is None
    assert result["notification_text"] is None


def test_cli_main_prints_single_json_object(tmp_path, capsys):
    log_path = tmp_path / "signal_log.jsonl"
    exit_code = run_signal_agent.main(
        ["--transcript", HIGH_INTENT_TRANSCRIPT, "--log-path", str(log_path)]
    )
    assert exit_code == 0

    captured = capsys.readouterr()
    # The last non-empty top-level JSON block printed must parse as the
    # single final result object.
    last_brace_start = captured.out.rindex("{\n")
    final_json_text = captured.out[last_brace_start:]
    parsed = json.loads(final_json_text)
    _assert_valid_schema(parsed)


def test_read_only_skills_do_not_write_files(tmp_path):
    """Skills 1-5 must never write to disk; only notify.py may."""
    import importlib
    import inspect

    read_only_modules = [
        "skills.ingest_transcript",
        "skills.detect_painpoint",
        "skills.lookup_account",
        "skills.evaluate_intent",
        "skills.lookup_specialist",
    ]
    forbidden_write_patterns = re.compile(r"\bopen\([^)]*[\"']w[\"']|\.write_text\(|\.mkdir\(")

    for module_name in read_only_modules:
        module = importlib.import_module(module_name)
        source = inspect.getsource(module)
        assert not forbidden_write_patterns.search(source), (
            f"{module_name} appears to contain write operations, "
            "violating read/write separation (Ground Rule 4/5)."
        )


def test_only_notify_module_appends_to_signal_log():
    import importlib
    import inspect

    notify_module = importlib.import_module("skills.notify")
    source = inspect.getsource(notify_module)
    assert "signal_log.jsonl" in source or "DEFAULT_LOG_PATH" in source
    assert 'open(' in source or 'fh.write' in source


def test_no_hardcoded_secrets_in_source_tree():
    poc_root = run_signal_agent.POC_ROOT
    suspicious_patterns = [
        re.compile(r"sk-[A-Za-z0-9]{20,}"),
        re.compile(r"OPENAI_API_KEY\s*=\s*[\"'][^\"']+[\"']"),
        re.compile(r"AKIA[0-9A-Z]{16}"),
    ]

    for path in poc_root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for pattern in suspicious_patterns:
            assert not pattern.search(text), f"Possible hard-coded secret in {path}"

    env_example = poc_root / ".env.example"
    assert env_example.exists()
    for line in env_example.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, _, value = line.partition("=")
            assert value.strip() == "" or value.strip().startswith("gpt-"), (
                f".env.example line should not carry a real secret value: {line}"
            )


def test_env_is_gitignored():
    poc_root = run_signal_agent.POC_ROOT
    gitignore_text = (poc_root / ".gitignore").read_text(encoding="utf-8")
    assert ".env" in gitignore_text


def test_no_external_enterprise_endpoints_referenced():
    """No live network calls to Webex/Outlook/Salesforce/Gong/Cisco APIs —
    only local files, plus the fully optional OpenAI synthesis path."""
    poc_root = run_signal_agent.POC_ROOT
    forbidden_hosts = [
        "webexapis.com",
        "graph.microsoft.com",
        "salesforce.com",
        "gong.io",
    ]
    for path in (poc_root / "skills").glob("*.py"):
        text = path.read_text(encoding="utf-8")
        for host in forbidden_hosts:
            assert host not in text, f"Found unexpected reference to {host} in {path}"
