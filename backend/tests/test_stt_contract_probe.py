"""Offline tests for the AUDIODEPR-0051 T001 probe guards (no network)."""
import json

import pytest

from scripts.probes import stt_contract_probe as probe


def test_refuses_non_staging_or_missing_key():
    assert probe.check_environment({"OPENAI_API_KEY": "x"}) is not None
    assert probe.check_environment({"RAILWAY_ENVIRONMENT_NAME": "production", "OPENAI_API_KEY": "x"}) is not None
    assert probe.check_environment({"RAILWAY_ENVIRONMENT_NAME": "staging"}) is not None
    assert probe.check_environment({"RAILWAY_ENVIRONMENT_NAME": "staging", "OPENAI_API_KEY": "x"}) is None


def test_main_exits_before_network_outside_staging(tmp_path, monkeypatch):
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    rc = probe.main(["--step", "1", "--audio", str(tmp_path / "a.mp3"), "--out-dir", str(tmp_path / "out")])
    assert rc == 2
    assert not (tmp_path / "out").exists()


def test_counter_refuses_sixth_call(tmp_path):
    counter = probe.CallCounter(tmp_path / "c.json")
    assert [counter.take() for _ in range(5)] == [1, 2, 3, 4, 5]
    with pytest.raises(RuntimeError):
        counter.take()
    assert json.loads((tmp_path / "c.json").read_text()) == {"calls": 5}


def test_build_form_encodes_lists_as_array_fields():
    form = probe.build_form({"model": "m", "languages": ["en"], "timestamp_granularities": ["segment", "word"]})
    assert form == [("model", "m"), ("languages[]", "en"),
                    ("timestamp_granularities[]", "segment"), ("timestamp_granularities[]", "word")]


def test_sanitize_truncates_and_error_keeps_safe_keys():
    body = {"text": "a" * 500, "segments": [{"id": i} for i in range(5)]}
    out = probe.sanitize(body)
    assert out["text"].endswith("(500 chars)")
    assert out["segments"][-1] == "... (5 items total)"
    err = probe.sanitize_error({"error": {"message": "bad", "code": "x", "extra": "drop"}})
    assert err == {"error": {"message": "bad", "code": "x"}}


def _take_slot(path):
    try:
        return probe.CallCounter(path).take()
    except RuntimeError:
        return None


def test_counter_atomic_across_processes(tmp_path):
    from concurrent.futures import ProcessPoolExecutor

    path = tmp_path / "shared.json"
    with ProcessPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_take_slot, [path] * 24))
    assert sorted(slot for slot in results if slot is not None) == [1, 2, 3, 4, 5]
    assert probe.CallCounter(path).used() == 5


@pytest.fixture
def send_setup(tmp_path, monkeypatch):
    from unittest.mock import Mock
    from services import ai_usage_logger
    import requests

    fixture_root = tmp_path / "fixtures"
    fixture_root.mkdir()
    audio = fixture_root / "synthetic.mp3"
    audio.write_bytes(b"fixture")
    counter = tmp_path / "global" / "counter.json"
    counter.parent.mkdir()
    counter.write_text('{"calls": 0}')
    monkeypatch.setattr(probe, "FIXTURE_ROOTS", (fixture_root,))
    monkeypatch.setattr(probe, "COUNTER_PATH", counter)
    monkeypatch.setattr(probe, "audio_duration", lambda _: 8.1)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
    monkeypatch.setenv("OPENAI_API_KEY", "offline-sentinel-key")
    post = Mock(return_value=Mock(status_code=200, ok=True, json=lambda: {
        "text": "synthetic speech", "usage": {"type": "duration", "seconds": 9},
    }))
    log = Mock()
    monkeypatch.setattr(requests, "post", post)
    monkeypatch.setattr(ai_usage_logger, "log_whisper", log)
    return audio, counter, post, log


def _send(audio, out):
    return probe.main(["--step", "1", "--audio", str(audio), "--out-dir", str(out)])


@pytest.mark.parametrize("outcome", ["success", "http_error", "network_error", "logger_error"])
def test_send_logs_once_without_secrets_or_retry(send_setup, tmp_path, capsys, outcome):
    import requests

    audio, counter, post, log = send_setup
    if outcome == "http_error":
        post.return_value.status_code = 400
        post.return_value.ok = False
        post.return_value.json = lambda: {"error": {"code": "unsupported_value", "extra": "drop"}}
    elif outcome == "network_error":
        post.side_effect = requests.Timeout("offline-sentinel-key Authorization Bearer")
    elif outcome == "logger_error":
        log.side_effect = RuntimeError("offline-sentinel-key Authorization Bearer")
    out = tmp_path / "out"
    assert _send(audio, out) == 0
    post.assert_called_once()
    log.assert_called_once()
    usage = log.call_args.kwargs
    assert usage["model"] == "gpt-transcribe"
    assert usage["audio_seconds"] == 8.1
    assert usage["status"] == ("error" if outcome in ("http_error", "network_error") else "success")
    assert usage["metadata"]["call_no"] == 1
    assert post.call_args.args == (probe.ENDPOINT,)
    assert ("languages[]", "en") in post.call_args.kwargs["data"]
    assert post.call_args.kwargs["timeout"] == 120
    captured = capsys.readouterr()
    record_text = (out / "call1_step1.json").read_text()
    exposed = captured.out + captured.err + record_text + json.dumps(usage)
    for forbidden in ("offline-sentinel-key", "Authorization", "Bearer"):
        assert forbidden not in exposed
    assert json.loads(counter.read_text()) == {"calls": 1}
    record = json.loads(record_text)
    if outcome == "network_error":
        assert record["exception"] == "Timeout"
    if outcome == "logger_error":
        assert "usage logging failed (RuntimeError)" in captured.err
        assert record["http_status"] == 200


def test_sixth_call_refused_across_output_directories(send_setup, tmp_path):
    audio, counter, post, log = send_setup
    for i in range(5):
        assert _send(audio, tmp_path / f"out-{i}") == 0
    assert _send(audio, tmp_path / "new-out") == 3
    assert post.call_count == log.call_count == 5
    assert probe.CallCounter(counter).used() == 5


def test_missing_t001_counter_does_not_reopen_spent_budget(send_setup, tmp_path):
    audio, counter, post, log = send_setup
    counter.unlink()
    assert _send(audio, tmp_path / "out") == 3
    post.assert_not_called()
    log.assert_not_called()


@pytest.mark.parametrize("kind", ["outside", "symlink"])
def test_refuses_audio_outside_fixtures(send_setup, tmp_path, kind):
    audio, counter, post, log = send_setup
    outside = tmp_path / "student.mp3"
    outside.write_bytes(b"private")
    if kind == "symlink":
        audio.unlink()
        audio.symlink_to(outside)
    else:
        audio = outside
    assert _send(audio, tmp_path / "out") == 2
    post.assert_not_called()
    log.assert_not_called()
    assert probe.CallCounter(counter).used() == 0


@pytest.mark.parametrize("duration", [None, -1, 0, 121, float("nan"), float("inf")])
def test_refuses_invalid_duration(send_setup, tmp_path, monkeypatch, duration):
    audio, counter, post, log = send_setup
    monkeypatch.setattr(probe, "audio_duration", lambda _: duration)
    assert _send(audio, tmp_path / "out") == 2
    post.assert_not_called()
    log.assert_not_called()
    assert probe.CallCounter(counter).used() == 0
