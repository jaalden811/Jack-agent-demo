"""Verifies the HIGH_INTENT path: a real signal routes to the correct
specialist, prints an internal notification, and is logged."""

import json

import run_signal_agent

TRANSCRIPT = "data/transcripts/high_intent_orchestrator.txt"


def test_high_intent_routes_to_correct_specialist(tmp_path, capsys):
    log_path = tmp_path / "signal_log.jsonl"

    result = run_signal_agent.run(TRANSCRIPT, log_path=log_path)

    assert result["verdict"] == "HIGH_INTENT"
    assert result["account"] == "Meridian Health Systems"
    assert result["pain_point"] == "fragmented collaboration and tool sprawl"
    assert result["solution"] == "Cisco Collaboration Orchestration"
    assert result["specialist"] == "Priya Nair"
    assert result["channel"] == "console"
    assert result["notification_text"] is not None


def test_high_intent_prints_internal_notification(tmp_path, capsys):
    log_path = tmp_path / "signal_log.jsonl"

    run_signal_agent.run(TRANSCRIPT, log_path=log_path)

    captured = capsys.readouterr()
    assert "Signal detected: fragmented collaboration and tool sprawl" in captured.out
    assert "Account: Meridian Health Systems" in captured.out
    assert "Owner: Priya Nair" in captured.out
    assert "Do not contact the customer directly from this automation." in captured.out


def test_high_intent_has_corroborating_structured_signal():
    from skills.evaluate_intent import evaluate_intent
    from skills.ingest_transcript import ingest_transcript
    from skills.detect_painpoint import detect_painpoint
    from skills.lookup_account import lookup_account

    ingested = ingest_transcript(str(run_signal_agent.POC_ROOT / TRANSCRIPT))
    painpoint_result = detect_painpoint(ingested, str(run_signal_agent.PAINPOINT_MAP_PATH))
    account_result = lookup_account(ingested["account"], str(run_signal_agent.ACCOUNTS_CSV_PATH))
    intent_result = evaluate_intent(painpoint_result, account_result, str(run_signal_agent.THRESHOLDS_PATH))

    assert account_result["matched"] is True
    assert len(intent_result["corroborating_signals"]) >= 1
    assert intent_result["verdict"] == "HIGH_INTENT"


def test_high_intent_appends_jsonl_audit_record():
    log_path = None  # use a scratch path but still verify JSONL append semantics
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp_dir:
        log_path = Path(tmp_dir) / "signal_log.jsonl"
        run_signal_agent.run(TRANSCRIPT, log_path=log_path)

        assert log_path.exists()
        lines = log_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1

        record = json.loads(lines[0])
        assert record["verdict"] == "HIGH_INTENT"
        assert record["account"] == "Meridian Health Systems"
        assert record["specialist"] == "Priya Nair"
        assert record["notification_text"] is not None
