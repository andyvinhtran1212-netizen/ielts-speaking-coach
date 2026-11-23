"""LEARNERCORE-0063 amendment 4 (G07-T31): review notes and flag-once state.

``review_notes`` (migration 421) holds one private note per (learner, skill,
test, question). The test is always taken from the caller's own attempt, never
from the client, so a note written on one attempt shows again on a later
attempt of the same test. Note bodies are never logged.

``my_flagged_q_nums`` lists the questions the caller already flagged on one
attempt (``user_feedback`` type ``flag``), so the review page can show
"Đã báo lỗi" on load. A whole-test flag (``q_num`` NULL) is not a question and
is left out.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

NOTE_MAX_CHARS = 500
SKILLS = ("listening", "reading")


class NoteTooLong(ValueError):
    pass


class QuestionNotInTest(ValueError):
    pass


def normalise_body(body: str | None) -> str | None:
    """Trimmed body, or None for "delete". Length counts characters as shown."""
    text = (body or "").strip()
    if not text:
        return None
    if len(text) > NOTE_MAX_CHARS:
        raise NoteTooLong(len(text))
    return text


def question_numbers(attempt: dict) -> set[int]:
    """Question numbers of the attempt's test, from its graded per-question rows.

    The review pages exist only for a submitted attempt, whose
    ``grading_details`` carry one row per question of the test.
    """
    out: set[int] = set()
    for row in attempt.get("grading_details") or []:
        q = row.get("q_num") if isinstance(row, dict) else None
        if isinstance(q, int) and not isinstance(q, bool) and q > 0:
            out.add(q)
    return out


def list_notes(db, *, user_id: str, skill: str, test_uuid: str) -> list[dict[str, Any]]:
    rows = (
        db.table("review_notes")
        .select("q_num,body,updated_at")
        .eq("user_id", user_id)
        .eq("skill", skill)
        .eq("test_uuid", test_uuid)
        .order("q_num")
        .execute().data or []
    )
    return [{"q_num": r["q_num"], "body": r["body"], "updated_at": r.get("updated_at")} for r in rows]


def save_note(db, *, user_id: str, skill: str, attempt: dict, q_num: int,
              body: str | None) -> dict[str, Any]:
    """Upsert, or delete when the trimmed body is empty; return the stored state."""
    if q_num not in question_numbers(attempt):
        raise QuestionNotInTest(q_num)
    text = normalise_body(body)
    key = {"user_id": user_id, "skill": skill, "test_uuid": attempt["test_id"], "q_num": q_num}
    if text is None:
        query = db.table("review_notes").delete()
        for column, value in key.items():
            query = query.eq(column, value)
        query.execute()
        return {"q_num": q_num, "body": None, "updated_at": None}
    now = datetime.now(timezone.utc).isoformat()
    saved = (
        db.table("review_notes")
        .upsert({**key, "body": text, "updated_at": now},
                on_conflict="user_id,skill,test_uuid,q_num")
        .execute().data or []
    )
    row = saved[0] if saved else {"body": text, "updated_at": now}
    return {"q_num": q_num, "body": row.get("body", text), "updated_at": row.get("updated_at", now)}


def my_flagged_q_nums(db, *, attempt_id: str, user_id: Optional[str] = None,
                      anon_id: Optional[str] = None) -> list[int]:
    if not user_id and not anon_id:
        return []
    query = (
        db.table("user_feedback")
        .select("q_num")
        .eq("attempt_id", attempt_id)
        .eq("type", "flag")
    )
    query = query.eq("created_by", user_id) if user_id else query.eq("anon_id", anon_id)
    rows = query.execute().data or []
    return sorted({r["q_num"] for r in rows if isinstance(r.get("q_num"), int)})
