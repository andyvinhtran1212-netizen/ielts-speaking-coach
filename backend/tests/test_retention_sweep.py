"""
tests/test_retention_sweep.py — Sprint 16.4 retention sweep job.

Covers (Pattern #20 schema-aware stub of Supabase + Storage):
  - dry-run finds eligible sessions but performs NO writes;
  - live audio purge ordering = Storage remove BEFORE the DB scrub (orphan-safe);
  - content scrub NULLs heavy text/JSONB but PRESERVES every score column;
  - eligibility reuses the max(started_at, last_accessed_at) anchor (never purge a
    recently-opened session) + the audio_purged_at/started_at pre-filter;
  - per-session errors are isolated (Pattern #29);
  - main() returns a summary; DRY_RUN env parsing.
"""

from datetime import datetime, timedelta, timezone

import pytest

from jobs import retention_sweep as sweep


def _ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


# ── Recording stub Supabase client + Storage ───────────────────────────────────

class _Exec:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, name, data_for, calls):
        self.name, self._data_for, self._calls = name, data_for, calls
        self.kind, self.payload, self.eqs = "select", None, {}

    def select(self, *a, **k):
        return self

    def update(self, payload):
        self.kind, self.payload = "update", payload
        return self

    def is_(self, col, val):
        self._calls.append({"type": "filter", "op": "is", "table": self.name, "col": col, "val": val})
        return self

    def lt(self, col, val):
        self._calls.append({"type": "filter", "op": "lt", "table": self.name, "col": col})
        return self

    def eq(self, col, val):
        self.eqs[col] = val
        return self

    def execute(self):
        if self.kind == "update":
            self._calls.append({"type": "update", "table": self.name, "payload": self.payload, "eq": dict(self.eqs)})
            return _Exec([])
        self._calls.append({"type": "select", "table": self.name, "eq": dict(self.eqs)})
        return _Exec(self._data_for(self.name, self.eqs))


class _Storage:
    def __init__(self, calls):
        self._calls, self._bucket = calls, None

    def from_(self, bucket):
        self._bucket = bucket
        return self

    def remove(self, paths):
        self._calls.append({"type": "storage_remove", "bucket": self._bucket, "paths": list(paths)})
        return []


class _StubClient:
    def __init__(self, sessions, responses_by_session, calls, remove_raises_for=None):
        self._sessions = sessions
        self._resp = responses_by_session
        self.calls = calls
        self.storage = _Storage(calls)
        if remove_raises_for is not None:
            orig = self.storage.remove
            def _raise(paths):
                if any(remove_raises_for in p for p in paths):
                    raise RuntimeError("storage boom")
                return orig(paths)
            self.storage.remove = _raise

    def table(self, name):
        def data_for(n, eqs):
            if n == "sessions":
                return list(self._sessions)
            if n == "responses":
                return list(self._resp.get(eqs.get("session_id"), []))
            return []
        return _Q(name, data_for, self.calls)


def _install(monkeypatch, *, dry_run, sessions, responses=None, remove_raises_for=None):
    calls: list = []
    client = _StubClient(sessions, responses or {}, calls, remove_raises_for)
    monkeypatch.setattr(sweep, "supabase_admin", client)
    monkeypatch.setattr(sweep, "DRY_RUN", dry_run)
    return calls


# ── Eligibility (anchor + pre-filter) ──────────────────────────────────────────

def test_audio_eligibility_uses_strict_started_anchor(monkeypatch):
    # Sprint 16.4.1 (D1): audio is strict recording-age. A reopened-but-old session
    # IS audio-eligible (access does not save audio). A genuinely recent session is not.
    sessions = [
        {"id": "old", "user_id": "u", "started_at": _ago(20), "last_accessed_at": None,
         "audio_purged_at": None, "content_purged_at": None},                 # eligible
        {"id": "reopened", "user_id": "u", "started_at": _ago(70), "last_accessed_at": _ago(1),
         "audio_purged_at": None, "content_purged_at": None},                 # eligible — audio is recording-age
        {"id": "recent", "user_id": "u", "started_at": _ago(5), "last_accessed_at": _ago(1),
         "audio_purged_at": None, "content_purged_at": None},                 # NOT — started 5d ago
    ]
    _install(monkeypatch, dry_run=True, sessions=sessions)
    eligible = sweep._eligible("audio_purged_at", sweep.RETENTION_AUDIO_DAYS, "is_audio_purged")
    assert sorted(s["id"] for s in eligible) == ["old", "reopened"]


def test_content_eligibility_uses_max_anchor(monkeypatch):
    # Content stays activity-extended: a 70d session reopened 1d ago is NOT content-eligible.
    sessions = [
        {"id": "stale", "user_id": "u", "started_at": _ago(70), "last_accessed_at": None,
         "audio_purged_at": None, "content_purged_at": None},                 # eligible
        {"id": "reopened", "user_id": "u", "started_at": _ago(70), "last_accessed_at": _ago(1),
         "audio_purged_at": None, "content_purged_at": None},                 # NOT — opened 1d ago
    ]
    _install(monkeypatch, dry_run=True, sessions=sessions)
    eligible = sweep._eligible("content_purged_at", sweep.RETENTION_CONTENT_DAYS, "is_content_purged")
    assert [s["id"] for s in eligible] == ["stale"]


def test_audio_query_applies_prefilter(monkeypatch):
    calls = _install(monkeypatch, dry_run=True, sessions=[])
    sweep._eligible("audio_purged_at", sweep.RETENTION_AUDIO_DAYS, "is_audio_purged")
    filters = [c for c in calls if c["type"] == "filter"]
    assert any(c["op"] == "is" and c["col"] == "audio_purged_at" and c["val"] == "null" for c in filters)
    assert any(c["op"] == "lt" and c["col"] == "started_at" for c in filters)


# ── Dry-run vs live ─────────────────────────────────────────────────────────────

_ELIGIBLE_AUDIO = [{"id": "s1", "user_id": "u1", "started_at": _ago(20), "last_accessed_at": None,
                    "audio_purged_at": None, "content_purged_at": None}]
_RESP = {"s1": [{"audio_storage_path": "u1/s1/q1.webm"}, {"audio_storage_path": "u1/s1/q2.webm"},
                {"audio_storage_path": None}]}


def test_dry_run_no_writes(monkeypatch):
    calls = _install(monkeypatch, dry_run=True, sessions=_ELIGIBLE_AUDIO, responses=_RESP)
    res = sweep.sweep_audio()
    assert res["eligible"] == 1 and res["purged"] == 1 and res["objects"] == 2
    assert not [c for c in calls if c["type"] in ("update", "storage_remove")]


def test_live_audio_writes_and_storage_first_ordering(monkeypatch):
    calls = _install(monkeypatch, dry_run=False, sessions=_ELIGIBLE_AUDIO, responses=_RESP)
    res = sweep.sweep_audio()
    assert res["purged"] == 1 and res["objects"] == 2
    removes = [i for i, c in enumerate(calls) if c["type"] == "storage_remove"]
    resp_updates = [i for i, c in enumerate(calls) if c["type"] == "update" and c["table"] == "responses"]
    sess_updates = [i for i, c in enumerate(calls) if c["type"] == "update" and c["table"] == "sessions"]
    assert removes and resp_updates and sess_updates
    # Storage-first: remove() happens before the DB scrub (orphan-safe).
    assert removes[0] < resp_updates[0] < sess_updates[0]
    # The removed paths are the non-null audio_storage_path values.
    assert calls[removes[0]]["paths"] == ["u1/s1/q1.webm", "u1/s1/q2.webm"]
    # Audio scrub nulls audio columns + stamps audio_purged_at.
    assert calls[resp_updates[0]]["payload"] == {"audio_url": None, "audio_storage_path": None}
    assert "audio_purged_at" in calls[sess_updates[0]]["payload"]


# ── Content scrub preserves scores ──────────────────────────────────────────────

def test_content_scrub_nulls_heavy_cols_preserves_scores(monkeypatch):
    sessions = [{"id": "c1", "user_id": "u", "started_at": _ago(70), "last_accessed_at": None,
                 "audio_purged_at": _ago(50), "content_purged_at": None}]
    calls = _install(monkeypatch, dry_run=False, sessions=sessions)
    res = sweep.sweep_content()
    assert res["purged"] == 1
    resp_update = next(c for c in calls if c["type"] == "update" and c["table"] == "responses")
    assert set(resp_update["payload"]) == {"transcript", "raw_transcript_text", "feedback", "pronunciation_payload"}
    # Score columns must NOT be touched.
    for score_col in ("overall_band", "final_overall_band", "final_band_p",
                      "pronunciation_score", "pronunciation_fluency"):
        assert score_col not in resp_update["payload"]
    assert any(c["table"] == "sessions" and "content_purged_at" in c["payload"]
               for c in calls if c["type"] == "update")


# ── Error isolation (Pattern #29) ───────────────────────────────────────────────

def test_per_session_error_isolated(monkeypatch):
    sessions = [
        {"id": "boom", "user_id": "u", "started_at": _ago(20), "last_accessed_at": None,
         "audio_purged_at": None, "content_purged_at": None},
        {"id": "ok", "user_id": "u", "started_at": _ago(20), "last_accessed_at": None,
         "audio_purged_at": None, "content_purged_at": None},
    ]
    responses = {"boom": [{"audio_storage_path": "u/boom/q.webm"}],
                 "ok":   [{"audio_storage_path": "u/ok/q.webm"}]}
    _install(monkeypatch, dry_run=False, sessions=sessions, responses=responses, remove_raises_for="boom")
    res = sweep.sweep_audio()
    assert res["purged"] == 1 and len(res["errors"]) == 1
    assert res["errors"][0]["session_id"] == "boom"


# ── main() summary + DRY_RUN parsing ────────────────────────────────────────────

def test_main_returns_summary(monkeypatch):
    _install(monkeypatch, dry_run=True, sessions=_ELIGIBLE_AUDIO, responses=_RESP)
    out = sweep.main()
    assert out["dry_run"] is True
    assert out["audio"]["op"] == "audio" and out["content"]["op"] == "content"
    assert out["audio"]["eligible"] == 1


@pytest.mark.parametrize("env,expected", [("false", False), ("FALSE", False), ("true", True), ("", True), ("anything", True)])
def test_dry_run_env_parsing(monkeypatch, env, expected):
    monkeypatch.setenv("RETENTION_SWEEP_DRY_RUN", env)
    # Re-evaluate the same expression the module uses at import.
    import os
    assert (os.getenv("RETENTION_SWEEP_DRY_RUN", "true").lower() != "false") is expected
