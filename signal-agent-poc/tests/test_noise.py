"""Verifies the NOISE path: a weak signal is logged with a reason and no
one is notified."""

import json

import run_signal_agent

TRANSCRIPT = "data/transcripts/noise_general_interest.txt"


def test_noise_does_not_notify_anyone(tmp_path, capsys):
    log_path = tmp_path / "signal_log.jsonl"

    result = run_signal_agent.run(TRANSCRIPT, log_path=log_path)

    assert result["verdict"] == "NOISE"
    assert result["specialist"] is None
    assert result["channel"] is None
    assert result["notification_text"] is None

    captured = capsys.readouterr()
    assert "Signal detected" not in captured.out
    assert "Owner:" not in captured.out


def test_noise_still_logs_reason_to_jsonl(tmp_path):
    log_path = tmp_path / "signal_log.jsonl"

    run_signal_agent.run(TRANSCRIPT, log_path=log_path)

    assert log_path.exists()
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1

    record = json.loads(lines[0])
    assert record["verdict"] == "NOISE"
    assert record["specialist"] is None
    assert record["channel"] is None
    assert record["notification_text"] is None
    assert isinstance(record["why"], str) and len(record["why"]) > 0


def test_noise_account_lacks_pain_point_or_corroboration():
    from skills.detect_painpoint import detect_painpoint
    from skills.evaluate_intent import evaluate_intent
    from skills.ingest_transcript import ingest_transcript
    from skills.lookup_account import lookup_account

    ingested = ingest_transcript(str(run_signal_agent.POC_ROOT / TRANSCRIPT))
    painpoint_result = detect_painpoint(ingested, str(run_signal_agent.PAINPOINT_MAP_PATH))
    account_result = lookup_account(ingested["account"], str(run_signal_agent.ACCOUNTS_CSV_PATH))
    intent_result = evaluate_intent(painpoint_result, account_result, str(run_signal_agent.THRESHOLDS_PATH))

    assert painpoint_result["pain_point"] is None
    assert intent_result["verdict"] == "NOISE"
