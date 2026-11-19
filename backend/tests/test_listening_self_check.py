"""Synthetic self-check authoring → payload → grading contracts (no database)."""
from __future__ import annotations

import hashlib
import json

import pytest

from services import listening_convert as convert
from services import listening_fulltest_import as importer
from services import listening_test_grader as grader
from services.mock_response_policy import ResponsePolicyError, authored_response_policies


def synthetic_pack(marker=""):
    qp = f"""# IELTS LISTENING — SYNTHETIC-SELF-CHECK
## SECTION 1
### Questions 1-2
{marker}
<!-- qtype: short_answer -->
> Answer the questions below. Write ONE WORD ONLY.
**1.** Which colour is the door?
**2.** Which room is upstairs?
### Question 3
<!-- qtype: mcq_3option -->
> Choose the correct letter, A, B or C.
**3.** When does the tour start?
   - **A** Morning
   - **B** Afternoon
   - **C** Evening
"""
    sol = "## Quick Answer Key\n| **1.** blue / navy | **2.** library | **3.** B |\n## Solutions\n"
    for n, answer in [(1, "blue"), (2, "library"), (3, "B")]:
        sol += (f"### Q{n}\n**Answer:** {answer}\n"
                f"**Vì sao đúng:** Đây là thông tin tham khảo cho câu {n}.\n"
                f"**Script:** The guide gives answer {n}.\n"
                f"**Nghe lại:** [Replay](audio://full_test.mp3?start={n * 10}&end={n * 10 + 5}&q={n}&section=S1)\n")
    timings = {"full_test": {"section_offsets": {"S1": 0}}, "sections": [
        {"id": "S1", "questions": {str(n): {"start": n * 10, "end": n * 10 + 5} for n in range(1, 4)}}]}
    return qp, sol, timings


def persisted(marker=""):
    qp, sol, timings = synthetic_pack(marker)
    result = importer.parse_fulltest(qp, sol, timings)
    assert result.ok, result.errors
    return result, importer.build_section_persistence(result, qp)


def exercises(sections):
    return [exercise for section in sections for exercise in section["exercise_rows"]]


def forty_question_pack(self_check_questions):
    qp = "# IELTS LISTENING — SYNTHETIC-40\n"
    sol = "## Quick Answer Key\n| " + " | ".join(f"**{n}.** blue" for n in range(1, 41)) + " |\n## Solutions\n"
    timings = {"sections": []}
    for section in range(1, 5):
        qp += f"## SECTION {section}\n"
        windows = {}
        for n in range((section - 1) * 10 + 1, section * 10 + 1):
            qp += f"### Question {n}\n"
            if n in self_check_questions:
                qp += "<!-- scoring: self_check -->\n"
            qp += f"<!-- qtype: short_answer -->\n> Write ONE WORD ONLY.\n**{n}.** Which colour?\n"
            sol += (f"### Q{n}\n**Answer:** blue\n**Vì sao đúng:** Màu được nhắc tới.\n"
                    f"[Replay](audio://full_test.mp3?start={n * 10}&end={n * 10 + 5}&q={n}&section=S{section})\n")
            windows[str(n)] = {"start": n * 10, "end": n * 10 + 5}
        timings["sections"].append({"id": f"S{section}", "questions": windows})
    return qp, sol, timings


@pytest.mark.parametrize("marked", [{1}, set(range(1, 11)), set(range(1, 40))])
def test_forty_question_band_bearing_import_rejects_self_check(marked):
    # No target band or conversion table: neither disables the grader's band.
    result = importer.parse_fulltest(*forty_question_pack(marked))
    assert len(result.questions) == 40
    assert not result.ok
    assert any("self-check items are not allowed on 40-question band-bearing tests" in error
               for error in result.errors)


def test_forty_question_non_band_all_self_check_import_still_succeeds():
    qp, sol, timings = forty_question_pack(set(range(1, 41)))
    result = importer.parse_fulltest(qp, sol, timings)
    assert result.ok, result.errors
    key = grader.collect_answer_key(exercises(importer.build_section_persistence(result, qp)))
    assert len(key) == 40
    graded = grader.grade_attempt([], key)
    assert graded["max_score"] == 0 and graded["band_estimate"] is None


def test_no_marker_payload_bytes_match_pre_self_check_baseline():
    _, sections = persisted()
    serialized = json.dumps(sections, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    # Captured from the unmodified importer at the job's starting SHA.
    assert hashlib.sha256(serialized).hexdigest() == "21605dce6ee834e116928ef0dbadc5c065eee9be94c1a0537111e7bbb52ce90a"


def test_marker_reaches_preview_persisted_answers_and_collected_key():
    result, sections = persisted("<!-- scoring: self_check -->")
    assert [q.get("scoring") for q in result.as_preview()["questions"]] == ["self_check", "self_check", None]
    rows = exercises(sections)
    assert [a.get("scoring") for ex in rows for a in ex["payload"]["answers"]] == ["self_check", "self_check", None]
    assert [a.get("scoring") for a in grader.collect_answer_key(rows)] == ["self_check", "self_check", None]
    assert "scoring:" not in str(rows[0]["payload"]["questions"])
    assert "scoring:" not in str(rows[0]["payload"].get("template"))
    assert rows[0]["payload"]["solutions"]["1"]["why_correct"] == "Đây là thông tin tham khảo cho câu 1."


@pytest.mark.parametrize("location", ["parent", "subgroup"])
def test_marker_scopes_to_parent_or_p4_subgroup(location):
    marker = "<!-- scoring: self_check -->"
    body = f"""### Questions 1-5
{marker if location == 'parent' else ''}
**List of places:**
- **A** The hall
- **B** The library
- **C** The office
> **Questions 1 and 2**
{marker if location == 'subgroup' else ''}
<!-- qtype: mcq_multi -->
> Choose TWO letters, A-C.
**1.** ___________
**2.** ___________
> **Questions 3, 4 and 5**
<!-- qtype: matching -->
> Which place matches each activity? Write the correct letter, A-C.
**3.** Reading ___________
**4.** Meeting ___________
**5.** Working ___________
"""
    blocks = convert.parse_question_blocks(body)
    assert [b["q_range"] for b in blocks] == [(1, 2), (3, 5)]
    assert [b["q_type"] for b in blocks] == ["mcq_multi", "matching"]
    assert [b["metadata"].get("scoring") for b in blocks] == ["self_check", "self_check" if location == "parent" else None]
    sol = "## Quick Answer Key\n| " + " | ".join(f"**{n}.** {answer}" for n, answer in enumerate("ABABC", 1)) + " |\n## Solutions\n"
    for n, answer in enumerate("ABABC", 1):
        sol += (f"### Q{n}\n**Answer:** {answer}\n**Vì sao đúng:** Lời giải tham khảo.\n"
                f"[Replay](audio://full_test.mp3?start={n * 10}&end={n * 10 + 5}&q={n}&section=S1)\n")
    timings = {"sections": [{"id": "S1", "questions": {str(n): {"start": n * 10, "end": n * 10 + 5} for n in range(1, 6)}}]}
    qp = "## SECTION 1\n" + body
    parsed = importer.parse_fulltest(qp, sol, timings)
    assert parsed.ok, parsed.errors
    rows = exercises(importer.build_section_persistence(parsed, qp))
    key = grader.collect_answer_key(rows)
    assert [q.get("scoring") for q in key] == ["self_check", "self_check", *(["self_check"] * 3 if location == "parent" else [None] * 3)]
    assert grader.grade_attempt([], key)["max_score"] == (0 if location == "parent" else 3)


@pytest.mark.parametrize("value", ["auto", "self-check", "", "self_check typo"])
def test_unknown_scoring_marker_is_an_import_error(value):
    result = importer.parse_fulltest(*synthetic_pack(f"<!-- scoring: {value} -->"))
    assert not result.ok
    assert any("unknown scoring" in error for error in result.errors)


@pytest.mark.parametrize("missing", ["answer", "solution", "window", "solution_answer", "explanation"])
def test_self_check_preserves_required_reference_and_solution_validation(missing):
    qp, sol, timings = synthetic_pack("<!-- scoring: self_check -->")
    if missing == "answer":
        sol = sol.replace("**1.** blue / navy", "**1.** ")
    elif missing == "solution":
        sol = sol[:sol.index("### Q1")] + sol[sol.index("### Q2"):]
    elif missing == "solution_answer":
        sol = sol.replace("**Answer:** blue", "**Answer:** ")
    elif missing == "explanation":
        sol = sol.replace("**Vì sao đúng:** Đây là thông tin tham khảo cho câu 1.", "**Vì sao đúng:** ")
    else:
        sol = sol.replace("audio://full_test.mp3?start=10&end=15&q=1&section=S1", "")
    result = importer.parse_fulltest(qp, sol, timings)
    assert not result.ok
    assert any("Q1" in error for error in result.errors)


def test_mixed_grading_excludes_self_check_from_scores_sections_and_traps():
    _, sections = persisted("<!-- scoring: self_check -->")
    key = grader.collect_answer_key(exercises(sections))
    key[0]["trap_mechanisms"] = ["synthetic-trap"]
    result = grader.grade_attempt([{"q_num": 1, "user_answer": "my blue"}, {"q_num": 3, "user_answer": "B"}], key)
    assert (result["score"], result["max_score"]) == (1, 1)
    assert result["section_breakdown"]["s1"] == {"correct": 1, "total": 1}
    assert result["trap_analytics"] == {}
    first, blank, scored = result["per_question"]
    assert first["self_check"] is True and first["correct"] is None
    assert first["user_answer"] == "my blue" and first["expected"] == "blue" and first["alternatives"] == ["navy"]
    assert blank["self_check"] is True and blank["correct"] is None and blank["user_answer"] == ""
    assert scored["correct"] is True and "self_check" not in scored


def test_all_self_check_has_zero_maximum_and_no_band():
    _, sections = persisted("<!-- scoring: self_check -->")
    key = grader.collect_answer_key(exercises(sections))[:2]
    result = grader.grade_attempt([], key)
    assert (result["score"], result["max_score"], result["band_estimate"]) == (0, 0, None)
    assert all(section == {"correct": 0, "total": 0} for section in result["section_breakdown"].values())
    assert result["trap_analytics"] == {}


@pytest.mark.parametrize("marked_q", [1, 2])
def test_partial_mcq_multi_marker_excludes_entire_group(marked_q):
    rows = [{"payload": {"template_kind": "mcq_multi", "answers": [
        {"q_num": n, "answer": answer, **({"scoring": "self_check"} if n == marked_q else {})}
        for n, answer in [(1, "A"), (2, "B")]]}},
        {"payload": {"answers": [{"q_num": 3, "answer": "C"}]}}]
    result = grader.grade_attempt([{"q_num": n, "user_answer": answer} for n, answer in [(1, "B"), (2, "A"), (3, "C")]], grader.collect_answer_key(rows))
    assert (result["score"], result["max_score"]) == (1, 1)
    assert [q["correct"] for q in result["per_question"]] == [None, None, True]
    assert [q.get("self_check") for q in result["per_question"]] == [True, True, None]
    assert [q["expected"] for q in result["per_question"]] == ["A", "B", "C"]
    assert result["score_mode"] == "mixed" and result["self_check_count"] == 2


def test_self_check_skip_is_independent_of_question_type():
    result = grader.grade_attempt([], [{"q_num": 1, "answer": "reference", "template_kind": "future_type", "scoring": "self_check"}])
    assert result["max_score"] == 0 and result["per_question"][0]["correct"] is None


@pytest.mark.parametrize("self_check", [False, True])
def test_self_check_preserves_authored_response_policy_validation(self_check):
    from test_listening_fulltest_import import _synthetic_import_policy
    qp, sol, timings = synthetic_pack("<!-- scoring: self_check -->" if self_check else "")
    result = importer.parse_fulltest(qp, sol, timings)
    policy = _synthetic_import_policy("literal", ["blue", "navy"], {}, 1)
    result.questions[0]["response_policy"] = policy
    rows = exercises(importer.build_section_persistence(result, qp))
    policies = authored_response_policies("listening", rows)
    assert policies[1] == policy
    key = grader.collect_answer_key(rows, pinned_policies=policies)
    graded = grader.grade_attempt([{"q_num": 1, "user_answer": "navy"}], key)
    assert graded["per_question"][0]["correct"] is (None if self_check else True)
    result.questions[0]["response_policy"]["version"] = 999
    with pytest.raises(ResponsePolicyError):
        importer.build_section_persistence(result, qp)


def test_self_check_does_not_weaken_a_scored_rows_response_policy():
    _, sections = persisted("<!-- scoring: self_check -->")
    key = grader.collect_answer_key(exercises(sections))
    with pytest.raises(ResponsePolicyError):
        grader.collect_answer_key(exercises(sections), pinned_policies={3: {"version": 999}})
    assert grader.grade_attempt([{"q_num": 3, "user_answer": "C"}], key)["score"] == 0


def test_self_check_answers_and_solutions_stay_hidden_in_live_player():
    _, sections = persisted("<!-- scoring: self_check -->")
    safe = grader.strip_answer_keys(exercises(sections))
    assert [q["q_num"] for ex in safe for q in ex["payload"]["questions"]] == [1, 2, 3]
    assert all("answers" not in ex["payload"] and "solutions" not in ex["payload"] for ex in safe)


@pytest.mark.parametrize("all_self_check", [False, True])
def test_assigned_mini_submit_and_roster_reconciliation_complete_without_a_score(monkeypatch, all_self_check):
    from routers import listening
    from routers.admin_class_assignments import _hand_in_status
    from services import mock_correction_service
    from services.class_assignment_service import reconcile_test_attempts
    from test_class_assignment_service import _rl_assignment, _rl_db
    from test_student_listening_full_test import _patch, _run, _seed_test

    fake, authz = _patch(monkeypatch)
    monkeypatch.setattr(mock_correction_service, "supabase_admin", fake)
    test = _seed_test(fake, test_type="mini")
    _, sections = persisted("<!-- scoring: self_check -->")
    rows = exercises(sections)
    if all_self_check:
        rows[-1]["payload"]["answers"][0]["scoring"] = "self_check"
    fake.tables["listening_content"] = [{"id": "content-1", "test_id": test["id"], "section_num": 1}]
    fake.tables["listening_exercises"] = [dict(row, content_id="content-1") for row in rows]
    ledger = _rl_db(attempts=[], table="listening_test_attempts")
    ledger.tables["class_assignment_items"][0]["score"] = None
    fake.tables["class_assignment_items"] = ledger.tables["class_assignment_items"]
    fake.tables["class_assignments"] = [dict(_rl_assignment(skill="listening"), cohort_id="class-1")]
    fake.tables["cohorts"] = [{"id": "class-1", "is_active": True}]
    fake.tables["listening_test_attempts"].append({
        "id": "self-check-attempt", "test_id": test["id"], "user_id": "user-1", "status": "in_progress",
        "class_assignment_item_id": "item-1", "answers": [
            {"q_num": 1, "user_answer": "my answer"}, {"q_num": 3, "user_answer": "B"}],
    })
    result = _run(listening.submit_listening_test_attempt("self-check-attempt", authorization=authz))
    assert (result["score"], result["max_score"]) == ((None, 0) if all_self_check else (1, 1))
    assert result["score_mode"] == ("self_check_only" if all_self_check else "mixed")
    assert result["self_check_count"] == (3 if all_self_check else 2)
    assert result["band_estimate"] is None
    read = _run(listening.get_listening_test_attempt("self-check-attempt", authorization=authz))
    for field in ("score", "max_score", "score_mode", "self_check_count"):
        assert read[field] == result[field]
    stored = fake.tables["listening_test_attempts"][0]
    assert stored["score"] == (0 if all_self_check else 1)
    assert stored["status"] == "submitted" and stored["submitted_at"]
    assert stored["grading_details"][0]["self_check"] is True
    assert stored["grading_details"][0]["correct"] is None
    # The existing roster read repairs its ledger from linked, submitted attempts.
    ledger.tables["listening_test_attempts"] = [stored]
    assert reconcile_test_attempts(ledger, [_rl_assignment(skill="listening")]) == 1
    item = ledger.tables["class_assignment_items"][0]
    assert item["submitted_at"] == stored["submitted_at"]
    assert item["artifact_id"] == "self-check-attempt" and item["artifact_kind"] == "listening_attempt"
    assert item["state"] == "submitted"  # Null band is still completed homework.
    assert item["score"] is None
    for sealed in (False, True):
        assert _hand_in_status(item, {"user_id": "user-1"}, due=None, sealed=sealed) == "submitted"
    before_reload = dict(item)
    assert reconcile_test_attempts(ledger, [_rl_assignment(skill="listening")]) == 0
    assert ledger.tables["class_assignment_items"][0] == before_reload


@pytest.mark.parametrize("flags,mode,scored,checks", [
    ([], "scored", 0, 0), ([False, False], "scored", 2, 0),
    ([True, False], "mixed", 1, 1), ([True, True], "self_check_only", 0, 2),
])
def test_display_score_fields_use_persisted_flags(flags, mode, scored, checks):
    details = [{"self_check": flag, "correct": False} for flag in flags]
    assert grader.score_mode(details) == mode
    assert grader.self_check_count(details) == checks
    assert grader.score_fields(0, details) == {
        "score": None if mode == "self_check_only" else 0,
        "max_score": scored, "score_mode": mode, "self_check_count": checks,
    }


@pytest.mark.parametrize("total,checks,correct,band,mode", [
    (40, 0, 40, 9.0, "scored"), (40, 0, 35, 8.0, "scored"),
    (40, 0, 9, None, "scored"), (40, 4, 36, None, "mixed"),
    (12, 0, 12, None, "scored"), (39, 0, 39, None, "scored"),
    (41, 1, 40, None, "mixed"),
])
def test_band_requires_exactly_forty_auto_scored_questions(total, checks, correct, band, mode):
    key = [{"q_num": n, "answer": "blue", **({"scoring": "self_check"} if n > total - checks else {})}
           for n in range(1, total + 1)]
    answers = [{"q_num": n, "user_answer": "blue"} for n in range(1, correct + 1)]
    result = grader.grade_attempt(answers, key)
    assert result["band_estimate"] == band
    assert result["score_mode"] == mode
    assert result["score"] == correct and result["max_score"] == total - checks


def test_teacher_score_fields_are_read_only_and_preserve_item_score(monkeypatch):
    from routers import admin_class_assignments as classes
    from test_class_assignment_service import _rl_db
    db = _rl_db(attempts=[{"id": "attempt-1", "grading_details": [{"self_check": True}]}],
                table="listening_test_attempts")
    monkeypatch.setattr(classes, "supabase_admin", db)
    items = [{"id": "item-1", "artifact_kind": "listening_attempt", "artifact_id": "attempt-1",
              "state": "submitted", "score": None}]
    db.tables.setdefault("listening_tests", [])
    before = json.dumps(db.tables, sort_keys=True)
    for _ in range(2):
        assert classes._listening_item_score_fields(items) == {"item-1": {
            "score_mode": "self_check_only", "max_score": 0, "self_check_count": 1}}
        assert items[0]["state"] == "submitted" and items[0]["score"] is None
    assert json.dumps(db.tables, sort_keys=True) == before
