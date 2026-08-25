from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import admin  # noqa: E402


async def _admin(_authorization):
    return {"id": "admin-1", "email": "admin@example.test"}


class _Query:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.action = "select"
        self.payload = None
        self.equals = []

    def select(self, *_args, **_kwargs): self.action = "select"; return self
    def insert(self, payload, *_args, **_kwargs): self.action = "insert"; self.payload = payload; return self
    def update(self, payload, *_args, **_kwargs): self.action = "update"; self.payload = payload; return self
    def delete(self, *_args, **_kwargs): self.action = "delete"; return self
    def eq(self, column, value, *_args, **_kwargs): self.equals.append((column, value)); return self
    def in_(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self

    def execute(self):
        if self.table == "topic_questions" and self.action == "select" and self.db.fail_question_select:
            raise RuntimeError("question metadata unavailable")
        rows = self.db.tables.setdefault(self.table, [])
        matches = [row for row in rows if all(row.get(key) == value for key, value in self.equals)]
        self.db.calls.append((self.table, self.action, self.payload, tuple(self.equals)))
        if self.action == "select":
            return SimpleNamespace(data=matches, count=len(matches))
        if self.action == "insert":
            inserted = self.payload if isinstance(self.payload, list) else [self.payload]
            inserted = [{"id": f"new-{index}", **row} for index, row in enumerate(inserted, 1)]
            rows.extend(inserted)
            return SimpleNamespace(data=inserted, count=len(inserted))
        if self.action == "update":
            for row in matches:
                row.update(self.payload or {})
            return SimpleNamespace(data=matches, count=len(matches))
        if self.action == "delete":
            if not self.db.ignore_delete:
                self.db.tables[self.table] = [row for row in rows if row not in matches]
            return SimpleNamespace(data=matches, count=len(matches))
        raise AssertionError(self.action)


class _DB:
    def __init__(self, *, topics=None, questions=None, fail_question_select=False, ignore_delete=False):
        self.tables = {"topics": topics or [], "topic_questions": questions or []}
        self.fail_question_select = fail_question_select
        self.ignore_delete = ignore_delete
        self.calls = []

    def table(self, name):
        return _Query(self, name)


def test_topic_metadata_lookup_failure_is_unknown_not_zero(monkeypatch):
    db = _DB(fail_question_select=True)
    monkeypatch.setattr(admin, "supabase_admin", db)

    rows = admin._serialize_topics_with_metadata([{"id": "t1", "title": "Travel", "part": 1, "is_active": True}])

    assert rows[0]["question_count"] is None
    assert rows[0]["question_metadata_lookup_failed"] is True
    assert rows[0]["status"] == "metadata_unavailable"


def test_generate_without_body_uses_safe_missing_only_mode(monkeypatch):
    called = []
    monkeypatch.setattr(admin, "require_admin", _admin)

    async def _generate(topic_id, user_id, *, replace_existing):
        called.append((topic_id, user_id, replace_existing))
        return {"topic_id": topic_id, "mode": "missing_only"}

    monkeypatch.setattr(admin, "_generate_questions_for_topic", _generate)

    result = asyncio.run(admin.generate_topic_questions("t1", body=None, authorization="Bearer test"))

    assert result["mode"] == "missing_only"
    assert called == [("t1", "admin-1", False)]
    assert admin.GenerateTopicQuestionsRequest().mode == "missing_only"


def test_create_question_persists_explicit_part_and_auto_order(monkeypatch):
    db = _DB(questions=[{"id": "q1", "topic_id": "t1", "part": 3, "is_active": True}])
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_touch_topic", lambda _topic_id: None)

    result = asyncio.run(admin.create_topic_question(
        "t1",
        admin.CreateTopicQuestionRequest(part=3, question_text="  Why is travel useful?  ", question_type="opinion"),
        authorization="Bearer test",
    ))

    assert result["part"] == 3
    assert result["order_num"] == 2
    assert result["question_text"] == "Why is travel useful?"


def test_update_question_can_change_part_and_clear_cue_card_metadata(monkeypatch):
    question = {
        "id": "q1", "topic_id": "t1", "part": 2, "question_text": "Old",
        "cue_card_bullets": ["old"], "cue_card_reflection": "old reflection",
    }
    db = _DB(questions=[question])
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_touch_topic", lambda _topic_id: None)

    result = asyncio.run(admin.update_topic_question(
        "t1",
        "q1",
        admin.UpdateTopicQuestionRequest(
            part=3,
            question_text="New",
            cue_card_bullets=None,
            cue_card_reflection=None,
        ),
        authorization="Bearer test",
    ))

    assert result["part"] == 3
    assert result["cue_card_bullets"] is None
    assert result["cue_card_reflection"] is None
    assert result["audio_url"] is None
    assert result["audio_path"] is None


@pytest.mark.parametrize(("from_part", "to_part"), [(1, 3), (3, 1), (1, 2), (3, 2)])
def test_update_question_part_change_invalidates_audio(monkeypatch, from_part, to_part):
    question = {
        "id": "q1", "topic_id": "t1", "part": from_part,
        "question_text": "Same question?",
        "audio_url": "https://audio.test/q1.mp3", "audio_path": "questions/q1.mp3",
    }
    db = _DB(questions=[question])
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_touch_topic", lambda _topic_id: None)

    result = asyncio.run(admin.update_topic_question(
        "t1",
        "q1",
        admin.UpdateTopicQuestionRequest(part=to_part),
        authorization="Bearer test",
    ))

    assert result["part"] == to_part
    assert result["question_text"] == "Same question?"
    assert result["audio_url"] is None
    assert result["audio_path"] is None


def test_update_question_keeps_audio_when_text_is_unchanged(monkeypatch):
    question = {
        "id": "q1", "topic_id": "t1", "part": 2, "question_text": "Same question?",
        "audio_url": "https://audio.test/q1.mp3", "audio_path": "questions/q1.mp3",
        "cue_card_bullets": ["  old bullet  "], "cue_card_reflection": " reflection ",
    }
    db = _DB(questions=[question])
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_touch_topic", lambda _topic_id: None)

    result = asyncio.run(admin.update_topic_question(
        "t1",
        "q1",
        admin.UpdateTopicQuestionRequest(question_text=" Same question? ", order_num=2),
        authorization="Bearer test",
    ))

    assert result["audio_url"] == "https://audio.test/q1.mp3"
    assert result["audio_path"] == "questions/q1.mp3"
    assert result["cue_card_bullets"] == ["  old bullet  "]


def test_create_non_part2_question_discards_cue_card_metadata(monkeypatch):
    db = _DB()
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_touch_topic", lambda _topic_id: None)

    result = asyncio.run(admin.create_topic_question(
        "t1",
        admin.CreateTopicQuestionRequest(
            part=3,
            question_text="Why?",
            question_type=" opinion ",
            order_num=1,
            cue_card_bullets=["must disappear"],
            cue_card_reflection="must disappear",
        ),
        authorization="Bearer test",
    ))

    assert result["question_type"] == "opinion"
    assert result["cue_card_bullets"] is None
    assert result["cue_card_reflection"] is None


def test_empty_question_patch_is_rejected_even_for_non_part2(monkeypatch):
    db = _DB(questions=[{
        "id": "q1", "topic_id": "t1", "part": 3, "question_text": "Why?",
        "cue_card_bullets": None, "cue_card_reflection": None,
    }])
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(admin.update_topic_question(
            "t1", "q1", admin.UpdateTopicQuestionRequest(), authorization="Bearer test",
        ))

    assert caught.value.status_code == 400
    assert "Không có trường" in str(caught.value.detail)
    assert not any(action == "update" for _table, action, _payload, _equals in db.calls)


def test_topic_delete_fails_when_canonical_readback_still_finds_row(monkeypatch):
    db = _DB(topics=[{"id": "t1", "title": "Travel"}], ignore_delete=True)
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(admin.delete_topic("t1", authorization="Bearer test"))

    assert caught.value.status_code == 500
    assert "chưa được xóa" in str(caught.value.detail)
