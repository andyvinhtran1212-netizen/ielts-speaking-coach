"""Repair and mark the manual source audit for Cambridge 17 Test 4.

Dry-run is the default.  ``--commit`` writes only when both tests still have no
attempts, then reads every changed row back before recording the audit marker.
The fixes are intentionally tied to the two canonical test IDs; this is not a
general re-importer.

Usage (from backend/):
  python scripts/repair_cam17_test4_content.py
  python scripts/repair_cam17_test4_content.py --commit
"""
from __future__ import annotations

import argparse
import copy
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from _script_env import load_env  # noqa: E402

load_env()

from database import supabase_admin as sb  # noqa: E402

LISTENING_CODE = "ILR-LIS-CAM-B17-T4"
READING_CODE = "ILR-RDG-CAM-B17-T4"
LISTENING_UUID = "c69e96e7-a6df-45ce-9aec-d8bb31b60a46"
READING_UUID = "47b1a045-6464-4dfc-9d93-edebd16af844"
AUDITOR = "codex-manual-source-audit"

EXPECTED_LISTENING = {
    1: "floor", 2: "fridge", 3: "shirts", 4: "windows", 5: "balcony",
    6: "electrician", 7: "dust", 8: "police", 9: "training", 10: "review",
    11: "A", 12: "A", 13: "A", 14: "C", 15: "A", 16: "C", 17: "B",
    18: "C", 19: "B", 20: "A", 21: "C", 22: "E", 23: "A", 24: "D",
    25: "B", 26: "F", 27: "A", 28: "D", 29: "C", 30: "G",
    31: "golden", 32: "healthy", 33: "climate", 34: "rock", 35: "diameter",
    36: "tube", 37: "fire", 38: "steam", 39: "cloudy", 40: "litre",
}
EXPECTED_READING = {
    1: "FALSE", 2: "FALSE", 3: "NOT GIVEN", 4: "TRUE", 5: "NOT GIVEN", 6: "TRUE",
    7: "droppings", 8: "coffee", 9: "mosquitoes", 10: "protein", 11: "unclean",
    12: "culture", 13: "houses", 14: "E", 15: "A", 16: "D", 17: "F", 18: "C",
    19: "descendants", 20: "sermon", 21: "fine", 22: "innovation", 23: "B", 24: "E",
    25: "B", 26: "D", 27: "D", 28: "E", 29: "F", 30: "B", 31: "H", 32: "E",
    33: "FALSE", 34: "NOT GIVEN", 35: "NOT GIVEN", 36: "TRUE", 37: "memory",
    38: "numbers", 39: "communication", 40: "visual",
}


def one(table: str, **where) -> dict:
    query = sb.table(table).select("*")
    for key, value in where.items():
        query = query.eq(key, value)
    rows = query.limit(2).execute().data or []
    if len(rows) != 1:
        raise RuntimeError(f"{table} {where}: expected exactly one row, got {len(rows)}")
    return rows[0]


def exercise_for(test_uuid: str, first_q: int) -> dict:
    contents = sb.table("listening_content").select("id").eq("test_id", test_uuid).execute().data or []
    rows = (sb.table("listening_exercises").select("*")
            .in_("content_id", [row["id"] for row in contents]).execute().data or [])
    matches = [row for row in rows if any(q.get("q_num") == first_q
               for q in (row.get("payload") or {}).get("questions") or [])]
    if len(matches) != 1:
        raise RuntimeError(f"Listening Q{first_q}: expected one exercise, got {len(matches)}")
    return matches[0]


def reading_question(q_num: int) -> dict:
    passage_ids = [row["id"] for row in (
        sb.table("reading_passages").select("id").eq("test_id", READING_UUID).execute().data or [])]
    rows = (sb.table("reading_questions").select("*").in_("passage_id", passage_ids)
            .eq("q_num", q_num).execute().data or [])
    if len(rows) != 1:
        raise RuntimeError(f"Reading Q{q_num}: expected one row, got {len(rows)}")
    return rows[0]


def reading_passage(order: int) -> dict:
    return one("reading_passages", test_id=READING_UUID, passage_order=order)


def verify_keys_and_types() -> None:
    contents = sb.table("listening_content").select("id").eq("test_id", LISTENING_UUID).execute().data or []
    exercises = (sb.table("listening_exercises").select("payload")
                 .in_("content_id", [row["id"] for row in contents]).execute().data or [])
    listening: dict[int, str] = {}
    listening_types: dict[int, str] = {}
    for row in exercises:
        payload = row.get("payload") or {}
        kind = payload.get("template_kind")
        answers = {item.get("q_num"): item.get("answer") for item in payload.get("answers") or []}
        for question in payload.get("questions") or []:
            q_num = question.get("q_num")
            listening[q_num] = str(answers.get(q_num) or question.get("answer") or "").strip()
            listening_types[q_num] = kind
    # The importer keeps all canonical answers in payload.answers, including
    # letter questions.  Fail loudly if a future shape change makes that false.
    if listening != EXPECTED_LISTENING:
        raise RuntimeError(f"Listening answer-key mismatch: {listening}")
    expected_l_types = {
        **{q: "notes_completion" for q in range(1, 11)},
        **{q: "mcq_3option" for q in range(11, 15)},
        **{q: "matching" for q in range(15, 21)},
        **{q: "mcq_multi" for q in range(21, 25)},
        **{q: "matching" for q in range(25, 31)},
        **{q: "notes_completion" for q in range(31, 41)},
    }
    if listening_types != expected_l_types:
        raise RuntimeError(f"Listening question-type mismatch: {listening_types}")

    passage_ids = [row["id"] for row in (
        sb.table("reading_passages").select("id").eq("test_id", READING_UUID).execute().data or [])]
    rows = (sb.table("reading_questions").select(
        "q_num,question_type,prompt,payload,answer,passage_id")
            .in_("passage_id", passage_ids).execute().data or [])
    reading = {row["q_num"]: str((row.get("answer") or {}).get("answer") or "").strip()
               for row in rows}
    if reading != EXPECTED_READING:
        raise RuntimeError(f"Reading answer-key mismatch: {reading}")
    expected_r_types = {
        **{q: "true_false_not_given" for q in range(1, 7)},
        **{q: "table_completion" for q in range(7, 14)},
        **{q: "matching_information" for q in range(14, 19)},
        **{q: "summary_completion" for q in range(19, 23)},
        **{q: "mcq_single" for q in range(23, 27)},
        **{q: "matching_information" for q in range(27, 33)},
        **{q: "true_false_not_given" for q in range(33, 37)},
        **{q: "summary_completion" for q in range(37, 41)},
    }
    reading_types = {row["q_num"]: row["question_type"] for row in rows}
    if reading_types != expected_r_types:
        raise RuntimeError(f"Reading question-type mismatch: {reading_types}")

    from services.reading_test_grader import collect_answer_key, grade_attempt
    key = collect_answer_key(rows)
    for q_nums, picks in (((23, 24), ("E", "B")), ((25, 26), ("D", "B"))):
        grouped_key = [row for row in key if row["q_num"] in q_nums]
        result = grade_attempt(
            [{"q_num": q_num, "user_answer": pick}
             for q_num, pick in zip(q_nums, picks)], grouped_key)
        if result["score"] != 2 or not all(row["correct"] for row in result["per_question"]):
            raise RuntimeError(f"Grouped MCQ unordered grading failed for {q_nums}: {result}")


def build_changes(now: str) -> list[tuple[str, str, dict, dict]]:
    changes: list[tuple[str, str, dict, dict]] = []

    listening = one("listening_tests", id=LISTENING_UUID, test_id=LISTENING_CODE)
    lmeta = copy.deepcopy(listening.get("metadata") or {})
    previous_l_audit = lmeta.get("content_audit") or {}
    audit_time = (previous_l_audit.get("audited_at")
                  if previous_l_audit.get("auditor") == AUDITOR
                  and previous_l_audit.get("status") == "passed_after_fix" else now)
    lmeta["content_audit"] = {
        "status": "passed_after_fix", "scope": "manual_source_and_render_contract",
        "audited_at": audit_time, "auditor": AUDITOR, "questions_verified": 40,
        "source": "Cambridge IELTS 17 Academic, Test 4",
        "fixed_issue_codes": ["L2", "L7", "L8", "R2", "R3"],
    }
    changes.append(("listening_tests", LISTENING_UUID, listening, {
        "title": "Cambridge IELTS 17 — Test 4 (Listening)", "metadata": lmeta,
    }))

    e1 = exercise_for(LISTENING_UUID, 1)
    p1 = copy.deepcopy(e1["payload"])
    p1["template"]["groups"][1]["items"][0]["suffix"] = "throughout the apartment"
    p1["template"]["groups"][3]["items"][5]["suffix"] = ""
    p1["template"]["groups"][4]["items"] = [
        {"q_num": 6, "prefix": "They can organise a plumber or an", "suffix": "if necessary."},
        {"q_num": 7, "prefix": "A special cleaning service is available for customers who are allergic to", "suffix": ""},
    ]
    p1["template"]["groups"][5]["items"] = [
        {"q_num": 8, "prefix": "Before being hired, all cleaners have a background check carried out by the", "suffix": ""},
        {"text": "References are required."},
        {"q_num": 9, "prefix": "All cleaners are given", "suffix": "for two weeks."},
        {"q_num": 10, "prefix": "Customers send a", "suffix": "after each visit."},
        {"text": "Usually, each customer has one regular cleaner."},
    ]
    prompt_updates = {
        1: "Cleaning all surfaces: Cleaning the ___ throughout the apartment",
        5: "Additional services agreed: Washing down the ___",
        7: "Other possibilities: A special cleaning service is available for customers who are allergic to ___",
        8: "Information on the cleaners: Before being hired, all cleaners have a background check carried out by the ___",
    }
    for question in p1["questions"]:
        if question["q_num"] in prompt_updates:
            question["prompt"] = prompt_updates[question["q_num"]]
    changes.append(("listening_exercises", e1["id"], e1, {"payload": p1}))

    e15 = exercise_for(LISTENING_UUID, 15)
    p15 = copy.deepcopy(e15["payload"])
    p15["instruction"] = "Which way of reducing staff turnover was used in each hotel? Write A, B or C next to Questions 15-20."
    p15["metadata"]["match_options"] = [
        {"letter": "A", "text": "improving relationships and teamwork"},
        {"letter": "B", "text": "offering incentives and financial benefits"},
        {"letter": "C", "text": "providing career opportunities"},
    ]
    p15["metadata"]["letter_options"] = ["A", "B", "C"]
    changes.append(("listening_exercises", e15["id"], e15, {"payload": p15}))

    e21 = exercise_for(LISTENING_UUID, 21)
    p21 = copy.deepcopy(e21["payload"])
    p21["instruction"] = "Choose TWO letters, A-E. Which TWO points do Thomas and Jeanne make about Thomas's sporting activities at school?"
    p21["metadata"]["match_options"] = [
        {"letter": "A", "text": "He should have felt more positive about them."},
        {"letter": "B", "text": "The training was too challenging for him."},
        {"letter": "C", "text": "He could have worked harder at them."},
        {"letter": "D", "text": "His parents were disappointed in him."},
        {"letter": "E", "text": "His fellow students admired him."},
    ]
    p21["metadata"]["letter_options"] = ["A", "B", "C", "D", "E"]
    changes.append(("listening_exercises", e21["id"], e21, {"payload": p21}))

    e31 = exercise_for(LISTENING_UUID, 31)
    p31 = copy.deepcopy(e31["payload"])
    p31["template"]["groups"][0]["items"] = [
        {"q_num": 31, "prefix": "made from the sap of the maple tree • colour described as", "suffix": ""},
        {"q_num": 32, "prefix": "added to food or used in cooking • very", "suffix": "compared to refined sugar"},
    ]
    p31["template"]["groups"][1]["items"][4] = {
        "q_num": 33, "prefix": "best growing conditions and", "suffix": "are in Canada and North America",
    }
    for question in p31["questions"]:
        if question["q_num"] == 33:
            question["prompt"] = "best growing conditions and ___ are in Canada and North America"
    for q_num in (33, 37):
        solution = p31["solutions"][str(q_num)]
        solution["skills"] = re.sub(r"\n\n> ⚠️ Audioscript nguồn[^\n]*", "", solution["skills"]).strip()
    changes.append(("listening_exercises", e31["id"], e31, {"payload": p31}))

    s4 = one("listening_content", test_id=LISTENING_UUID, section_num=4)
    transcript = s4["transcript"].replace(
        "There are only certain parts of the world that have the right climate for growing these trees perfectly.",
        "There are only certain parts of the world that provide all these conditions: one is Canada, and by that, I mean all parts of Canada, and the other is the north-eastern states of North America. In these areas, the climate suits the trees perfectly.",
    ).replace(
        "The trees can often take several taps. ... has to take place immediately",
        "The trees can often take several taps, though the workers take care not to cause any damage to the healthy growth of the tree itself. The sap that comes out of the trees consists of 98 percent water and 2 percent sugar and other nutrients. It has to be boiled so that much of that water evaporates, and this process has to take place immediately",
    )
    changes.append(("listening_content", s4["id"], s4, {"transcript": transcript}))

    reading = one("reading_tests", id=READING_UUID, test_id=READING_CODE)
    rmeta = copy.deepcopy(reading.get("metadata") or {})
    previous_r_audit = rmeta.get("content_audit") or {}
    reading_audit_time = (previous_r_audit.get("audited_at")
                          if previous_r_audit.get("auditor") == AUDITOR
                          and previous_r_audit.get("status") == "passed_after_fix" else now)
    rmeta["content_audit"] = {
        "status": "passed_after_fix", "scope": "manual_source_and_render_contract",
        "audited_at": reading_audit_time, "auditor": AUDITOR, "questions_verified": 40,
        "source": "Cambridge IELTS 17 Academic, Test 4",
        "fixed_issue_codes": ["L2", "L7", "L8", "R2", "R3"],
    }
    changes.append(("reading_tests", READING_UUID, reading, {"metadata": rmeta}))

    passage2 = reading_passage(2)
    body2 = passage2["body_markdown"].replace(
        "late. 'Modern cross-country analyses have also struggled to find evidence that education causes economic growth, even though there is plenty of evidence that growth increases education, she adds.",
        "late. 'Modern cross-country analyses have also struggled to find evidence that education causes economic growth, even though there is plenty of evidence that growth increases education,' she adds.",
    ).replace(
        "changes that might reduce their influence. *Early findings suggest",
        "changes that might reduce their influence. 'Early findings suggest",
    ).replace(
        "barriers, and this has implications for today, says Ogilvie.",
        "barriers, and this has implications for today,' says Ogilvie.",
    ).replace(
        "straightforward. German-speaking central Europe is an excellent laboratory for testing theories of economic growth, she explains.",
        "straightforward. 'German-speaking central Europe is an excellent laboratory for testing theories of economic growth,' she explains.",
    ).replace(
        'sermon. "This tells us they were continuing',
        "sermon. 'This tells us they were continuing",
    )
    changes.append(("reading_passages", passage2["id"], passage2, {"body_markdown": body2}))

    passage3 = reading_passage(3)
    body3 = passage3["body_markdown"].replace(
        "'He was not exceptional on any of these standard tests, said Rissman.",
        "'He was not exceptional on any of these standard tests,' said Rissman.",
    )
    changes.append(("reading_passages", passage3["id"], passage3, {"body_markdown": body3}))

    q19 = reading_question(19)
    q19p = copy.deepcopy(q19["payload"])
    q19p["template"]["summary_text"] = q19p["template"]["summary_text"].replace(
        "their {{19}}. ________ over a 300-year", "their {{19}} over a 300-year")
    changes.append(("reading_questions", q19["id"], q19, {"payload": q19p}))

    options_23 = [
        {"label": "A", "text": "Very little research has been done into the link between high literacy rates and improved earnings."},
        {"label": "B", "text": "Literacy rates in Germany between 1600 and 1900 were very good."},
        {"label": "C", "text": "There is strong evidence that high literacy rates in the modern world result in economic growth."},
        {"label": "D", "text": "England is a good example of how high literacy rates helped a country industrialise."},
        {"label": "E", "text": "Economic growth can help to improve literacy rates."},
    ]
    for q_num in (23, 24):
        row = reading_question(q_num); payload = copy.deepcopy(row["payload"])
        payload["options"] = options_23
        changes.append(("reading_questions", row["id"], row, {
            "prompt": "Which TWO of the following statements does the writer make about literacy rates in Section B?",
            "payload": payload,
        }))

    prompt_25 = "Which TWO of the following statements does the writer make in Section F about guilds in German-speaking Central Europe between 1600 and 1900?"
    for q_num in (25, 26):
        row = reading_question(q_num); payload = copy.deepcopy(row["payload"])
        solution = payload.get("solution") or {}
        solution["question_text"] = re.sub(r"\s*> \*Ghi chú OCR:\*[^\n]*", "", solution.get("question_text") or "").strip()
        changes.append(("reading_questions", row["id"], row, {"prompt": prompt_25, "payload": payload}))

    q38 = reading_question(38); q38p = copy.deepcopy(q38["payload"])
    q38p["solution"]["question_text"] = re.sub(
        r"\s*> \*Ghi chú OCR:\*[^\n]*", "", q38p["solution"]["question_text"]).strip()
    changes.append(("reading_questions", q38["id"], q38, {"payload": q38p}))
    return [row for row in changes
            if any(row[2].get(key) != value for key, value in row[3].items())]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    now = datetime.now(timezone.utc).isoformat()

    for table, test_uuid in (("listening_test_attempts", LISTENING_UUID),
                             ("reading_test_attempts", READING_UUID)):
        result = sb.table(table).select("id", count="exact").eq("test_id", test_uuid).limit(1).execute()
        if result.count != 0:
            raise RuntimeError(f"Refusing to patch {test_uuid}: {result.count} attempt(s) exist")

    verify_keys_and_types()
    print("Verified before write: 80/80 source answers and all question types")

    changes = build_changes(now)
    print(f"{'COMMIT' if args.commit else 'DRY-RUN'}: {len(changes)} canonical rows")
    for table, row_id, _before, patch in changes:
        print(f"  {table} {row_id}: {', '.join(sorted(patch))}")
        if args.commit:
            query = sb.table(table).update(patch).eq("id", row_id)
            # Avoid overwriting a concurrent admin/import edit made after this
            # script fetched the row.  Every target content table has
            # updated_at; the guard stays optional for schema-safe reuse.
            updated_at = _before.get("updated_at")
            if updated_at:
                query = query.eq("updated_at", updated_at)
            result = query.execute().data or []
            if len(result) != 1:
                raise RuntimeError(f"{table} {row_id}: write was not confirmed (stale row?)")
            readback = one(table, id=row_id)
            for key, expected in patch.items():
                if readback.get(key) != expected:
                    raise RuntimeError(f"{table} {row_id}: readback mismatch for {key}")

    if args.commit and changes:
        issues = [
            {"q_num": None, "dimension": "question", "severity": "error", "code": "manual_source_fidelity", "resolved": True,
             "source": "manual", "message": "Đã sửa option bank/prompt bị cắt dòng ở Listening 15-22 và Reading 23-26."},
            {"q_num": None, "dimension": "template", "severity": "warning", "code": "manual_render_contract", "resolved": True,
             "source": "manual", "message": "Đã sửa bullet tách, ô trống giả và dấu OCR trong template Listening/Reading."},
            {"q_num": 37, "dimension": "transcript", "severity": "warning", "code": "manual_transcript_gap", "resolved": True,
             "source": "manual", "message": "Đã khôi phục đoạn audioscript Part 4 bị thiếu và gỡ cảnh báo OCR đã lỗi thời."},
        ]
        row = {
            "test_id": LISTENING_UUID, "status": "fixed",
            "health": {"status": "passed", "error_count": 0, "warning_count": 0,
                       "question_count": 40, "manual_issue_count": len(issues)},
            "issues": issues, "notes": "Manual Cambridge source + student renderer audit: 40/40 questions, answer key, audio windows, transcript and solutions verified.",
            "auditor": AUDITOR, "audited_at": now, "updated_at": now,
        }
        existing = sb.table("listening_audit").select("id").eq("test_id", LISTENING_UUID).limit(1).execute().data or []
        result = ((sb.table("listening_audit").update(row).eq("test_id", LISTENING_UUID)) if existing
                  else sb.table("listening_audit").insert(row)).execute().data or []
        if len(result) != 1:
            raise RuntimeError("Listening audit marker write was not confirmed")
        saved = one("listening_audit", test_id=LISTENING_UUID)
        if saved.get("status") != "fixed" or saved.get("audited_at") != now:
            raise RuntimeError("Listening audit marker readback mismatch")
        print("  listening_audit: fixed marker saved and read back")
        verify_keys_and_types()
        print("Verified after write: 80/80 source answers and all question types")
    elif args.commit:
        print("No write needed: production already matches the audited canonical state")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
