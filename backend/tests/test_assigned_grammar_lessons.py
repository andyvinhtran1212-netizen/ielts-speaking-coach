"""The lesson path must remain separate from MASTER30 diagnostic evidence."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import admin_class_assignments as assignments
from routers import class_student
from services import grammar_lesson_content as content
from services import grammar_lesson_service as lessons


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args): return self
    def eq(self, *_args): return self
    def order(self, *_args): return self
    def limit(self, *_args): return self
    def execute(self): return SimpleNamespace(data=self.rows)


def test_legacy_reviewed_package_has_separate_questions_and_real_articles():
    package = content.load_version("v1")
    assert package["version"] == "v1"
    assert len(package["lessons"]) == 15
    assert sum(len(row["questions"]) for row in package["lessons"].values()) >= 120
    assert content.lesson_content("M30-B02", "v1") is None
    for lesson_id, row in package["lessons"].items():
        assert row["source_bank_code"].startswith("G-")
        assert len(row["questions"]) >= 8, lesson_id
        assert all(question["source_qid"] for question in row["questions"])


def test_answer_key_is_visible_only_for_answered_question():
    lesson = content.lesson_content("M30-B04")
    assert lesson is not None
    first, second = lesson["questions"][:2]
    before = content.public_lesson(lesson)
    assert "correct_index" not in before["questions"][0]
    assert "explanation" not in before["questions"][1]
    after = content.public_lesson(lesson, {
        first["id"]: {"selected_index": 0, "is_correct": first["correct_index"] == 0},
    })
    assert after["questions"][0]["correct_index"] == first["correct_index"]
    assert "correct_index" not in after["questions"][1]
    assert second["id"] not in {first["id"]}


def test_catalog_marks_missing_practice_unready_instead_of_using_diagnostic(monkeypatch):
    monkeypatch.setattr(lessons, "_active_release", lambda: {"id": "release"})
    monkeypatch.setattr(lessons, "enabled", lambda: True)
    monkeypatch.setattr(lessons, "lesson_content", lambda lesson_id: content.lesson_content(lesson_id, "v1"))
    rows = [{"id": str(uuid4()), "lesson_id": f"M30-B{number:02d}",
             "lesson_no": number, "title": f"Lesson {number}"}
            for number in range(1, 31)]
    monkeypatch.setattr(lessons, "supabase_admin", SimpleNamespace(table=lambda name: _Rows(rows)))
    catalog = lessons.catalog()
    assert len(catalog) == 30
    assert next(row for row in catalog if row["id"] == "M30-B04")["ready"]
    b02 = next(row for row in catalog if row["id"] == "M30-B02")
    assert not b02["ready"] and b02["question_count"] == 0
    assert "đã có câu hỏi" in b02["reason"]
    assert "chưa nạp và rà soát" in b02["reason"]
    b07 = next(row for row in catalog if row["id"] == "M30-B07")
    assert "đã có câu hỏi" in b07["reason"]
    b18 = next(row for row in catalog if row["id"] == "M30-B18")
    assert "đã có câu hỏi" in b18["reason"]
    b09 = next(row for row in catalog if row["id"] == "M30-B09")
    assert "đã có nguồn" in b09["reason"]


def test_current_all_thirty_catalog_requires_reviewed_practice_and_flag(monkeypatch):
    monkeypatch.setattr(lessons, "_active_release", lambda: {"id": "release"})
    rows = [{"id": str(uuid4()), "lesson_id": f"M30-B{number:02d}",
             "lesson_no": number, "title": f"Lesson {number}"}
            for number in range(1, 31)]
    monkeypatch.setattr(lessons, "supabase_admin", SimpleNamespace(table=lambda name: _Rows(rows)))
    monkeypatch.setattr(lessons, "enabled", lambda: True)
    catalog = lessons.catalog()
    assert len(catalog) == 30
    assert all(row["ready"] and row["question_count"] == 12 and row["content_version"] == "v2" for row in catalog)
    monkeypatch.setattr(lessons, "enabled", lambda: False)
    assert all(not row["ready"] and "đang tắt" in row["reason"] for row in lessons.catalog())


def test_give_requires_unique_request_id_and_fingerprint_changes_with_intent():
    base = {"skill": "grammar", "title": "Ôn B04", "grammar_lesson_id": "M30-B04",
            "student_ids": [str(uuid4())], "due_date": "2026-10-10"}
    with pytest.raises(ValueError, match="mã yêu cầu"):
        assignments.AssignmentCreate(**base)
    body = assignments.AssignmentCreate(**base, give_request_id=uuid4())
    retry = assignments.AssignmentCreate(**base, give_request_id=body.give_request_id)
    changed = assignments.AssignmentCreate(**{**base, "title": "Ôn lại B04"},
                                            give_request_id=body.give_request_id)
    assert assignments._grammar_give_fingerprint(body) == assignments._grammar_give_fingerprint(retry)
    assert assignments._grammar_give_fingerprint(body) != assignments._grammar_give_fingerprint(changed)


def test_wrong_course_cannot_open_master30_assignment_catalog(monkeypatch):
    monkeypatch.setattr(assignments, "_cohort_course_id", lambda _cohort: "course-1")
    monkeypatch.setattr(assignments, "supabase_admin", SimpleNamespace(
        table=lambda _name: _Rows([{"code": "C4"}]),
    ))
    with pytest.raises(HTTPException) as caught:
        assignments._require_course_five("cohort-1")
    assert caught.value.status_code == 400


@pytest.mark.asyncio
async def test_course_five_lesson_give_reuses_atomic_class_fanout(monkeypatch):
    student_id = str(uuid4())
    request_id = uuid4()
    body = assignments.AssignmentCreate(
        skill="grammar", title="Ôn B04", grammar_lesson_id="M30-B04",
        give_request_id=request_id, student_ids=[student_id], due_date="2026-10-10",
    )
    async def admin(_header): return {"id": str(uuid4())}
    monkeypatch.setattr(assignments, "require_admin", admin)
    monkeypatch.setattr(assignments, "_require_cohort", lambda _cohort: None)
    monkeypatch.setattr(assignments, "_require_course_five", lambda _cohort: None)
    monkeypatch.setattr(assignments, "_existing_grammar_give", lambda *_args: None)
    monkeypatch.setattr(lessons, "prepare_assignment", lambda _lesson: (str(uuid4()), {
        "assignment_type": "grammar_lesson", "lesson_id": "M30-B04",
    }))
    captured = {}
    def create(_db, **kwargs):
        captured.update(kwargs)
        return {"id": str(uuid4()), "student_count": 1, "unactivated_count": 0}
    monkeypatch.setattr(assignments, "create_class_assignment", create)
    result = await assignments.create_assignment(str(uuid4()), body)
    assert result["student_count"] == 1
    assert captured["skill"] == "grammar" and captured["student_ids"] == [student_id]
    assert captured["content_config"]["give_request_id"] == str(request_id)
    assert captured["content_config"]["give_fingerprint"]


def test_paused_flag_keeps_completed_history_readable(monkeypatch):
    monkeypatch.setattr(lessons, "enabled", lambda: False)
    monkeypatch.setattr(lessons, "is_accepting_submissions", lambda _assignment: True)
    monkeypatch.setattr(lessons, "is_assignment_open", lambda _assignment: True)
    lesson = content.lesson_content("M30-B04", "v1")
    assert lesson is not None
    assignment = {"id": "assignment", "title": "B04", "content_config": {
        "lesson_id": "M30-B04", "lesson_title": "Articles", "content_version": "v1",
        "question_count": len(lesson["questions"]), "practice_focus": lesson["focus"],
    }}
    paused = lessons._public_state({"id": "item"}, assignment, None)
    assert paused["status"] == "paused" and paused["article"]
    done = lessons._public_state({"id": "item"}, assignment, {
        "id": "attempt", "status": "completed", "content_snapshot": lesson,
        "answers": {}, "correct_count": 0,
    })
    assert done["status"] == "completed" and not done["can_submit"]


@pytest.mark.asyncio
@pytest.mark.parametrize("submitted", [False, True])
async def test_my_class_reopens_saved_lesson_after_deadline(monkeypatch, submitted):
    item = {"id": "item-1", "assignment_id": "assignment-1", "student_id": "student-1",
            "state": "submitted" if submitted else "opened",
            "submitted_at": "2026-10-01T00:00:00Z" if submitted else None,
            "artifact_kind": "grammar_lesson_attempt" if submitted else None,
            "artifact_id": "attempt-1" if submitted else None}
    assignment = {"id": "assignment-1", "cohort_id": "cohort-1", "skill": "grammar",
                  "content_config": {"assignment_type": "grammar_lesson"}}
    rows = {"class_assignment_items": [item], "class_assignments": [assignment]}
    async def user(_header): return {"id": "user-1"}
    monkeypatch.setattr(class_student, "get_supabase_user", user)
    monkeypatch.setattr(class_student, "_student_for_user", lambda _user: {
        "id": "student-1", "cohort_id": "cohort-1",
    })
    monkeypatch.setattr(class_student, "supabase_admin", SimpleNamespace(
        table=lambda name: _Rows(rows[name]),
    ))
    monkeypatch.setattr(class_student, "is_assignment_open", lambda _assignment: True)
    monkeypatch.setattr(class_student, "is_accepting_submissions", lambda _assignment: False)
    monkeypatch.setattr(class_student, "student_is_active_in_cohort", lambda *_args: True)
    result = await class_student.start_assignment("item-1")
    assert result["grammar_lesson_path"] == "/grammar-lessons/assigned?assignment_item=item-1"
