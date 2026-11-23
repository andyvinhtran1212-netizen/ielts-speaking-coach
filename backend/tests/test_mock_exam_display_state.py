"""MOCKORG-0086 FR-140: the one-word state of each exam on the admin list."""
from datetime import datetime, timedelta, timezone

import pytest

from services import mock_exam_display_state as ds

NOW = datetime(2026, 11, 25, 13, 0, tzinfo=timezone.utc)
ISO = lambda d: d.isoformat()  # noqa: E731


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
