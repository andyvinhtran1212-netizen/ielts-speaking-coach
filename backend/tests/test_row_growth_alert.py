"""INACTIVEWRITE-0035 follow-up — daily row-growth alert
(`services.row_growth_alert.run_row_growth_check`).

A user who created more than the threshold of rows in one Vocabulary/flashcard
table in the trailing 24h gets one `error_logs` warning (the admin triage
path), at most once per user/table/UTC day. Nothing else is written, so the
learner is never notified. A table that cannot be checked is reported, not
skipped silently."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
RECENT = (NOW - timedelta(hours=2)).isoformat()
OLD = (NOW - timedelta(hours=30)).isoformat()


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.orders, self.window, self.cap = [], [], None, None
        self.insert_payload = None

    def select(self, _cols):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r[col] >= val)
        return self

    def in_(self, col, vals):
        vals = set(vals)
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def order(self, col):
        self.orders.append(col)
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def limit(self, n):
        self.cap = n
        return self

    def insert(self, payload):
        self.insert_payload = payload
        return self

    def execute(self):
        if self.table in self.db.fail_tables:
            raise RuntimeError(f"{self.table} unavailable")
        if self.insert_payload is not None:
            self.db.writes.append((self.table, self.insert_payload))
            self.db.tables.setdefault(self.table, []).append(
                {**self.insert_payload, "occurred_at": NOW.isoformat()}
            )
            return _Result([self.insert_payload])
        rows = [r for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        for col in reversed(self.orders):
            rows.sort(key=lambda r: r[col])
        if self.window:
            rows = rows[self.window[0]:self.window[1] + 1]
        if self.cap is not None:
            rows = rows[:self.cap]
        return _Result([dict(r) for r in rows])


class _FakeDb:
    def __init__(self, tables):
        self.tables = tables
        self.writes: list[tuple[str, dict]] = []
        self.fail_tables: set[str] = set()

    def table(self, name):
        return _Query(self, name)


def _rows(n, ts, **cols):
    return [{"id": f"{ts}-{cols}-{i:05d}", **cols, "created_at": ts,
             "reviewed_at": ts, "added_at": ts} for i in range(n)]


@pytest.fixture
def check(monkeypatch):
    from services import row_growth_alert

    def _run(db, threshold=500, now=NOW):
        monkeypatch.setattr(row_growth_alert, "supabase_admin", db)
        return row_growth_alert.run_row_growth_check(threshold=threshold, now=now)

    return _run


def _alerts(db):
    return [p for t, p in db.writes if t == "error_logs"]


def test_user_over_500_new_rows_in_24h_is_flagged_once_in_error_logs(check):
    db = _FakeDb({
        "user_vocabulary": _rows(501, RECENT, user_id="spammer")
        + _rows(500, RECENT, user_id="heavy-but-ok")
        + _rows(900, OLD, user_id="old-bulk"),
    })
    summary = check(db)

    assert summary["flagged"] == [{"table": "user_vocabulary", "user_id": "spammer", "rows": 501}]
    assert {t for t, _ in db.writes} == {"error_logs"}
    [alert] = _alerts(db)
    assert alert["level"] == "warning" and alert["source"] == "backend"
    assert alert["request_id"] == "row-growth:2026-10-28:user_vocabulary:spammer"
    assert alert["extra"]["rows"] == 501 and alert["extra"]["threshold"] == 500
    assert "user_id" not in alert  # admin-only row; nothing addressed to the learner


def test_each_flashcard_table_is_watched_and_cards_are_attributed_via_their_stack(check):
    db = _FakeDb({
        "flashcard_stacks": _rows(3, RECENT, user_id="u1")
        + [{"id": "stack-u2", "user_id": "u2", "created_at": OLD}],
        "flashcard_cards": _rows(600, RECENT, stack_id="stack-u2"),
        "flashcard_reviews": _rows(501, RECENT, user_id="u3"),
        "flashcard_review_log": _rows(700, RECENT, user_id="u4"),
    })
    summary = check(db)

    assert {(f["table"], f["user_id"], f["rows"]) for f in summary["flagged"]} == {
        ("flashcard_cards", "u2", 600),
        ("flashcard_reviews", "u3", 501),
        ("flashcard_review_log", "u4", 700),
    }
    assert summary["alerted"] == 3


def test_second_run_on_the_same_day_does_not_repeat_the_alert(check):
    db = _FakeDb({"user_vocabulary": _rows(600, RECENT, user_id="spammer")})
    check(db)
    second = check(db, now=NOW + timedelta(hours=3))

    assert len(_alerts(db)) == 1
    assert second["alerted"] == 0 and len(second["flagged"]) == 1


def test_scan_cap_is_itself_reported(check, monkeypatch):
    from services import row_growth_alert

    monkeypatch.setattr(row_growth_alert, "PAGE_SIZE", 10)
    monkeypatch.setattr(row_growth_alert, "MAX_SCANNED_ROWS", 20)
    db = _FakeDb({"user_vocabulary": _rows(35, RECENT, user_id="spammer")})
    summary = check(db, threshold=15)

    assert summary["truncated_tables"] == ["user_vocabulary"]
    keys = {a["request_id"] for a in _alerts(db)}
    assert keys == {
        "row-growth:2026-10-28:user_vocabulary:scan-cap",
        "row-growth:2026-10-28:user_vocabulary:spammer",
    }


def test_a_table_that_cannot_be_read_is_reported_not_skipped(check):
    db = _FakeDb({"user_vocabulary": _rows(600, RECENT, user_id="spammer")})
    db.fail_tables.add("flashcard_review_log")
    summary = check(db)

    assert summary["failed_tables"] == ["flashcard_review_log"]
    keys = {a["request_id"] for a in _alerts(db)}
    assert "row-growth:2026-10-28:flashcard_review_log:check-failed" in keys
    assert "row-growth:2026-10-28:user_vocabulary:spammer" in keys


def test_default_settings_are_daily_with_a_500_row_threshold():
    from config import Settings

    s = Settings(_env_file=None)
    assert s.ROW_GROWTH_ALERT_ENABLED is True
    assert s.ROW_GROWTH_ALERT_INTERVAL_SECONDS == 86400
    assert s.ROW_GROWTH_ALERT_THRESHOLD == 500
