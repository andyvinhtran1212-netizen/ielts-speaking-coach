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
