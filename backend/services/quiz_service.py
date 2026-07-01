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

_ATTEMPT_FIELDS = ("client_id", "item_key", "qid", "skill", "type", "subtype",
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
    _attach_article_urls(questions)
    return {"bank": bank, "questions": questions, "word_cards": _word_cards_for(bank)}


def _bank_meta_or_404(bank_id: str) -> dict:
    """Lightweight published-bank guard: fetch ONLY the bank's own row (id, code,
    is_published) — no questions, no word_cards. Used by start_session, which just
    needs `code` + the published check; pulling the full get_bank_for_play there
    would re-run the questions + whole-topic word_cards queries on every session
    start (they were already fetched by the player's GET /banks/{id})."""
    try:
        b = (
            supabase_admin.table("quiz_banks").select("id, code, is_published")
            .eq("id", bank_id).limit(1).execute()
        ).data
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn bank: {exc}")
    if not b or not b[0].get("is_published"):
        raise HTTPException(404, "Không tìm thấy bank")
    return b[0]


def _word_cards_for(bank: dict) -> dict:
    """Per-word glance cards for the bank's topic, keyed by LOWERCASED headword
    (== quiz_questions.item_key), so the player can show a quick-glance vocab
    popup (meaning + IPA + audio + example) without leaving the quiz.

    Best-effort and graceful: vocab-only, scoped to the bank's topic_id; any
    error or missing card → the key is simply absent and the popup link hides."""
    if bank.get("skill_area") == "grammar" or not bank.get("topic_id"):
        return {}
    try:
        rows = (
            supabase_admin.table("vocab_cards").select(
                "headword, definition_vi, definition_en, gloss_vi, pronunciation, "
                "syllables, part_of_speech, level, register, example, "
                "audio_headword, audio_example, collocations, synonyms, antonyms, "
                "related_words, word_family, common_error, memory_hook"
            ).eq("topic_id", bank["topic_id"]).execute()
        ).data or []
    except Exception:  # noqa: BLE001
        return {}
    cards = {}
    for c in rows:
        hw = (c.get("headword") or "").strip().lower()
        if hw:
            cards[hw] = c
    return cards


def _attach_article_urls(questions: list[dict]) -> None:
    """For questions that reference a Wiki article (grammar), resolve the public
    URL (/grammar/<category>/<slug>) so the player can show a 'review' link on a
    wrong answer. Best-effort — leaves article_url unset if grammar_service or the
    slug isn't available."""
    slugged = [q for q in questions if q.get("grammar_article_slug")]
    if not slugged:
        return
    try:
        from services.grammar_content import grammar_service
        by_slug = grammar_service.articles_by_slug
    except Exception:  # noqa: BLE001
        return
    for q in slugged:
        art = by_slug.get(q["grammar_article_slug"])
        if art and art.get("category"):
            q["article_url"] = f"/grammar/{art['category']}/{q['grammar_article_slug']}"


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
    """Create a session and return {session_id, resume} — resume = prior word_stats
    so the engine continues carry-over.

    Resume is read BEFORE the session is created and FAILS CLOSED: if the read
    errors we must NOT start a fresh-looking session, because the first /progress
    upsert would then overwrite a previously mastered/provisional word with lower
    counts. A read failure → 500, no session row, no destructive write."""
    bank = _bank_meta_or_404(bank_id)   # 404/published guard + code (no heavy fetch)
    resume = get_resume(user_id=user_id, bank_id=bank_id)   # raises on read failure
    try:
        res = supabase_admin.table("quiz_sessions").insert({
            "user_id": user_id, "bank_id": bank_id, "code": bank.get("code"),
        }).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi tạo session: {exc}")
    if not res.data:
        raise HTTPException(500, "Insert session không trả về dòng nào")
    return {"session_id": res.data[0]["id"], "resume": resume}


def get_resume(*, user_id: str, bank_id: str) -> list[dict]:
    """ALL prior word_stats for this user+bank (incl. mastered), so a new session
    resumes progress truthfully — mastered words stay mastered (not re-asked) and
    in-progress words keep their partial credit, instead of restarting from zero.

    FAILS CLOSED: a read error raises (not []), so the caller never proceeds with
    empty resume and clobbers existing progress on the next snapshot upsert."""
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
        raise HTTPException(500, f"Lỗi đọc tiến độ (resume): {exc}")
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
            # Idempotent on client_id (mig 119 unique index) — a retried or
            # keepalive-on-unload re-send of the same attempts is ignored, so a
            # pagehide-during-flush double-send never duplicates rows.
            supabase_admin.table("quiz_attempts").upsert(
                attempt_rows, on_conflict="client_id", ignore_duplicates=True
            ).execute()
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


# ── Analytics (Pha 5a) ───────────────────────────────────────────────

def bank_analytics(bank_id: str) -> dict:
    """Class-wide "từ dễ sai" for a bank: per-item + per-skill error rates (via
    the mig-121 RPCs) + a session count. Admin-only."""
    try:
        items = supabase_admin.rpc(
            "quiz_item_error_rates", {"p_bank_id": bank_id}).execute().data or []
        skills = supabase_admin.rpc(
            "quiz_skill_error_rates", {"p_bank_id": bank_id}).execute().data or []
        sc = (
            supabase_admin.table("quiz_sessions")
            .select("id", count="exact").eq("bank_id", bank_id).execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn analytics: {exc}")
    session_count = sc.count if sc.count is not None else len(sc.data or [])
    return {"items": items, "skills": skills, "session_count": session_count}


def student_progress(user_id: str) -> dict:
    """A learner's own progress: per-bank mastered/in-progress (from word_stats)
    enriched with bank meta, plus recent sessions for an accuracy trend."""
    # Aggregate per-bank in SQL (RPC) so a learner with more word_stats rows than
    # the PostgREST page cap is counted fully — a plain select would silently see
    # only the first page and undercount.
    try:
        rows = (
            supabase_admin.rpc("quiz_user_bank_progress", {"p_user_id": user_id})
            .execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn tiến độ: {exc}")

    by_bank: dict[str, dict] = {
        r["bank_id"]: {
            "mastered": int(r.get("mastered") or 0),
            "in_progress": int(r.get("in_progress") or 0),
        }
        for r in rows if r.get("bank_id")
    }

    meta: dict[str, dict] = {}
    if by_bank:
        try:
            rows = (
                supabase_admin.table("quiz_banks")
                .select("id, code, title, skill_area, words_count")
                .in_("id", list(by_bank.keys())).execute()
            ).data or []
            meta = {r["id"]: r for r in rows}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Lỗi truy vấn bank: {exc}")

    banks = []
    for bid, cnt in by_bank.items():
        m = meta.get(bid, {})
        banks.append({
            "bank_id": bid, "code": m.get("code"), "title": m.get("title"),
            "skill_area": m.get("skill_area"), "words_count": m.get("words_count"),
            "mastered": cnt["mastered"], "in_progress": cnt["in_progress"],
        })
    banks.sort(key=lambda x: (x.get("skill_area") or "", x.get("code") or ""))

    try:
        sessions = (
            supabase_admin.table("quiz_sessions")
            .select("code, accuracy, words_mastered, total_questions, total_correct, "
                    "duration_sec, ended_at, ended_by")
            .eq("user_id", user_id).order("started_at", desc=True).limit(20).execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn phiên: {exc}")

    # Lifetime totals for the "Thống kê của tôi" header (total practice time,
    # session count, words mastered, avg accuracy). Words-mastered is the truthful
    # cumulative count summed across banks (from the page-safe RPC above), not a
    # per-session sum. Session time/accuracy come from a lean all-sessions read;
    # a learner's session count is far below the PostgREST page cap in practice.
    try:
        all_sess = (
            supabase_admin.table("quiz_sessions")
            .select("duration_sec, accuracy, ended_at").eq("user_id", user_id).execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn tổng hợp phiên: {exc}")
    # Count only FINALIZED sessions: start_session inserts a row when the quiz page
    # opens, so a learner who opens quiz.html and leaves before finish() PATCHes
    # leaves an ended_at-less row. Including it would inflate the session count with
    # zero time/accuracy. end_session always stamps ended_at (completed AND paused),
    # so ended_at present == real, finished practice.
    fin = [r for r in all_sess if r.get("ended_at")]
    accs = [r["accuracy"] for r in fin if r.get("accuracy") is not None]
    totals = {
        "sessions": len(fin),
        "time_sec": sum(int(r.get("duration_sec") or 0) for r in fin),
        "words_mastered": sum(b["mastered"] for b in banks),
        "avg_accuracy": (sum(accs) / len(accs)) if accs else None,
    }

    return {"banks": banks, "recent_sessions": sessions, "totals": totals}
