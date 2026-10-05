"""Independent approval must be tied to the exact teaching/practice served."""
import copy
import json

import pytest

from services import grammar_lesson_content as content


@pytest.fixture
def reviewed_package(tmp_path, monkeypatch):
    lessons = {}
    approvals = {}
    for number in range(1, 31):
        lesson_id = f"M30-B{number:02d}"
        lesson = {
            "title": f"Lesson {number}", "focus": "Subject and finite verb",
            "lesson_notes": "Teaching material. " * 100,
            "learning_objectives": ["Identify a finite verb"],
            "coverage_review": "A small formative practice sample.",
            "source_kind": "master30-authored-practice", "article": None,
            "questions": [{
                "id": f"M30P2-B{number:02d}-{q:02d}", "prompt": "Choose the finite verb.",
                "options": ["travels", "travelling", "to travel", "a traveller"],
                "correct_index": 0, "explanation": "Travels is a finite verb.",
                "target": "finite verb", "error_tags": ["finite_verb"],
                "distractor_mechanisms": [None, "N1", "N2", "N3"],
                "provenance": {"kind": "newly_authored", "basis": "test fixture"},
            } for q in range(1, 13)],
        }
        lessons[lesson_id] = lesson
        approvals[lesson_id] = {"decision": "approved",
                                "content_sha256": content.reviewed_content_sha256(lesson)}
    package = {"version": "v2", "lessons": lessons}
    review = {"version": "v2", "decision": "approved",
              "reviewer_role": "senior_content_gate", "lessons": approvals}
    monkeypatch.setattr(content, "PRACTICE_ROOT", tmp_path)
    content.load_version.cache_clear()
    (tmp_path / "v2.json").write_text(json.dumps(package))
    (tmp_path / "v2-review.json").write_text(json.dumps(review))
    yield tmp_path, package, review
    content.load_version.cache_clear()


def test_reviewed_v2_has_all_lessons_and_teaching_without_required_wiki_link(reviewed_package):
    package = content.load_version("v2")
    assert len(package["lessons"]) == 30
    public = content.public_lesson(package["lessons"]["M30-B02"])
    assert public["lesson_notes"] and public["learning_objectives"]
    assert public["article"] is None
    assert all("correct_index" not in q and "explanation" not in q
               and "provenance" not in q for q in public["questions"])


@pytest.mark.parametrize("change", ["notes", "key", "options", "explanation", "missing_approval", "missing_lesson"])
def test_gate_rejects_unreviewed_edits_and_partial_release(reviewed_package, change):
    path, package, review = reviewed_package
    lesson = package["lessons"]["M30-B02"]
    if change == "notes": lesson["lesson_notes"] += "A new rule."
    elif change == "key": lesson["questions"][0]["correct_index"] = 1
    elif change == "options": lesson["questions"][0]["options"][1] = "traveled"
    elif change == "explanation": lesson["questions"][0]["explanation"] += "Unreviewed."
    elif change == "missing_approval": del review["lessons"]["M30-B02"]
    else: del package["lessons"]["M30-B02"]
    (path / "v2.json").write_text(json.dumps(package))
    (path / "v2-review.json").write_text(json.dumps(review))
    with pytest.raises(ValueError): content.load_version("v2")


def test_v1_remains_immutable_and_reopenable_when_current_revision_changes(monkeypatch):
    old = copy.deepcopy(content.load_version("v1"))
    monkeypatch.setattr(content, "CURRENT_VERSION", "v2")
    assert content.load_version("v1") == old


def test_preview_and_attempt_use_their_own_frozen_teaching(monkeypatch):
    from services import grammar_lesson_service as service
    monkeypatch.setattr(service, "enabled", lambda: True)
    monkeypatch.setattr(service, "is_accepting_submissions", lambda _: True)
    config = {"lesson_id": "M30-B02", "content_version": "v2",
              "question_count": 12, "practice_focus": "A focus"}
    lesson = {"focus": "A focus", "article": None, "questions": [],
              "lesson_notes": "Frozen notes", "learning_objectives": ["An objective"]}
    monkeypatch.setattr(service, "lesson_content", lambda *_: lesson)
    preview = service._public_state({"id": "item"}, {"id": "assignment", "title": "B02", "content_config": config}, None)
    assert preview["lesson_notes"] == "Frozen notes"
    attempt = {"id": "attempt", "status": "in_progress", "answers": {},
               "correct_count": 0, "content_snapshot": copy.deepcopy(lesson)}
    lesson["lesson_notes"] = "Later revision notes"
    state = service._public_state({"id": "item"}, {"id": "assignment", "title": "B02", "content_config": config}, attempt)
    assert state["lesson_notes"] == "Frozen notes"


def test_educator_report_accepts_lesson_owned_teaching_without_a_wiki_link():
    from routers.admin_grammar_lesson import EducatorReport
    report = EducatorReport.model_validate({
        "attempt_id": "attempt", "assignment_item_id": "item",
        "assignment_title": "Ôn B02", "lesson_id": "M30-B02",
        "status": "completed", "correct_count": 10, "question_count": 12,
        "focus": "Âm và chữ", "article": None, "questions": [],
    })
    assert report.article is None and report.correct_count == 10
