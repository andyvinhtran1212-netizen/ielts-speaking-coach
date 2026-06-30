"""services/quiz_service.py — Quick-Check player read/write paths (Pha 2).

Serves a published bank (META + questions WITH answers — client grades instant,
QĐ-5) to authenticated students, and persists progress (sessions / attempts /
word_stats). The Adaptive Mastery loop runs in the browser; this layer just
stores what the client reports + reads carry-over for resume.

Ownership: every write verifies the session belongs to the caller (the backend
writes via service-role supabase_admin, so it must enforce user scoping in code).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import HTTPException

from database import supabase_admin

logger = logging.getLogger(__name__)

_ATTEMPT_FIELDS = ("item_key", "qid", "skill", "type", "subtype",
                   "is_correct", "answer_given", "response_time_ms", "attempt_no")
_WORD_STAT_FIELDS = ("item_key", "correct_count", "wrong_count", "first_try_correct",
                     "attempts_to_master", "status", "is_difficult", "skills_passed",
                     "provisional_skill", "production_done", "credit_count")
_VALID_WORD_STATUS = ("testing", "provisional", "mastered", "carried_over")
_ENDED_BY = ("completed", "time_cap", "paused")
_MAX_ATTEMPTS_PER_CALL = 200   # batch guard


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Read: list + serve banks ─────────────────────────────────────────

def list_published_banks(*, skill_area: str | None = None, topic_id: str | None = None) -> list[dict]:
    q = supabase_admin.table("quiz_banks").select(
        "id, topic_id, code, title, skill_area, words_count, updated_at"
    ).eq("is_published", True)
    if skill_area:
        q = q.eq("skill_area", skill_area)
    if topic_id:
        q = q.eq("topic_id", topic_id)
    try:
        return q.order("code").execute().data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn banks: {exc}")


def get_bank_for_play(bank_id: str) -> dict:
    """Bank META + questions WITH answers, for the authed player. 404 unless the
    bank exists AND is published."""
    try:
        b = (
            supabase_admin.table("quiz_banks").select("*")
            .eq("id", bank_id).limit(1).execute()
        ).data
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn bank: {exc}")
    if not b or not b[0].get("is_published"):
        raise HTTPException(404, "Không tìm thấy bank")
    bank = b[0]
    try:
        questions = (
            supabase_admin.table("quiz_questions").select("*")
            .eq("bank_id", bank_id).order("order").execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn câu hỏi: {exc}")
    return {"bank": bank, "questions": questions}


# ── Sessions / progress ──────────────────────────────────────────────

def _owned_session(session_id: str, user_id: str) -> dict:
    try:
        rows = (
            supabase_admin.table("quiz_sessions").select("*")
            .eq("id", session_id).limit(1).execute()
        ).data
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn session: {exc}")
    if not rows:
        raise HTTPException(404, "Không tìm thấy session")
    if rows[0]["user_id"] != user_id:
        raise HTTPException(403, "Session không thuộc về bạn")
    return rows[0]


def start_session(*, user_id: str, bank_id: str) -> dict:
    """Create a session and return {session_id, resume} — resume = the not-yet-
    mastered word_stats from prior sessions so the engine continues carry-over."""
    bank = get_bank_for_play(bank_id)["bank"]   # 404/published guard + code
    try:
        res = supabase_admin.table("quiz_sessions").insert({
            "user_id": user_id, "bank_id": bank_id, "code": bank.get("code"),
        }).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi tạo session: {exc}")
    if not res.data:
        raise HTTPException(500, "Insert session không trả về dòng nào")
    return {"session_id": res.data[0]["id"], "resume": get_resume(user_id=user_id, bank_id=bank_id)}


def get_resume(*, user_id: str, bank_id: str) -> list[dict]:
    """ALL prior word_stats for this user+bank (incl. mastered), so a new session
    resumes progress truthfully — mastered words stay mastered (not re-asked) and
    in-progress words keep their partial credit, instead of restarting from zero."""
    try:
        rows = (
            supabase_admin.table("quiz_word_stats").select(
                "item_key, correct_count, wrong_count, first_try_correct, "
                "attempts_to_master, status, is_difficult, skills_passed, "
                "provisional_skill, production_done, credit_count"
            )
            .eq("user_id", user_id).eq("bank_id", bank_id)
            .execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] resume read failed: %s", exc)
        return []
    return rows


def log_progress(*, user_id: str, session_id: str, attempts: list[dict], word_stats: list[dict]) -> dict:
    """Batch-persist attempts (append) + word_stats (upsert by user+bank+item).
    The client owns the mastery decision; we store its snapshots."""
    session = _owned_session(session_id, user_id)
    bank_id = session["bank_id"]

    attempts = attempts or []
    word_stats = word_stats or []
    if len(attempts) > _MAX_ATTEMPTS_PER_CALL or len(word_stats) > _MAX_ATTEMPTS_PER_CALL:
        raise HTTPException(413, "Batch quá lớn.")

    attempt_rows = []
    for a in attempts:
        row = {k: a.get(k) for k in _ATTEMPT_FIELDS}
        if not row.get("item_key") or row.get("is_correct") is None:
            continue   # skip malformed entries rather than 500 the batch
        row["is_correct"] = bool(row["is_correct"])
        row.update({"user_id": user_id, "session_id": session_id, "bank_id": bank_id})
        attempt_rows.append(row)
    if attempt_rows:
        try:
            supabase_admin.table("quiz_attempts").insert(attempt_rows).execute()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Lỗi ghi attempts: {exc}")

    stat_rows = []
    for w in word_stats:
        if not w.get("item_key"):
            continue
        status = w.get("status") or "testing"
        if status not in _VALID_WORD_STATUS:
            status = "testing"
        sp = w.get("skills_passed")
        stat_rows.append({
            "user_id": user_id, "bank_id": bank_id, "last_session_id": session_id,
            "item_key": w["item_key"],
            "correct_count": int(w.get("correct_count") or 0),
            "wrong_count": int(w.get("wrong_count") or 0),
            "first_try_correct": w.get("first_try_correct"),
            "attempts_to_master": w.get("attempts_to_master"),
            "status": status,
            "is_difficult": bool(w.get("is_difficult")),
            "skills_passed": sp if isinstance(sp, list) else [],
            "provisional_skill": w.get("provisional_skill"),
            "production_done": bool(w.get("production_done")),
            "credit_count": int(w.get("credit_count") or 0),
            "updated_at": _now(),
        })
    if stat_rows:
        try:
            supabase_admin.table("quiz_word_stats").upsert(
                stat_rows, on_conflict="user_id,bank_id,item_key"
            ).execute()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Lỗi ghi word_stats: {exc}")

    return {"ok": True, "attempts": len(attempt_rows), "word_stats": len(stat_rows)}


def end_session(*, user_id: str, session_id: str, data: dict) -> dict:
    """Finalize a session with totals from the client. ended_by ∈ ENDED_BY."""
    _owned_session(session_id, user_id)
    ended_by = data.get("ended_by")
    if ended_by not in _ENDED_BY:
        ended_by = "completed"
    total = int(data.get("total_questions") or 0)
    correct = int(data.get("total_correct") or 0)
    wrong = int(data.get("total_wrong") or 0)
    patch = {
        "ended_at": _now(),
        "duration_sec": data.get("duration_sec"),
        "total_questions": total,
        "total_correct": correct,
        "total_wrong": wrong,
        "accuracy": (correct / total) if total else None,
        "words_mastered": int(data.get("words_mastered") or 0),
        "words_carried_over": int(data.get("words_carried_over") or 0),
        "ended_by": ended_by,
    }
    try:
        res = supabase_admin.table("quiz_sessions").update(patch).eq("id", session_id).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi kết thúc session: {exc}")
    return res.data[0] if res.data else {"id": session_id, **patch}
