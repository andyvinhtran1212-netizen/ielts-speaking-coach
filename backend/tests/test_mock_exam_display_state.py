"""MOCKORG-0086 FR-140: the one-word state of each exam on the admin list."""
from datetime import datetime, timedelta, timezone

import pytest

from services import mock_exam_display_state as ds

NOW = datetime(2026, 11, 25, 13, 0, tzinfo=timezone.utc)
ISO = lambda d: d.isoformat()  # noqa: E731


_REAL_LISTENING_SECONDS = ds._listening_seconds


@pytest.fixture(autouse=True)
def _no_listening_read(monkeypatch):
    monkeypatch.setattr(ds, "_listening_seconds", lambda rows: {})


def exam(**kw):
    base = {"id": "e1", "status": "published", "exam_mode": "sequential", "is_open": False,
            "active_section": "not_started", "open_from": None, "open_until": None}
    return {**base, **kw}


@pytest.mark.parametrize("row,statuses,expected", [
    (exam(status="draft"), (), "draft"),
    (exam(status="archived"), (), "archived"),
    (exam(), (), "scheduled"),
    (exam(exam_mode="live", is_open=True), (), "running"),
    (exam(active_section="reading"), (), "running"),
    (exam(active_section="done"), {"all_submitted"}, "grading"),
    (exam(active_section="done"), {"released", "reviewed"}, "grading"),
    (exam(active_section="done"), {"released"}, "released"),
    (exam(active_section="done"), (), "ended"),
    (exam(active_section="done", is_open=True), (), "running"),
    (exam(exam_mode="retake"), (), "open"),
    (exam(exam_mode="self_paced", open_from=ISO(NOW + timedelta(days=1))), (), "scheduled"),
    (exam(exam_mode="self_paced", open_from=ISO(NOW - timedelta(days=1)),
          open_until=ISO(NOW + timedelta(days=1))), (), "open"),
    (exam(exam_mode="self_paced", open_until=ISO(NOW - timedelta(minutes=1))), {"under_review"}, "grading"),
    (exam(exam_mode="self_paced", open_until=ISO(NOW - timedelta(minutes=1))), {"released"}, "released"),
    (exam(exam_mode="self_paced", open_until="2026-11-25T12:59:00Z"), (), "ended"),
])
def test_display_state(row, statuses, expected):
    assert ds.display_state(row, NOW, statuses) == expected


def test_enrich_reads_sittings_only_for_finished_exams(monkeypatch):
    seen = {}
    monkeypatch.setattr(ds, "_sitting_statuses", lambda ids: seen.setdefault("ids", ids) and {"done": {"released"}})
    monkeypatch.setattr(ds, "_audience_counts", lambda ids: {"draft": 3})
    rows = [exam(id="draft", status="draft"), exam(id="done", active_section="done")]
    out = ds.enrich_admin_list(rows, audiences_enabled=True, now=NOW)
    assert seen["ids"] == ["done"]
    assert [(r["id"], r["display_state"], r["audience_count"]) for r in out] == [
        ("draft", "draft", 3), ("done", "released", 0)]


def test_enrich_failed_reads_give_none_not_a_guess(monkeypatch):
    def boom(ids):
        raise RuntimeError("db down")
    monkeypatch.setattr(ds, "_sitting_statuses", boom)
    monkeypatch.setattr(ds, "_audience_counts", boom)
    rows = [exam(id="live"), exam(id="done", active_section="done")]
    out = ds.enrich_admin_list(rows, audiences_enabled=True, now=NOW)
    assert [(r["display_state"], r["audience_count"]) for r in out] == [("scheduled", None), (None, None)]


def test_enrich_flag_off_has_no_audience_count(monkeypatch):
    called = []
    monkeypatch.setattr(ds, "_audience_counts", lambda ids: called.append(ids) or {})
    out = ds.enrich_admin_list([exam(status="draft")], audiences_enabled=False, now=NOW)
    assert out[0]["audience_count"] is None and not called


# CR #2640 (Medium): self-paced windows are per person, so the exam's own
# open_until can be NULL or earlier than someone's window.
PAST = ISO(NOW - timedelta(hours=1))
LATER = ISO(NOW + timedelta(hours=1))


@pytest.mark.parametrize("row,ends,statuses,expected", [
    (exam(exam_mode="self_paced"), [PAST], {"under_review"}, "grading"),
    (exam(exam_mode="self_paced"), [PAST, ISO(NOW - timedelta(days=1))], {"released"}, "released"),
    (exam(exam_mode="self_paced", open_until=PAST), [LATER], {"under_review"}, "open"),
    (exam(exam_mode="retake", open_until=PAST), [PAST, ds._OPEN_ENDED], {"under_review"}, "open"),
    (exam(exam_mode="self_paced"), [], {"under_review"}, "open"),
])
def test_self_paced_end_is_the_latest_window(row, ends, statuses, expected):
    assert ds.display_state(row, NOW, statuses, ends) == expected


def test_enrich_reads_per_person_windows_of_self_paced_exams(monkeypatch):
    seen = {}

    def windows(ids, audiences_enabled):
        seen["windows"] = (ids, audiences_enabled)
        return {"sp": [PAST]}
    monkeypatch.setattr(ds, "_window_ends", windows)
    monkeypatch.setattr(ds, "_sitting_statuses", lambda ids: seen.setdefault("sittings", ids) and {"sp": {"under_review"}})
    monkeypatch.setattr(ds, "_audience_counts", lambda ids: {})
    rows = [exam(id="live"), exam(id="draft", status="draft", exam_mode="self_paced"),
            exam(id="sp", exam_mode="self_paced")]
    out = ds.enrich_admin_list(rows, audiences_enabled=True, now=NOW)
    assert seen == {"windows": (["sp"], True), "sittings": ["sp"]}
    assert [r["display_state"] for r in out] == ["scheduled", "draft", "grading"]


def test_enrich_failed_window_read_gives_no_state_for_self_paced(monkeypatch):
    def boom(ids, audiences_enabled):
        raise RuntimeError("db down")
    monkeypatch.setattr(ds, "_window_ends", boom)
    monkeypatch.setattr(ds, "_sitting_statuses", lambda ids: {i: set() for i in ids})
    rows = [exam(id="done", active_section="done"), exam(id="sp", exam_mode="self_paced", open_until=PAST)]
    out = ds.enrich_admin_list(rows, audiences_enabled=False, now=NOW)
    assert [r["display_state"] for r in out] == ["ended", None]


# CR #2640 deviation 4: N uses the real Listening seat clock, not a fixed 32.
def test_enrich_carries_listening_seconds_and_none_on_failure(monkeypatch):
    monkeypatch.setattr(ds, "_listening_seconds", lambda rows: {"l": 2520})
    rows = [exam(id="l", status="draft", listening_test_id="t1"), exam(id="n", status="draft")]
    out = ds.enrich_admin_list(rows, audiences_enabled=False, now=NOW)
    assert [r["listening_seconds"] for r in out] == [2520, None]

    def boom(rows):
        raise RuntimeError("db down")
    monkeypatch.setattr(ds, "_listening_seconds", boom)
    out = ds.enrich_admin_list(rows, audiences_enabled=False, now=NOW)
    assert [r["listening_seconds"] for r in out] == [None, None]


def test_listening_seconds_is_audio_plus_buffer_or_the_default(monkeypatch):
    import sys
    import types

    class Query:
        def __init__(self, data):
            self.data = data

        def select(self, *_):
            return self

        def in_(self, _col, ids):
            self.data = [r for r in self.data if r["id"] in ids]
            return self

        def execute(self):
            return self

    tests = [{"id": "t1", "full_audio_duration_seconds": 2400}, {"id": "t2", "full_audio_duration_seconds": None}]
    fake_db = types.SimpleNamespace(supabase_admin=types.SimpleNamespace(table=lambda name: Query(list(tests))))
    monkeypatch.setitem(sys.modules, "database", fake_db)
    fake_svc = types.SimpleNamespace(_DEFAULT_LISTENING_MINUTES=30, _LISTENING_BUFFER_SECONDS=120)
    import services
    monkeypatch.setattr(services, "mock_exam_service", fake_svc, raising=False)
    monkeypatch.setitem(sys.modules, "services.mock_exam_service", fake_svc)
    rows = [{"id": "a", "listening_test_id": "t1"}, {"id": "b", "listening_test_id": "t2"}, {"id": "c"}]
    assert _REAL_LISTENING_SECONDS(rows) == {"a": 2520, "b": 1920}
