from __future__ import annotations

from scripts import regrade_reading_grouped_mcq_attempts as backfill
from services.reading_test_grader import collect_answer_key, grade_attempt


class _Query:
    def __init__(self, owner, table):
        self.owner = owner
        self.table = table
        self.payload = None
        self.filters = []

    def update(self, payload):
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def execute(self):
        self.owner.writes.append((self.table, self.payload, self.filters))
        return type("Result", (), {"data": []})()


class _FakeDatabase:
    def __init__(self):
        self.writes = []

    def table(self, name):
        return _Query(self, name)


class _PagedQuery:
    def __init__(self, owner):
        self.owner = owner
        self.bounds = (0, backfill._PAGE_SIZE - 1)

    def select(self, *_args):
        return self

    def eq(self, *_args):
        return self

    def order(self, column):
        assert column == "id"
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        self.owner.ranges.append(self.bounds)
        return self

    def execute(self):
        start, end = self.bounds
        return type("Result", (), {"data": self.owner.rows[start:end + 1]})()


class _PagedDatabase:
    def __init__(self, rows):
        self.rows = rows
        self.ranges = []

    def table(self, name):
        assert name == "reading_test_attempts"
        return _PagedQuery(self)


def _reversed_group_result():
    options = [
        {"label": "A", "text": "Alpha"},
        {"label": "B", "text": "Beta"},
        {"label": "C", "text": "Gamma"},
        {"label": "D", "text": "Delta"},
    ]
    rows = [
        {
            "q_num": 21,
            "question_type": "mcq_single",
            "prompt": "Which TWO statements are made?",
            "payload": {"options": options},
            "answer": {"answer": "D"},
            "skill_tag": "detail",
            "passage_id": "p2",
        },
        {
            "q_num": 22,
            "question_type": "mcq_single",
            "prompt": "Which TWO statements are made?",
            "payload": {"options": options},
            "answer": {"answer": "B"},
            "skill_tag": "detail",
            "passage_id": "p2",
        },
    ]
    key = collect_answer_key(rows, {"p2": 2})
    return grade_attempt(
        [{"q_num": 21, "user_answer": "B"}, {"q_num": 22, "user_answer": "D"}],
        key,
    )


def test_backfill_updates_all_canonical_reading_result_fields_and_mock_draft(monkeypatch):
    result = _reversed_group_result()
    assert result["score"] == 2
    assert {row["expected"] for row in result["per_question"]} == {"B, D"}

    fake = _FakeDatabase()
    draft_updates = []
    monkeypatch.setattr(backfill, "supabase_admin", fake)
    monkeypatch.setattr(
        backfill,
        "_merge_review_ai_draft",
        lambda sitting_id, patch: draft_updates.append((sitting_id, patch)),
    )
    attempt = {
        "id": "attempt-1",
        "sitting_id": "sitting-1",
        "score": 0,
        "band_estimate": None,
        "grading_details": [],
        "skill_breakdown": {},
    }

    backfill._apply_regrade(attempt, result)

    assert fake.writes == [(
        "reading_test_attempts",
        {
            "score": 2,
            "grading_details": result["per_question"],
            "skill_breakdown": result["skill_breakdown"],
            "band_estimate": result["band_estimate"],
        },
        [("id", "attempt-1")],
    )]
    assert draft_updates == [(
        "sitting-1",
        {"reading": {"raw": 2, "band": result["band_estimate"]}},
    )]


def test_backfill_detects_result_or_mock_draft_drift():
    result = _reversed_group_result()
    current = {
        "score": result["score"],
        "band_estimate": result["band_estimate"],
        "grading_details": result["per_question"],
        "skill_breakdown": result["skill_breakdown"],
        "sitting_id": "sitting-1",
    }
    matching_draft = {
        "sitting-1": {"raw": result["score"], "band": result["band_estimate"]},
    }
    assert backfill._result_changed(current, result, matching_draft) is False

    stale_draft = {"sitting-1": {"raw": 0, "band": None}}
    assert backfill._result_changed(current, result, stale_draft) is True

    stale_attempt = {**current, "grading_details": []}
    assert backfill._result_changed(stale_attempt, result, matching_draft) is True


def test_backfill_paginates_past_postgrest_one_thousand_row_cap(monkeypatch):
    rows = [{"id": f"attempt-{index:04d}"} for index in range(1005)]
    fake = _PagedDatabase(rows)
    monkeypatch.setattr(backfill, "supabase_admin", fake)

    fetched = backfill._attempts_for_test("test-1")

    assert fetched == rows
    assert fake.ranges == [(0, 999), (1000, 1999)]
