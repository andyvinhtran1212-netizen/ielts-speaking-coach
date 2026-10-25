"""E1 — backfill_cohort_writing_assignments: late joiners get the cohort's
still-open writing gives, idempotently.

Fan-out snapshots the roster at give-time (services/cohort_assignment_service.py
fan_out_assignment), so a student who joins a class LATER has no
writing_assignments row for gives already made. backfill_cohort_writing_assignments
reconciles that on enroll. These tests exercise the helper directly against a
tiny filtering fake so the contract is pinned independent of the HTTP path.
"""

from __future__ import annotations

from services.cohort_assignment_service import backfill_cohort_writing_assignments


class _R:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, table, sb):
        self.table = table; self.sb = sb
        self._f = []; self._op = "select"; self._payload = None

    def select(self, *a, **k): self._op = "select"; return self
    def insert(self, p): self._op = "insert"; self._payload = p; return self
    def eq(self, c, v): self._f.append((c, v)); return self
    def limit(self, *a, **k): return self
    def order(self, *a, **k): return self

    def _match(self, row):
        return all(str(row.get(c)) == str(v) for c, v in self._f)

    def execute(self):
        rows = self.sb.store.setdefault(self.table, [])
        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            created = [dict(it, id=f"new-{len(rows) + i}") for i, it in enumerate(items)]
            rows.extend(created)
            return _R([dict(r) for r in created])
        return _R([dict(r) for r in rows if self._match(r)])


class _FakeSB:
    def __init__(self, store): self.store = store
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
