"""Owned Grammar history keeps frozen question identity and fails visibly.

This is a read-path regression suite; the transport rejects all writes/RPCs.
Actual PostgreSQL/ASGI capture is recorded separately from these unit controls.
"""
from copy import deepcopy

import pytest
from fastapi import HTTPException

from services import quiz_service

USER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
OLD = "33333333-3333-4333-8333-333333333333"
CURRENT = "44444444-4444-4444-8444-444444444444"
CODE = "G-tenses-present-simple"


class ReadOnlyHistory:
    def __init__(self, rows):
        self.rows = deepcopy(rows)
        self.calls = []

    def table(self, name):
        return HistoryQuery(self, name)

    def rpc(self, *_args, **_kwargs):
        raise AssertionError("Mistake history must not call a lifecycle RPC")


class HistoryQuery:
    def __init__(self, client, table):
        self.client, self.name = client, table
        self.columns, self.filters = None, []
        self.sort, self.cap = None, None

    def select(self, columns):
        self.columns = [column.strip() for column in columns.split(",")]
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, list(values)))
        return self

    def order(self, column, desc=False):
        self.sort = (column, desc)
        return self

    def limit(self, cap):
        self.cap = cap
        return self

    def execute(self):
        assert self.columns is not None
        self.client.calls.append({"table": self.name, "columns": self.columns,
                                  "filters": deepcopy(self.filters)})
        rows = self.client.rows.get(self.name, [])
        for op, column, value in self.filters:
            rows = [row for row in rows if (row.get(column) == value if op == "eq"
                                            else row.get(column) in value)]
        if self.sort:
            column, desc = self.sort
            rows = sorted(rows, key=lambda row: row.get(column) or "", reverse=desc)
        if self.cap is not None:
            rows = rows[:self.cap]
        from types import SimpleNamespace
        return SimpleNamespace(data=[{key: row[key] for key in self.columns if key in row}
                                     for row in rows])

    def _write(self, *_args, **_kwargs):
        raise AssertionError("Mistake history must not mutate stored rows")

    insert = update = delete = upsert = _write


def stored_history():
    banks = [{"id": bank, "code": CODE + ("~" + "b" * 16 if current else ""),
              "title": "Present simple", "skill_area": "grammar",
              "grammar_canonical_code": CODE, "grammar_revision": revision * 64,
              "grammar_is_current": current}
             for bank, current, revision in [(OLD, False, "a"), (CURRENT, True, "b")]]
    return {
        "quiz_banks": banks,
        "quiz_attempts": [{"user_id": user, "bank_id": bank, "item_key": "same-item",
                           "qid": "same-qid", "is_correct": False, "answer_given": "0",
                           "created_at": date}
                          for user, bank, date in [(USER, OLD, "2026-09-29T10:00:00Z"),
                                                  (USER, CURRENT, "2026-09-30T10:00:00Z"),
                                                  (OTHER, OLD, "2026-10-01T10:00:00Z")]],
        "quiz_questions": [{"bank_id": bank, "item_key": "same-item", "qid": "same-qid",
                            "prompt": prompt, "input": "choice", "options": ["A", "B", "C"],
                            "answer": answer, "explain": explanation}
                           for bank, prompt, answer, explanation in [
                               (OLD, "Frozen original prompt", 1, "Frozen original explanation"),
                               (CURRENT, "Reviewed corrected prompt", 2, "Reviewed corrected explanation")]],
        "quiz_word_stats": [],
    }


def read(monkeypatch, rows, skill="grammar"):
    client = ReadOnlyHistory(rows)
    monkeypatch.setattr(quiz_service, "supabase_admin", client)
    return client, quiz_service.student_mistakes(USER, skill_area=skill)


def test_history_uses_each_frozen_bank_question_and_owns_every_attempt(monkeypatch):
    rows = stored_history()
    before = deepcopy(rows)
    client, result = read(monkeypatch, rows)
    items = {item["bank_id"]: item for item in result["items"]}
    assert set(items) == {OLD, CURRENT}
    assert result["attempts_scanned"] == 2  # The other user's newer answer is excluded.
    old, current = items[OLD]["questions"][0], items[CURRENT]["questions"][0]
    assert (old["prompt"], old["correct_answer"], old["explain"]) == (
        "Frozen original prompt", "B", "Frozen original explanation")
    assert (current["prompt"], current["correct_answer"], current["explain"]) == (
        "Reviewed corrected prompt", "C", "Reviewed corrected explanation")
    assert old["wrong_times"] == current["wrong_times"] == 1
    assert old["your_answer"] == current["your_answer"] == "A"
    for table in ("quiz_attempts", "quiz_word_stats"):
        call = next(call for call in client.calls if call["table"] == table)
        assert ("eq", "user_id", USER) in call["filters"]
    assert ("eq", "is_correct", False) in next(
        call for call in client.calls if call["table"] == "quiz_attempts")["filters"]
    assert ("eq", "skill_area", "grammar") in client.calls[0]["filters"]
    question_calls = [call for call in client.calls if call["table"] == "quiz_questions"]
    assert {next(value for op, key, value in call["filters"] if key == "bank_id")
            for call in question_calls} == {OLD, CURRENT}
    assert all(("in", "qid", ["same-qid"]) in call["filters"] for call in question_calls)
    assert client.rows == before and rows == before


@pytest.mark.parametrize("bank", [OLD, CURRENT])
def test_missing_managed_question_is_unavailable_not_partial_or_empty(monkeypatch, bank):
    rows = stored_history()
    rows["quiz_questions"] = [row for row in rows["quiz_questions"] if row["bank_id"] != bank]
    client = ReadOnlyHistory(rows)
    monkeypatch.setattr(quiz_service, "supabase_admin", client)
    with pytest.raises(HTTPException) as failure:
        quiz_service.student_mistakes(USER, skill_area="grammar")
    assert failure.value.status_code == 503
    assert failure.value.detail["error_code"] == "grammar_revision_unavailable"
    meta_read = next(call for call in client.calls
                     if call["table"] == "quiz_banks" and "code" in call["columns"])
    assert {"grammar_canonical_code", "grammar_revision", "grammar_is_current"} <= set(meta_read["columns"])
    assert client.rows == rows


@pytest.mark.parametrize("field,value", [
    ("grammar_canonical_code", "G-not-reviewed"),
    ("grammar_revision", None),
    ("grammar_revision", "invalid"),
    ("grammar_is_current", "false"),
    ("skill_area", "vocab"),
])
def test_missing_question_with_malformed_managed_header_stays_unavailable(monkeypatch, field, value):
    rows = stored_history()
    rows["quiz_questions"] = []
    rows["quiz_banks"][0][field] = value
    client = ReadOnlyHistory(rows)
    monkeypatch.setattr(quiz_service, "supabase_admin", client)
    with pytest.raises(HTTPException) as failure:
        quiz_service.student_mistakes(USER)
    assert failure.value.status_code == 503
    assert failure.value.detail["error_code"] == "grammar_revision_unavailable"


def test_missing_parent_is_still_unidentified_and_keeps_existing_skip(monkeypatch):
    """No marker remains to identify this bank; this narrow guard cannot prove it."""
    rows = stored_history()
    rows["quiz_banks"] = [row for row in rows["quiz_banks"] if row["id"] != OLD]
    rows["quiz_questions"] = [row for row in rows["quiz_questions"] if row["bank_id"] != OLD]
    client, result = read(monkeypatch, rows, skill=None)
    assert [item["bank_id"] for item in result["items"]] == [CURRENT]
    assert result["attempts_scanned"] == 2
    assert client.rows == rows


def test_unmanaged_retired_question_and_empty_owned_history_keep_existing_behavior(monkeypatch):
    rows = stored_history()
    rows["quiz_questions"] = []
    for bank in rows["quiz_banks"]:
        bank.update(grammar_canonical_code=None, grammar_revision=None, grammar_is_current=False)
    client, result = read(monkeypatch, rows)
    assert result["items"] == [] and result["total_missed_words"] == 0
    assert client.rows == rows
    rows["quiz_attempts"] = [row for row in rows["quiz_attempts"] if row["user_id"] == OTHER]
    client, result = read(monkeypatch, rows)
    assert result == {"items": [], "total_missed_words": 0}
    assert [call["table"] for call in client.calls] == ["quiz_banks", "quiz_attempts"]
