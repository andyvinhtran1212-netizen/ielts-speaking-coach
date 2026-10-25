"""E1 — backfill_cohort_writing_assignments: late joiners get the cohort's
still-open writing gives, idempotently.

Fan-out snapshots the roster at give-time (services/cohort_assignment_service.py
fan_out_assignment), so a student who joins a class LATER has no
writing_assignments row for gives already made. backfill_cohort_writing_assignments
reconciles that on enroll. These tests exercise the helper directly against a
tiny filtering fake so the contract is pinned independent of the HTTP path.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from services.cohort_assignment_service import (
    _deadline_is_open,
    backfill_cohort_writing_assignments,
    parse_deadline,
)


class _R:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, table, sb):
        self.table = table; self.sb = sb
        self._f = []; self._op = "select"; self._payload = None
        self._range = None

    def select(self, *a, **k): self._op = "select"; return self
    def insert(self, p): self._op = "insert"; self._payload = p; return self
    def eq(self, c, v): self._f.append((c, v)); return self
    def limit(self, *a, **k): return self
    def order(self, *a, **k): return self
    def range(self, start, end): self._range = (start, end); return self

    def _match(self, row):
        return all(str(row.get(c)) == str(v) for c, v in self._f)

    def execute(self):
        rows = self.sb.store.setdefault(self.table, [])
        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            created = [dict(it, id=f"new-{len(rows) + i}") for i, it in enumerate(items)]
            rows.extend(created)
            return _R([dict(r) for r in created])
        matched = [dict(r) for r in rows if self._match(r)]
        if self._range is not None:
            start, end = self._range
            cap = self.sb.page_cap
            # PostgREST serves at most `cap` rows per page even when the
            # requested .range() span is wider; emulate that so pagination is
            # actually exercised.
            end = min(end, start + cap - 1)
            matched = matched[start:end + 1]
        return _R(matched)


class _FakeSB:
    def __init__(self, store, page_cap=1000):
        self.store = store; self.page_cap = page_cap
    def table(self, name): return _Q(name, self)


COHORT = "c-700"
NEW = "s-new"
OLD = "s-old"


def _give(**over):
    base = {
        "prompt_id": "p-1", "student_id": OLD, "cohort_id": COHORT,
        "assignment_group_id": "g-1", "name": "Buổi 1", "allow_soft_check": False,
        "assigned_by": "gv-a", "deadline": None, "instructions": "x",
        "is_timed": False, "time_limit_minutes": None, "analysis_level": 3,
        "grading_tier": "standard", "status": "pending",
    }
    base.update(over)
    return base


def test_backfills_open_give_and_copies_template():
    store = {"writing_assignments": [_give(name="Buổi 1", instructions="Viết đoạn")]}
    db = _FakeSB(store)
    res = backfill_cohort_writing_assignments(db, student_id=NEW, cohort_id=COHORT)
    assert res["created_count"] == 1
    mine = [w for w in store["writing_assignments"] if w["student_id"] == NEW]
    assert len(mine) == 1
    row = mine[0]
    assert row["prompt_id"] == "p-1"
    assert row["name"] == "Buổi 1" and row["instructions"] == "Viết đoạn"
    assert row["assignment_group_id"] == "g-1"
    assert row["status"] == "pending"


def test_idempotent_second_run_creates_nothing():
    store = {"writing_assignments": [_give()]}
    db = _FakeSB(store)
    first = backfill_cohort_writing_assignments(db, student_id=NEW, cohort_id=COHORT)
    second = backfill_cohort_writing_assignments(db, student_id=NEW, cohort_id=COHORT)
    assert first["created_count"] == 1
    assert second["created_count"] == 0
    assert len([w for w in store["writing_assignments"] if w["student_id"] == NEW]) == 1


def test_skips_overdue_give():
    store = {"writing_assignments": [_give(deadline="2000-01-01T00:00:00+00:00")]}
    db = _FakeSB(store)
    res = backfill_cohort_writing_assignments(db, student_id=NEW, cohort_id=COHORT)
    assert res["created_count"] == 0


def test_future_deadline_is_open():
    store = {"writing_assignments": [_give(deadline="2999-01-01T00:00:00+00:00")]}
    db = _FakeSB(store)
    res = backfill_cohort_writing_assignments(db, student_id=NEW, cohort_id=COHORT)
    assert res["created_count"] == 1


def test_multiple_prompts_one_row_each():
    store = {"writing_assignments": [
        _give(prompt_id="p-1"), _give(prompt_id="p-2"),
        _give(prompt_id="p-1", student_id="s-other"),   # another classmate, same give
    ]}
    db = _FakeSB(store)
    res = backfill_cohort_writing_assignments(db, student_id=NEW, cohort_id=COHORT)
    assert res["created_count"] == 2                     # one per distinct prompt
    prompts = {w["prompt_id"] for w in store["writing_assignments"]
               if w["student_id"] == NEW}
    assert prompts == {"p-1", "p-2"}


def test_no_gives_in_cohort_is_noop():
    db = _FakeSB({"writing_assignments": []})
    res = backfill_cohort_writing_assignments(db, student_id=NEW, cohort_id=COHORT)
    assert res == {"created_count": 0, "assignment_ids": []}


def test_open_give_beyond_first_page_is_still_backfilled():
    """Capped-response guard: the cohort's assignment history fills a full
    PostgREST page (1000 per-student rows) of already-closed gives, and the only
    OPEN give sits on page 2. A bare single .execute() would read only the first
    page and miss it, leaving the late joiner with no homework. Pagination must
    surface it."""
    # 1000 overdue filler rows (one full page) + 1 open give beyond the page.
    filler = [
        _give(prompt_id=f"old-{i}", assignment_group_id=f"g-old-{i}",
              deadline="2000-01-01T00:00:00+00:00")
        for i in range(1000)
    ]
    open_give = _give(prompt_id="p-open", assignment_group_id="g-open",
                      deadline="2999-01-01T00:00:00+00:00")
    store = {"writing_assignments": filler + [open_give]}
    db = _FakeSB(store, page_cap=1000)
    res = backfill_cohort_writing_assignments(db, student_id=NEW, cohort_id=COHORT)
    assert res["created_count"] == 1
    mine = [w for w in store["writing_assignments"] if w["student_id"] == NEW]
    assert [w["prompt_id"] for w in mine] == ["p-open"]


# ── deadlines are compared as instants, never as ISO strings ───────────────
#
# The cases marked (string-wrong) are ones where STRING order disagrees with
# TIME order, so a lexicographic compare against now.isoformat() gets them wrong;
# the rest pin the date-only / naive / equal-instant rules.

NOW_UTC = datetime(2026, 10, 25, 2, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("raw, expected", [
    ("2026-10-25T02:00:00Z",       datetime(2026, 10, 25, 2, 0, tzinfo=timezone.utc)),
    ("2026-10-25T02:00:00+00:00",  datetime(2026, 10, 25, 2, 0, tzinfo=timezone.utc)),
    ("2026-10-25T09:00:00+07:00",  datetime(2026, 10, 25, 2, 0, tzinfo=timezone.utc)),
    ("2026-10-25T02:00:00",        datetime(2026, 10, 25, 2, 0, tzinfo=timezone.utc)),  # naive = UTC
    ("2026-10-25",                 datetime(2026, 10, 25, 0, 0, tzinfo=timezone.utc)),  # date-only
    (date(2026, 10, 25),           datetime(2026, 10, 25, 0, 0, tzinfo=timezone.utc)),
    (datetime(2026, 10, 25, 2, 0), datetime(2026, 10, 25, 2, 0, tzinfo=timezone.utc)),
    (None, None),
    ("", None),
])
def test_parse_deadline_normalises_every_shape_to_aware_utc(raw, expected):
    got = parse_deadline(raw)
    assert got == expected
    if got is not None:
        assert got.utcoffset() == timedelta(0)


def test_parse_deadline_rejects_garbage_so_callers_pick_a_policy():
    with pytest.raises(ValueError):
        parse_deadline("next friday")


@pytest.mark.parametrize("deadline, is_open", [
    # (string-wrong) 08:00+07:00 == 01:00Z — an hour BEFORE now, though
    # "08" > "02" as text.
    ("2026-10-25T08:00:00+07:00", False),
    # (string-wrong) 23:00-05:00 on the 24th == 04:00Z on the 25th — still
    # open, though "2026-10-24" < "2026-10-25" as text.
    ("2026-10-24T23:00:00-05:00", True),
    # Same instant spelled two ways: open (deadline == now still accepts).
    ("2026-10-25T09:00:00+07:00", True),
    # Date-only = midnight UTC of that day, already behind now.
    ("2026-10-25", False),
    ("2026-10-26", True),
    # Naive value is UTC.
    ("2026-10-25T03:00:00", True),
    (None, True),
])
def test_deadline_is_open_compares_instants_across_offsets(deadline, is_open):
    assert _deadline_is_open(deadline, NOW_UTC) is is_open


def test_deadline_is_open_accepts_a_non_utc_now():
    now_vn = NOW_UTC.astimezone(timezone(timedelta(hours=7)))   # 09:00+07:00
    assert _deadline_is_open("2026-10-25T08:00:00+07:00", now_vn) is False
    assert _deadline_is_open("2026-10-25T03:00:00+00:00", now_vn) is True


def test_z_suffix_is_compared_as_utc_not_as_a_character():
    """(string-wrong) 'Z' sorts after '.', so "02:00:00Z" >= "02:00:00.5+00:00"
    as text, yet the deadline passed half a second ago."""
    now = NOW_UTC.replace(microsecond=500000)
    assert "2026-10-25T02:00:00Z" >= now.isoformat()
    assert _deadline_is_open("2026-10-25T02:00:00Z", now) is False


def test_malformed_deadline_fails_open(caplog):
    with caplog.at_level("WARNING"):
        assert _deadline_is_open("not-a-date", NOW_UTC, row_ref="g-1") is True
    assert "g-1" in caplog.text and "not-a-date" not in caplog.text


def test_backfill_uses_instant_order_for_mixed_offset_deadlines():
    """End to end through the backfill: the +07:00 give closed an hour ago must
    NOT be copied, the -05:00 give still open must be — the exact opposite of
    what a string compare against now.isoformat() decides."""
    store = {"writing_assignments": [
        _give(prompt_id="p-closed", assignment_group_id="g-closed",
              deadline="2026-10-25T08:00:00+07:00"),
        _give(prompt_id="p-open", assignment_group_id="g-open",
              deadline="2026-10-24T23:00:00-05:00"),
    ]}
    db = _FakeSB(store)
    res = backfill_cohort_writing_assignments(
        db, student_id=NEW, cohort_id=COHORT, now=NOW_UTC)
    assert res["created_count"] == 1
    mine = [w["prompt_id"] for w in store["writing_assignments"] if w["student_id"] == NEW]
    assert mine == ["p-open"]
