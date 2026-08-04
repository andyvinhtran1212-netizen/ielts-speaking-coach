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
import re
import traceback
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from database import supabase_admin

logger = logging.getLogger(__name__)

# A curated lesson word's `source` is an "L<NN> Group X" stamp. Such a word stays
# scoped to the bank (dual membership) even when it also carries an exam `lists`
# tag; only pure exam imports (no lesson source) are filtered out of the popup.
_LESSON_SRC_RE = re.compile(r"^L\d")

# The prompt placeholder that marks a question as needing the word's audio. Must
# stay byte-identical to the token quiz_import._commit_bank keys off, so import
# and serve agree on which questions are audio questions.
_AUDIO_TOKEN = "{{audio}}"


def _is_lesson_source(source) -> bool:
    return bool(_LESSON_SRC_RE.match((source or "").strip()))

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


def _coerce_int(v):
    """INT columns (mig 119 response_time_ms/attempt_no) reject a fractional value.
    The client sends a performance.now() delta in ms (e.g. 5491.2999…), so Postgres
    raises 22P02 and 500s the whole attempts batch — silently losing progress. Round
    to int; None/garbage → None (nullable columns)."""
    if v is None:
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def _log_backend_error(*, message: str, user_id: str | None = None,
                       url: str | None = None, extra: dict | None = None) -> None:
    """Best-effort persist a backend error to `error_logs` (source=backend) so a
    server-side 500 is DIAGNOSABLE later (uvicorn access logs show only the
    status, not the exception). Call from inside an `except` block — it captures
    the live traceback. NEVER raises: a logging failure must not mask the real
    error or turn a handled 500 into a crash."""
    try:
        supabase_admin.table("error_logs").insert({
            "level": "error",
            "source": "backend",
            "message": str(message)[:2000],
            "stack": traceback.format_exc()[:10000],
            "user_id": user_id,
            "url": url,
            "extra": extra or {},
            "occurred_at": _now(),
        }).execute()
    except Exception:  # noqa: BLE001
        logger.warning("[quiz] could not persist backend error to error_logs", exc_info=True)


def quiz_write_health() -> dict:
    """Probe that the exact upserts log_progress performs are usable — both that
    PostgREST recognizes the ON CONFLICT unique constraints (migration 119) AND that
    every column log_progress writes EXISTS in the table.

    Two failure modes this guards against, both of which 500 /progress while plain
    reads keep working (so a naive liveness check misses them):
      1. Constraint not in PostgREST's schema cache → "no unique or exclusion
         constraint matching the ON CONFLICT specification" (needs NOTIFY pgrst).
      2. A column log_progress writes is MISSING (a manual migration's ADD COLUMN
         wasn't applied to this env) → "column ... does not exist". The probe rows
         below deliberately carry the FULL column set log_progress sends — an earlier
         minimal probe wrote only {user_id,bank_id,item_key,status}, so a missing
         provisional_skill/production_done/credit_count column reported HEALTHY while
         real progress-saving 500'd.

    Non-destructive: probes with BOGUS foreign keys. Postgres validates ON CONFLICT
    + column existence at PLAN time (before row execution):
      - constraint/column problem → planning error (not a FK error)  → unhealthy
      - all good                   → plan OK, then FK violation on the bogus row → healthy
    The bogus row is never written (FK rejects it), so nothing to clean up."""
    bogus = str(uuid.uuid4())

    def _probe(table: str, on_conflict: str, row: dict) -> dict:
        try:
            supabase_admin.table(table).upsert(
                [row], on_conflict=on_conflict, ignore_duplicates=True
            ).execute()
            # Unexpected: the bogus row was ACCEPTED (FK not enforced?). on_conflict
            # resolved, but this is anomalous — flag unhealthy + clean up the sentinel.
            try:
                supabase_admin.table(table).delete().eq("item_key", "__healthcheck__").execute()
            except Exception:  # noqa: BLE001
                pass
            return {"ok": False, "note": "unexpected: bogus row was written (FK not enforced?) — investigate"}
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            # HEALTHY *only* on the EXPECTED foreign-key violation: it proves PostgREST
            # reached the DB, recognized the ON CONFLICT constraint (planned OK), and
            # only the bogus FK stopped the write. ANY other error — missing constraint
            # (42P10), expired/invalid service key, missing table/column, PostgREST 5xx,
            # network — means the real progress upsert cannot persist → UNHEALTHY.
            if "foreign key" in msg or "23503" in msg:
                return {"ok": True, "note": "on_conflict resolved (bogus row rejected by FK, as expected)"}
            missing = ("on conflict" in msg or "no unique" in msg
                       or "exclusion constraint" in msg or "42p10" in msg)
            note = ("ON CONFLICT constraint MISSING — run NOTIFY pgrst, 'reload schema'"
                    if missing else "write path unhealthy (auth / missing table-column / PostgREST / network?)")
            return {"ok": False, "note": note, "err": str(exc)[:200]}

    # Rows carry the SAME columns log_progress writes (representative values), so a
    # missing column surfaces here instead of only in production.
    attempt_row = {
        "client_id": str(uuid.uuid4()), "item_key": "__healthcheck__", "qid": "__hc__",
        "skill": "meaning", "type": "mcq", "subtype": None, "is_correct": True,
        "answer_given": "x", "response_time_ms": 0, "attempt_no": 1,
        "user_id": bogus, "session_id": bogus, "bank_id": bogus,
    }
    word_stat_row = {
        "user_id": bogus, "bank_id": bogus, "last_session_id": bogus,
        "item_key": "__healthcheck__", "correct_count": 0, "wrong_count": 0,
        "first_try_correct": None, "attempts_to_master": None, "status": "testing",
        "is_difficult": False, "skills_passed": [], "provisional_skill": None,
        "production_done": False, "credit_count": 0, "updated_at": _now(),
    }
    checks = {
        "quiz_attempts.client_id": _probe("quiz_attempts", "client_id", attempt_row),
        "quiz_word_stats.user_bank_item": _probe(
            "quiz_word_stats", "user_id,bank_id,item_key", word_stat_row),
    }
    return {"ok": all(c["ok"] for c in checks.values()), "checks": checks}


# ── Read: list + serve banks ─────────────────────────────────────────

# Bài tập theo BUỔI HỌC của giáo trình. Khác mọi bank khác ở một điểm, và điểm
# ấy quyết định cả hai chốt dưới đây: nó KHÔNG phải nội dung học viên tự chọn mà
# làm. Nó nằm trong kho của giáo viên, và chỉ tới tay một em khi em đó ĐƯỢC GIAO.
COURSE_AREA = "course"


def list_published_banks(*, skill_area: str | None = None, topic_id: str | None = None) -> list[dict]:
    q = supabase_admin.table("quiz_banks").select(
        "id, topic_id, code, title, skill_area, words_count, updated_at"
    ).eq("is_published", True)
    # KHÔNG bao giờ liệt kê bank theo buổi ở đây. `skill_area` do người gọi
    # truyền, nên không loại trừ nghĩa là bất kỳ học viên nào gọi
    # `?skill_area=course` cũng liệt kê được toàn bộ giáo trình — kể cả buổi lớp
    # em ấy chưa học tới.
    if skill_area == COURSE_AREA:
        return []
    q = q.neq("skill_area", COURSE_AREA)
    if skill_area:
        q = q.eq("skill_area", skill_area)
    if topic_id:
        q = q.eq("topic_id", topic_id)
    try:
        return q.order("code").execute().data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn banks: {exc}")


def _has_assignment_for(bank_id: str, user_id: str) -> bool:
    """Học viên này CÓ được giao bài tập của bank ấy không.

    Bài giao lớp trỏ tới bank bằng `content_id` (mig 177), và mỗi học viên có một
    dòng trong `class_assignment_items`. Hỏi từ phía học viên: chỉ những mục của
    CHÍNH em ấy mới được tính.
    """
    try:
        asg = (supabase_admin.table("class_assignments").select("id")
               .eq("content_id", bank_id).execute().data) or []
        if not asg:
            return False
        student = (supabase_admin.table("students").select("id")
                   .eq("user_id", user_id).execute().data) or []
        if not student:
            return False
        sids = [s["id"] for s in student]
        aids = [a["id"] for a in asg]
        rows = (supabase_admin.table("class_assignment_items").select("id")
                .in_("assignment_id", aids).in_("student_id", sids)
                .limit(1).execute().data) or []
        return bool(rows)
    except Exception as exc:  # noqa: BLE001
        # Không đọc được thì TỪ CHỐI. Mở cửa khi chốt hỏng là biến một lỗi tạm
        # thời thành một lần lộ nội dung.
        logger.warning("[quiz] assignment check failed bank=%s: %s", bank_id, exc)
        return False


def get_bank_for_play(bank_id: str, user_id: str | None = None) -> dict:
    """Bank META + questions WITH answers, for the authed player. 404 unless the
    bank exists AND is published.

    Bank theo BUỔI HỌC còn một chốt nữa: phải ĐƯỢC GIAO. Xuất bản không mở cửa
    cho nó — đó là kho của giáo viên, không phải nội dung tự chọn."""
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
    if bank.get("skill_area") == COURSE_AREA:
        # Trả 404 chứ không 403: 403 xác nhận bank ấy tồn tại, và với nội dung
        # giáo trình thì chính sự tồn tại cũng không cần nói ra.
        if not user_id or not _has_assignment_for(bank_id, user_id):
            raise HTTPException(404, "Không tìm thấy bank")
    try:
        questions = (
            supabase_admin.table("quiz_questions").select("*")
            .eq("bank_id", bank_id).order("order").execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn câu hỏi: {exc}")
    word_cards = _word_cards_for(bank)
    _attach_article_urls(questions)
    _resolve_question_audio(questions, word_cards)
    return {"bank": bank, "questions": questions, "word_cards": word_cards}


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
                "related_words, word_family, common_error, memory_hook, lists, source"
            ).eq("topic_id", bank["topic_id"]).execute()
        ).data or []
    except Exception:  # noqa: BLE001
        return {}
    cards = {}
    for c in rows:
        # Skip exam-ONLY vocab (a pure AWL/TOEIC/THPT import sharing this topic): the
        # glance popup must stay scoped to the curated bank words. A lesson word that
        # also carries an exam list (dual membership, source "L##") is kept.
        if c.get("lists") and not _is_lesson_source(c.get("source")):
            continue
        hw = (c.get("headword") or "").strip().lower()
        if hw:
            cards[hw] = c
    return cards


def _resolve_question_audio(questions: list[dict], word_cards: dict) -> None:
    """Re-point `{{audio}}` questions at the vocab card's CURRENT audio_headword.

    `quiz_questions.audio_url` is written ONLY at import (quiz_import._commit_bank)
    and never again — no other writer exists. So a bank imported before the word's
    TTS pregen finished keeps audio_url NULL forever: the pregen fills
    vocab_cards.audio_headword, but nothing propagates it back, and the player then
    hides the 🔊 button on a "listen and type" question that cannot be answered
    without it. The card is the source of truth for a word's audio, so resolve per
    request from it and let the stored snapshot be the fallback (grammar banks carry
    no word_cards, and keep theirs untouched)."""
    for q in questions:
        if _AUDIO_TOKEN not in (q.get("prompt") or ""):
            continue
        card = word_cards.get((q.get("item_key") or "").strip().lower()) or {}
        live = card.get("audio_headword")
        if live:
            q["audio_url"] = live


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


def reset_progress(*, user_id: str, bank_id: str) -> dict:
    """Wipe the caller's word_stats for one bank — a full restart of the adaptive
    test (used by the "Làm lại từ đầu" action once every word is already mastered).
    Session/attempt HISTORY in quiz_sessions/quiz_attempts is untouched (append-only
    log of what actually happened); only the current mastery cache is cleared."""
    _bank_meta_or_404(bank_id)   # 404 unless the bank exists + is published
    try:
        supabase_admin.table("quiz_word_stats").delete() \
            .eq("user_id", user_id).eq("bank_id", bank_id).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi xoá tiến độ: {exc}")
    return {"ok": True}


def _record_quiz_kp_evidence(user_id: str, bank_id: str, attempt_rows: list[dict]) -> None:
    """Phase 2.4 — a graded quiz attempt on a grammar-linked question is a
    source=quiz signal on that article's KP (+1 correct / -1 wrong). Best-effort:
    generalizes quiz_questions.grammar_article_slug → grammar KP. Never raises
    into log_progress; a no-op until the KP tables/migrations exist. Questions with
    no grammar_article_slug (pure vocab) contribute nothing here."""
    try:
        from services import kp_evidence  # local import — keep this path optional
        keys = list({r["item_key"] for r in attempt_rows if r.get("item_key")})
        if not keys:
            return
        qrows = (supabase_admin.table("quiz_questions")
                 .select("item_key,grammar_article_slug")
                 .eq("bank_id", bank_id).in_("item_key", keys).execute().data or [])
        slug_by_key = {q["item_key"]: q["grammar_article_slug"]
                       for q in qrows if q.get("grammar_article_slug")}
        if not slug_by_key:
            return
        for r in attempt_rows:
            slug = slug_by_key.get(r.get("item_key"))
            if not slug:
                continue
            kp_evidence.record_evidence_safe(
                user_id, kp_type="grammar", ref_slug=slug, anchor="",
                source="quiz", signal=1 if r["is_correct"] else -1,
                context={"bank_id": bank_id, "item_key": r["item_key"]})
    except Exception as e:  # noqa: BLE001 — telemetry only, never fatal
        logger.warning("[quiz] KP evidence recording skipped (non-fatal): %s", e)


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
        # response_time_ms / attempt_no are INT columns; the client's timing delta
        # is a float — coerce so one fractional value can't 22P02-500 the batch.
        row["response_time_ms"] = _coerce_int(row.get("response_time_ms"))
        row["attempt_no"] = _coerce_int(row.get("attempt_no"))
        row.update({"user_id": user_id, "session_id": session_id, "bank_id": bank_id})
        attempt_rows.append(row)
    if attempt_rows:
        try:
            # Idempotent on client_id (mig 119 unique index) — a retried or
            # keepalive-on-unload re-send of the same attempts is ignored, so a
            # pagehide-during-flush double-send never duplicates rows.
            attempts_resp = supabase_admin.table("quiz_attempts").upsert(
                attempt_rows, on_conflict="client_id", ignore_duplicates=True
            ).execute()
        except Exception as exc:  # noqa: BLE001
            _log_backend_error(
                message=f"quiz progress: attempts upsert failed: {exc}",
                user_id=user_id, url=f"/api/quiz/sessions/{session_id}/progress",
                extra={"stage": "attempts", "n_attempts": len(attempt_rows)})
            raise HTTPException(500, f"Lỗi ghi attempts: {exc}")
        # Feed only the NEWLY-inserted attempts into the KP evidence store. With
        # ignore_duplicates the upsert RETURNs just the rows it inserted, so a
        # retried/keepalive re-send (same client_id) records no duplicate evidence
        # and can't double-count a quiz answer toward mastery.
        _record_quiz_kp_evidence(user_id, bank_id, getattr(attempts_resp, "data", None) or [])

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
            _log_backend_error(
                message=f"quiz progress: word_stats upsert failed: {exc}",
                user_id=user_id, url=f"/api/quiz/sessions/{session_id}/progress",
                extra={"stage": "word_stats", "n_word_stats": len(stat_rows)})
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


def admin_student_rollup(skill_area: str = "vocab") -> dict:
    """Admin observation of learners' practice for one skill_area: an {overview,
    students} payload. Per-learner rows come from the mig-123 RPC (page-safe SQL
    aggregate); identities (name/email) are resolved in one batched users read.
    The overview totals are derived from the same rows — accuracy is weighted by
    session count so a one-session learner doesn't skew the class average."""
    try:
        rows = supabase_admin.rpc(
            "quiz_admin_student_rollup", {"p_skill_area": skill_area}).execute().data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn rollup: {exc}")

    uids = [r["user_id"] for r in rows if r.get("user_id")]
    users: dict[str, dict] = {}
    if uids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email, display_name").in_("id", uids).execute()
            ).data or []
            users = {u["id"]: u for u in ur}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Lỗi truy vấn user: {exc}")

    students = []
    for r in rows:
        uid = r.get("user_id")
        u = users.get(uid, {})
        acc = r.get("avg_accuracy")
        students.append({
            "user_id": uid,
            "name": u.get("display_name") or "",
            "email": u.get("email") or "",
            "sessions": int(r.get("sessions") or 0),
            "graded_sessions": int(r.get("graded_sessions") or 0),
            "time_sec": int(r.get("total_time_sec") or 0),
            "avg_accuracy": float(acc) if acc is not None else None,
            "words_mastered": int(r.get("words_mastered") or 0),
            "last_active": r.get("last_active"),
        })

    # Weight the class average by GRADED sessions, not started ones: a learner's
    # avg_accuracy excludes their NULL-accuracy (unanswered) sessions, so weighting
    # by total sessions would overweight someone with many abandoned/empty sessions.
    acc_num = sum((s["avg_accuracy"] or 0) * s["graded_sessions"]
                  for s in students if s["avg_accuracy"] is not None)
    acc_den = sum(s["graded_sessions"] for s in students if s["avg_accuracy"] is not None)
    overview = {
        "active_learners": len(students),
        "total_sessions": sum(s["sessions"] for s in students),
        "total_time_sec": sum(s["time_sec"] for s in students),
        "total_words_mastered": sum(s["words_mastered"] for s in students),
        "avg_accuracy": (acc_num / acc_den) if acc_den else None,
    }
    return {"overview": overview, "students": students}


def admin_student_detail(user_id: str, skill_area: str = "vocab") -> dict:
    """One learner's practice detail for the admin drill-down: their per-bank
    progress + recent sessions (reuses the student's own progress view) plus the
    resolved identity so the panel can title itself.

    SCOPED to skill_area: the vocab report must not leak a learner's grammar bank
    progress / grammar sessions into the vocabulary modal. Per-bank progress carries
    skill_area, so it's filtered directly; recent sessions are re-queried scoped by
    the skill's bank_ids BEFORE the 20-row cap (reusing student_progress()'s already
    capped-across-all-skills list would hide vocab practice behind newer grammar
    sessions, and code-matching would leak when two skills' banks share a code)."""
    prog = student_progress(user_id)
    banks = [b for b in prog.get("banks", []) if (b.get("skill_area") or "") == skill_area]

    # FAIL CLOSED: a scoping-lookup error raises 500 rather than falling through
    # with unscoped sessions — the endpoint promises skill-scoped detail, so it must
    # never show another skill's sessions on a transient DB/permission error.
    try:
        bank_ids = [r["id"] for r in (
            supabase_admin.table("quiz_banks").select("id")
            .eq("skill_area", skill_area).execute()
        ).data or [] if r.get("id")]
        sessions: list[dict] = []
        if bank_ids:
            sessions = (
                supabase_admin.table("quiz_sessions")
                .select("code, accuracy, words_mastered, total_questions, "
                        "total_correct, duration_sec, ended_at, ended_by")
                .eq("user_id", user_id).in_("bank_id", bank_ids)
                .order("started_at", desc=True).limit(20).execute()
            ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn phiên (scoped): {exc}")

    info: dict = {}
    try:
        u = (
            supabase_admin.table("users")
            .select("id, email, display_name").eq("id", user_id).limit(1).execute()
        ).data
        if u:
            info = u[0]
    except Exception:  # noqa: BLE001 — identity is best-effort; progress already loaded
        info = {}
    return {
        "user": {"user_id": user_id, "name": info.get("display_name") or "",
                 "email": info.get("email") or ""},
        "banks": banks,
        "recent_sessions": sessions,
    }


_WORD_STAT_PAGE = 1000


def mastered_item_keys(sb, user_id: str, bank_ids: list[str]) -> set[str]:
    """DISTINCT lowercased item_keys this learner has mastered across `bank_ids`.

    Distinct, not summed: 28 words live in two lessons each, so adding the
    per-bank counts reports more words than the learner actually knows. Both the
    Vocabulary hub tile and the stats-page header read this, so the two screens
    can't disagree (they did: 141 vs 136 for the same learner).

    Takes `sb` rather than reaching for the module-global client, because the home
    aggregator is handed its own client (and a fake one in tests). Paged — a
    learner several lessons in can exceed the PostgREST page cap.
    """
    if not bank_ids:
        return set()
    out: set[str] = set()
    start = 0
    while True:
        rows = (
            sb.table("quiz_word_stats").select("item_key")
            .eq("user_id", user_id).eq("status", "mastered").in_("bank_id", bank_ids)
            .order("item_key").range(start, start + _WORD_STAT_PAGE - 1).execute()
        ).data or []
        for r in rows:
            key = (r.get("item_key") or "").strip().lower()
            if key:
                out.add(key)
        if len(rows) < _WORD_STAT_PAGE:
            return out
        start += _WORD_STAT_PAGE


def _bank_ids_for_skill(skill_area: str | None) -> list[str] | None:
    """Bank ids for one skill_area, or None meaning "every bank" (no filter).

    FAILS CLOSED: a lookup error raises rather than silently degrading to an
    unscoped read — a vocabulary surface must never fall back to showing the
    learner's grammar practice.
    """
    if not skill_area:
        return None
    try:
        rows = (
            supabase_admin.table("quiz_banks").select("id")
            .eq("skill_area", skill_area).execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn bank theo kỹ năng: {exc}")
    return [r["id"] for r in rows if r.get("id")]


def _display_answer(question: dict, raw) -> str:
    """Render a stored `answer_given` / the question's own answer as the learner
    saw it. quiz_attempts stores the ORIGINAL option index for choice/syllable
    (the player grades by index), so a bare echo would show "2" instead of the
    option text."""
    if raw is None:
        return ""
    inp = question.get("input")
    if inp in ("choice", "syllable"):
        pool = question.get("options") if inp == "choice" else question.get("segments")
        pool = pool or []
        try:
            i = int(str(raw).strip())
        except (TypeError, ValueError):
            return str(raw)
        return str(pool[i]) if 0 <= i < len(pool) else str(raw)
    if inp == "boolean":
        return "Đúng" if str(raw).strip().lower() in ("true", "1") else "Sai"
    return str(raw)


def _correct_answer_text(question: dict) -> str:
    inp, ans = question.get("input"), question.get("answer")
    if inp == "choice":
        opts = question.get("options") or []
        return str(opts[ans]) if isinstance(ans, int) and 0 <= ans < len(opts) else ""
    if inp == "syllable":
        segs = question.get("segments") or []
        return str(segs[ans]) if isinstance(ans, int) and 0 <= ans < len(segs) else ""
    if inp == "boolean":
        return "Đúng" if (ans == 1 or ans is True) else "Sai"
    if inp == "text":
        accept = question.get("accept") or []
        return str(accept[0]) if accept else ""
    return ""


_MISTAKE_ATTEMPT_CAP = 400      # newest wrong answers scanned
_MISTAKE_ITEM_CAP = 60          # words shown

# `{{audio}}` is a PLAYER placeholder, not prompt text — the player replaces it
# with a 🔊 control. Anything else that shows a prompt to a learner must strip it
# or the raw token reaches the screen (it did, on 16 of 47 review cards). Matches
# the player's own regex, including an authored `**{{audio}}**` wrapper: stripping
# the bare token there would leave `****` behind.
_AUDIO_TOKEN_RE = re.compile(r"\s*(?:\*\*)?\{\{audio\}\}(?:\*\*)?\s*")


def _display_prompt(prompt: str | None) -> str:
    return _AUDIO_TOKEN_RE.sub(" ", str(prompt or "")).strip()


def student_mistakes(user_id: str, skill_area: str | None = None) -> dict:
    """The caller's own wrong answers, so they survive the session.

    Audit 2026-07-28 (§C2): the end-of-session "Xem lại bài làm" list lives only
    in the tab's memory (`sessionLog` in quiz.html) — leave the result screen and
    every wrong answer is gone. The data was never the problem: quiz_attempts has
    kept `qid` + `answer_given` + `is_correct` all along (6 948 rows on prod) and
    quiz_word_stats.is_difficult was true for 47% of rows. There was simply no
    read path. This is it.

    Groups the newest wrong attempts by word, then by question, and joins the
    question so the learner sees the prompt, what they answered, the right answer
    and the explanation — the same four things the in-session review shows.
    """
    bank_ids = _bank_ids_for_skill(skill_area)
    if bank_ids is not None and not bank_ids:
        return {"items": [], "total_missed_words": 0}

    try:
        q = (
            supabase_admin.table("quiz_attempts")
            .select("bank_id, item_key, qid, skill, type, answer_given, created_at")
            .eq("user_id", user_id).eq("is_correct", False)
        )
        if bank_ids is not None:
            q = q.in_("bank_id", bank_ids)
        attempts = (
            q.order("created_at", desc=True).limit(_MISTAKE_ATTEMPT_CAP).execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn câu đã trả lời sai: {exc}")
    if not attempts:
        return {"items": [], "total_missed_words": 0}

    # Newest-first, so the FIRST attempt seen per (bank, qid) is the latest one.
    by_q: dict[tuple[str, str], dict] = {}
    for a in attempts:
        key = (a.get("bank_id"), a.get("qid"))
        if not all(key):
            continue
        slot = by_q.get(key)
        if slot is None:
            by_q[key] = {"attempt": a, "wrong_times": 1}
        else:
            slot["wrong_times"] += 1

    # Resolve the questions themselves, one read per bank.
    questions: dict[tuple[str, str], dict] = {}
    for bank_id in {k[0] for k in by_q}:
        qids = [k[1] for k in by_q if k[0] == bank_id]
        # Chunked: an in_() list goes into the QUERY STRING, so a few hundred qids
        # would build a URL long enough for PostgREST/the proxy to reject.
        for i in range(0, len(qids), 100):
            try:
                rows = (
                    supabase_admin.table("quiz_questions")
                    .select("bank_id, qid, item_key, prompt, hint, input, type, skill, "
                            "options, segments, answer, accept, explain, "
                            "grammar_article_slug")
                    .eq("bank_id", bank_id).in_("qid", qids[i:i + 100]).execute()
                ).data or []
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(500, f"Lỗi truy vấn câu hỏi: {exc}")
            _attach_article_urls(rows)
            for r in rows:
                questions[(r["bank_id"], r["qid"])] = r

    # Bank meta for the card headers.
    try:
        meta = {
            r["id"]: r for r in (
                supabase_admin.table("quiz_banks")
                .select("id, code, title, skill_area")
                .in_("id", list({k[0] for k in by_q})).execute()
            ).data or []
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn bank: {exc}")

    # Mastery state per word, so a word already fixed reads as fixed.
    stats: dict[tuple[str, str], dict] = {}
    try:
        s = (
            supabase_admin.table("quiz_word_stats")
            .select("bank_id, item_key, status, wrong_count, correct_count, is_difficult")
            .eq("user_id", user_id)
            .in_("bank_id", list({k[0] for k in by_q})).execute()
        ).data or []
        stats = {(r["bank_id"], r["item_key"]): r for r in s}
    except Exception:  # noqa: BLE001 — enrichment only; the mistakes still render
        stats = {}

    grouped: dict[tuple[str, str], dict] = {}
    for (bank_id, qid), slot in by_q.items():
        question = questions.get((bank_id, qid))
        if not question:
            continue          # question retired since the attempt — nothing to show
        a = slot["attempt"]
        item_key = question.get("item_key") or a.get("item_key") or ""
        gkey = (bank_id, item_key)
        b = meta.get(bank_id, {})
        st = stats.get(gkey, {})
        g = grouped.setdefault(gkey, {
            "bank_id": bank_id,
            "item_key": item_key,
            "code": b.get("code"),
            "title": b.get("title"),
            "skill_area": b.get("skill_area"),
            "status": st.get("status"),
            "is_difficult": bool(st.get("is_difficult")),
            "wrong_count": int(st.get("wrong_count") or 0),
            "correct_count": int(st.get("correct_count") or 0),
            "last_wrong_at": a.get("created_at"),
            "questions": [],
        })
        if (a.get("created_at") or "") > (g["last_wrong_at"] or ""):
            g["last_wrong_at"] = a.get("created_at")
        g["questions"].append({
            "qid": qid,
            "prompt": _display_prompt(question.get("prompt")),
            "hint": question.get("hint") or "",
            "skill": question.get("skill") or a.get("skill"),
            "type": question.get("type") or a.get("type"),
            "your_answer": _display_answer(question, a.get("answer_given")),
            "correct_answer": _correct_answer_text(question),
            "explain": question.get("explain") or "",
            "article_url": question.get("article_url"),
            "wrong_times": slot["wrong_times"],
            "last_wrong_at": a.get("created_at"),
        })

    items = sorted(
        grouped.values(),
        key=lambda g: (g["last_wrong_at"] or ""),
        reverse=True,
    )
    for g in items:
        g["questions"].sort(key=lambda x: (x["last_wrong_at"] or ""), reverse=True)
    return {
        "items": items[:_MISTAKE_ITEM_CAP],
        "total_missed_words": len(items),
        "attempts_scanned": len(attempts),
        "capped": len(attempts) >= _MISTAKE_ATTEMPT_CAP,
    }


def student_progress(user_id: str, skill_area: str | None = None) -> dict:
    """A learner's own progress: per-bank mastered/in-progress (from word_stats)
    enriched with bank meta, plus recent sessions for an accuracy trend.

    `skill_area` scopes BOTH halves (audit 2026-07-28 §C3). Without it the vocab
    entry point — "📊 Tiến độ luyện tập" on the Vocabulary page, whose back link
    reads "← Luyện tập" — listed the learner's grammar banks and grammar sessions
    too. admin_student_detail already scoped its view; the learner's own did not.
    """
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
        if skill_area and (m.get("skill_area") or "") != skill_area:
            continue
        banks.append({
            "bank_id": bid, "code": m.get("code"), "title": m.get("title"),
            "skill_area": m.get("skill_area"), "words_count": m.get("words_count"),
            "mastered": cnt["mastered"], "in_progress": cnt["in_progress"],
        })
    banks.sort(key=lambda x: (x.get("skill_area") or "", x.get("code") or ""))

    # Sessions are scoped by the skill's bank_ids BEFORE the 20-row cap — filtering
    # an already-capped all-skills list would hide vocab practice behind newer
    # grammar sessions, and matching on `code` would leak when two skills' banks
    # share one. Same reasoning as admin_student_detail.
    scoped_bank_ids = _bank_ids_for_skill(skill_area)
    try:
        sq = (
            supabase_admin.table("quiz_sessions")
            .select("code, accuracy, words_mastered, total_questions, total_correct, "
                    "duration_sec, ended_at, ended_by")
            .eq("user_id", user_id)
        )
        if scoped_bank_ids is not None:
            sq = sq.in_("bank_id", scoped_bank_ids)
        sessions = sq.order("started_at", desc=True).limit(20).execute().data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn phiên: {exc}")

    # Lifetime totals for the "Thống kê của tôi" header (total practice time,
    # session count, words mastered, avg accuracy). Words-mastered is the truthful
    # cumulative count summed across banks (from the page-safe RPC above), not a
    # per-session sum. Session time/accuracy come from a lean all-sessions read;
    # a learner's session count is far below the PostgREST page cap in practice.
    try:
        aq = (
            supabase_admin.table("quiz_sessions")
            .select("duration_sec, accuracy, ended_at").eq("user_id", user_id)
        )
        if scoped_bank_ids is not None:
            aq = aq.in_("bank_id", scoped_bank_ids)
        all_sess = aq.execute().data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn tổng hợp phiên: {exc}")
    # Count only FINALIZED sessions: start_session inserts a row when the quiz page
    # opens, so a learner who opens quiz.html and leaves before finish() PATCHes
    # leaves an ended_at-less row. Including it would inflate the session count with
    # zero time/accuracy. end_session always stamps ended_at (completed AND paused),
    # so ended_at present == real, finished practice.
    fin = [r for r in all_sess if r.get("ended_at")]
    accs = [r["accuracy"] for r in fin if r.get("accuracy") is not None]
    # DISTINCT words, not the sum of per-bank counts: a word that lives in two
    # lessons is one word. Summing made this header disagree with the Vocabulary
    # hub tile (141 vs 136 for the same learner) — see mastered_item_keys.
    totals = {
        "sessions": len(fin),
        "time_sec": sum(int(r.get("duration_sec") or 0) for r in fin),
        "words_mastered": len(mastered_item_keys(
            supabase_admin, user_id, [b["bank_id"] for b in banks])),
        "avg_accuracy": (sum(accs) / len(accs)) if accs else None,
    }

    return {"banks": banks, "recent_sessions": sessions, "totals": totals}
