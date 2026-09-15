from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services import advanced_vocab_service as service

LESSON_IDS = tuple(f"ADV-T{number:02d}" for number in range(1, 31))


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)
        self.start = 0
        self.end = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.rows = [row for row in self.rows if str(row.get(key)) == str(value)]
        return self

    def in_(self, key, values):
        expected = {str(value) for value in values}
        self.rows = [row for row in self.rows if str(row.get(key)) in expected]
        return self

    def order(self, key, **_kwargs):
        self.rows.sort(key=lambda row: str(row.get(key) or ""))
        return self

    def range(self, start, end):
        self.start, self.end = start, end + 1
        return self

    def limit(self, value):
        self.end = self.start + value
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows[self.start:self.end])


class _Admin:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


def _lesson() -> dict:
    return service.load_lesson("ADV-T01")


def test_core30_catalog_has_complete_authored_sections_and_reference_boundaries():
    lessons = [service.load_lesson(lesson_id) for lesson_id in LESSON_IDS]

    assert [lesson["lesson_id"] for lesson in lessons] == list(LESSON_IDS)
    assert sum(len(lesson["vocabulary"]) for lesson in lessons) == 720
    assert sum(len(lesson["adaptive_quiz"]["items"]) for lesson in lessons) == 8090
    assert sum(len(next(row for row in lesson["activities"]
                        if row["activity_type"] == "reading_lab")["content"]["questions"])
               for lesson in lessons) == 407
    assert sum(len(next(row for row in lesson["activities"]
                        if row["activity_type"] == "listening_lab")["content"]["questions"])
               for lesson in lessons) == 180
    for lesson in lessons:
        activities = {row["activity_type"]: row for row in lesson["activities"]}
        assert len(lesson["vocabulary"]) == 24
        assert all(word["common_error"] for word in lesson["vocabulary"])
        assert all((word.get("audio_provenance") or {}).get("engine") == "kokoro"
                   for word in lesson["vocabulary"])
        assert len(activities["reading_lab"]["content"]["questions"]) in (13, 14)
        assert len(activities["listening_lab"]["content"]["questions"]) == 6
        assert activities["writing_reference"]["submittable"] is False
        assert activities["writing_reference"]["grading_policy"] == "none"
        assert activities["speaking_practice"]["graded_by_default"] is False


def test_core30_reading_listening_keys_are_complete_and_unambiguous():
    for lesson_id in LESSON_IDS:
        lesson = service.load_lesson(lesson_id)
        activities = {row["activity_type"]: row for row in lesson["activities"]}
        for activity_type in ("reading_lab", "listening_lab"):
            content = activities[activity_type]["content"]
            qids = [str(row["question_number"]) for row in content["questions"]]
            assert len(qids) == len(set(qids))
            assert set(content["solutions"]) == set(qids)
            assert all(solution.get("answer") not in (None, "")
                       for solution in content["solutions"].values())


def test_core30_writing_has_both_reference_tasks_and_task1_illustrations():
    for lesson_id in LESSON_IDS:
        lesson = service.load_lesson(lesson_id)
        writing = next(row for row in lesson["activities"]
                       if row["activity_type"] == "writing_reference")
        tasks = writing["content"]["tasks"]
        assert set(tasks) == {"task_1", "task_2"}
        assert len(tasks["task_1"]["illustrations"]) == 2
        assert len(tasks["task_1"]["model_answers"]) == 2
        assert len(tasks["task_2"]["model_answers"]) == 2


def test_core30_controlled_rewrite_has_20_prompts_and_delayed_solutions():
    for lesson_id in LESSON_IDS:
        parts = service.controlled_rewrite_parts(service.load_lesson(lesson_id))
        assert [row["item_id"] for row in parts["prompts"]] == [
            f"rewrite-{number:02d}" for number in range(1, 21)
        ]
        assert all(row["prompt"] for row in parts["prompts"])
        assert parts["solutions"]
        assert parts["activity"]["completion_policy"] == "required"
        assert parts["activity"]["grading_policy"] == "self_check"


def test_deterministic_practice_uses_one_recognition_and_one_production_per_word():
    for lesson_id in LESSON_IDS:
        lesson = service.load_lesson(lesson_id)
        selected = service.practice_selection(lesson)
        combined = selected["practice_1"] + selected["practice_2"]

        assert len(selected["practice_1"]) == 28
        assert len(selected["practice_2"]) == 20
        assert len({row["item_id"] for row in combined}) == 48
        for word in lesson["vocabulary"]:
            rows = [row for row in combined if row["lexeme_id"] == word["lexeme_id"]]
            assert len(rows) == 2
            assert {service._choice(row) for row in rows} == {True, False}
        assert service.practice_selection(lesson) == selected


def test_quiz_import_rows_keep_text_keys_out_of_integer_answer_column():
    rows = service.build_quiz_rows(_lesson())

    assert len(rows) == 48
    for row in rows:
        if row["answer"] is None:
            assert row["answer"] is None
            assert row["accept"]
        else:
            assert isinstance(row["answer"], int)


def test_learner_question_projection_never_contains_answer_material():
    source = {
        "item_id": "q1", "prompt": "Question", "answer": 2,
        "accept": ["secret"], "explain": "secret", "why_wrong": {"0": "secret"},
        "note": "secret", "options": ["A", "B", "C"],
    }

    safe = service._safe_question(source)

    assert safe == {"item_id": "q1", "prompt": "Question", "options": ["A", "B", "C"]}

    with_audio = service._safe_question(
        {**source, "prompt": "Type the word {{audio}}"},
        audio_url="/assets/advanced-vocab/ADV-T01/vocab/word.mp3",
    )
    assert with_audio["prompt"] == "Type the word"
    assert with_audio["audio_url"].endswith("word.mp3")
    assert "{{audio}}" not in with_audio["prompt"]


def test_assigned_lesson_rejects_live_content_that_differs_from_frozen_snapshot(monkeypatch):
    lesson = _lesson()
    monkeypatch.setattr(service, "_runtime", lambda _bank: ({"id": "bank-1"}, {}))
    monkeypatch.setattr(service, "_owned_item", lambda *_args, **_kwargs: {
        "id": "item-1",
        "content_config": {"runtime": {
            "kind": "advanced_vocab",
            "lesson_id": lesson["lesson_id"],
            "content_checksum": "checksum-from-earlier-import",
        }},
    })
    monkeypatch.setattr(service, "load_lesson", lambda _lesson_id: lesson)

    with pytest.raises(HTTPException) as exc:
        service._assigned_lesson(
            bank_id="bank-1", user_id="user-1", item_id="item-1",
        )

    assert exc.value.status_code == 409
    assert "không khớp" in exc.value.detail


def test_assigned_lesson_recomputes_checksum_instead_of_trusting_provenance(monkeypatch):
    lesson = deepcopy(_lesson())
    declared = lesson["provenance"]["content_checksum"]
    lesson["vocabulary"][0]["example"] = "Changed after the assignment was issued."
    monkeypatch.setattr(service, "_runtime", lambda _bank: ({"id": "bank-1"}, {}))
    monkeypatch.setattr(service, "_owned_item", lambda *_args, **_kwargs: {
        "id": "item-1", "content_config": {"runtime": {
            "kind": "advanced_vocab", "lesson_id": lesson["lesson_id"],
            "content_checksum": declared,
        }},
    })
    monkeypatch.setattr(service, "load_lesson", lambda _lesson_id: lesson)

    with pytest.raises(HTTPException) as exc:
        service._assigned_lesson(
            bank_id="bank-1", user_id="user-1", item_id="item-1",
        )

    assert exc.value.status_code == 409
    assert "không khớp" in exc.value.detail


def test_server_grader_uses_authored_text_variants_and_integer_choice_keys():
    assert service._correct({"answer": 2, "options": ["A", "B", "C"]}, "2") is True
    assert service._correct({"answer": None, "accept": ["dual-income household"]},
                            "Dual income household") is True
    assert service._correct({"answer": None, "accept": ["kinship"]}, "kindship") is False
    assert service._correct({"answer": True}, True) is True
    assert service._correct({"answer": False}, False) is True
    assert service._correct({"answer": False}, True) is False


def test_section_grader_accepts_authored_codes_and_explicit_slash_variants():
    results = service._answer_results(
        {
            "10": "G", "3": "5", "optional-short": "five",
            "optional-long": "five sharp", "or-first": "street",
            "or-second": "kerb", "wrong": "not-the-answer",
        },
        [
            {"id": "10", "answer": "embodied", "answer_code": "G"},
            {"id": "3", "answer": "five (sharp) / 5"},
            {"id": "optional-short", "answer": "five (sharp) / 5"},
            {"id": "optional-long", "answer": "five (sharp) / 5"},
            {"id": "or-first", "answer": "street (OR kerb)"},
            {"id": "or-second", "answer": "street (OR kerb)"},
            {"id": "wrong", "answer": "correct"},
        ],
    )

    assert [row["is_correct"] for row in results] == [
        True, True, True, True, True, True, False,
    ]


def test_learner_reading_projection_strips_source_and_correction_evidence(monkeypatch):
    lesson = service.load_lesson("ADV-T22")
    monkeypatch.setattr(service, "_progress", lambda _item: {
        "completed_stages": [], "stages": [], "answers": [], "sections": [],
        "listening_submitted": False, "required_completed": False,
    })
    monkeypatch.setattr(service, "_assigned_lesson", lambda **_kwargs: (
        {"id": "bank-1", "code": "C4-ADV-T22", "title": "Advanced T22"},
        {"id": "item-1"}, lesson,
    ))

    reading = service.learner_lesson(
        user_id="user-1", bank_id="bank-1", item_id="item-1",
    )["lesson"]["activities"]["reading"]
    serialized = json.dumps(reading)

    assert "solutions" not in reading
    assert "source_answer" not in serialized
    assert "source_evidence" not in serialized
    assert "correction_reason" not in serialized
    assert set().union(*(question.keys() for question in reading["questions"])) == {
        "question_number", "question_type", "stem", "options",
    }
    authored = service._answer_rows(
        service._activity(lesson, "reading_lab")["content"],
    )
    assert any(row.get("evidence") for row in authored)


def test_core30_assets_exist_for_every_card_and_core_media():
    frontend = Path(__file__).resolve().parents[2] / "frontend" / "public"
    for lesson_id in LESSON_IDS:
        lesson = service.load_lesson(lesson_id)
        for word in lesson["vocabulary"]:
            for key in ("audio_headword", "audio_example"):
                url = service._asset_url(lesson_id, word[key])
                assert url and (frontend / url.lstrip("/")).is_file()
        assert (frontend / "assets" / "advanced-vocab" / lesson_id
                / "listening" / "full_test.mp3").is_file()
        listening = next(row for row in lesson["activities"]
                         if row["activity_type"] == "listening_lab")["content"]
        for section in listening.get("sections") or []:
            if section.get("figure"):
                assert (frontend / "assets" / "advanced-vocab" / lesson_id
                        / "listening" / Path(section["figure"]).name).is_file()
        for ref in lesson["media"]["wt1_illustrations"]:
            assert (frontend / "assets" / "advanced-vocab" / lesson_id
                    / "writing" / Path(ref).name).is_file()


def test_core30_deploy_manifest_matches_runtime_content():
    manifest = (Path(__file__).resolve().parents[1] / "content"
                / "advanced_vocab" / "core30-manifest.json")
    payload = json.loads(manifest.read_text(encoding="utf-8"))

    assert payload["lesson_count"] == 30
    assert [row["lesson_id"] for row in payload["lessons"]] == list(LESSON_IDS)
    assert sum(row["asset_count"] for row in payload["lessons"]) == 1524
    for row in payload["lessons"]:
        lesson = service.load_lesson(row["lesson_id"])
        assert row["content_checksum"] == lesson["provenance"]["content_checksum"]
        assert 49 <= row["asset_count"] <= 52


def test_finalizer_is_atomic_and_overall_score_is_null():
    migration = (Path(__file__).resolve().parents[1]
                 / "migrations" / "263_advanced_vocab_stage_progress.sql").read_text()

    assert "finalize_advanced_vocab_assignment" in migration
    assert "trg_finalize_advanced_vocab_on_listening" in migration
    assert "AFTER INSERT ON course_section_submissions" in migration
    assert "advanced_vocab_listening_attempts" in migration
    assert "PERFORM finalize_advanced_vocab_assignment" in migration
    assert "COUNT(DISTINCT c.section)" in migration
    assert "controlled_rewrite" in migration
    assert "score = NULL" in migration
    assert "REVOKE ALL ON FUNCTION" in migration


def test_listening_first_attempt_hides_key_until_guided_retry(monkeypatch):
    inserted = []

    class _Insert:
        def insert(self, payload):
            inserted.append(payload)
            return self

        def execute(self):
            return SimpleNamespace(data=inserted[-1:])

    class _WriteAdmin:
        def table(self, name):
            assert name == "advanced_vocab_listening_attempts"
            return _Insert()

    lesson = _lesson()
    monkeypatch.setattr(service, "_assigned_lesson", lambda **_kwargs: (
        {"id": "bank-1"}, {"id": "item-1"}, lesson,
    ))
    monkeypatch.setattr(service, "_require_stage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_listening_attempt", lambda _item: None)
    monkeypatch.setattr(service, "_admin", lambda: _WriteAdmin())
    monkeypatch.setattr(service, "_progress", lambda _item: {
        "required_completed": False, "completed_stages": [],
    })
    content = service._activity(lesson, "listening_lab")["content"]
    answers = {qid: solution["answer"] for qid, solution in content["solutions"].items()}

    out = service.submit_listening(
        user_id="user-1", bank_id="bank-1", item_id="item-1", answers=answers,
    )

    assert out["requires_guided_retry"] is True
    assert out["assignment"] == {"completed": False, "pct": None}
    assert "answers" not in out
    assert inserted[0]["answer_key"]


def test_listening_retry_persists_correction_before_revealing_key(monkeypatch):
    lesson = _lesson()
    content = service._activity(lesson, "listening_lab")["content"]
    key = service._answer_rows(content)
    initial = {row["id"]: row["answer"] for row in key}
    initial["1"] = "wrong"
    saved = {
        "id": "initial-1", "answers": initial, "answer_key": key,
        "content_snapshot": content, "total": len(key), "correct": len(key) - 1,
        "score": 83.33, "duration_sec": 300,
    }
    inserted = []

    class _CourseSections:
        def __init__(self): self.rows = []
        def select(self, *_args): return self
        def eq(self, *_args): return self
        def limit(self, *_args): return self
        def insert(self, payload): inserted.append(payload); return self
        def execute(self): return SimpleNamespace(data=self.rows)

    class _WriteAdmin:
        def table(self, name):
            assert name == "course_section_submissions"
            return _CourseSections()

    monkeypatch.setattr(service, "_assigned_lesson", lambda **_kwargs: (
        {"id": "bank-1"}, {"id": "item-1"}, lesson,
    ))
    monkeypatch.setattr(service, "_listening_attempt", lambda _item: saved)
    monkeypatch.setattr(service, "_admin", lambda: _WriteAdmin())
    monkeypatch.setattr(service, "_progress", lambda _item: {
        "required_completed": True, "completed_stages": list(service._REQUIRED_STAGES),
    })

    out = service.complete_listening_guided_retry(
        user_id="user-1", bank_id="bank-1", item_id="item-1",
        answers={"1": key[0]["answer"]},
    )

    assert out["assignment"] == {"completed": True, "pct": None}
    assert out["answers"] == key
    assert out["initial_answer_results"][0] == {
        "id": "1", "submitted_answer": "wrong", "is_correct": False,
    }
    assert inserted[0]["section"] == "listening"
    assert inserted[0]["content_snapshot"]["guided_retry"]["initial_wrong_ids"] == ["1"]


def test_listening_retry_rejects_a_different_canonical_race_winner(monkeypatch):
    lesson = _lesson()
    content = service._activity(lesson, "listening_lab")["content"]
    key = service._answer_rows(content)
    initial = {row["id"]: row["answer"] for row in key}
    initial["1"] = "wrong"
    saved = {
        "answers": initial, "answer_key": key, "content_snapshot": content,
        "total": len(key), "correct": len(key) - 1, "score": 83.33,
        "duration_sec": 300,
    }
    winner = {
        "content_snapshot": {"guided_retry": {"answers": {"1": "other"}}},
    }

    class _RacingSections:
        def __init__(self): self.reads = 0
        def select(self, *_args): return self
        def eq(self, *_args): return self
        def limit(self, *_args): return self
        def insert(self, _payload): return self
        def execute(self):
            self.reads += 1
            if self.reads == 1:
                return SimpleNamespace(data=[])
            if self.reads == 2:
                raise RuntimeError("23505 duplicate key")
            return SimpleNamespace(data=[winner])

    sections = _RacingSections()
    monkeypatch.setattr(service, "_assigned_lesson", lambda **_kwargs: (
        {"id": "bank-1"}, {"id": "item-1"}, lesson,
    ))
    monkeypatch.setattr(service, "_listening_attempt", lambda _item: saved)
    monkeypatch.setattr(
        service, "_admin",
        lambda: type("Admin", (), {"table": lambda _self, _name: sections})(),
    )

    with pytest.raises(HTTPException) as exc:
        service.complete_listening_guided_retry(
            user_id="user-1", bank_id="bank-1", item_id="item-1",
            answers={"1": key[0]["answer"]},
        )

    assert exc.value.status_code == 409
    assert "nơi khác" in exc.value.detail


def test_progress_restores_frozen_section_review_after_reveal(monkeypatch):
    reading_key = [{"id": "1", "answer": "A", "evidence": "Paragraph B"}]
    listening_key = [{
        "id": "4", "answer": "A", "evidence": "roughly seventy-six per cent",
        "distractor_rationales": {"C": "Fourteen per cent was a different cohort."},
        "timing": {"answer_span": {"start": 123.74, "end": 140.86}},
    }]
    fake = _Admin({
        "advanced_vocab_stage_progress": [],
        "advanced_vocab_question_attempts": [],
        "advanced_vocab_listening_attempts": [],
        "course_section_submissions": [
            {
                "class_assignment_item_id": "item-1", "section": "reading",
                "total": 1, "correct": 0, "score": 0, "duration_sec": 60,
                "submitted_at": "2026-09-15T00:00:00Z",
                "answers": {"1": "B"}, "answer_key": reading_key,
                "content_snapshot": {"title": "Frozen reading"},
            },
            {
                "class_assignment_item_id": "item-1", "section": "listening",
                "total": 1, "correct": 0, "score": 0, "duration_sec": 45,
                "submitted_at": "2026-09-15T00:02:00Z",
                "answers": {"4": "C"}, "answer_key": listening_key,
                "content_snapshot": {"guided_retry": {
                    "initial_wrong_ids": ["4"], "answers": {"4": "A"},
                }},
            },
        ],
    })
    monkeypatch.setattr(service, "_admin", lambda: fake)

    progress = service._progress("item-1")
    reading = next(row for row in progress["sections"] if row["section"] == "reading")
    listening = next(row for row in progress["sections"] if row["section"] == "listening")

    assert reading["review"]["answer_results"][0]["submitted_answer"] == "B"
    assert reading["review"]["answers"] == reading_key
    assert "answer_key" not in reading and "content_snapshot" not in reading
    assert listening["review"]["answer_results"][0]["submitted_answer"] == "A"
    assert listening["review"]["initial_answer_results"][0]["submitted_answer"] == "C"
    assert listening["review"]["guided_retry"]["initial_wrong_ids"] == ["4"]


def test_learner_writing_projection_scopes_analysis_and_outline_per_task(monkeypatch):
    monkeypatch.setattr(service, "_progress", lambda _item: {
        "completed_stages": [], "stages": [], "answers": [], "sections": [],
        "listening_submitted": False, "required_completed": False,
    })
    for lesson_id in ("ADV-T01", "ADV-T17"):
        lesson = service.load_lesson(lesson_id)
        monkeypatch.setattr(service, "_assigned_lesson", lambda **_kwargs: (
            {"id": "bank-1", "code": f"C4-{lesson_id}", "title": lesson_id},
            {"id": "item-1"}, lesson,
        ))
        writing = service.learner_lesson(
            user_id="user-1", bank_id="bank-1", item_id="item-1",
        )["lesson"]["activities"]["writing"]["content"]

        task_1 = writing["tasks"]["task_1"]
        task_2 = writing["tasks"]["task_2"]
        assert [row["heading"][:3] for row in task_1["prompt_analysis"]] == ["(g)", "(h)"]
        assert [row["heading"][:3] for row in task_2["prompt_analysis"]] == ["(9)"]
        assert task_1["outline"][0]["heading"].startswith("(c)")
        assert task_2["outline"][0]["heading"].startswith("(4)")
        assert "prompt_analysis" not in writing and "outline" not in writing


def test_admin_results_collects_each_learner_evidence_without_an_overall_score(monkeypatch):
    fake = _Admin({
        "class_assignments": [{
            "id": "assignment-1", "skill": "course", "content_id": "bank-1",
            "title": "Advanced T01", "content_config": {},
        }],
        "quiz_banks": [{
            "id": "bank-1", "code": "C4-ADV-T01", "title": "Advanced T01",
            "skill_area": "course", "meta": {
                "runtime": {"kind": "advanced_vocab", "lesson_id": "ADV-T01"},
            },
        }],
        "class_assignment_items": [{
            "id": "item-1", "assignment_id": "assignment-1",
            "student_id": "student-1", "state": "submitted",
            "opened_at": "2026-09-15T01:00:00Z", "submitted_at": "2026-09-15T02:00:00Z",
            "passed_at": "2026-09-15T02:00:00Z", "score": None, "mastery": {},
        }],
        "students": [{
            "id": "student-1", "user_id": "user-1", "full_name": "Học viên A",
            "student_code": "HV01",
        }],
        "advanced_vocab_stage_progress": [
            {"id": f"stage-{index}", "class_assignment_item_id": "item-1",
             "stage": stage, "status": "completed"}
            for index, stage in enumerate(
                ("vocabulary", "practice_1", "practice_2", "controlled_rewrite"), 1
            )
        ],
        "advanced_vocab_question_attempts": [{
            "id": "attempt-1", "class_assignment_item_id": "item-1",
            "stage": "practice_1", "qid": "ADV-T01-Q1", "answer_given": "A",
            "is_correct": True, "response_time_ms": 1200,
        }],
        "course_section_submissions": [
            {"id": "section-reading", "class_assignment_item_id": "item-1",
             "section": "reading", "correct": 11, "total": 13, "score": 84.62,
             "duration_sec": 600},
            {"id": "section-listening", "class_assignment_item_id": "item-1",
             "section": "listening", "correct": 5, "total": 6, "score": 83.33,
             "duration_sec": 420},
        ],
    })
    monkeypatch.setattr(service, "_admin", lambda: fake)

    report = service.assignment_results(assignment_id="assignment-1")

    assert report["score_policy"] == "none"
    assert report["required_stages"] == list(service._REQUIRED_STAGES)
    assert report["reference_only"] == ["writing", "speaking"]
    assert len(report["students"]) == 1
    row = report["students"][0]
    assert row["student"]["full_name"] == "Học viên A"
    assert row["item"]["score"] is None
    assert {stage["stage"] for stage in row["stages"]} == {
        "vocabulary", "practice_1", "practice_2", "controlled_rewrite",
    }
    assert {section["section"] for section in row["sections"]} == {
        "reading", "listening",
    }
    assert row["practice_attempts"][0]["qid"] == "ADV-T01-Q1"
