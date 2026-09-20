from __future__ import annotations

import json
import re
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
    manifest = json.loads(
        (service._CONTENT_ROOT / "core30-manifest.json").read_text(encoding="utf-8")
    )

    assert manifest["source_package_version"] == "v6-t11-map-locked"
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
        assert parts["activity"]["grading_policy"] == "ai_feedback_once"
        assert parts["activity"]["submittable"] is True


def test_controlled_rewrite_claim_migrations_use_supported_jsonb_count():
    migrations = Path(__file__).resolve().parents[1] / "migrations"
    initial = (migrations / "288_advanced_vocab_rewrite_feedback.sql").read_text()
    repair = (migrations / "289_fix_advanced_vocab_rewrite_claim_count.sql").read_text()

    for sql in (initial, repair):
        assert "jsonb_object_length" not in sql
        assert "SELECT count(*) FROM jsonb_object_keys(p_answers)" in sql
        assert "'response_count'" in sql

    gate = (migrations / "290_align_advanced_vocab_rewrite_evidence.sql").read_text()
    assert "submitted_item_ids" in gate
    assert "attempted_item_ids" not in gate
    assert "response_count" in gate


@pytest.mark.asyncio
async def test_controlled_rewrite_saves_all_answers_and_calls_grader_once(monkeypatch):
    from services import advanced_vocab_rewrite_grader

    prompts = [{"item_id": f"rewrite-{number:02d}", "prompt": f"Prompt {number}"}
               for number in range(1, 21)]
    answers = {row["item_id"]: f"Answer {index}"
               for index, row in enumerate(prompts, 1)}
    rows: list[dict] = []
    calls: list[list[dict]] = []

    class Query:
        def __init__(self, data=None):
            self.patch = None
            self.data = data

        def insert(self, payload):
            rows.append({"id": "rewrite-sub-1", **payload})
            return self

        def update(self, payload):
            self.patch = payload
            return self

        def eq(self, *_args):
            return self

        def execute(self):
            if self.data is not None:
                return SimpleNamespace(data=self.data)
            if self.patch:
                rows[0].update(self.patch)
            return SimpleNamespace(data=rows[:1])

    class Admin:
        def table(self, name):
            assert name == "advanced_vocab_rewrite_submissions"
            return Query()

        def rpc(self, name, params):
            assert name == "claim_advanced_vocab_rewrite_submission"
            if rows:
                if rows[0]["answers"] != params["p_answers"]:
                    raise RuntimeError("23505 advanced_vocab_rewrite_already_submitted")
                return Query({"should_grade": False, "submission": rows[0]})
            submission = {
                "id": "rewrite-sub-1", "bank_id": params["p_bank_id"],
                "user_id": params["p_user_id"],
                "class_assignment_item_id": params["p_item_id"],
                "answers": params["p_answers"], "status": "processing",
                "content_snapshot": params["p_content_snapshot"],
                "prompt_version": params["p_prompt_version"],
            }
            rows.append(submission)
            return Query({"should_grade": True, "submission": submission})

    async def fake_grade(items, *, user_id=None):
        calls.append(items)
        return ({"results": [{"item_id": row["item_id"], "corrected": row["answer"],
                               "grammar_notes": [], "style_note": "Ổn",
                               "target_usage_note": "Đúng", "ok": True}
                              for row in items],
                 "overall": {"strengths": ["Đủ 20 câu"], "focus": []}},
                "gemini-test", None)

    monkeypatch.setattr(service, "_assigned_lesson",
                        lambda **_kwargs: ({}, {}, {"lesson_id": "ADV-T01", "provenance": {"content_checksum": "sum"}}))
    monkeypatch.setattr(service, "_require_section", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "controlled_rewrite_parts",
                        lambda _lesson: {"prompts": prompts, "solutions": [{"text": "Key"}]})
    monkeypatch.setattr(service, "_rewrite_submission",
                        lambda _item_id: rows[0] if rows else None)
    monkeypatch.setattr(service, "_upsert_stage", lambda **_kwargs: {})
    monkeypatch.setattr(service, "_progress", lambda _item_id: {"completed_stages": ["controlled_rewrite"]})
    monkeypatch.setattr(service, "_admin", lambda: Admin())
    monkeypatch.setattr(advanced_vocab_rewrite_grader, "grade_rewrites", fake_grade)

    first = await service.complete_controlled_rewrite(
        user_id="user-1", bank_id="bank-1", item_id="item-1", answers=answers,
    )
    replay = await service.complete_controlled_rewrite(
        user_id="user-1", bank_id="bank-1", item_id="item-1", answers=answers,
    )

    assert len(calls) == 1
    assert len(calls[0]) == 20
    assert first["submission"]["status"] == "completed"
    assert replay["submission"]["answers"] == answers

    with pytest.raises(HTTPException) as exc:
        await service.complete_controlled_rewrite(
            user_id="user-1", bank_id="bank-1", item_id="item-1",
            answers={**answers, "rewrite-01": "Changed"},
        )
    assert exc.value.status_code == 409


def test_controlled_rewrite_projection_whitelists_activity_metadata():
    lesson = deepcopy(_lesson())
    rewrite = service._activity(lesson, "controlled_rewrite")
    rewrite["answer_key"] = {"rewrite-01": "private"}
    rewrite["private_editorial"] = "private"

    activity = service.controlled_rewrite_parts(lesson)["activity"]

    assert set(activity) == service._CONTROLLED_REWRITE_PUBLIC_FIELDS
    assert "private" not in json.dumps(activity)


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
        for stage in (selected["practice_1"], selected["practice_2"]):
            assert all(
                service._choice(row) is (index % 2 == 0)
                for index, row in enumerate(stage)
            )
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


def test_practice_selection_never_selects_unrenderable_match_item():
    lesson = deepcopy(_lesson())
    lexeme = lesson["vocabulary"][0]["lexeme_id"]
    pool = lesson["adaptive_quiz"]["items"]
    lesson["adaptive_quiz"]["items"] = [
        row for row in pool
        if row.get("lexeme_id") != lexeme or service._choice(row)
    ]
    lesson["adaptive_quiz"]["items"].append({
        "item_id": "deterministic-match",
        "lexeme_id": lexeme,
        "type": "matching",
        "input": "match",
        "pairs": [{"left": "A", "right": "B"}],
        "answer": ["B"],
    })

    with pytest.raises(ValueError, match="Không có câu phù hợp"):
        service.practice_selection(lesson)


def test_answer_index_is_canonicalized_and_never_exposed_to_learner():
    lesson = deepcopy(_lesson())
    selected = service.practice_selection(lesson)
    selected_id = next(
        item["item_id"]
        for item in selected["practice_1"] + selected["practice_2"]
        if item.get("options") and len(item["options"]) > 1
    )
    authored = next(
        item for item in lesson["adaptive_quiz"]["items"]
        if item["item_id"] == selected_id
    )
    authored.pop("answer", None)
    authored["answer_index"] = 1

    imported = next(
        row for row in service.build_quiz_rows(lesson) if row["qid"] == selected_id
    )

    assert imported["answer"] == 1
    assert service._correct(imported, 1) is True
    assert "answer_index" not in service._safe_question(authored)


def test_boolean_syllable_and_text_contracts_grade_correctly():
    assert service._correct({"input": "boolean", "answer": False}, False) is True
    assert service._correct({"input": "boolean", "answer": True}, True) is True
    assert service._correct({"input": "boolean", "answer": True}, False) is False
    assert service._correct({
        "input": "syllable", "answer": 1, "segments": ["one", "two"],
    }, 1) is True
    assert service._correct({
        "input": "text", "accept": ["correct answer"],
    }, "Correct Answer") is True


def test_indexed_object_options_grade_the_submitted_identity_before_numeric_index():
    indexed = {
        "input": "choice", "answer_index": 1,
        "options": [
            {"key": "1", "text": "Incorrect first option"},
            {"key": "0", "text": "Correct second option"},
        ],
    }

    assert service._correct(indexed, "1") is False
    assert service._correct(indexed, "0") is True


def test_answer_practice_grades_authored_answer_index(monkeypatch):
    lesson = deepcopy(_lesson())
    indexed = {
        "item_id": "indexed-mcq", "type": "mcq", "prompt": "Pick A",
        "options": [
            {"key": "A", "text": "Correct"},
            {"key": "B", "text": "Wrong"},
        ],
        "answer_index": 0,
    }
    saved_rows = []

    class _Attempts:
        def __init__(self):
            self.filters = []
            self.result = None

        def select(self, *_args): return self
        def eq(self, key, value):
            self.filters.append((key, value))
            return self
        def limit(self, *_args): return self
        def insert(self, payload):
            saved_rows.append(payload)
            self.result = [payload]
            return self
        def execute(self):
            if self.result is not None:
                return SimpleNamespace(data=self.result)
            rows = [
                row for row in saved_rows
                if all(str(row.get(key)) == str(value) for key, value in self.filters)
            ]
            return SimpleNamespace(data=rows)

    monkeypatch.setattr(service, "_assigned_lesson", lambda **_kwargs: (
        {"id": "bank-1"}, {"id": "item-1"}, lesson,
    ))
    monkeypatch.setattr(service, "_require_stage", lambda *_args: None)
    practice_items = [indexed]
    monkeypatch.setattr(service, "practice_selection", lambda _lesson: {
        "practice_1": practice_items, "practice_2": [],
    })
    monkeypatch.setattr(
        service, "_selection_qids",
        lambda _item_id, _stage: [row["item_id"] for row in practice_items],
    )
    monkeypatch.setattr(service, "_upsert_stage", lambda **_kwargs: None)
    monkeypatch.setattr(service, "_progress", lambda _item_id: {
        "completed_stages": ["practice_1"], "required_completed": False,
    })
    monkeypatch.setattr(
        service, "_admin",
        lambda: type("Admin", (), {"table": lambda _self, _name: _Attempts()})(),
    )

    result = service.answer_practice(
        user_id="user-1", bank_id="bank-1", item_id="item-1",
        stage="practice_1", qid="indexed-mcq", answer="A",
    )

    assert result["is_correct"] is True
    assert saved_rows[0]["is_correct"] is True
    assert service._correct(indexed, "B") is False

    case_sensitive = {
        "item_id": "case-sensitive-text", "type": "gap_text", "input": "text",
        "prompt": "Enter the abbreviation.", "accept": ["US"],
        "case_sensitive": True,
    }
    practice_items.append(case_sensitive)
    wrong_case = service.answer_practice(
        user_id="user-1", bank_id="bank-1", item_id="item-1",
        stage="practice_1", qid="case-sensitive-text", answer="us",
    )

    assert wrong_case["is_correct"] is False
    assert service._correct({**case_sensitive, "case_sensitive": False}, "us") is True

    blank_text = {
        "item_id": "blank-text", "type": "gap_text", "input": "text",
        "prompt": "Enter the answer.", "accept": ["answer"],
    }
    practice_items.append(blank_text)
    before_blank = len(saved_rows)
    with pytest.raises(HTTPException) as exc:
        service.answer_practice(
            user_id="user-1", bank_id="bank-1", item_id="item-1",
            stage="practice_1", qid="blank-text", answer=" \n\t ",
        )
    assert exc.value.status_code == 422
    assert len(saved_rows) == before_blank

    boolean_false = {
        "item_id": "boolean-false", "type": "boolean", "input": "boolean",
        "prompt": "True or false?", "answer": False,
    }
    syllable_zero = {
        "item_id": "syllable-zero", "type": "syllable", "input": "syllable",
        "prompt": "Choose the stressed syllable.", "answer": 0,
        "segments": ["first", "second"],
    }
    practice_items.extend([boolean_false, syllable_zero])
    assert service.answer_practice(
        user_id="user-1", bank_id="bank-1", item_id="item-1",
        stage="practice_1", qid="boolean-false", answer=False,
    )["is_correct"] is True
    assert service.answer_practice(
        user_id="user-1", bank_id="bank-1", item_id="item-1",
        stage="practice_1", qid="syllable-zero", answer=0,
    )["is_correct"] is True


def test_practice_start_persists_and_returns_the_database_selection(monkeypatch):
    lesson = _lesson()
    authored = service.practice_selection(lesson)["practice_1"]
    canonical_qids = [row["item_id"] for row in authored]
    calls = []

    class _Rpc:
        def execute(self):
            return SimpleNamespace(data=[{
                "stage": "practice_1", "qids": list(reversed(canonical_qids)),
            }])

    class _StartAdmin:
        def rpc(self, name, params):
            calls.append((name, params))
            return _Rpc()

    monkeypatch.setattr(service, "_assigned_lesson", lambda **_kwargs: (
        {"id": "bank-1"}, {"id": "item-1"}, lesson,
    ))
    monkeypatch.setattr(service, "_require_stage", lambda *_args: None)
    monkeypatch.setattr(service, "_admin", lambda: _StartAdmin())
    monkeypatch.setattr(service, "_progress", lambda _item_id: {
        "completed_stages": ["vocabulary"], "required_completed": False,
    })

    result = service.start_practice(
        user_id="user-1", bank_id="bank-1", item_id="item-1",
        stage="practice_1",
    )

    assert calls == [("start_advanced_vocab_practice", {
        "p_item_id": "item-1", "p_user_id": "user-1", "p_bank_id": "bank-1",
        "p_stage": "practice_1", "p_qids": canonical_qids,
    })]
    assert [row["item_id"] for row in result["questions"]] == list(
        reversed(canonical_qids)
    )
    assert all("answer" not in row and "accept" not in row
               for row in result["questions"])


def test_persistence_gate_migration_locks_and_guards_every_evidence_store():
    migration = (Path(__file__).resolve().parents[1]
                 / "migrations" / "282_advanced_vocab_persistence_gate.sql").read_text()

    assert "advanced_vocab_practice_selections" in migration
    assert "start_advanced_vocab_practice" in migration
    assert "advanced_vocab_lock_open_item" in migration
    assert migration.index("student_cohort_memberships") < migration.index(
        "SELECT a.* INTO v_assignment"
    ) < migration.index("SELECT i.* INTO v_item")
    assert "AS RESTRICTIVE" in migration
    assert "advanced_vocab_attempt_must_be_one" in migration
    assert "advanced_vocab_section_already_submitted" in migration
    assert "trg_protect_advanced_vocab_bank" in migration
    assert "advanced_vocab_bank_unpublished" in migration
    assert "advanced_vocab_assignment_snapshot_mismatch" in migration
    assert "attempt_no = 1" in migration
    assert "state = 'submitted'" in migration
    assert "score = NULL" in migration


def test_learner_question_projection_never_contains_answer_material():
    source = {
        "item_id": "q1", "prompt": "Question", "answer": 2,
        "accept": ["secret"], "explain": "secret", "why_wrong": {"0": "secret"},
        "note": "secret", "correct_answer": "secret", "solution": "secret",
        "feedback": "secret", "options": ["A", "B", "C"],
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

    safe_option = service._safe_question({
        "item_id": "q2", "prompt": "Question",
        "options": [{"key": "A", "text": "Visible", "correct": True}],
    })
    assert safe_option["options"] == [{"key": "A", "text": "Visible"}]

    unsafe_segments = service._safe_question({
        "item_id": "q3", "prompt": "Question",
        "segments": {"answer": "secret"},
    })
    assert "segments" not in unsafe_segments
    assert "secret" not in json.dumps(unsafe_segments)
    assert service._safe_question({"item_id": "q4", "prompt": 42})["prompt"] == "42"
    assert service._safe_question({"item_id": "q5"})["prompt"] == ""


@pytest.mark.parametrize("activity_type", ["reading_lab", "listening_lab"])
def test_answer_rows_keeps_solution_map_key_authoritative(activity_type):
    content = deepcopy(service._activity(_lesson(), activity_type)["content"])
    qid = str(content["questions"][0]["question_number"])
    content["solutions"][qid]["id"] = "shadowed-inner-id"

    rows = service._answer_rows(content)

    assert rows[0]["id"] == qid
    assert all(row["id"] != "shadowed-inner-id" for row in rows)


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
    monkeypatch.setattr(
        service, "load_lesson", lambda _lesson_id, _checksum=None: lesson,
    )

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
    monkeypatch.setattr(
        service, "load_lesson", lambda _lesson_id, _checksum=None: lesson,
    )

    with pytest.raises(HTTPException) as exc:
        service._assigned_lesson(
            bank_id="bank-1", user_id="user-1", item_id="item-1",
        )

    assert exc.value.status_code == 409
    assert "không khớp" in exc.value.detail


def test_assigned_lesson_reopens_frozen_version_after_canonical_revision(
        tmp_path, monkeypatch):
    v1 = deepcopy(_lesson())
    checksum_v1 = v1["provenance"]["content_checksum"]
    v2 = deepcopy(v1)
    v2["title"] = "Revised title"
    v2["provenance"]["content_checksum"] = service.lesson_content_checksum(v2)
    root = tmp_path / "advanced_vocab"
    version = root / "versions" / v1["lesson_id"]
    version.mkdir(parents=True)
    (root / f"{v1['lesson_id']}.json").write_text(json.dumps(v2), encoding="utf-8")
    (version / f"{checksum_v1}.json").write_text(json.dumps(v1), encoding="utf-8")
    monkeypatch.setattr(service, "_CONTENT_ROOT", root)
    monkeypatch.setattr(
        service, "_runtime",
        lambda _bank: (_ for _ in ()).throw(AssertionError("mutable bank read")),
    )
    monkeypatch.setattr(service, "_owned_item", lambda *_args, **_kwargs: {
        "id": "item-1", "content_config": {"runtime": {
            "kind": "advanced_vocab", "lesson_id": v1["lesson_id"],
            "content_checksum": checksum_v1,
        }},
    })

    _, _, reopened = service._assigned_lesson(
        bank_id="bank-1", user_id="user-1", item_id="item-1",
    )

    assert reopened["title"] == v1["title"]
    assert reopened["provenance"]["content_checksum"] == checksum_v1


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


@pytest.mark.parametrize(
    ("authored", "submitted"),
    [
        ("TRUE", "true"),
        ("FALSE", "false"),
        ("NOT GIVEN", "not given"),
        ("YES", "yes"),
        ("NO", "no"),
    ],
)
def test_section_grader_supports_every_reading_fixed_choice_value(
        authored: str, submitted: str):
    result = service._answer_results(
        {"1": submitted}, [{"id": "1", "answer": authored}],
    )

    assert result[0]["is_correct"] is True


def test_activity_lookup_ignores_malformed_non_object_rows():
    lesson = {"activities": ["invalid", {"activity_type": "reading_lab"}]}

    assert service._activity(lesson, "reading_lab") == {
        "activity_type": "reading_lab",
    }


@pytest.mark.parametrize("lesson_id", ["ADV-T22", "ADV-T23"])
def test_learner_reading_projection_strips_source_and_correction_evidence(
    monkeypatch, lesson_id,
):
    lesson = deepcopy(service.load_lesson(lesson_id))
    authored_reading = service._activity(lesson, "reading_lab")["content"]
    authored_reading["answer_key"] = {"1": "private"}
    authored_reading["private_support"] = "private"
    authored_reading["question_material"].insert(0, {"answer": "secret"})
    authored_reading["passages"][0].update({
        "answer": "private", "private_support": "private",
    })
    option_question = next(
        question for question in authored_reading["questions"]
        if question.get("options")
    )
    option_question["options"][0].update({
        "correct": True, "answer": "private", "evidence": "private",
    })
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
    assert "answer_key" not in reading
    assert "private_support" not in serialized
    assert "secret" not in serialized
    assert "answer" not in reading["passages"][0]
    assert "source_answer" not in serialized
    assert "source_evidence" not in serialized
    assert "correction_reason" not in serialized
    assert '"correct"' not in serialized
    assert '"answer"' not in serialized
    assert '"evidence"' not in serialized
    assert set().union(*(question.keys() for question in reading["questions"])) == {
        "question_number", "question_type", "stem", "options",
    }
    if lesson_id == "ADV-T23":
        assert "Master Answer Key" not in serialized
        assert "Vocabulary Profile" not in serialized
        assert "Quality Checks" not in serialized
        assert "3Y (1, 4, 5)" not in serialized
        assert "Answer key (Task A)" not in serialized
    authored = service._answer_rows(
        service._activity(lesson, "reading_lab")["content"],
    )
    assert any(row.get("evidence") for row in authored)


def test_learner_listening_projection_whitelists_top_and_nested_questions(
        monkeypatch):
    lesson = deepcopy(service.load_lesson("ADV-T11"))
    authored = service._activity(lesson, "listening_lab")["content"]
    authored["questions"][0].update({
        "answer": "leaked", "evidence": "private", "transcript": "private",
    })
    nested = authored["sections"][0]["question_blocks"][0]["questions"][0]
    nested.update({"answer": "leaked", "distractor_rationales": ["private"]})
    monkeypatch.setattr(service, "_progress", lambda _item: {
        "completed_stages": [], "stages": [], "answers": [], "sections": [],
        "listening_submitted": False, "required_completed": False,
    })
    monkeypatch.setattr(service, "_assigned_lesson", lambda **_kwargs: (
        {"id": "bank-1", "code": "C4-ADV-T11", "title": "Advanced T11"},
        {"id": "item-1"}, lesson,
    ))

    listening = service.learner_lesson(
        user_id="user-1", bank_id="bank-1", item_id="item-1",
    )["lesson"]["activities"]["listening"]
    top = listening["questions"][0]
    nested_safe = listening["sections"][0]["question_blocks"][0]["questions"][0]

    assert set(top) == {"question_number", "question_type", "stem", "options"}
    assert set(nested_safe) == {
        "question_number", "question_type", "stem", "options",
    }
    assert len(listening["questions"]) == len(authored["questions"])
    assert all(
        len(safe_question["options"]) == len(authored_question.get("options") or [])
        for authored_question, safe_question in zip(
            authored["questions"], listening["questions"], strict=True,
        )
    )
    serialized = json.dumps(listening)
    assert "leaked" not in serialized
    assert "private" not in serialized


def test_core30_learner_reading_material_stops_before_editorial_appendices():
    forbidden = re.compile(
        r"master\s+answer\s+key|answer\s+key|vocabulary\s+profile|"
        r"quality\s+checks?|supplement\b|\b\d+[YNT]\s*\(",
        flags=re.IGNORECASE,
    )
    for lesson_id in LESSON_IDS:
        lesson = service.load_lesson(lesson_id)
        content = service._activity(lesson, "reading_lab")["content"]
        safe = service._safe_reading_material(content.get("question_material"))
        assert not forbidden.search("\n".join(safe)), lesson_id


def test_core30_assets_exist_for_every_card_and_core_media():
    frontend = Path(__file__).resolve().parents[2] / "frontend" / "public"
    for lesson_id in LESSON_IDS:
        lesson = service.load_lesson(lesson_id)
        checksum = lesson["provenance"]["content_checksum"]
        for word in lesson["vocabulary"]:
            for key in ("audio_headword", "audio_example"):
                url = service._asset_url(lesson_id, word[key], checksum)
                assert url and (frontend / url.lstrip("/")).is_file()
                assert f"/versions/{lesson_id}/{checksum}/" in url
        version_root = (frontend / "assets" / "advanced-vocab" / "versions"
                        / lesson_id / checksum)
        assert (version_root
                / "listening" / "full_test.mp3").is_file()
        listening = next(row for row in lesson["activities"]
                         if row["activity_type"] == "listening_lab")["content"]
        for section in listening.get("sections") or []:
            if section.get("figure"):
                assert (version_root
                        / "listening" / Path(section["figure"]).name).is_file()
        for ref in lesson["media"]["wt1_illustrations"]:
            assert (version_root
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
        frozen = service.load_lesson(row["lesson_id"], row["content_checksum"])
        assert frozen == lesson
        assert 49 <= row["asset_count"] <= 52


def test_finalizer_is_atomic_and_overall_score_is_null():
    migration = (Path(__file__).resolve().parents[1]
                 / "migrations" / "281_advanced_vocab_stage_progress.sql").read_text()

    assert "finalize_advanced_vocab_assignment" in migration
    assert "trg_finalize_advanced_vocab_on_listening" in migration
    assert "AFTER INSERT ON course_section_submissions" in migration
    assert "advanced_vocab_listening_attempts" in migration
    assert (
        "DROP CONSTRAINT IF EXISTS class_assignment_items_artifact_kind_check"
        in migration
    )
    assert "ILIKE '%artifact_kind%IN%'" not in migration
    assert "ADD CONSTRAINT class_assignment_items_artifact_pairing" in migration
    assert "VALIDATE CONSTRAINT class_assignment_items_artifact_pairing" in migration
    assert "PERFORM finalize_advanced_vocab_assignment" in migration
    assert "COUNT(DISTINCT c.section)" in migration
    assert "controlled_rewrite" in migration
    assert "score = NULL" in migration
    assert "REVOKE ALL ON FUNCTION" in migration
    assert "DROP POLICY IF EXISTS quiz_banks_public_read" in migration
    assert "COALESCE(meta -> 'runtime' ->> 'kind', '') <> 'advanced_vocab'" in migration
    assert migration.count("SET state = 'submitted'") == 2


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
            "title": "Advanced T01", "content_config": {
                "test_title": "Advanced T01", "bank_code": "C4-ADV-T01",
                "runtime": {"kind": "advanced_vocab", "lesson_id": "ADV-T01"},
            },
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
             "duration_sec": 600, "answers": {"1": "B"},
             "answer_key": [{"id": "1", "answer": "B"}]},
            {"id": "section-listening", "class_assignment_item_id": "item-1",
             "section": "listening", "correct": 5, "total": 6, "score": 83.33,
             "duration_sec": 420, "answers": {"1": "A", "2": "wrong"},
             "answer_key": [
                 {"id": "1", "answer": "A"}, {"id": "2", "answer": "C"},
             ],
             "content_snapshot": {
                 "guided_retry": {"answers": {"2": "C"}},
             }},
        ],
        "advanced_vocab_listening_attempts": [{
            "id": "listening-initial", "class_assignment_item_id": "item-1",
            "answers": {"1": "A", "2": "wrong"},
            "answer_key": [
                {"id": "1", "answer": "A"}, {"id": "2", "answer": "C"},
            ],
            "correct": 1, "total": 2, "score": 50, "duration_sec": 120,
        }],
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
    reading = next(section for section in row["sections"]
                   if section["section"] == "reading")
    listening = next(section for section in row["sections"]
                     if section["section"] == "listening")
    assert reading["answer_results"] == [{
        "id": "1", "submitted_answer": "B", "is_correct": True,
    }]
    assert listening["initial_answer_results"][1] == {
        "id": "2", "submitted_answer": "wrong", "is_correct": False,
    }
    assert listening["answer_results"][1] == {
        "id": "2", "submitted_answer": "C", "is_correct": True,
    }
    assert row["listening_attempts"][0]["answer_results"][1]["is_correct"] is False
