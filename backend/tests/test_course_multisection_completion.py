"""Cổng hoàn thành hợp nhất cho bài course có nhiều dạng bài."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from services import quiz_service as qs


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, name, state):
        self.name = name
        self.state = state
        self.filters = []
        self.patch = None

    def select(self, *_args, **_kwargs): return self
    def limit(self, *_args): return self
    def order(self, *_args, **_kwargs): return self
    def eq(self, field, value):
        self.filters.append((field, value))
        return self
    def update(self, value):
        self.patch = value
        return self
    def execute(self):
        rows = self.state.get(self.name, [])
        selected = [row for row in rows if all(str(row.get(k)) == str(v)
                                                for k, v in self.filters)]
        if self.patch is not None:
            for row in selected:
                row.update(self.patch)
        return _Resp([dict(row) for row in selected])


def _db(state):
    return type("DB", (), {"table": lambda _self, name: _Table(name, state)})()


def _attempt():
    return {
        "phase": "run", "sessions": ["session-1"], "completed": False,
        "pct": None, "at": None,
        "sections": {"quiz": {"completed": True, "pct": 80,
                                "correct": 8, "total": 10, "duration_sec": 600}},
    }


def test_text_grading_is_strict_but_ignores_presentation_differences():
    key = [{"id": "r1", "answer": "The most peaceful place."},
           {"id": "r2", "answer": "T", "accepted": ["T", "True"]}]
    assert qs._grade_course_section({
        "r1": "  the MOST peaceful place ", "r2": "true",
    }, key) == (2, 2)
    assert qs._grade_course_section({"r1": "a peaceful place", "r2": "T"}, key) == (1, 2)


def test_weights_are_complete_and_normalize_to_exactly_one_hundred():
    required = ["quiz", "writing", "reading"]
    equal = qs._course_section_weights({"content_config": {}}, required)
    assert sum(equal.values()) == 100
    # Override thiếu phần là cấu hình chưa hoàn chỉnh: fallback chia đều, không
    # biến riêng quiz thành 96% trọng số vì các phần thiếu bị mặc định là 1.
    partial = qs._course_section_weights(
        {"content_config": {"section_weights": {"quiz": 50}}}, required)
    assert partial == equal
    custom = qs._course_section_weights({"content_config": {
        "section_weights": {"quiz": 60, "writing": 25, "reading": 15},
    }}, required)
    assert custom == {"quiz": 60.0, "writing": 25.0, "reading": 15.0}
    assert sum(custom.values()) == 100


def _questions(quiz_n: int, writing_n: int) -> list[dict]:
    return ([{"id": f"q-{i}", "type": "mcq"} for i in range(quiz_n)]
            + [{"id": f"w-{i}", "type": "writing"}
               for i in range(writing_n)])


def _extra_meta(*, reading_n: int = 0, listening_n: int = 0) -> dict:
    meta = {}
    if reading_n:
        meta["short_reading"] = {
            "answers": [{"id": f"r-{i}"} for i in range(reading_n)],
        }
    if listening_n:
        meta["short_listening"] = {"solution": {
            "answers": [{"id": f"l-{i}"} for i in range(listening_n)],
        }}
    return meta


def test_hybrid_question_count_policy_matches_course_1_shapes():
    cases = [
        ((90, 10, 0, 0, 0), {"quiz": 70.0, "writing": 30.0}),
        ((90, 10, 10, 0, 0),
         {"quiz": 57.58, "writing": 21.21, "reading": 21.21}),
        ((90, 10, 10, 20, 0),
         {"quiz": 47.12, "writing": 16.35, "reading": 16.35,
          "listening": 20.18}),
        ((90, 10, 10, 20, 12),
         {"quiz": 41.69, "writing": 13.52, "reading": 13.52,
          "listening": 17.04, "pronunciation": 14.23}),
    ]
    for (quiz_n, writing_n, reading_n, listening_n, pronunciation_n), expected in cases:
        pronunciation = ([{"sentences": [f"s-{i}" for i in range(pronunciation_n)]}]
                         if pronunciation_n else [])
        snap = qs.course_section_weight_snapshot(
            questions=_questions(quiz_n, writing_n),
            meta=_extra_meta(reading_n=reading_n, listening_n=listening_n),
            pronunciation_sets=pronunciation,
        )
        assert snap["weight_policy"] == "hybrid_question_count_v1"
        assert snap["section_weights"] == expected
        assert round(sum(snap["section_weights"].values()), 2) == 100


def test_flattened_supplement_rows_never_inflate_the_grammar_quiz_count():
    questions = _questions(90, 10) + [
        {"id": f"r-{i}", "type": "course_reading",
         "counts_toward_mastery": False} for i in range(10)
    ] + [
        {"id": f"l-{i}", "type": "course_listening",
         "counts_toward_mastery": False} for i in range(20)
    ] + [
        {"id": f"p-{i}", "type": "course_pronunciation",
         "counts_toward_mastery": False} for i in range(12)
    ]
    snap = qs.course_section_weight_snapshot(questions=questions)
    assert snap["section_counts"] == {"quiz": 90, "writing": 10}


def test_snapshotted_weights_win_over_retake_question_count():
    assignment = {"content_config": {
        "weight_policy": "hybrid_question_count_v1",
        "section_counts": {"quiz": 90, "writing": 10},
        "section_weights": {"quiz": 70, "writing": 30},
    }}
    # Lượt revision chỉ có 20 câu, nhưng required sections vẫn đọc đúng bản
    # chụp của đề 90+10 lúc giao bài.
    assert qs._course_section_weights(
        assignment, ["quiz", "writing"],
    ) == {"quiz": 70.0, "writing": 30.0}


def test_live_sections_added_after_assignment_do_not_change_in_progress_shape():
    attempt = _attempt()
    assignment = {"id": "asg-1", "content_config": {
        "pass_pct": 80,
        "weight_policy": "hybrid_question_count_v1",
        "section_counts": {"quiz": 90, "writing": 10},
        "section_weights": {"quiz": 70, "writing": 30},
    }}
    state = {
        "class_assignment_items": [{
            "id": "item-1", "assignment_id": "asg-1", "passed_at": None,
            "submitted_at": None, "score": None,
            "mastery": {"attempts": [attempt]}, "updated_at": "t0",
        }],
        "class_assignments": [assignment],
        # Reading, listening và pronunciation được thêm vào bank sau lúc giao.
        "quiz_banks": [{"id": "bank-1", "meta": _extra_meta(
            reading_n=10, listening_n=20)}],
        "quiz_questions": [
            {"id": "q-1", "bank_id": "bank-1", "type": "mcq"},
            {"id": "w-1", "bank_id": "bank-1", "type": "writing"},
        ],
        "course_pronunciation_sets": [{
            "id": "pron-1", "bank_id": "bank-1", "is_active": True,
        }],
    }
    with patch.object(qs, "supabase_admin", _db(state)):
        out = qs.refresh_course_completion(
            user_id="user-1", bank_id="bank-1", item_id="item-1",
        )

    assert out["completed"] is False and out["remaining"] == ["writing"]
    assert [row["key"] for row in out["sections"]] == ["quiz", "writing"]


def test_live_sections_removed_after_assignment_do_not_change_completed_result():
    attempt = {
        "phase": "run", "sessions": ["session-1"], "completed": True,
        "pct": 85.0, "at": "finished", "next_action": "passed",
        "duration_sec": 1200,
        "sections": {
            "quiz": {"completed": True, "pct": 85, "weight": 57.58},
            "writing": {"completed": True, "pct": 80, "weight": 21.21},
            "reading": {"completed": True, "pct": 90, "weight": 21.21},
        },
    }
    state = {
        "class_assignment_items": [{
            "id": "item-1", "assignment_id": "asg-1", "passed_at": "finished",
            "submitted_at": "finished", "score": 85.0,
            "mastery": {"attempts": [attempt]}, "updated_at": "t0",
        }],
        "class_assignments": [{"id": "asg-1", "content_config": {
            "pass_pct": 80,
            "weight_policy": "hybrid_question_count_v1",
            "section_counts": {"quiz": 90, "writing": 10, "reading": 10},
            "section_weights": {"quiz": 57.58, "writing": 21.21,
                                "reading": 21.21},
        }}],
        # Live bank chỉ còn quiz; writing và reading đã bị gỡ sau lúc giao.
        "quiz_banks": [{"id": "bank-1", "meta": {}}],
        "quiz_questions": [{
            "id": "q-1", "bank_id": "bank-1", "type": "mcq",
        }],
    }
    with patch.object(qs, "supabase_admin", _db(state)):
        out = qs.refresh_course_completion(
            user_id="user-1", bank_id="bank-1", item_id="item-1",
        )

    assert out["completed"] is True and out["passed"] is True
    assert out["pct"] == 85.0
    assert [row["key"] for row in out["sections"]] == [
        "quiz", "writing", "reading",
    ]


def test_incomplete_sections_never_write_a_verdict_or_hand_in():
    attempt = _attempt()
    state = {
        "class_assignment_items": [{
            "id": "item-1", "assignment_id": "asg-1", "passed_at": None,
            "submitted_at": None, "score": None,
            "mastery": {"attempts": [attempt]}, "updated_at": "t0",
        }],
        "class_assignments": [{"id": "asg-1", "content_config": {"pass_pct": 80}}],
    }
    evidence = {
        "quiz": attempt["sections"]["quiz"],
        "writing": {"completed": True, "pct": 90, "correct": 9, "total": 10,
                    "duration_sec": 500},
    }
    marked = []
    with patch.object(qs, "supabase_admin", _db(state)), \
         patch.object(qs, "_course_completion_evidence", return_value=(
             ["quiz", "writing", "reading", "listening", "pronunciation"],
             evidence, {"quiz": "session-1", "writing": "writing-1"},
         )), \
         patch.object(qs, "mark_item_submitted", side_effect=lambda *a, **k: marked.append(k)):
        out = qs.refresh_course_completion(
            user_id="user-1", bank_id="bank-1", item_id="item-1",
        )

    assert out["completed"] is False and out["passed"] is None and out["pct"] is None
    assert out["remaining"] == ["reading", "listening", "pronunciation"]
    assert state["class_assignment_items"][0]["score"] is None
    assert state["class_assignment_items"][0]["passed_at"] is None
    assert marked == []


def test_all_sections_are_weighted_then_passed_and_hand_in_once():
    attempt = _attempt()
    state = {
        "class_assignment_items": [{
            "id": "item-1", "assignment_id": "asg-1", "passed_at": None,
            "submitted_at": None, "score": None,
            "mastery": {"attempts": [attempt]}, "updated_at": "t0",
        }],
        "class_assignments": [{"id": "asg-1", "content_config": {
            "pass_pct": 80,
            "section_weights": {"quiz": 40, "writing": 20, "reading": 15,
                                "listening": 15, "pronunciation": 10},
        }}],
    }
    evidence = {
        "quiz": attempt["sections"]["quiz"],
        "writing": {"completed": True, "pct": 90, "correct": 9, "total": 10,
                    "duration_sec": 500},
        "reading": {"completed": True, "pct": 100, "correct": 10, "total": 10,
                    "duration_sec": 300},
        "listening": {"completed": True, "pct": 60, "correct": 12, "total": 20,
                      "duration_sec": 400},
        "pronunciation": {"completed": True, "pct": 70, "correct": None, "total": None,
                          "duration_sec": 700},
    }
    marked = []
    with patch.object(qs, "supabase_admin", _db(state)), \
         patch.object(qs, "_course_completion_evidence", return_value=(
             list(evidence), evidence, {"quiz": "session-1", "writing": "writing-1"},
         )), \
         patch.object(qs, "mark_item_submitted", side_effect=lambda *a, **k: marked.append(k) or True):
        out = qs.refresh_course_completion(
            user_id="user-1", bank_id="bank-1", item_id="item-1",
        )

    # 80*40% + 90*20% + 100*15% + 60*15% + 70*10% = 81
    assert out["completed"] is True and out["passed"] is True and out["pct"] == 81.0
    assert out["duration_sec"] == 2500
    assert state["class_assignment_items"][0]["score"] == 81.0
    assert state["class_assignment_items"][0]["passed_at"]
    assert marked[0]["artifact_kind"] == "quiz_session"


def test_migration_is_additive_rls_protected_and_keeps_answer_snapshot():
    sql = (Path(__file__).parents[1] / "migrations" /
           "226_course_multisection_results.sql").read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS course_section_submissions" in sql
    assert "UNIQUE (class_assignment_item_id, section)" in sql
    assert "answer_key" in sql and "duration_sec" in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "ON DELETE SET NULL" in sql
    assert "course_section_submissions c" in sql
    assert "course_pronunciation_submissions p" in sql
    assert "DROP TABLE" not in sql and "DROP COLUMN" not in sql
