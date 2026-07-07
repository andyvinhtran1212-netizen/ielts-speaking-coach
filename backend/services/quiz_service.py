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
import traceback
import uuid
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
                "related_words, word_family, common_error, memory_hook, lists"
            ).eq("topic_id", bank["topic_id"]).execute()
        ).data or []
    except Exception:  # noqa: BLE001
        return {}
    cards = {}
    for c in rows:
        # Skip exam-list vocab (AWL/TOEIC/THPT import): those cards share the topic
        # but are NOT part of the self-curated bank — the glance popup must stay
        # scoped to 'từ của tôi'. `lists` non-empty marks an exam card.
        if c.get("lists"):
            continue
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
