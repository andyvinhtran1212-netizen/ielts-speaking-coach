"""services/quiz_service.py — Quick-Check player read/write paths (Pha 2).

Serves a published bank (META + questions WITH answers — client grades instant,
QĐ-5) to authenticated students, and persists progress (sessions / attempts /
word_stats). The Adaptive Mastery loop runs in the browser; this layer just
stores what the client reports + reads carry-over for resume.

Ownership: every write verifies the session belongs to the caller (the backend
writes via service-role supabase_admin, so it must enforce user scoping in code).
"""

from __future__ import annotations

import hashlib
import logging
import re
import traceback
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from config import settings
from services import course_writing_grader
from services.class_assignment_service import (
    is_accepting_submissions,
    is_assignment_open,
    _at,
    mark_item_submitted,
)
from services.class_membership_service import active_cohort_ids_for_student

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
_COURSE_LISTENING_TTL = 7200


def _is_course_quiz_question(row: dict) -> bool:
    """True only for an auto-graded Grammar question in the course quiz lane.

    Legacy course banks may not have populated ``counts_toward_mastery``; only
    an explicit false opts an MCQ out. Other course section types are never
    inferred as quiz questions merely because they are not writing prompts.
    """
    return (row.get("type") in (None, "mcq")
            and row.get("counts_toward_mastery") is not False)


def _is_lesson_source(source) -> bool:
    return bool(_LESSON_SRC_RE.match((source or "").strip()))


def _course_listening_for_play(listening: dict) -> dict:
    """Lọc lời giải và ký URL mới cho một bài nghe đã qua cổng truy cập bank."""
    listening_for_play = dict(listening)
    listening_for_play.pop("solution", None)
    listening_for_play["has_solution"] = True
    sections = []
    bucket_name = ((listening.get("audio_bundle") or {}).get("bucket")
                   or settings.LISTENING_AUDIO_BUCKET)
    bucket = supabase_admin.storage.from_(bucket_name)

    def signed(path: str) -> str:
        try:
            response = bucket.create_signed_url(path, _COURSE_LISTENING_TTL)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] course listening audio sign failed path=%s: %s",
                           path, exc)
            raise HTTPException(500, "Không mở được audio bài nghe") from exc
        url = ((response or {}).get("signedURL") or (response or {}).get("signedUrl")
               or (response or {}).get("signed_url"))
        if not url:
            raise HTTPException(500, "Không mở được audio bài nghe")
        return url

    for section in listening.get("sections") or []:
        served_section = dict(section)
        path = served_section.pop("audio_storage_path", None)
        if path:
            served_section["audio_url"] = signed(path)
        questions_for_play = []
        for question in section.get("questions") or []:
            served_question = dict(question)
            q_path = served_question.pop("audio_storage_path", None)
            if q_path:
                served_question["audio_url"] = signed(q_path)
            questions_for_play.append(served_question)
        served_section["questions"] = questions_for_play
        sections.append(served_section)
    listening_for_play["sections"] = sections
    return listening_for_play


def _course_reading_for_play(reading: dict) -> dict:
    """Lọc lời giải khỏi snapshot/bank đọc trước khi đưa lại cho trình duyệt."""
    reading_for_play = dict(reading)
    reading_for_play.pop("translation", None)
    reading_for_play.pop("answers", None)
    reading_for_play["has_solution"] = True
    return reading_for_play

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

# ── Cổng "thuộc bài" (mastery gate) ──────────────────────────────────────────
# Dưới ngưỡng thì chưa kết luận được là thuộc: học viên làm bài KIỂM TRA LẠI —
# mẫu nhỏ bốc ngẫu nhiên, trộn thứ tự câu VÀ trộn thứ tự đáp án — tới khi đạt.
# Ngưỡng/cỡ mẫu chỉnh được theo TỪNG BÀI GIAO (content_config), đây là mặc định.
PASS_PCT_DEFAULT = 80
RETAKE_SIZE_DEFAULT = 20
NEAR_PASS_GAP = 10

_SESSION_KINDS = {"run", "retake"}

# Một chặng của bài tập theo buổi = 10 câu trắc nghiệm. Con số này đã nằm rải
# rác ở cả hai phía (`STAGE` trong course-runner.js, phép `chia 10` trong
# `_course_stage_count`); nêu tên nó ở đây để chỗ mới khỏi thành bản sao thứ ba.
COURSE_STAGE_SIZE = 10


def mastery_config(assignment: dict | None) -> dict:
    """Ngưỡng đạt + cỡ mẫu kiểm tra lại của một bài giao, đã kẹp về dải lành.

    Kẹp chứ không tin: content_config là jsonb tự do, một lần nhập tay `800`
    thay vì `80` sẽ biến bài tập thành không thể đạt — và không ai biết vì sao.
    """
    cfg = (assignment or {}).get("content_config") or {}

    def _clamp(raw, lo, hi, default):
        try:
            v = int(raw)
        except (TypeError, ValueError):
            return default
        return max(lo, min(hi, v))

    return {
        "pass_pct":    _clamp(cfg.get("pass_pct"), 50, 100, PASS_PCT_DEFAULT),
        "retake_size": _clamp(cfg.get("retake_size"), 5, 100, RETAKE_SIZE_DEFAULT),
    }


def near_pass_pct(pass_pct: int) -> int:
    """Floor of the near-pass band: pass=75 means near-pass=65..74.9."""
    return max(0, int(pass_pct) - NEAR_PASS_GAP)


def mastery_next_action(pct: float, pass_pct: int) -> str:
    """Return `passed`, `retake`, or `retry_full` for a graded attempt."""
    if pct >= pass_pct:
        return "passed"
    if pct >= near_pass_pct(pass_pct):
        return "retake"
    return "retry_full"


def _recorded_next_action(attempt: dict | None, pass_pct: int) -> str | None:
    """Read the stored decision, deriving it only for legacy attempt rows.

    New rows persist ``next_action`` so a later config edit cannot retroactively
    turn a full-retry decision into a short-retake entitlement.
    """
    if not attempt:
        return None
    if attempt.get("completed") is False or attempt.get("pct") is None:
        return None
    action = attempt.get("next_action")
    if action in {"passed", "retake", "retry_full"}:
        return action
    return mastery_next_action(float(attempt.get("pct") or 0), pass_pct)


def _full_retry_boundary(attempts: list[dict], pass_pct: int) -> datetime | None:
    """Newest full-retry cutoff, preserved until the assignment passes.

    A successful full rerun may only reach the near-pass band. Its newest ledger
    action then becomes ``retake``, but the earlier ``retry_full`` timestamp must
    continue excluding the failed run's sessions on reload and re-verdict.
    """
    for attempt in reversed(attempts):
        if _recorded_next_action(attempt, pass_pct) != "retry_full":
            continue
        boundary = _at(attempt.get("at"))
        if boundary is not None:
            return boundary
    return None


def _course_attempt_history(attempts: list[dict], pass_pct: int) -> list[dict]:
    """Learner-safe summary of the canonical mastery ledger.

    The UI needs to explain the sequence ``full run → revision → next step``.
    Returning a small explicit shape here prevents it from inferring history
    from quiz sessions (which include abandoned/incomplete rows) or exposing the
    raw mastery JSON contract to the browser.
    """
    history = []
    for number, attempt in enumerate(attempts or [], start=1):
        sessions = attempt.get("sessions") or []
        try:
            pct = (round(float(attempt.get("pct")), 1)
                   if attempt.get("pct") is not None else None)
        except (TypeError, ValueError):
            pct = None
        sections = []
        for key, result in (attempt.get("sections") or {}).items():
            if key not in _COURSE_SECTION_LABELS or not isinstance(result, dict):
                continue
            sections.append({
                "key": key, "label": _COURSE_SECTION_LABELS[key],
                "pct": result.get("pct"),
                "duration_sec": int(result.get("duration_sec") or 0),
                "weight": result.get("weight"),
                "carried": result.get("carried") is True,
            })
        history.append({
            "number": number,
            "phase": "retake" if attempt.get("phase") == "retake" else "run",
            "pct": pct,
            "at": attempt.get("at"),
            "session_count": len({str(s) for s in sessions if s}),
            "next_action": _recorded_next_action(attempt, pass_pct),
            "completed": attempt.get("completed", pct is not None),
            "duration_sec": int(attempt.get("duration_sec") or 0),
            "sections": sections,
        })
    return history


def course_admin_summary(
    item: dict, assignment: dict | None = None,
    *, required_sections: list[str] | None = None,
) -> dict:
    """One canonical, read-only summary for the admin course-work surfaces.

    ``submitted_at`` is an operational receipt and, for mastery assignments,
    may intentionally remain empty until the learner passes.  It therefore
    cannot answer the teacher's different question: what learning outcome does
    this learner currently have?  Keep that decision next to the mastery rules
    so tally, effort and student detail do not each invent their own meaning.
    """
    cfg = mastery_config(assignment)
    attempts = list(((item.get("mastery") or {}).get("attempts")) or [])
    completed = [row for row in attempts
                 if row.get("completed", row.get("pct") is not None)
                 and row.get("pct") is not None]
    latest = attempts[-1] if attempts else {}
    latest_completed = completed[-1] if completed else {}
    action = _recorded_next_action(latest_completed, cfg["pass_pct"])

    if required_sections is None:
        required_sections = course_required_sections(assignment)
    required = [name for name in required_sections
                if name in _COURSE_SECTION_LABELS]
    present = latest.get("sections") or {}
    section_results = []
    missing_sections = []
    for name in required:
        result = present.get(name)
        # Quiz-only banks intentionally keep the legacy compact ledger shape:
        # the completed quiz lives at the attempt top level instead of under
        # ``sections.quiz``.  Treat that canonical shape as the sole required
        # section; otherwise every completed legacy assignment reads as 0/1
        # with a fabricated "missing Quiz" warning in both admin reports.
        if (name == "quiz" and len(required) == 1
                and not isinstance(result, dict)
                and latest.get("pct") is not None
                and latest.get("completed", True)):
            result = {
                "completed": True,
                "pct": latest.get("pct"),
                "duration_sec": latest.get("duration_sec") or 0,
                "weight": 100,
            }
        section_complete = (isinstance(result, dict)
                            and result.get("completed", result.get("pct") is not None))
        if section_complete:
            section_results.append({
                "key": name,
                "label": _COURSE_SECTION_LABELS[name],
                "pct": result.get("pct"),
                "duration_sec": int(result.get("duration_sec") or 0),
                "weight": result.get("weight"),
                "carried": result.get("carried") is True,
            })
        else:
            missing_sections.append({"key": name, "label": _COURSE_SECTION_LABELS[name]})

    latest_is_incomplete = bool(latest) and not latest.get(
        "completed", latest.get("pct") is not None)
    if item.get("passed_at"):
        state = "passed"
    elif latest_is_incomplete:
        state = "in_progress"
    elif action == "retake":
        state = "near_pass"
    elif action == "retry_full":
        state = "retry_full"
    elif attempts:
        state = "in_progress"
    else:
        state = "untouched"

    flags = []
    if item.get("passed_at") and not completed:
        flags.append({
            "code": "course_ledger_mismatch", "severity": "high",
            "label": "Kết quả không đồng nhất",
            "why": "Mục bài đã ghi đạt nhưng không có lượt hoàn thành tương ứng trong sổ tiến độ.",
            "action": "Mở bài và kiểm tra sổ mastery trước khi dùng kết quả.",
        })
    # `near_pass` và `retry_full` là kết quả học tập bình thường, không phải sự
    # cố cần admin can thiệp. Đưa mọi lượt chưa đạt lần đầu vào `flags` làm hàng
    # đợi "Cần admin xem" đầy gần như cả lớp và chôn mất lỗi ledger/bỏ dở thật.
    # Chúng vẫn hiện rõ trong outcome funnel; chỉ thất bại LẶP LẠI mới thành cờ.
    failed = [row for row in completed
              if _recorded_next_action(row, cfg["pass_pct"]) != "passed"]
    if len(failed) >= 2:
        scores = ", ".join(f"{float(row['pct']):.1f}%" for row in failed[-3:])
        flags.append({
            "code": "course_repeated_failure", "severity": "high",
            "label": "Chưa đạt qua nhiều lượt",
            "why": f"{len(failed)} lượt hoàn thành chưa đạt; các lượt gần nhất: {scores}.",
            "action": "Inspect lịch sử và misconception lặp lại trước khi giao thêm lượt.",
        })
    if latest_is_incomplete and missing_sections:
        labels = ", ".join(row["label"] for row in missing_sections)
        flags.append({
            "code": "course_missing_section", "severity": "medium",
            "label": "Thiếu phần bắt buộc",
            "why": f"Lượt hiện tại chưa có kết quả: {labels}.",
            "action": "Kiểm tra tiến độ và nhắc học viên hoàn tất đúng phần còn thiếu.",
        })

    return {
        "state": state,
        "pass_pct": cfg["pass_pct"],
        "near_pass_pct": near_pass_pct(cfg["pass_pct"]),
        "latest_pct": (float(latest_completed["pct"]) if latest_completed else None),
        "next_action": action,
        "attempts": len(completed),
        "retakes": sum(1 for row in completed if row.get("phase") == "retake"),
        "attempt_minutes": round(sum(int(row.get("duration_sec") or 0)
                                     for row in completed) / 60, 1),
        "current_attempt_minutes": (round(int(latest.get("duration_sec") or 0) / 60, 1)
                                    if latest_is_incomplete else 0),
        "sections_done": len(section_results),
        "sections_total": len(required),
        "section_results": section_results,
        "missing_sections": missing_sections,
        "flags": flags,
    }


def unavailable_course_admin_summary(
    item: dict, assignment: dict | None = None,
    *, required_sections: list[str] | None = None,
) -> dict:
    """Safe per-row degradation when a stored mastery payload is malformed."""
    summary = course_admin_summary(
        {}, assignment, required_sections=required_sections or [])
    fallback_state = ("passed" if item.get("passed_at") else
                      "in_progress" if item.get("mastery") else "untouched")
    return {
        **summary,
        "state": fallback_state,
        "flags": [{
            "code": "course_summary_unavailable",
            "severity": "high",
            "label": "Không đọc được kết quả",
            "why": "Sổ mastery của học viên có dữ liệu không hợp lệ.",
            "action": "Mở bài và đối chiếu sổ mastery trước khi dùng kết quả.",
        }],
    }


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


def _assignment_item_for(
    bank_id: str, user_id: str, *, allow_submitted_review: bool = False,
    assignment_item_id: str | None = None,
) -> dict | None:
    """Mục bài giao CÒN HIỆU LỰC của học viên này cho bank ấy, hoặc None.

    ĐÚNG BA ĐIỀU KIỆN mà `POST /api/class/assignments/{item}/start` đã đòi, và
    dùng lại CHÍNH hai hàm ấy chứ không chép luật:

      · bài giao còn mở      (`is_assignment_open` — chưa lưu trữ, đã tới ngày)
      · còn nhận bài         (`is_accepting_submissions` — chưa quá hạn), HOẶC
        đã nộp và caller chỉ xin quyền đọc kết quả (`allow_submitted_review`)
      · thuộc một lớp đang học (rời lớp thì mất quyền, dù dòng mục còn đó)

    Thiếu các cổng này thì một bookmark còn trả về TOÀN BỘ câu hỏi kèm đáp án
    mãi mãi. Sau hạn chỉ có ngoại lệ hẹp cho mục ĐÃ NỘP và caller read-only;
    lưu trữ hoặc chuyển lớp vẫn chặn tuyệt đối. Cổng ở đây phải nói cùng một câu
    với lệnh mở bài, nếu không thì lệnh kia chỉ là một gợi ý.
    """
    try:
        asg = (supabase_admin.table("class_assignments").select("*")
               .eq("content_id", bank_id).execute().data) or []
        if not asg:
            return None
        student = (supabase_admin.table("students").select("id, cohort_id")
                   .eq("user_id", user_id).execute().data) or []
        if not student:
            return None
        cohorts = {
            cohort_id
            for row in student
            for cohort_id in active_cohort_ids_for_student(supabase_admin, row)
        }
        owned = [a for a in asg
                 if is_assignment_open(a) and a.get("cohort_id") in cohorts]
        if not owned:
            return None
        sids = [s["id"] for s in student]
        item_query = (supabase_admin.table("class_assignment_items")
                      .select("id, assignment_id, student_id, submitted_at, "
                              "passed_at, mastery, updated_at")
                      .in_("assignment_id", [a["id"] for a in owned])
                      .in_("student_id", sids))
        if assignment_item_id:
            item_query = item_query.eq("id", assignment_item_id)
        rows = (item_query.execute().data) or []
        if not rows:
            return None
        owned_by_id = {a["id"]: a for a in owned}
        eligible = [row for row in rows
                    if is_accepting_submissions(owned_by_id.get(row.get("assignment_id")) or {})
                    or (allow_submitted_review and row.get("submitted_at"))]
        if not eligible:
            return None
        # Carry the deadline already read above to the player. Authorization is
        # still checked again when the stage is finalized.
        item = dict(eligible[0])
        assignment = owned_by_id.get(item.get("assignment_id")) or {}
        item["due_at"] = assignment.get("due_at")
        item["accepting"] = bool(is_accepting_submissions(assignment))
        # Retry decisions must use the assignment snapshot, not a possibly
        # stale/missing threshold copied into the learner ledger.
        item["content_config"] = assignment.get("content_config") or {}
        return item
    except Exception as exc:  # noqa: BLE001
        # Không đọc được thì TỪ CHỐI. Mở cửa khi chốt hỏng là biến một lỗi tạm
        # thời thành một lần lộ nội dung.
        logger.warning("[quiz] assignment check failed bank=%s: %s", bank_id, exc)
        return None


def _has_assignment_for(bank_id: str, user_id: str) -> bool:
    return _assignment_item_for(bank_id, user_id) is not None


def _assignment_item_for_review(
    bank_id: str, user_id: str, assignment_item_id: str | None = None,
) -> dict | None:
    """Live item first; submitted-after-deadline fallback for read paths only."""
    current = (_assignment_item_for(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    ) if assignment_item_id else _assignment_item_for(bank_id, user_id))
    if current:
        return current
    if assignment_item_id:
        return _assignment_item_for(
            bank_id, user_id, allow_submitted_review=True,
            assignment_item_id=assignment_item_id,
        )
    return _assignment_item_for(bank_id, user_id, allow_submitted_review=True)


def course_section_attempt_no(item: dict | None) -> int:
    """Lượt full-session đang sở hữu các submission nhiều phần.

    Revision chỉ làm lại quiz nên không tăng số này. Ledger cũ chưa có trường
    tường minh được suy từ số dòng ``phase=run``; migration 230 backfill các
    submission bằng cùng một luật để lần deploy không làm mất dấu bài hiện tại.
    """
    mastery = ((item or {}).get("mastery") or {})
    try:
        explicit = int(mastery.get("active_section_attempt_no") or 0)
    except (TypeError, ValueError):
        explicit = 0
    if explicit > 0:
        return explicit
    attempts = mastery.get("attempts") or []
    runs = sum(1 for attempt in attempts
               if (attempt or {}).get("phase", "run") == "run")
    return max(1, runs)


def _course_rows_for_attempt(rows: list[dict], attempt_no: int) -> list[dict]:
    """Filter rows while keeping pre-migration in-memory fixtures compatible."""
    return [row for row in rows
            if int(row.get("attempt_no") or 1) == int(attempt_no)]


def get_bank_for_play(
    bank_id: str, user_id: str | None = None,
    assignment_item_id: str | None = None,
) -> dict:
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
    if not b:
        raise HTTPException(404, "Không tìm thấy bank")
    bank = b[0]
    mastery_state = None
    if bank.get("skill_area") == COURSE_AREA:
        # BÀI GIAO LÀ CỬA DUY NHẤT. `is_published` KHÔNG áp cho giáo trình: bank
        # theo buổi sống trong kho giáo viên ở trạng thái nháp và không bao giờ
        # được xuất bản, nên đòi thêm cờ ấy sẽ khoá chết cả những bài ĐÃ GIAO —
        # giao xong mà học viên vẫn không mở được.
        #
        # Trả 404 chứ không 403: 403 xác nhận bank ấy tồn tại, và với nội dung
        # giáo trình thì chính sự tồn tại cũng không cần nói ra.
        item = (_assignment_item_for_review(
            bank_id, user_id, assignment_item_id=assignment_item_id,
        ) if user_id else None)
        if not item:
            raise HTTPException(404, "Không tìm thấy bank")
        # Trạng thái cổng thuộc-bài, để trang nói được "đã đạt" ngay khi mở lại
        # thay vì bắt làm lại từ đầu mới biết. Best-effort: đọc hỏng thì trang
        # vẫn chạy, chỉ thiếu tấm huy hiệu.
        try:
            row = (supabase_admin.table("class_assignment_items")
                   .select("passed_at, mastery")
                   .eq("id", item["id"]).limit(1).execute().data) or []
            asg = (supabase_admin.table("class_assignments")
                   .select("id, content_config")
                   .eq("id", item["assignment_id"]).limit(1).execute().data) or []
            cfg = mastery_config(asg[0] if asg else None)
            it = row[0] if row else {}
            att = ((it.get("mastery") or {}).get("attempts")) or []
            latest_sections = ((att[-1].get("sections") or {})
                               if att and isinstance(att[-1], dict) else {})
            mastery_state = {
                # id MỤC bài giao — runner khoá trạng thái localStorage vào nó:
                # em chuyển lớp rồi được giao lại CÙNG bank ở lớp mới là một
                # mục khác, phiên cũ thuộc mục cũ và verdict sẽ bác chúng.
                "item_id": item["id"],
                "passed_at": it.get("passed_at"),
                "threshold": cfg["pass_pct"],
                "near_threshold": near_pass_pct(cfg["pass_pct"]),
                "retake_size": cfg["retake_size"],
                "retakes": sum(1 for a in att if a.get("phase") == "retake"),
                # Canonical item snapshot, not the current bank. Review UI must
                # not advertise a section added after this item was issued.
                "completed_sections": [
                    key for key in _COURSE_SECTION_LABELS if key in latest_sections
                ],
                "due_at": item.get("due_at"),
                # A submitted assignment reopens read-only. Never create a new
                # quiz session merely because the learner chose "Xem kết quả".
                "review_only": bool(item.get("submitted_at")),
                "accepting": bool(item.get("accepting")),
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] mastery state read failed bank=%s: %s", bank_id, exc)
    elif not bank.get("is_published"):
        raise HTTPException(404, "Không tìm thấy bank")
    try:
        questions = (
            supabase_admin.table("quiz_questions").select("*")
            .eq("bank_id", bank_id).order("order").execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn câu hỏi: {exc}")
    # ĐÁP ÁN MẪU CỦA CÂU TỰ LUẬN KHÔNG ĐI QUA ĐƯỜNG NÀY.
    #
    # `select("*")` trả cả `explain` (đáp án mẫu) và `accept`. Lọc ở trình duyệt
    # chỉ là trang trí: chuỗi ấy đã nằm trong phản hồi mạng, mở tab Network là
    # đọc được — và lượt viết chỉ có MỘT, nên đọc trước là hỏng cả bài tập
    # (codex #935). Đường duy nhất phát đáp án mẫu là `course_writing_state`,
    # và nó chỉ phát SAU khi đã nộp.
    for q in questions:
        if q.get("type") == "writing":
            q["explain"] = None
            q["accept"] = None
            q["answer"] = None

    # BÀI ĐỌC THÊM: passage, từ vựng và câu hỏi đi cùng đề; bản dịch + đáp án
    # chỉ tới sau khi học viên chủ động đối chiếu. Lọc ở máy chủ — xoá bằng JS
    # vẫn để nguyên lời giải trong Network response, đúng lỗi phần tự luận đã
    # từng mắc.
    meta = dict(bank.get("meta") or {})
    reading = meta.get("short_reading")
    if isinstance(reading, dict):
        meta["short_reading"] = _course_reading_for_play(reading)
        bank = {**bank, "meta": meta}

    # BÀI NGHE THÊM: đáp án/transcript không đi cùng đề. Audio nằm trong bucket
    # riêng tư và chỉ được ký URL sau khi cổng bài-giao ở trên đã cho phép bank.
    listening = meta.get("short_listening")
    if isinstance(listening, dict):
        meta["short_listening"] = _course_listening_for_play(listening)
        bank = {**bank, "meta": meta}

    word_cards = _word_cards_for(bank)
    _attach_article_urls(questions)
    _resolve_question_audio(questions, word_cards)
    out = {"bank": bank, "questions": questions, "word_cards": word_cards}
    if mastery_state is not None:
        out["mastery"] = mastery_state
    return out


def _course_answer_text(value) -> str:
    """Chuẩn hoá đáp án text có chủ đích, không dùng so khớp xấp xỉ.

    Bỏ khác biệt viết hoa, khoảng trắng và dấu câu trình bày; không tự coi hai
    câu gần nghĩa là đúng vì false-positive ở một cổng điểm còn hại hơn việc
    yêu cầu tác giả khai thêm ``accepted`` trong nội dung.
    """
    text = unicodedata.normalize("NFKC", str(value or "")).casefold().strip()
    return re.sub(r"[^\w+]+", " ", text, flags=re.UNICODE).strip()


def _grade_course_section(submitted: dict, answer_rows: list[dict]) -> tuple[int, int]:
    correct = 0
    for row in answer_rows:
        qid = str(row.get("id") or "")
        got = _course_answer_text(submitted.get(qid))
        accepted = row.get("accepted")
        keys = accepted if isinstance(accepted, list) and accepted else [row.get("answer")]
        if got and any(got == _course_answer_text(key) for key in keys):
            correct += 1
    return correct, len(answer_rows)


def _save_course_section_result(
    *, user_id: str, bank_id: str, section: str, answers: dict,
    answer_rows: list[dict], duration_sec: int,
    assignment_item_id: str | None = None,
    content_snapshot: dict | None = None,
) -> dict:
    review_existing = not bool(answers)
    item = (_assignment_item_for_review(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    ) if review_existing else _assignment_item_for(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    ))
    if not item:
        raise HTTPException(404, "Không tìm thấy bài giao còn hiệu lực")
    attempt_no = course_section_attempt_no(item)
    expected = [str(row.get("id") or "") for row in answer_rows if row.get("id")]
    total = len(answer_rows)
    submitted = {}
    for qid in expected:
        value = str((answers or {}).get(qid) or "").strip()
        if len(value) > 2000:
            raise HTTPException(422, f"Câu {qid} vượt quá 2.000 ký tự")
        submitted[qid] = value
    missing = [qid for qid in expected if not submitted.get(qid)]
    row = None
    reviewed_existing = False
    try:
        all_existing = (supabase_admin.table("course_section_submissions")
                    .select("*").eq("class_assignment_item_id", item["id"])
                    .eq("section", section).execute().data) or []
        existing = _course_rows_for_attempt(all_existing, attempt_no)
        if existing:
            prior_answers = existing[0].get("answers") or {}
            if review_existing:
                # Empty answers are a read-only review request.  They reveal
                # nothing unless this user already owns a canonical completed
                # row for the same assignment item and section.
                saved = existing[0]
                reviewed_existing = True
            elif missing:
                raise HTTPException(422, {
                    "message": f"Còn {len(missing)} câu {section} chưa trả lời.",
                    "missing": missing,
                })
            elif prior_answers != submitted:
                raise HTTPException(409, f"Phần {section} đã nộp rồi — không sửa được nữa.")
            else:
                saved = existing[0]
        else:
            if missing:
                raise HTTPException(422, {
                    "message": f"Còn {len(missing)} câu {section} chưa trả lời.",
                    "missing": missing,
                })
            correct, total = _grade_course_section(submitted, answer_rows)
            safe_duration = max(0, min(int(duration_sec or 0), 12 * 60 * 60))
            row = {
                "bank_id": bank_id,
                "user_id": user_id,
                "class_assignment_item_id": item["id"],
                "section": section,
                "attempt_no": attempt_no,
                "answers": {qid: submitted[qid] for qid in expected},
                "answer_key": answer_rows,
                "content_snapshot": content_snapshot or {},
                "total": total,
                "correct": correct,
                "score": round(correct / total * 100, 2),
                "duration_sec": safe_duration,
            }
            saved_rows = (supabase_admin.table("course_section_submissions")
                          .insert(row).execute().data) or []
            if not saved_rows:
                raise HTTPException(500, f"Lưu phần {section} không trả về kết quả")
            saved = saved_rows[0]
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if "23505" in str(exc) or "duplicate key" in str(exc).lower():
            # Hai tab có thể cùng vượt lượt đọc `existing`. Đọc canonical row:
            # cùng payload là retry luỹ đẳng, payload khác mới là xung đột.
            try:
                all_raced = (supabase_admin.table("course_section_submissions")
                         .select("*").eq("class_assignment_item_id", item["id"])
                         .eq("section", section).execute().data) or []
                raced = _course_rows_for_attempt(all_raced, attempt_no)
            except Exception as read_exc:  # noqa: BLE001
                raise HTTPException(
                    500, f"Không xác nhận được lượt nộp phần {section}") from read_exc
            if row and raced and (raced[0].get("answers") or {}) == row["answers"]:
                saved = raced[0]
            else:
                raise HTTPException(409, f"Phần {section} đã được nộp ở nơi khác.")
        else:
            raise HTTPException(500, f"Lỗi lưu kết quả phần {section}: {exc}")
    result = {
        "section": section,
        "attempt_no": attempt_no,
        "total": int(saved.get("total") or total),
        "correct": int(saved.get("correct") or 0),
        "pct": float(saved.get("score") or 0),
        "duration_sec": int(saved.get("duration_sec") or 0),
        "submitted_at": saved.get("submitted_at") or saved.get("created_at"),
        "submitted_answers": saved.get("answers") or {},
        # Use the immutable answer snapshot when reviewing a completed section;
        # a later bank import must not rewrite what the learner was graded on.
        "answer_key": saved.get("answer_key") or answer_rows,
        "_content_snapshot": saved.get("content_snapshot") or content_snapshot or {},
    }
    if not reviewed_existing:
        try:
            result["course"] = refresh_course_completion(
                user_id=user_id, bank_id=bank_id, item_id=item["id"],
                assignment_id=item.get("assignment_id"),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] section completion refresh failed item=%s: %s",
                           item.get("id"), exc)
            result["completion_pending"] = True
    return result


def _review_course_section_result(
    *, user_id: str, bank_id: str, section: str,
    assignment_item_id: str | None = None,
) -> dict:
    """Đọc đúng submission đã chốt trước khi đụng nội dung bank hiện tại."""
    item = _assignment_item_for_review(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    )
    if not item:
        raise HTTPException(404, "Không tìm thấy bài giao đã nộp")
    attempt_no = course_section_attempt_no(item)
    try:
        all_rows = (supabase_admin.table("course_section_submissions")
                .select("*").eq("class_assignment_item_id", item["id"])
                .eq("user_id", user_id).eq("bank_id", bank_id)
                .eq("section", section).execute().data) or []
        rows = _course_rows_for_attempt(all_rows, attempt_no)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đọc kết quả phần {section}: {exc}") from exc
    if not rows:
        raise HTTPException(404, f"Chưa có kết quả phần {section} cho bài giao này")
    saved = rows[0]
    return {
        "section": section,
        "attempt_no": attempt_no,
        "total": int(saved.get("total") or 0),
        "correct": int(saved.get("correct") or 0),
        "pct": float(saved.get("score") or 0),
        "duration_sec": int(saved.get("duration_sec") or 0),
        "submitted_at": saved.get("submitted_at") or saved.get("created_at"),
        "submitted_answers": saved.get("answers") or {},
        "answer_key": saved.get("answer_key") or [],
        "_content_snapshot": saved.get("content_snapshot") or {},
    }


def course_reading_solution(*, user_id: str, bank_id: str,
                            submitted_answers: dict, duration_sec: int = 0,
                            assignment_item_id: str | None = None) -> dict:
    """Chấm + lưu phần đọc rồi mới trả bản dịch và lời giải."""
    if not submitted_answers:
        result = _review_course_section_result(
            user_id=user_id, bank_id=bank_id, section="reading",
            assignment_item_id=assignment_item_id,
        )
        reading = result.pop("_content_snapshot")
        if isinstance(reading, dict) and reading:
            return {
                "content": _course_reading_for_play(reading),
                "translation": reading.get("translation"),
                "answers": result["answer_key"],
                "result": result,
            }
        # Compatibility for rows created before the immutable content snapshot.
        # Authorization and the exact submitted row were already verified above.
    else:
        _bank_meta_or_404(
            bank_id, user_id, assignment_item_id=assignment_item_id,
        )
    try:
        rows = (supabase_admin.table("quiz_banks").select("meta")
                .eq("id", bank_id).limit(1).execute().data) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đọc đáp án bài đọc: {exc}")
    reading = (((rows[0] if rows else {}).get("meta") or {}).get("short_reading"))
    if not isinstance(reading, dict):
        raise HTTPException(404, "Bài tập này không có bài đọc thêm")
    translation = reading.get("translation")
    answers = reading.get("answers")
    if not translation or not isinstance(answers, list) or not answers:
        raise HTTPException(500, "Bài đọc chưa có đủ bản dịch và đáp án")
    expected = [str(row.get("id") or "") for row in answers if row.get("id")]
    if len(expected) != len(answers):
        raise HTTPException(500, "Đáp án bài đọc thiếu mã câu")
    if submitted_answers:
        result = _save_course_section_result(
            user_id=user_id, bank_id=bank_id, section="reading",
            answers=submitted_answers, answer_rows=answers, duration_sec=duration_sec,
            assignment_item_id=assignment_item_id, content_snapshot=reading,
        )
        reading = result.pop("_content_snapshot") or reading
        translation = reading.get("translation")
    return {
        "content": _course_reading_for_play(reading),
        "translation": translation,
        "answers": result["answer_key"],
        "result": result,
    }


def course_listening_solution(*, user_id: str, bank_id: str,
                              submitted_answers: dict, duration_sec: int = 0,
                              assignment_item_id: str | None = None) -> dict:
    """Chấm + lưu phần nghe rồi mới trả đáp án và transcript."""
    if not submitted_answers:
        result = _review_course_section_result(
            user_id=user_id, bank_id=bank_id, section="listening",
            assignment_item_id=assignment_item_id,
        )
        listening = result.pop("_content_snapshot")
        solution = listening.get("solution") if isinstance(listening, dict) else None
        if isinstance(solution, dict):
            return {**solution, "answers": result["answer_key"], "result": result}
        # Compatibility for rows created before the immutable content snapshot.
    else:
        _bank_meta_or_404(
            bank_id, user_id, assignment_item_id=assignment_item_id,
        )
    try:
        rows = (supabase_admin.table("quiz_banks").select("meta")
                .eq("id", bank_id).limit(1).execute().data) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đọc đáp án bài nghe: {exc}")
    listening = (((rows[0] if rows else {}).get("meta") or {}).get("short_listening"))
    solution = listening.get("solution") if isinstance(listening, dict) else None
    answers = solution.get("answers") if isinstance(solution, dict) else None
    if not isinstance(answers, list) or not answers:
        raise HTTPException(404, "Bài tập này không có bài nghe hoàn chỉnh")
    expected = [str(row.get("id") or "") for row in answers if row.get("id")]
    if len(expected) != len(answers):
        raise HTTPException(500, "Đáp án bài nghe thiếu mã câu")
    if submitted_answers:
        result = _save_course_section_result(
            user_id=user_id, bank_id=bank_id, section="listening",
            answers=submitted_answers, answer_rows=answers, duration_sec=duration_sec,
            assignment_item_id=assignment_item_id, content_snapshot=listening,
        )
        listening = result.pop("_content_snapshot") or listening
        solution = listening.get("solution")
    return {**solution, "answers": result["answer_key"], "result": result}


def course_listening_audio(
    *, user_id: str, bank_id: str, assignment_item_id: str | None = None,
) -> dict:
    """Tái ký URL ngay khi mở phần nghe; bank/assignment được kiểm tra lại."""
    if assignment_item_id:
        item = _assignment_item_for_review(
            bank_id, user_id, assignment_item_id=assignment_item_id,
        )
        if not item:
            raise HTTPException(404, "Không tìm thấy bài giao")
        attempt_no = course_section_attempt_no(item)
        try:
            all_saved_rows = (supabase_admin.table("course_section_submissions")
                          .select("content_snapshot, attempt_no")
                          .eq("class_assignment_item_id", item["id"])
                          .eq("user_id", user_id).eq("bank_id", bank_id)
                          .eq("section", "listening")
                          .execute().data) or []
            saved_rows = _course_rows_for_attempt(all_saved_rows, attempt_no)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, "Không tải được audio bài nghe") from exc
        snapshot = (saved_rows[0].get("content_snapshot") if saved_rows else None)
        if isinstance(snapshot, dict) and snapshot:
            return _course_listening_for_play(snapshot)
    else:
        _bank_meta_or_404(bank_id, user_id)
    try:
        rows = (supabase_admin.table("quiz_banks").select("meta")
                .eq("id", bank_id).limit(1).execute().data) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, "Không tải được audio bài nghe") from exc
    listening = (((rows[0] if rows else {}).get("meta") or {}).get("short_listening"))
    if not isinstance(listening, dict):
        raise HTTPException(404, "Bài tập này không có bài nghe")
    return _course_listening_for_play(listening)


def _bank_meta_or_404(
    bank_id: str, user_id: str | None = None, *, allow_submitted_review: bool = False,
    assignment_item_id: str | None = None,
) -> dict:
    """Lightweight published-bank guard: fetch ONLY the bank's own row (id, code,
    is_published) — no questions, no word_cards. Used by start_session, which just
    needs `code` + the published check; pulling the full get_bank_for_play there
    would re-run the questions + whole-topic word_cards queries on every session
    start (they were already fetched by the player's GET /banks/{id})."""
    try:
        b = (
            supabase_admin.table("quiz_banks").select("id, code, is_published, skill_area")
            .eq("id", bank_id).limit(1).execute()
        ).data
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn bank: {exc}")
    if not b:
        raise HTTPException(404, "Không tìm thấy bank")
    bank = b[0]
    # CÙNG cổng với `get_bank_for_play`. Trước đó hàm này chỉ đòi `is_published`,
    # nên bank giáo trình (luôn ở trạng thái nháp) mở được ở lượt đọc đề nhưng
    # 404 ở lượt TẠO PHIÊN — học viên vẫn làm bài được, mà không lượt nào được
    # ghi và giáo viên đọc thành chưa làm. Hai cổng cho cùng một bank phải nói
    # cùng một câu.
    if bank.get("skill_area") == COURSE_AREA:
        item = (_assignment_item_for(
            bank_id, user_id, allow_submitted_review=allow_submitted_review,
            assignment_item_id=assignment_item_id,
        ) if user_id else None)
        if not item:
            raise HTTPException(404, "Không tìm thấy bank")
    elif not bank.get("is_published"):
        raise HTTPException(404, "Không tìm thấy bank")
    return bank


def _bank_meta_for_review_or_404(
    bank_id: str, user_id: str, assignment_item_id: str | None = None,
) -> dict:
    """Normal gate first; submitted-after-deadline fallback for reads only."""
    try:
        if assignment_item_id:
            return _bank_meta_or_404(
                bank_id, user_id, assignment_item_id=assignment_item_id,
            )
        return _bank_meta_or_404(bank_id, user_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
    if assignment_item_id:
        return _bank_meta_or_404(
            bank_id, user_id, allow_submitted_review=True,
            assignment_item_id=assignment_item_id,
        )
    return _bank_meta_or_404(bank_id, user_id, allow_submitted_review=True)


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


def _assert_retake_allowed(item: dict | None) -> None:
    """A short retake is legal only after the immediately prior near-pass."""
    if not item:
        raise HTTPException(404, "Không tìm thấy bài giao còn hiệu lực")
    try:
        rows = (supabase_admin.table("class_assignment_items")
                .select("passed_at, mastery").eq("id", item["id"])
                .limit(1).execute().data) or []
        assignments = (supabase_admin.table("class_assignments")
                       .select("content_config").eq("id", item["assignment_id"])
                       .limit(1).execute().data) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi kiểm tra quyền làm bài kiểm tra lại: {exc}")
    cur = rows[0] if rows else {}
    attempts = ((cur.get("mastery") or {}).get("attempts")) or []
    cfg = mastery_config(assignments[0] if assignments else None)
    prior = _recorded_next_action(attempts[-1] if attempts else None,
                                  cfg["pass_pct"])
    if cur.get("passed_at") or prior != "retake":
        raise HTTPException(422, "Lượt gần nhất không thuộc mức gần đạt — "
                                 "không thể mở bài kiểm tra lại 20 câu.")


def start_session(
    *, user_id: str, bank_id: str, kind: str = "run",
    assignment_item_id: str | None = None,
) -> dict:
    """Create a session and return {session_id, resume} — resume = prior word_stats
    so the engine continues carry-over.

    Resume is read BEFORE the session is created and FAILS CLOSED: if the read
    errors we must NOT start a fresh-looking session, because the first /progress
    upsert would then overwrite a previously mastered/provisional word with lower
    counts. A read failure → 500, no session row, no destructive write."""
    bank = _bank_meta_or_404(bank_id, user_id)   # cổng (published HOẶC bài giao)
    if kind not in _SESSION_KINDS:
        raise HTTPException(422, "kind phải là 'run' hoặc 'retake'")
    if kind == "retake" and bank.get("skill_area") != COURSE_AREA:
        # Kiểm tra lại là khái niệm của cổng thuộc-bài; bank tự chọn không có
        # ngưỡng đạt nên một phiên 'retake' ở đó chỉ làm nhiễu số liệu.
        raise HTTPException(422, "Chỉ bài tập theo buổi mới có kiểm tra lại")
    resume = get_resume(user_id=user_id, bank_id=bank_id)   # raises on read failure
    # Ghi lại mục bài giao NGAY LÚC TẠO PHIÊN, không đoán về sau. Suy ra "lượt
    # này thuộc bài giao nào" từ thời điểm và người làm là một phép đoán, và phép
    # đoán ấy đã sai đủ nhiều lần (mig 181) để không đáng làm lại.
    item = ((_assignment_item_for(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    ) if assignment_item_id else _assignment_item_for(bank_id, user_id))
            if bank.get("skill_area") == COURSE_AREA else None)
    if kind == "retake":
        _assert_retake_allowed(item)
    row = {
        "user_id": user_id, "bank_id": bank_id, "code": bank.get("code"),
        "class_assignment_item_id": (item or {}).get("id"),
    }
    # Chỉ ghi cột `kind` khi khác mặc định: giữ cho MỌI luồng quiz đang chạy
    # (vocab, grammar) không phụ thuộc migration 189 — chúng không bao giờ tạo
    # phiên retake.
    if kind != "run":
        row["kind"] = kind
    try:
        res = supabase_admin.table("quiz_sessions").insert(row).execute()
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


def close_dead_course_sessions(db, *, idle_minutes: int = 120,
                              commit: bool = False) -> list[dict]:
    """Đóng sổ những phiên bài-theo-buổi CHẮC CHẮN đã chết. Trả về việc đã/sẽ làm.

    ── Vì sao cần ──────────────────────────────────────────────────────────
    Học viên báo "em có làm lại vài chặng" mà web không ghi lại. Đúng: một
    phiên bỏ giữa chừng nằm LƠ LỬNG — `ended_at` NULL nên nó không phải bản
    ghi, mà cũng chẳng ai đang làm nó. Nó không hiện ở đâu cả.

    Đo prod 06/08: 29 phiên như vậy mang 90 câu đã trả lời. Các CÂU thì không
    mất (`course_answer_report` đọc mọi phiên 'run', không lọc `ended_at`) —
    thứ mất là CÔNG SỨC: không chỗ nào nói em ấy đã làm chặng này ba lần.

    Đóng sổ chúng biến một khoảng lơ lửng thành một bản ghi đọc được.

    ── VÌ SAO KHÔNG ĐÓNG BỪA ───────────────────────────────────────────────
    Một phiên vừa mở hai phút trước cũng có `ended_at` NULL — vì em ấy ĐANG
    LÀM. Đóng nó là cướp bài khỏi tay người đang viết. Nên đòi ĐỦ CẢ HAI:

      · lặng ít nhất `idle_minutes` (tính từ lượt làm CUỐI, không phải từ lúc
        mở — một phiên mở lâu mà vẫn đang gõ thì vẫn sống), VÀ
      · đã có một phiên KHÁC của cùng mục bắt đầu SAU nó — bằng chứng chính em
        ấy đã bỏ nó mà đi tiếp.

    `ended_by='abandoned'`, KHÔNG phải `'completed'`: nó chưa bao giờ xong, và
    mọi phép đếm chặng/xét đạt đều lọc đúng `'completed'`.

    `commit=False` là mặc định: chạy thử trước, đọc xem nó định làm gì, rồi mới
    cho ghi. Một lượt quét ghi vào bảng của học viên không được là lượt chạy
    đầu tiên ai đó nhìn thấy.
    """
    plan: list[dict] = []
    try:
        rows = _report_pages(
            "quiz_sessions",
            "id, user_id, bank_id, kind, ended_at, started_at, created_at, "
            "class_assignment_item_id",
            lambda q: q.not_.is_("class_assignment_item_id", "null"), db=db)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] close-dead: không đọc được phiên: %s", exc)
        return plan
    runs = [r for r in rows if (r.get("kind") or "run") == "run"]
    dead_ids = [r["id"] for r in runs if not r.get("ended_at")]
    if not dead_ids:
        return plan

    att: dict[str, list[dict]] = {}
    try:
        for c in _chunks(dead_ids):
            for a in _report_pages("quiz_attempts", "session_id, qid, is_correct, created_at",
                                   lambda q, c=c: q.in_("session_id", c), db=db):
                att.setdefault(a["session_id"], []).append(a)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] close-dead: không đọc được lượt làm: %s", exc)
        return plan

    # Phiên bắt đầu SAU nó, cùng mục — bằng chứng em ấy đã bỏ nó mà đi tiếp.
    by_item: dict[str, list[dict]] = {}
    for r in runs:
        by_item.setdefault(r["class_assignment_item_id"], []).append(r)

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=idle_minutes)
    for r in runs:
        if r.get("ended_at"):
            continue
        rows_a = att.get(r["id"]) or []
        if not rows_a:
            continue           # phiên rỗng: vô hại, không có gì để ghi lại
        last = max((a.get("created_at") or "") for a in rows_a)
        last_at = _at(last)
        if not last_at or last_at > cutoff:
            continue           # em ấy có thể vẫn đang làm
        mine = r.get("started_at") or r.get("created_at") or ""
        if not any((o.get("started_at") or o.get("created_at") or "") > mine
                   for o in by_item.get(r["class_assignment_item_id"], [])
                   # Tự nó không thể muộn hơn chính nó vì phép so là NGẶT; điều
                   # kiện này là phòng thủ cho lần ai đó đổi `>` thành `>=`.
                   if o["id"] != r["id"]):
            continue           # chưa có phiên sau: chưa chắc đã bỏ
        seen: set[str] = set()
        right = 0
        for a in sorted(rows_a, key=lambda x: x.get("created_at") or ""):
            if a.get("qid") and a["qid"] not in seen:
                seen.add(a["qid"])
                right += 1 if a.get("is_correct") else 0
        plan.append({"session_id": r["id"], "user_id": r.get("user_id"),
                     "item_id": r["class_assignment_item_id"],
                     "ended_at": last, "total_questions": len(seen),
                     "total_correct": right})

    if commit:
        for row in plan:
            try:
                (db.table("quiz_sessions").update({
                    "ended_by": "abandoned", "ended_at": row["ended_at"],
                    "total_questions": row["total_questions"],
                    "total_correct": row["total_correct"],
                }).eq("id", row["session_id"]).is_("ended_at", "null").execute())
            except Exception as exc:  # noqa: BLE001
                logger.warning("[quiz] close-dead: ghi hỏng %s: %s", row["session_id"], exc)
    return plan


async def regrade_failed_course_writing(db, *, commit: bool = False) -> list[dict]:
    """Chấm LẠI những lượt nộp tự luận mà bộ chấm đã hỏng hoàn toàn.

    Lượt nộp tự luận chỉ có MỘT. Khi bộ chấm hỏng, dòng vẫn được ghi với mọi câu
    `ok=None` — bài của em ấy còn nguyên, nhưng lượt thì đã tiêu, và không đường
    nào chấm lại. Ngày 06/08 model `gemini-2.5-flash-lite` bị ngừng cấp và NĂM
    học viên mất lượt duy nhất của mình.

    Chấm lại từ chính CÂU ĐÃ LƯU, không nhận nội dung mới: đây là sửa một lượt
    chấm hỏng, không phải mở lại một lượt nộp.

    Chỉ đụng những dòng hỏng HOÀN TOÀN (mọi câu `ok is None`). Một dòng chấm
    được dù chỉ một câu là một bản chấm thật — chấm lại nó là ghi đè kết quả của
    học viên bằng một lượt gọi model khác.

    `commit=False` là mặc định: đọc xem nó định làm gì trước đã.
    """
    out: list[dict] = []
    try:
        rows = _report_pages("course_writing_submissions",
                             "id, user_id, bank_id, class_assignment_item_id, "
                             "items, total, clean, graded_at",
                             lambda q: q, db=db)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[course-writing] regrade: không đọc được lượt nộp: %s", exc)
        return out

    for r in rows:
        items = r.get("items") or []
        if not items or any(i.get("ok") is not None for i in items):
            continue
        batch = [{"qid": i.get("qid"), "prompt": i.get("prompt") or "",
                  "explain": i.get("explain") or "", "answer": i.get("answer") or ""}
                 for i in items]
        graded, model_name = await course_writing_grader.grade(batch)
        clean = sum(1 for g in graded if g.get("ok") is True)
        still_broken = all(g.get("ok") is None for g in graded)
        plan = {"id": r["id"], "user_id": r.get("user_id"), "total": len(graded),
                "clean": clean, "model": model_name, "fixed": not still_broken}
        out.append(plan)
        if commit and not still_broken:
            # Vẫn hỏng thì KHÔNG ghi: ghi đè một bản hỏng bằng một bản hỏng khác
            # chỉ làm mất dấu vết lần đầu.
            try:
                (db.table("course_writing_submissions")
                 .update({"items": graded, "clean": clean, "model": model_name,
                          "graded_at": _now()})
                 .eq("id", r["id"]).execute())
            except Exception as exc:  # noqa: BLE001
                logger.warning("[course-writing] regrade: ghi hỏng %s: %s", r["id"], exc)
                plan["fixed"] = False
                continue
            # ĐỒNG BỘ ĐIỂM SANG SỔ LỚP.
            #
            # Lượt nộp hỏng đã ghi 0 vào `class_assignment_items.score`, và cả
            # trang của học viên lẫn bảng của giáo viên đọc CỘT ẤY. Sửa mỗi bản
            # chấm thì chi tiết nói 9/10 còn sổ vẫn nói 0 — hai màn hình cãi
            # nhau về cùng một em (codex #970).
            #
            # `mark_item_submitted` không dùng được: nó luỹ đẳng, chỉ ghi khi
            # `submitted_at` còn trống, mà ở đây nó đã có. Ghi thẳng cột điểm.
            item_id = r.get("class_assignment_item_id")
            # CÙNG luật với ba đường kia. Bộ đề có trắc nghiệm thì điểm của
            # mục là kết quả trắc nghiệm — chấm lại bài viết không được động
            # vào nó (codex cục bộ 07/08: đây là người ghi thứ TƯ, và chốt
            # điểm-danh hụt nó vì nó chia cho `len(graded)` chứ không cho
            # `total`).
            pct = course_hand_in_score(
                has_mcq=bank_has_mcq(r.get("bank_id")),
                clean=clean, total=len(graded))
            if item_id and pct is not None:
                try:
                    (db.table("class_assignment_items")
                     .update({"score": pct})
                     .eq("id", item_id).execute())
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[course-writing] regrade: đồng bộ điểm hỏng "
                                   "item=%s: %s", item_id, exc)
    return out


def _course_answered_qids(session_ids: list[str]) -> set[str] | None:
    """qid đã trả lời trong các phiên ĐÃ CHỐT. Hỏng thì trả None.

    None, KHÔNG phải tập rỗng. Rỗng đọc ra là "em ấy chưa làm câu nào" — một
    khẳng định mà một lượt đọc hỏng không chứng minh được, và tin nó là đẩy một
    em đã xong 8 chặng về chặng 0 rồi mở phiên mới: tái tạo đúng cảnh bỏ rơi bài
    mà cả thay đổi này sinh ra để chấm dứt (codex PR 963).
    """
    out: set[str] = set()
    if not session_ids:
        return out
    try:
        for c in _chunks(session_ids):
            for a in _report_pages("quiz_attempts", "qid",
                                   lambda q, c=c: q.in_("session_id", c)):
                if a.get("qid"):
                    out.add(a["qid"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] course-resume answered read failed: %s", exc)
        return None
    return out


def grade_attempt(answer_given, answer) -> bool | None:
    """Đúng/sai của MỘT lượt làm. `None` = đề không so được, nơi gọi tự lo.

    ── Vì sao phải có MỘT hàm ───────────────────────────────────────────────
    Trước đây ba mặt đọc chấm ba kiểu:

      · `course_verdict`        so CHUỖI  → `"01"` khác `"1"` ⇒ SAI
      · `course_answer_report`  parse SỐ  → `int("01") == 1` ⇒ ĐÚNG
      · bảng lớp `_ok`          parse SỐ, hỏng thì lùi về cờ client

    Cùng một lượt làm, ba con số. Học viên đọc một kiểu, giáo viên đọc kiểu
    khác, và cổng thuộc bài kết luận kiểu thứ ba (codex #970).

    ── KHÔNG bao giờ lùi về cờ của client khi đề CÓ đáp án ──────────────────
    `is_correct` trong `quiz_attempts` là lời CLIENT gửi lên: `log_progress`
    nhận nguyên nó. Một payload sửa tay khai `answer_given="x"` kèm
    `is_correct=true` sẽ được hai mặt đọc kia tính là ĐÚNG. `course_verdict` đã
    từ chối trò ấy từ lâu; nay cả ba từ chối.

    Không so được thì trả `None` — nơi gọi dùng cờ đã lưu, vì lúc ấy thật sự
    không còn gì tốt hơn (câu tự luận, hoặc đề thiếu đáp án).
    """
    if not isinstance(answer, int):
        return None
    try:
        # `int()` nuốt cả khoảng trắng thừa lẫn số 0 đứng đầu: `" 01 "` là lựa
        # chọn số 1, không phải một chuỗi lạ.
        return int(str(answer_given).strip()) == answer
    except (TypeError, ValueError):
        # Đề CÓ đáp án mà lượt làm không đọc được ⇒ SAI. Lùi về cờ client ở đây
        # là mở đúng cái cửa mà cả hàm này sinh ra để đóng.
        return False


def _course_mcq_order(bank_id: str) -> list[str]:
    """qid các câu TRẮC NGHIỆM, ĐÚNG thứ tự trang nạp. Hỏng thì NÉM.

    Trang cắt chặng bằng `qs.slice(stage * 10, …)` trên chính danh sách này, nên
    thứ tự ở đây LÀ định nghĩa của "chặng". Đọc bằng cột `order` — cùng cột mà
    đường phát đề dùng; xếp theo cột khác là hai bên nói về hai bài khác nhau.

    Chỉ câu MCQ mastery được giữ. Tự luận và các section đọc/nghe/phát âm nằm
    ngoài vòng chặng; để chúng chiếm chỗ sẽ làm mọi chặng Grammar lệch đi.

    Ném chứ không trả rỗng: nơi gọi có đường lùi riêng, còn trả rỗng lặng lẽ thì
    nó tưởng bộ đề không có câu nào và tính ra chặng 0 — đẩy học viên về đầu bài
    (codex 06/08).
    """
    rows = (supabase_admin.table("quiz_questions")
            .select("qid, type, counts_toward_mastery")
            .eq("bank_id", bank_id).order("order").execute().data) or []
    return [r["qid"] for r in rows
            if r.get("qid") and _is_course_quiz_question(r)]


def _course_stage_reached(order: list[str], answered_all: set[str],
                          in_progress_qid: str | None = None) -> int:
    """Chặng học viên đang đứng, tính TRÊN THỨ TỰ CHUẨN của bộ đề.

    ── Vì sao không đếm ─────────────────────────────────────────────────────
    Trang từng tự tính `stage = completed.length` (đếm PHIÊN). Một lượt kết
    phiên hỏng làm chặng ấy không được đếm, chỉ số tụt, trang cắt nhầm 10 câu,
    phép khớp mã câu hỏng, và nó mở một phiên MỚI — bỏ rơi luôn những câu vừa
    làm. Lần sau lại lệch thêm. Đo được trên prod 06/08: 29 phiên mồ côi mang
    90 câu đã trả lời, đúng bằng số câu được tính.

    Đếm SỐ CÂU rồi chia 10 cũng không đúng: 9 câu của chặng 0 cộng 1 câu ở tận
    chặng 5 vẫn ra "10 câu ⇒ chặng 1", trong khi chặng 0 còn lỗ. Và một bộ đề
    25 câu trả lời trọn vẹn ra "2 chặng" trong khi nó có 3 — bài không bao giờ
    được coi là xong (codex 06/08).

    Nên: chặng đầu tiên CHƯA PHỦ ĐỦ. Phủ hết thì trả số chặng.
    """
    total = -(-len(order) // COURSE_STAGE_SIZE)
    for k in range(total):
        chunk = order[k * COURSE_STAGE_SIZE:(k + 1) * COURSE_STAGE_SIZE]
        if not set(chunk) <= answered_all:
            # Còn lỗ ở chặng k. Nhưng nếu học viên ĐANG làm dở một chặng SAU nó
            # thì chính câu đang dở mới nói đúng chỗ đứng: trang có thể đã tiến
            # chặng theo bộ nhớ cục bộ trong khi một lượt kết phiên hỏng để lại
            # lỗ phía sau. Kéo em ấy về lấp lỗ là bắt làm lại từ giữa bài.
            if in_progress_qid and in_progress_qid in order:
                at = order.index(in_progress_qid) // COURSE_STAGE_SIZE
                return max(at, k)
            return k
    return total


def get_course_resume(
    *, user_id: str, bank_id: str, assignment_item_id: str | None = None,
) -> dict:
    """Chỗ đang làm dở của MỘT lượt bài tập theo buổi — đọc từ máy chủ.

    Trước đây chỗ này chỉ sống trong `localStorage` của đúng một trình duyệt,
    nên đóng tab giữa chặng là mất: `restore()` vứt chặng dở, `load()` mở một
    phiên MỚI, và những câu đã trả lời nằm lại trong một phiên mồ côi không bao
    giờ được chốt. Học viên đọc chuyện ấy thành "thoát trình duyệt là bài tự
    nộp" (báo cáo thật: em Minh Ngoc Võ, bank C1-B01 — 8/10 câu chặng 3 nằm
    trong phiên dfecc87b, không lối về).

    Máy chủ đã giữ đủ mọi thứ để trả lại: phiên chưa chốt, và các lượt làm của
    nó. Trả lại từ đây thì chỗ đang làm sống qua cả đóng tab, đổi máy, lẫn xoá
    bộ nhớ trình duyệt.

    Trả về:
      · `session_id`  phiên 'run' CHƯA chốt gần nhất (None nếu không có)
      · `answered`    [{qid, is_correct}] theo THỨ TỰ làm, của đúng phiên ấy
      · `completed`   id các phiên 'run' ĐÃ chốt — chính là danh sách gửi đi xét
                      đạt, nay không còn phụ thuộc bộ nhớ trình duyệt
      · `stage`       CHẶNG đang đứng, suy từ SỐ CÂU ĐÃ PHỦ (xem dưới)
      · `item_id`     mục bài giao đang gắn, để trang bỏ trạng thái của mục khác

    Chỉ dành cho bank theo buổi; các luồng quiz khác trả rỗng và không đổi hành
    vi. KHÔNG chốt gì cả: phiên chỉ đóng khi học viên bấm nộp.
    """
    empty = {"session_id": None, "answered": [], "completed": [], "item_id": None,
             "last_stage": None, "stage": 0, "retake": None}
    bank = _bank_meta_or_404(bank_id, user_id)
    if bank.get("skill_area") != COURSE_AREA:
        return empty

    item = (_assignment_item_for(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    ) if assignment_item_id else _assignment_item_for(bank_id, user_id))
    item_id = (item or {}).get("id")
    empty["item_id"] = item_id

    # A score below the near-pass band starts a NEW full attempt. Preserve the
    # newest such boundary until PASS: a near-pass full rerun changes the latest
    # action to `retake`, but must not make the older failed sessions reappear.
    retry_after = None
    retake_allowed = False
    recorded_session_ids: set[str] = set()
    latest_attempt_at = None
    if item_id:
        try:
            ledger = (supabase_admin.table("class_assignment_items")
                      .select("passed_at, mastery").eq("id", item_id)
                      .limit(1).execute().data) or []
            if ledger:
                state = ledger[0]
                attempts = ((state.get("mastery") or {}).get("attempts")) or []
                cfg_threshold = mastery_config(item)["pass_pct"]
                recorded_session_ids = {
                    str(session_id)
                    for attempt in attempts
                    for session_id in (attempt.get("sessions") or [])
                    if session_id
                }
                if attempts:
                    latest_attempt_at = _at(attempts[-1].get("at"))
                retake_allowed = bool(
                    not state.get("passed_at") and attempts
                    and _recorded_next_action(attempts[-1], cfg_threshold) == "retake"
                )
            if ledger and not ledger[0].get("passed_at"):
                retry_after = _full_retry_boundary(attempts, cfg_threshold)
                pending_started = _at((state.get("mastery") or {}).get(
                    "section_attempt_started_at"))
                if pending_started and (retry_after is None or pending_started > retry_after):
                    retry_after = pending_started
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] course-resume mastery read failed item=%s: %s",
                           item_id, exc)

    try:
        q = (supabase_admin.table("quiz_sessions")
             .select("id, ended_at, ended_by, class_assignment_item_id, created_at, "
                     "kind, total_correct, total_questions")
             .eq("user_id", user_id).eq("bank_id", bank_id)
             .order("created_at", desc=False))
        rows = (q.execute().data) or []
    except Exception as exc:  # noqa: BLE001
        # Đọc hỏng thì trả RỖNG, không ném: trang vẫn mở bài mới được. Ném ở đây
        # là chặn học viên khỏi bài tập vì một lỗi đọc phụ trợ.
        logger.warning("[quiz] course-resume read failed bank=%s: %s", bank_id, exc)
        return empty

    # Phiên của MỤC BÀI GIAO khác (chuyển lớp, giao lại cùng bank) là lượt khác.
    # So sánh cả hai chiều: mục None chỉ khớp mục None.
    rows = [r for r in rows if (r.get("class_assignment_item_id") or None) == item_id]
    if retry_after:
        rows = [r for r in rows
                if (_at(r.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))
                > retry_after]
    # Một revision chưa được ghi vào mastery ledger vẫn là bài đang làm, kể cả
    # phiên đã chốt nhưng request `/course/verdict` bị rớt mạng. Giữ đúng MỘT
    # phiên mới nhất; session_id sẽ làm seed để trình duyệt dựng lại cùng mẫu và
    # cùng hoán vị đáp án trên mọi thiết bị, không cần lưu đáp án vào schema.
    pending_retakes = []
    if retake_allowed:
        for row in rows:
            if ((row.get("kind") or "run") != "retake"
                    or row["id"] in recorded_session_ids):
                continue
            created_at = _at(row.get("created_at"))
            # Verdict mới nhất supersede mọi revision đã tồn tại trước nó,
            # kể cả một tab cũ mở revision nhưng chưa nộp. Chỉ nhìn "chưa có
            # trong ledger" sẽ kéo tab cũ ấy sống lại sau khi revision mới hơn
            # đã được chấm và ghi sổ.
            if (latest_attempt_at is not None
                    and (created_at is None or created_at <= latest_attempt_at)):
                continue
            pending_retakes.append(row)
    pending_retake = (max(pending_retakes, key=lambda r: r.get("created_at") or "")
                      if pending_retakes else None)
    # `kind` vắng mặt trên phiên cũ (trước mig 189) — coi như 'run'.
    rows = [r for r in rows if (r.get("kind") or "run") == "run"]

    # ĐÃ CHỐT phải là `ended_by='completed'`. `ended_at` được đặt cả khi TẠM
    # DỪNG, nên đếm theo nó là gọi một chặng bỏ giữa chừng là chặng đã xong —
    # rồi gửi luôn id phiên tạm dừng đi xét đạt, và verdict bác cả lượt.
    completed = [r["id"] for r in rows if r.get("ended_by") == "completed"]
    # Kết quả CHẶNG CUỐI ĐÃ CHỐT. Máy mới (chưa có gì trong localStorage) khôi
    # phục vào màn kết quả với `marks` rỗng, và trang tính điểm từ `marks` — nên
    # không có con số này thì học viên xong cả bài vẫn thấy "0/10 câu đúng"
    # (codex PR 945 vòng 4).
    last = None
    for r in rows:
        if r.get("ended_by") == "completed" and r.get("total_questions"):
            last = r
    result_last = ({"right": int(last.get("total_correct") or 0),
                    "graded": int(last.get("total_questions") or 0)}
                   if last else None)
    open_rows = [r for r in rows if not r.get("ended_at")]
    # Nhiều phiên rỗng do tải lại trang: lấy phiên CÓ BÀI gần nhất, không phải
    # phiên mới nhất — bản ghi của học viên nằm ở phiên có bài.
    # ── CHẶNG SUY TỪ SỐ CÂU ĐÃ PHỦ, KHÔNG TỪ SỐ PHIÊN ────────────────────────
    #
    # Trang từng tự tính `stage = completed.length`. Một phiên bị bỏ giữa chừng
    # (tải lại trang, mất mạng) làm chặng ấy KHÔNG được đếm, nên chỉ số chặng
    # lệch xuống, trang cắt nhầm 10 câu, phép khớp tiền tố hỏng, và nó mở một
    # phiên MỚI — bỏ rơi luôn những câu học viên vừa làm. Lần sau lại lệch thêm:
    # một vòng tự nuôi, hỏng một lần là hỏng mãi.
    #
    # Dữ liệu thật 06/08: em Lê Ngọc Hà Linh đang dở chặng 3 (`B01-B2-*`) mà sổ
    # đếm được 2 phiên, nên trang chờ chặng 2 và vứt 8 câu của em ấy. Toàn lớp
    # có 29 phiên mồ côi mang 90 câu đã trả lời — đúng bằng số câu được tính.
    #
    # Đây là luật `course_verdict` và `_course_work_is_done` vẫn dùng: ĐẾM CÂU,
    # đừng đếm phiên. Một chặng làm hai lần vẫn là một chặng.
    # MỘT lượt đọc thứ tự chuẩn cho cả hai việc: tính chặng, và xếp lại câu đang
    # dở. Hỏng thì lùi về cách cũ (đếm phiên) — sai ở các ca lẻ nhưng đúng ở ca
    # thường, còn chặn học viên khỏi bài tập vì một lượt đọc phụ trợ thì tệ hơn.
    try:
        order = _course_mcq_order(bank_id)
        order_ok = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] course-resume order read failed bank=%s: %s", bank_id, exc)
        order = []
        order_ok = False
    answered_all = _course_answered_qids(completed) if order else None
    # Không đọc được thứ tự đề HAY không đọc được câu đã làm ⇒ lùi về cách cũ
    # (đếm phiên). Cách cũ sai ở các ca lẻ, nhưng nó KHÔNG bao giờ trả 0 cho một
    # em đã xong 8 chặng.
    usable = order_ok and bool(order) and answered_all is not None
    result = {"session_id": None, "answered": [], "completed": completed,
              "item_id": item_id, "last_stage": result_last,
              "stage": (_course_stage_reached(order, answered_all)
                        if usable else len(completed)), "retake": None}
    ids = [r["id"] for r in open_rows]
    if pending_retake:
        ids.append(pending_retake["id"])
    if not ids:
        return result

    try:
        att = (supabase_admin.table("quiz_attempts")
               .select("session_id, qid, is_correct, created_at")
               .in_("session_id", ids).order("created_at", desc=False)
               .execute().data) or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] course-resume attempts failed bank=%s: %s", bank_id, exc)
        return result

    # Client cũ từng ghi Reading/Listening/Pronunciation (và MCQ opt-out) vào
    # chính quiz session. Nếu đếm các dòng ấy để chọn phiên, một phiên bổ trợ
    # dài hơn sẽ luôn thắng phiên Grammar thật và frontend từ chối resume vì
    # QID không khớp tiền tố đề. Khi đọc được contract bank, chỉ evidence
    # Grammar canonical mới được tham gia cả việc chọn phiên lẫn payload trả về.
    if order_ok:
        grammar_qids = set(order)
        att = [a for a in att if a.get("qid") in grammar_qids]

    by_session: dict[str, list[dict]] = {}
    for a in att:
        by_session.setdefault(a["session_id"], []).append(a)
    if pending_retake:
        seen_retake: set[str] = set()
        retake_answers = []
        for a in by_session.get(pending_retake["id"], []):
            if not a.get("qid") or a["qid"] in seen_retake:
                continue
            seen_retake.add(a["qid"])
            retake_answers.append({
                "qid": a["qid"], "is_correct": bool(a.get("is_correct")),
            })
        result["retake"] = {
            "session_id": pending_retake["id"],
            "answered": retake_answers,
            "completed": pending_retake.get("ended_by") == "completed",
            "right": int(pending_retake.get("total_correct") or 0),
            "graded": int(pending_retake.get("total_questions") or 0),
        }
    if not open_rows:
        return result
    # Phiên dở dang ĐÁNG khôi phục = phiên NHIỀU BÀI NHẤT, hoà thì lấy mới nhất.
    # Không lấy "mới nhất" đơn thuần: tải lại trang giữa chặng từng đẻ ra vài
    # phiên cho CÙNG một chặng, và phiên mới nhất thường là phiên ít bài nhất.
    # Dữ liệu thật của em Minh Ngoc Võ: hai lần thử ở chặng 3, một phiên 8 câu và
    # một phiên 5 câu — lấy mới nhất là trả lại 5 rồi bắt em làm lại 3 câu đã làm.
    # Các phiên ấy cùng chặng nên cùng thứ tự câu, lấy phiên dài hơn luôn là một
    # tiền tố hợp lệ.
    # Phiên rỗng bỏ mặc: chúng vô hại (0 câu, không vào lượt xét).
    with_work = [r for r in open_rows if by_session.get(r["id"])]
    if not with_work:
        return result
    chosen = max(with_work, key=lambda r: (len(by_session[r["id"]]), r["created_at"]))
    result["session_id"] = chosen["id"]
    # XẾP THEO THỨ TỰ CHUẨN CỦA BỘ ĐỀ, không theo `created_at`.
    #
    # Một lô lượt làm được ghi cùng lúc thì mang CÙNG dấu thời gian, và Postgres
    # không hứa gì về thứ tự giữa các dòng bằng nhau. Trang lại đòi mảng khớp
    # ĐÚNG tiền tố, nên chỉ cần hai câu đảo chỗ là nó coi như lệch đề, mở phiên
    # mới, và bỏ rơi cả phiên có bài. Dữ liệu thật của em Minh Ngoc Võ đúng hình
    # dạng ấy: `B1-07, B1-05, B1-04, B1-03, B1-06` (codex 06/08).
    pos = {q: i for i, q in enumerate(order)}
    picked = [a for a in by_session[chosen["id"]] if a.get("qid")]
    if order:
        picked.sort(key=lambda a: pos.get(a["qid"], len(order)))
    seen_q: set[str] = set()
    result["answered"] = []
    for a in picked:
        if a["qid"] in seen_q:
            continue          # trả lời lại cùng một câu: giữ lượt ĐẦU
        seen_q.add(a["qid"])
        result["answered"].append(
            {"qid": a["qid"], "is_correct": bool(a.get("is_correct"))})
    # Có câu đang dở thì chính vị trí của nó nói chỗ đứng.
    if usable and result["answered"]:
        result["stage"] = _course_stage_reached(
            order, answered_all, in_progress_qid=result["answered"][0]["qid"])
    return result


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


def _assert_course_session_accepting(session: dict, ended_by: str = "completed") -> None:
    """Apply the deadline to final submissions; a pause is only a soft save."""
    if ended_by == "paused":
        return
    item_id = (session or {}).get("class_assignment_item_id")
    if not item_id:
        return
    try:
        items = (supabase_admin.table("class_assignment_items")
                 .select("id, assignment_id").eq("id", item_id)
                 .limit(1).execute().data) or []
        if not items:
            raise HTTPException(404, "Không tìm thấy mục bài giao")
        assignments = (supabase_admin.table("class_assignments").select("*")
                       .eq("id", items[0]["assignment_id"])
                       .limit(1).execute().data) or []
        if not assignments:
            raise HTTPException(404, "Không tìm thấy bài giao")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi kiểm tra hạn nộp: {exc}")
    if assignments[0].get("skill") == COURSE_AREA \
            and not is_accepting_submissions(assignments[0]):
        raise HTTPException(409, "Đã quá hạn nộp — chặng này chưa được chốt.")


def end_session(*, user_id: str, session_id: str, data: dict) -> dict:
    """Finalize a session with totals from the client. ended_by ∈ ENDED_BY."""
    session = _owned_session(session_id, user_id)
    ended_by = data.get("ended_by")
    if ended_by not in _ENDED_BY:
        ended_by = "completed"
    _assert_course_session_accepting(session, ended_by)
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

    # CHỐT SỔ BÀI GIAO. Không có bước này thì mục ở lại "opened" vĩnh viễn và
    # bảng của giáo viên báo em ấy chưa nộp — trong khi em ấy vừa làm xong.
    #
    # `mark_item_submitted` luỹ đẳng (chỉ ghi khi `submitted_at IS NULL`), nên
    # làm nhiều chặng chỉ ghi lần ĐẦU và một bài nộp đúng hạn không bị đẩy thành
    # trễ ở chặng sau.
    #
    # Best-effort: hỏng ở đây KHÔNG được làm đổ lệnh kết phiên — điểm đã ghi rồi,
    # và chốt sổ có thể vá lại bằng lượt đối chiếu.
    item_id = (session or {}).get("class_assignment_item_id")
    # Ngân hàng nhiều phần chỉ được chốt bởi `refresh_course_completion` sau
    # khi đọc/nghe/viết/phát âm đều có bằng chứng canonical. Nếu vẫn đi qua
    # đường legacy này, riêng việc phủ đủ MCQ sẽ đóng `submitted_at` bất biến
    # và lần tải lại kế tiếp khoá các phần còn thiếu ở chế độ review-only.
    bank_id = (session or {}).get("bank_id")
    if (item_id and ended_by == "completed"
            and not course_bank_is_multisection(bank_id)
            and _course_work_is_done(session or {}, item_id)):
        try:
            mark_item_submitted(
                supabase_admin, item_id=item_id,
                artifact_kind="quiz_session", artifact_id=session_id,
                score=(round(correct / total * 100, 1) if total else None),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] mark submitted failed item=%s: %s", item_id, exc)
    return res.data[0] if res.data else {"id": session_id, **patch}


def _course_bank_shape(bank_id: str | None) -> tuple[set[str], int, bool]:
    """(qid của câu TRẮC NGHIỆM, số câu TỰ LUẬN, đọc-được-hay-không).

    Một lượt đọc duy nhất trả cả ba thứ. Trước đây hai câu hỏi ("có tự luận
    không" và "bao nhiêu chặng") đi hai đường — một đường có cache dài hạn —
    nên sau khi re-import bộ đề, hai đường trả lời khác nhau và bài giao hoặc
    kẹt vĩnh viễn hoặc bị chốt sớm (codex cục bộ 06/08).
    """
    if not bank_id:
        return set(), 0, True
    try:
        rows = _report_pages("quiz_questions", "qid, type, counts_toward_mastery",
                             lambda q: q.eq("bank_id", bank_id))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] không đọc được bộ đề bank=%s: %s", bank_id, exc)
        return set(), 0, False
    mcq = {r["qid"] for r in rows
           if r.get("qid") and _is_course_quiz_question(r)}
    writing = sum(1 for r in rows if r.get("type") == "writing")
    return mcq, writing, True


def _course_work_is_done(session: dict, item_id: str) -> bool:
    """Kết chặng này đã là XONG BÀI chưa.

    ── Vì sao cần hỏi ──────────────────────────────────────────────────────
    `end_session` từng đóng dấu "đã nộp" ngay ở chặng ĐẦU TIÊN. Bốn học viên
    thật đã dính, trong đó em Minh Ngoc Võ mới 3/9 chặng mà sổ ghi `graded` 60.

    ── Vì sao PHỦ CÂU chứ không ĐẾM PHIÊN ──────────────────────────────────
    Một chặng có thể sinh NHIỀU phiên: tải lại trang, mở hai tab, làm lại chặng.
    Em Minh Ngoc Võ có 7 phiên cho 3 chặng. Đếm dòng phiên thì hai phiên cùng
    phủ câu 1–10 đã đủ "2 chặng" và bài bị chốt trong khi câu 11–20 chưa ai
    làm. `course_verdict` đã dùng luật phủ-đủ-câu từ lâu vì đúng lý do này —
    đây là mượn lại luật ấy, không phát minh luật mới.

    ── Hỏng thì trả False ───────────────────────────────────────────────────
    Không đọc được thì KHÔNG đóng dấu. `submitted_at` chỉ ghi một
    lần; đoán xong sớm sẽ khoá mốc nộp sai. Đoán chưa xong chỉ làm chậm
    sổ, và `reconcile_course_items` sẽ vá từ bằng chứng thật sau đó.
    """
    bank_id = session.get("bank_id")
    mcq_qids, writing, ok = _course_bank_shape(bank_id)
    if not ok:
        # `submitted_at` is immutable. A transient read failure must never turn
        # one stage into a completed assignment; reconciliation can safely fill
        # a missing ledger entry after the evidence becomes readable again.
        return False
    # Còn phần tự luận thì đường chốt sổ là lượt NỘP TỰ LUẬN. Đọc từ CÙNG lượt
    # đọc ở trên, không qua một cache có thể đã cũ sau re-import.
    if writing:
        return False
    if not mcq_qids:
        return True

    try:
        sess = (supabase_admin.table("quiz_sessions")
                .select("id, kind, ended_by")
                .eq("class_assignment_item_id", item_id)
                .eq("ended_by", "completed")
                .execute().data) or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] không đọc được phiên đã chốt item=%s: %s", item_id, exc)
        return False
    # Chỉ lượt CHÍNH. Phiên kiểm tra lại là mẫu nhỏ ngẫu nhiên, không phải chặng.
    ids = [x["id"] for x in sess if (x.get("kind") or "run") == "run"]
    if not ids:
        return False

    answered: set[str] = set()
    for i in range(0, len(ids), _REPORT_IDS):
        try:
            for a in _report_pages("quiz_attempts", "qid",
                                   lambda q, c=ids[i:i + _REPORT_IDS]: q.in_("session_id", c)):
                if a.get("qid"):
                    answered.add(a["qid"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] không đọc được lượt làm item=%s: %s", item_id, exc)
            return False

    return mcq_qids <= answered


def _chunks(seq, n=None):
    """Chia lô cho `in.(...)`: URL của PostgREST có giới hạn độ dài.

    Cắt bớt thay vì chia lô là một trần ÂM THẦM — trang chạy xanh, con số
    trông đủ, và những mục sau mốc 100 không bao giờ được vá.
    """
    n = n or _REPORT_IDS
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _bank_shapes(bank_ids: list[str], db=None) -> dict[str, tuple[set[str], int]]:
    """{bank: (qid trắc nghiệm, số câu tự luận)} — đọc THEO LÔ, hỏng thì NÉM.

    Khác `_course_bank_shape` ở hai điểm, cả hai đều có lý do:

    · Theo lô. Hỏi từng bộ đề trong vòng lặp thì một trang có 60 bài giao khác
      bộ đề tốn 60 lượt đọc, và cái memo theo bank chỉ đỡ khi các mục dùng
      CHUNG bộ đề — tức là đỡ đúng lúc không cần đỡ.
    · Ném. `_course_bank_shape` nuốt lỗi vì nó phục vụ đường chốt sổ duy nhất,
      ở đó đoán sai làm bài kẹt vĩnh viễn. Ở đường vá, nuốt lỗi nghĩa là bỏ vá
      trong im lặng: trang vẫn vẽ "chưa nộp" như thể đó là sự thật, không một
      lời cảnh báo (codex cục bộ 06/08 vòng 2).
    """
    out: dict[str, tuple[set[str], int]] = {b: (set(), 0) for b in bank_ids}
    for c in _chunks(list(bank_ids)):
        for r in _report_pages(
                "quiz_questions", "bank_id, qid, type, counts_toward_mastery",
                               lambda q, c=c: q.in_("bank_id", c), db=db):
            mcq, writing = out.get(r.get("bank_id"), (set(), 0))
            if r.get("type") == "writing":
                out[r["bank_id"]] = (mcq, writing + 1)
            elif r.get("qid") and _is_course_quiz_question(r):
                out[r["bank_id"]] = (mcq | {r["qid"]}, writing)
    return out


def _multisection_bank_ids(bank_ids: set[str], db=None) -> set[str]:
    """Đọc theo lô các bank có từ hai phần bắt buộc trở lên; lỗi thì ném."""
    source = db or supabase_admin
    ids = {bank_id for bank_id in bank_ids if bank_id}
    shapes = _bank_shapes(list(ids), source)
    meta_of = {bank_id: {} for bank_id in ids}
    for chunk in _chunks(list(ids)):
        for row in _report_pages(
                "quiz_banks", "id, meta",
                lambda q, chunk=chunk: q.in_("id", chunk), db=source):
            if row.get("id") in meta_of:
                meta_of[row["id"]] = row.get("meta") or {}
    pronunciation = set()
    for chunk in _chunks(list(ids)):
        for row in _report_pages(
                "course_pronunciation_sets", "bank_id",
                lambda q, chunk=chunk: q.in_("bank_id", chunk)
                .eq("is_active", True), db=source):
            if row.get("bank_id") in ids:
                pronunciation.add(row["bank_id"])

    out = set()
    for bank_id in ids:
        mcq, writing = shapes.get(bank_id, (set(), 0))
        meta = meta_of.get(bank_id) or {}
        reading = meta.get("short_reading")
        listening = meta.get("short_listening")
        solution = listening.get("solution") if isinstance(listening, dict) else None
        present = [
            bool(mcq),
            writing > 0,
            (isinstance(reading, dict) and isinstance(reading.get("answers"), list)
             and bool(reading.get("answers"))),
            (isinstance(solution, dict) and isinstance(solution.get("answers"), list)
             and bool(solution.get("answers"))),
            bank_id in pronunciation,
        ]
        if sum(present) > 1:
            out.add(bank_id)
    return out


def course_bank_is_multisection(bank_id: str | None, db=None) -> bool:
    """Bank có từ hai phần; không đọc được thì fail closed để không thu nhầm."""
    if not bank_id:
        return True
    try:
        return bank_id in _multisection_bank_ids({bank_id}, db)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] không đọc được hình dạng nhiều phần bank=%s: %s",
                       bank_id, exc)
        return True


def _completing_session(runs: list[dict], answered: dict[str, set[str]],
                        mcq_qids: set[str]) -> dict | None:
    """Phiên mà TẠI ĐÓ bài vừa đủ câu — không phải phiên muộn nhất.

    Học viên làm lại một chặng sau khi đã xong là chuyện thường. Lấy phiên muộn
    nhất thì mục được đóng dấu bằng giờ của lượt làm lại: sai giờ nộp, sai điểm
    (điểm của lượt làm lại chứ không phải lượt hoàn thành), và một bài xong
    đúng hạn rồi ôn lại sau hạn sẽ bị đọc thành nộp trễ.

    Đường ghi thường đóng dấu ở đúng phiên khép lại bài; đường vá phải dựng lại
    CHÍNH kết quả ấy, chứ không phải một kết quả khác cũng hợp lý (codex cục bộ
    06/08).
    """
    ordered = sorted(runs, key=lambda r: r["ended_at"])
    if not mcq_qids:
        # Bộ đề không có câu trắc nghiệm nào: phiên chốt đầu tiên là bằng chứng.
        return ordered[0] if ordered else None
    seen: set[str] = set()
    for r in ordered:
        seen |= answered.get(r["id"], set())
        if mcq_qids <= seen:
            return r
    return None


class ReconcileIncomplete(Exception):
    """Lượt đối chiếu KHÔNG làm trọn — khác hẳn "không có gì để vá".

    Hai mặt đọc đều bọc lời gọi trong try/except để bật cờ "chưa đối chiếu
    được". Nuốt lỗi rồi trả một con số trông như thành công khiến trang vẽ
    "chưa nộp" như thể đó là sự thật.
    """


def reconcile_course_items(db, assignment_ids: list[str]) -> int:
    """Vá sổ cho bài tập THEO BUỔI. Trả về số mục đã vá.

    ── Vì sao cần ──────────────────────────────────────────────────────────
    `end_session` và `submit_course_writing` đều ghi sổ BEST-EFFORT: hỏng thì
    chỉ log, còn client nhận HTTP 200 nên không có gì kích hoạt thử lại. Với
    chặng CUỐI (hoặc lượt nộp tự luận) thì không còn lượt nào sau để gọi lại, và
    bài nằm ở "Cần nộp" vĩnh viễn.

    `reconcile_ledger_from_sessions` không đỡ được: nó đọc bảng `sessions` của
    Speaking, không đọc `quiz_sessions` (codex PR 954).

    ── MỘT luật cho mọi trục trặc: làm hết phần làm được, rồi NÉM ───────────
    Ba vòng soi liên tiếp đều vấp cùng một câu hỏi — lượt đọc bộ đề hỏng thì
    sao, lượt ghi một mục hỏng thì sao, lượt đọc phiên hỏng thì sao — vì mỗi
    chỗ tôi lại quyết một kiểu. Nay chỉ còn một luật: hỏng ở đâu cũng cố làm
    nốt phần còn lại, rồi ném `ReconcileIncomplete`. Đơn vị "phần còn lại" là
    MỘT LÔ 100 mục: trong lô thì được ăn cả ngã về không (đọc nửa vời sẽ đóng
    dấu sai giờ), còn lô này hỏng không kéo theo lô khác. Hai mặt đọc của giáo viên
    và một mặt đọc của học viên đều đã bọc sẵn try/except để bật cờ, nên "ném"
    đúng nghĩa là "nói thật với người đang đọc trang".

    ── HAI loại bằng chứng, đọc RỜI nhau ───────────────────────────────────
    Một dòng tự luận đã chấm tự nó đủ để chốt sổ: nó không cần biết bộ đề có
    bao nhiêu câu hay em ấy đã làm những phiên nào. Bắt nó đi chung đường đọc
    với nhóm trắc nghiệm nghĩa là một lượt đọc `quiz_questions` hỏng cũng chặn
    luôn những bài viết đã chấm — chặn vì một dữ liệu không ai dùng tới.

    ── Vì sao đọc THEO LÔ ──────────────────────────────────────────────────
    Đa số mục "chưa nộp" là chưa nộp THẬT — em ấy chưa làm. Hỏi từng mục thì
    một lớp 14 em × 5 bài giao tốn hàng trăm lượt đọc mỗi lần mở trang, để vá
    một sự cố hiếm: cả lớp trả giá cho một trường hợp lẻ.

    ── Vì sao KHÔNG chặn theo hạn nộp ──────────────────────────────────────
    Speaking chặn sau hạn ở chính đường ghi (`sessions.py`), nên đường vá của
    nó chặn theo là ĐÚNG NHỊP. Bài theo buổi thì `end_session` và
    `submit_course_writing` KHÔNG chặn — bài muộn vẫn được ghi, và bảng của
    giáo viên gọi nó là trễ bằng cách so `submitted_at` với hạn. Nếu đường vá
    lại chặt hơn đường ghi thì em nào làm muộn mà gặp lượt ghi sổ hỏng sẽ kẹt
    VĨNH VIỄN — đúng cái lỗi hàm này sinh ra để sửa.

    Luỹ đẳng: `mark_item_submitted` chỉ ghi khi `submitted_at IS NULL`.
    """
    if not assignment_ids:
        return 0

    hurt: list[str] = []

    def _try(what, fn):
        """Chạy một mảnh việc; hỏng thì ghi sổ nợ và đi tiếp.

        MỘT LÔ LÀ MỘT ĐƠN VỊ CÔNG VIỆC. Trong một lô thì được ăn cả ngã về
        không — lượt đọc chết giữa chừng để lại dữ liệu về một nửa mà TRÔNG như
        đã đủ, và một mục mất đúng phiên muộn nhất sẽ bị đóng dấu bằng giờ của
        lượt trước. Nhưng lô này hỏng không được kéo theo lô khác: chúng chia
        theo mã mục, nên công việc của lô đã đọc trọn là an toàn.
        """
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] reconcile: %s hỏng: %s", what, exc)
            hurt.append(what)
            return None

    course: dict[str, dict] = {}
    for c in _chunks(list(assignment_ids)):
        _try(f"đọc bài giao ({len(c)} mã)", lambda c=c: course.update(
            {a["id"]: a for a in _report_pages(
                "class_assignments", "id, content_id, skill",
                lambda q, c=c: q.in_("id", c), db=db) if a.get("skill") == "course"}))
    if not course:
        if hurt:
            raise ReconcileIncomplete("; ".join(hurt))
        return 0

    items: list[dict] = []
    for c in _chunks(list(course)):
        _try(f"đọc mục bài giao ({len(c)} bài)", lambda c=c: items.extend(
            _report_pages("class_assignment_items",
                          "id, assignment_id, submitted_at",
                          lambda q, c=c: q.in_("assignment_id", c), db=db)))
    pending = {i["id"]: i for i in items if not i.get("submitted_at")}
    if not pending:
        if hurt:
            raise ReconcileIncomplete("; ".join(hurt))
        return 0

    def _bank_of(item_id):
        return (course.get(pending[item_id]["assignment_id"]) or {}).get("content_id")

    # Bank nhiều phần được chốt duy nhất qua `refresh_course_completion`, nơi
    # có đủ bằng chứng và trọng số. Đường vá legacy chỉ biết quiz/writing; cho
    # nó chạy sẽ thu bài ngay khi một phần xong và tái tạo đúng lỗi đang sửa.
    bank_ids = {_bank_of(item_id) for item_id in pending if _bank_of(item_id)}
    try:
        gated = _multisection_bank_ids(bank_ids, db)
    except Exception as exc:  # noqa: BLE001
        # Không biết hình dạng thì không được đóng dấu, đồng thời phải báo cho
        # mặt đọc rằng dữ liệu đang stale thay vì khẳng định “chưa nộp”.
        logger.warning("[quiz] reconcile: đọc hình dạng nhiều phần hỏng: %s", exc)
        gated = bank_ids
        hurt.append("đọc hình dạng nhiều phần")
    pending = {item_id: row for item_id, row in pending.items()
               if _bank_of(item_id) not in gated}
    if not pending:
        if hurt:
            raise ReconcileIncomplete("; ".join(hurt))
        return 0

    fixed = 0

    def _stamp(item_id, kind, art, done_at, score):
        """Đóng dấu thời điểm LÀM XONG, không phải thời điểm vá: bài xong lúc
        18:00 mà vá lúc 20:00 sẽ bị đọc thành nộp trễ — đường vá tự tạo ra đúng
        cái kết luận sai mà nó sinh ra để sửa."""
        nonlocal fixed
        try:
            if mark_item_submitted(db, item_id=item_id, artifact_kind=kind,
                                   artifact_id=art, score=score, now=done_at):
                fixed += 1
        except Exception as exc:  # noqa: BLE001
            # Thử tiếp những mục còn lại: một mục hỏng không được cản cả lớp.
            logger.warning("[quiz] reconcile: ghi sổ hỏng item=%s: %s", item_id, exc)
            hurt.append(f"ghi item={item_id}")

    # ── Bằng chứng 1: bài tự luận ĐÃ CHẤM ───────────────────────────────────
    # Tự nó đủ, kể cả khi bộ đề vừa bị nạp lại và phần viết đã biến mất: lấy
    # hình dạng bộ đề HÔM NAY để phán một việc đã xảy ra HÔM QUA sẽ bỏ rơi đúng
    # những lượt nộp cần cứu.
    wrote: dict[str, dict] = {}
    for c in _chunks(list(pending)):
        _try(f"đọc bài tự luận ({len(c)} mục)", lambda c=c: wrote.update(
            {w["class_assignment_item_id"]: w for w in _report_pages(
                "course_writing_submissions",
                "id, class_assignment_item_id, graded_at, total, clean",
                lambda q, c=c: q.in_("class_assignment_item_id", c), db=db)
             if w.get("class_assignment_item_id")}))
    # Hình dạng bộ đề đọc THEO LÔ: vòng lặp dưới có thể chạy qua nhiều mục của
    # cùng một bank, và hỏi lại từng mục là N lượt đọc cho một câu trả lời.
    #
    # Đọc hỏng KHÔNG được chặn lượt chốt sổ. Dòng tự luận đã chấm tự nó đủ để
    # chốt sổ; bắt nó chờ `quiz_questions` là dựng lại đúng cái ràng buộc mà
    # docstring trên nói phải tránh — và bộ test đã bắt tôi làm thế.
    #
    # Không biết hình dạng ⇒ coi như CÓ trắc nghiệm ⇒ không chạm cột điểm. Chiều
    # an toàn là không ghi: ghi nhầm sẽ xoá kết quả trắc nghiệm, còn không ghi
    # chỉ là để trống một con số mà `course_verdict` sẽ điền.
    try:
        w_shapes = _bank_shapes([b for b in {_bank_of(i) for i in wrote} if b], db)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] reconcile: không đọc được hình dạng bộ đề: %s", exc)
        w_shapes = {}
        hurt.append("đọc hình dạng bộ đề")
    for item_id, w in wrote.items():
        bank = _bank_of(item_id)
        known = bank in w_shapes
        _stamp(item_id, "course_writing", w["id"], _at(w.get("graded_at")),
               course_hand_in_score(
                   has_mcq=(not known) or bool(w_shapes[bank][0]),
                   clean=w.get("clean"), total=w.get("total")))

    # ── Bằng chứng 2: các phiên trắc nghiệm đã chốt ─────────────────────────
    rest = [i for i in pending if i not in wrote]
    for c in _chunks(rest):
        _try(f"đọc bằng chứng trắc nghiệm ({len(c)} mục)",
             lambda c=c: _reconcile_chunk(c, _bank_of, _stamp, db))

    if fixed:
        logger.info("[quiz] đã vá %s mục bài tập theo buổi", fixed)
    if hurt:
        raise ReconcileIncomplete("; ".join(hurt))
    return fixed


def bank_has_mcq(bank_id: str | None) -> bool:
    """Bộ đề này có câu trắc nghiệm không — và KHÔNG CHẮC thì trả True.

    `_course_bank_shape` KHÔNG ném khi đọc hỏng: nó trả `(set(), 0, False)`.
    Nên `bool(_course_bank_shape(x)[0])` đọc một lượt đọc hỏng thành "bộ đề
    chỉ có tự luận" — và ghi độ sạch bài viết đè lên kết quả trắc nghiệm, đúng
    cái hỏng cả bản vá này sinh ra để chặn, chỉ khác là nó chỉ nổ khi
    `quiz_questions` đang chập chờn (codex #994, P1).

    Ba nơi gọi từng tự bóc `[0]` và cả ba cùng sai một kiểu. Gói lại một hàm để
    chiều an toàn nằm ở MỘT chỗ: không đọc được ⇒ coi như CÓ trắc nghiệm ⇒ không
    chạm cột điểm. Không ghi chỉ để trống một con số `course_verdict` sẽ điền;
    ghi nhầm thì xoá mất bằng chứng.
    """
    mcq, _writing, ok = _course_bank_shape(bank_id)
    return (not ok) or bool(mcq)


def course_hand_in_score(*, has_mcq: bool, clean, total) -> float | None:
    """Điểm ghi sổ khi chốt/đồng bộ một mục bài-theo-buổi TỪ BÀI TỰ LUẬN.

    `None` = ĐỪNG chạm cột điểm.

    ── Cảnh hỏng đã xảy ra trên prod ───────────────────────────────────────
    Cột `score` có BỐN người ghi mang HAI nghĩa, và người ghi sau thắng:

      · `course_verdict` ghi `score = pct` (tỉ lệ đúng trắc nghiệm), và
        `passed_at` được xét trên CHÍNH con số ấy — nhưng nó không ghi
        `submitted_at`
      · `submit_course_writing`, `reconcile_course_items`, `assignment_tally`,
        `regrade_failed_course_writing` ghi độ sạch bài viết

    `mark_item_submitted` luỹ đẳng theo `submitted_at`, KHÔNG theo `score`, nên
    lượt sau xoá sạch kết quả của lượt trước. Đo trên prod 07/08: 11/11 mục đã
    nộp mang dấu `course_writing`, 0 mang dấu trắc nghiệm; 6/11 dòng TỰ MÂU
    THUẪN (đã đạt mà điểm dưới ngưỡng). Em Dương Dương hiện "10% · đã đạt"
    (thật 95%), em Hà Linh hiện "0%" (thật 65%).

    ── Luật khoá vào HÌNH DẠNG BỘ ĐỀ, không vào trạng thái dòng ────────────
    Bộ đề có trắc nghiệm ⇒ điểm của mục LÀ kết quả trắc nghiệm, và chỉ
    `course_verdict` được ghi nó. Bộ đề chỉ-có-viết ⇒ độ sạch bài viết đúng là
    kết quả duy nhất.

    Hỏi "dòng này đã có mastery chưa" thì đúng về nghĩa nhưng dựng một cuộc
    ĐUA: lượt nộp tự luận đọc dòng TRƯỚC khi gọi model chấm, rồi ghi SAU — và
    một lượt xét kết quả chạy xen vào giữa (hai tab) sẽ bị ghi đè y như cũ. Hình
    dạng bộ đề là nội dung tĩnh, đọc lúc nào cũng thế, nên không có cửa sổ nào
    để lọt (codex cục bộ 07/08).

    Nhận `has_mcq` chứ không nhận `bank_id`: nơi gọi nào cũng đã có sẵn hình
    dạng bộ đề (hoặc đọc theo lô), và một hàm thuần thì thử được mọi nhánh mà
    không cần dựng cơ sở dữ liệu.
    """
    if has_mcq:
        return None
    if not total:
        return None
    return round(int(clean or 0) / int(total) * 100, 1)


def _reconcile_chunk(item_ids: list[str], bank_of, stamp, db=None) -> None:
    """Vá MỘT LÔ mục mà bằng chứng nằm ở các phiên trắc nghiệm đã chốt.

    Ném thì cả lô này không vá gì — xem `_try`. Không trả về số đếm: `stamp`
    mới biết lượt ghi nào THỰC SỰ vào sổ (lệnh ghi luỹ đẳng có thể không đổi
    dòng nào), nên để nó đếm một mình.
    """
    runs: dict[str, list[dict]] = {}
    for r in _report_pages(
            "quiz_sessions",
            "id, kind, ended_at, class_assignment_item_id, "
            "total_questions, total_correct",
            lambda q: q.in_("class_assignment_item_id", item_ids)
                       .eq("ended_by", "completed"), db=db):
        # Chỉ lượt CHÍNH: phiên kiểm tra lại là mẫu nhỏ ngẫu nhiên, không phải
        # một chặng.
        if (r.get("kind") or "run") == "run" and r.get("ended_at"):
            runs.setdefault(r["class_assignment_item_id"], []).append(r)

    # Đây là chỗ N mục co xuống còn vài mục: không phiên nào chốt thì không có
    # gì để vá, và mọi lượt đọc tốn kém phía dưới đều khỏi phải chạy.
    cand = [i for i in item_ids if i in runs]
    if not cand:
        return

    # Câu đã trả lời, giữ THEO TỪNG PHIÊN — gộp thẳng thành một tập cho mỗi mục
    # thì mất thông tin cần để biết PHIÊN NÀO làm xong bài.
    sids = {r["id"] for i in cand for r in runs[i]}
    answered: dict[str, set[str]] = {}
    for c in _chunks(list(sids)):
        for a in _report_pages("quiz_attempts", "session_id, qid",
                               lambda q, c=c: q.in_("session_id", c), db=db):
            if a.get("qid") and a.get("session_id") in sids:
                answered.setdefault(a["session_id"], set()).add(a["qid"])

    shapes = _bank_shapes([b for b in {bank_of(i) for i in cand} if b], db)
    for item_id in cand:
        mcq_qids, writing = shapes.get(bank_of(item_id), (set(), 0))
        # Bộ đề còn phần viết mà không có dòng tự luận nào (mục này đã bị loại
        # khỏi nhóm kia) thì bài chưa xong, dù đã làm hết trắc nghiệm.
        if writing:
            continue
        done = _completing_session(runs[item_id], answered, mcq_qids)
        if not done:
            continue
        stamp(item_id, "quiz_session", done["id"], _at(done.get("ended_at")),
              round(int(done["total_correct"]) / int(done["total_questions"]) * 100, 1)
              if done.get("total_questions") else None)


def course_writing_state(
    *, user_id: str, bank_id: str, assignment_item_id: str | None = None,
) -> dict:
    """Phần tự luận của bank này: đề, và bản chấm nếu đã nộp.

    Trả cả `submitted` để trang biết hiện KHUNG VIẾT hay hiện BẢN CHẤM — trạng
    thái ấy do server giữ, không do localStorage: xoá bộ nhớ trình duyệt không
    được biến một lượt đã dùng thành một lượt mới.
    """
    # Đọc theo MỤC BÀI GIAO, không theo (bank, học viên): giao LẠI cùng bộ bài
    # là một lượt MỚI, và đọc theo bank sẽ lôi bài của lần giao trước ra rồi báo
    # "đã nộp" cho một bài chưa ai làm (codex #935).
    item = _assignment_item_for_review(bank_id, user_id, assignment_item_id)
    if assignment_item_id and not item:
        raise HTTPException(404, "Không tìm thấy bài đã nộp")
    attempt_no = course_section_attempt_no(item)
    _bank_meta_for_review_or_404(bank_id, user_id)
    try:
        qs = (supabase_admin.table("quiz_questions")
              .select("qid, prompt, explain, points, item_key, subtype, order")
              .eq("bank_id", bank_id).eq("type", "writing")
              .order("order").execute().data) or []
        all_rows = ((supabase_admin.table("course_writing_submissions")
                 .select("*").eq("class_assignment_item_id", item["id"])
                 .execute().data) or []) if item else []
        rows = _course_rows_for_attempt(all_rows, attempt_no)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đọc phần tự luận: {exc}")

    sub = rows[0] if rows else None
    # Bản nháp CHỈ đọc khi chưa nộp: nộp rồi thì nháp là rác, và rót nó ra màn
    # hình chỉ để một ngày nào đó nó đè lên bài đã chấm.
    draft = None
    if item and not sub:
        try:
            all_drafts = (supabase_admin.table("course_writing_drafts")
                 .select("answers, updated_at, attempt_no")
                 .eq("class_assignment_item_id", item["id"])
                 .execute().data) or []
            d = _course_rows_for_attempt(all_drafts, attempt_no)
            draft = d[0] if d else None
        except Exception as exc:  # noqa: BLE001
            # Nháp hỏng KHÔNG chặn học viên khỏi phần viết. Trang lấy bản trong
            # máy làm nguồn thật, nên "không đọc được bản dự phòng" và "chưa có
            # bản dự phòng" dẫn tới cùng một hành động — không cần cờ riêng.
            logger.warning("[quiz] đọc nháp tự luận hỏng item=%s: %s", item["id"], exc)
            draft = None
    return {
        # id MỤC BÀI GIAO — trang khoá bản nháp vào nó: giao lại cùng bộ bài là
        # một lượt MỚI, và nháp của lần trước không được rót vào lần này.
        "item_id": (item or {}).get("id"),
        "attempt_no": attempt_no,
        # Đề luôn trả — kể cả sau khi nộp, để học viên đọc lại đề bên cạnh bản
        # chấm. `explain` (đáp án mẫu) CHỈ trả sau khi đã nộp.
        "questions": [{
            "qid":      q["qid"],
            "prompt":   q.get("prompt"),
            "subtype":  q.get("subtype"),
            "points":   q.get("points"),
            "item_key": q.get("item_key"),
            **({"explain": q.get("explain")} if sub else {}),
        } for q in qs],
        # Dòng hỏng hoàn toàn KHÔNG phải "đã nộp": trang phải hiện lại KHUNG
        # VIẾT để em ấy bấm Nộp lần nữa.
        "submitted": bool(sub) and not _writing_row_is_broken(sub),
        "grader_failed": _writing_row_is_broken(sub),
        # Bản nháp máy chủ giữ. `None` = máy chủ chưa có gì (hoặc đọc hỏng), và
        # trang sẽ dùng bản trong trình duyệt rồi đẩy lên.
        # Bản DỰ PHÒNG. `None` = chưa có, hoặc không đọc được — trang xử lý hai
        # ca ấy giống nhau (dùng bản trong máy), nên không tách chúng ra.
        "draft": ({"answers": draft.get("answers") or {},
                   "updated_at": draft.get("updated_at")} if draft else None),
        "submission": ({
            "items":     sub.get("items"),
            "total":     sub.get("total"),
            "clean":     sub.get("clean"),
            "graded_at": sub.get("graded_at"),
        } if (sub and not _writing_row_is_broken(sub)) else None),
    }


def save_course_writing_draft(*, user_id: str, bank_id: str,
                              answers: dict,
                              assignment_item_id: str | None = None) -> dict:
    """Ghi bản nháp phần tự luận. Ghi đè bản cũ của CÙNG mục bài giao.

    Không phải một lần nộp: không chấm gì, không chốt gì, và gọi bao nhiêu lần
    cũng vô hại. Đây thuần là chỗ để bản nháp sống qua đổi máy và xoá bộ nhớ
    trình duyệt.

    ĐÃ NỘP thì từ chối: một lượt chấm duy nhất nghĩa là sau khi chấm, không còn
    gì để nháp — và ghi tiếp chỉ tạo ra một bản nháp mãi mãi không ai đọc, nằm
    cạnh bài đã chấm như thể còn sửa được.
    """
    _bank_meta_or_404(bank_id, user_id)
    item = (_assignment_item_for(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    ) if assignment_item_id else _assignment_item_for(bank_id, user_id))
    if not item:
        # Không có bài giao còn hiệu lực = không có chỗ để gắn bản nháp. Nói ra
        # thay vì ghi vào hư không.
        raise HTTPException(403, "Bài này không còn nhận bài nữa.")
    attempt_no = course_section_attempt_no(item)
    try:
        all_done = (supabase_admin.table("course_writing_submissions")
                    .select("id, items, attempt_no")
                    .eq("class_assignment_item_id", item["id"])
                    .execute().data) or []
        done = _course_rows_for_attempt(all_done, attempt_no)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi kiểm lượt nộp: {exc}")
    # Dòng hỏng hoàn toàn KHÔNG chặn lưu nháp: em ấy còn phải nộp lại, và chặn
    # ở đây là bắt gõ lại mọi thứ trong một tab duy nhất (codex #971).
    if done and not _writing_row_is_broken(done[0]):
        raise HTTPException(409, "Phần tự luận đã nộp rồi — không sửa được nữa.")

    # Chỉ giữ câu có nội dung, và cắt theo đúng trần của lượt nộp: một bản nháp
    # dài hơn thứ nộp được là một lời hứa suông.
    #
    # Tên biến KHÔNG dùng `clean`: đó là tên một CỘT của bảng bài-đã-chấm (số
    # câu không lỗi), và một cái tên mượn từ nơi khác là chỗ để hai khái niệm
    # trộn vào nhau lúc đọc lại.
    kept = {str(k): str(v)[:course_writing_grader.MAX_ANSWER_CHARS]
            for k, v in (answers or {}).items() if str(v or "").strip()}

    # Lượt ghi SAU CÙNG thắng. Không còn số thứ tự: bản trên máy chủ là DỰ
    # PHÒNG, còn nguồn thật nằm ở máy đang gõ — nên "bản cũ tới muộn" chỉ làm
    # bản dự phòng lùi lại một nhịp, không làm mất bài của ai.
    row = {
        "class_assignment_item_id": item["id"],
        "user_id": user_id,
        "bank_id": bank_id,
        "attempt_no": attempt_no,
        "answers": kept,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        supabase_admin.table("course_writing_drafts").upsert(
            row, on_conflict="class_assignment_item_id,attempt_no").execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi lưu nháp: {exc}")
    return {"saved": len(kept), "item_id": item["id"]}


def _writing_row_is_broken(sub) -> bool:
    """Dòng nộp này có phải một lượt bị MÁY CHỦ làm hỏng không?

    Mọi câu `ok=None` nghĩa là bộ chấm hỏng hoàn toàn — bài còn nguyên nhưng
    chưa ai chấm. Đó KHÔNG phải một lượt đã dùng.

    Ba nơi phải nói cùng một câu, nếu không đường chấm lại có mà không tới
    được: `course_writing_state` (trang khoá khung viết), `save_course_writing_
    draft` (chặn lưu nháp), và `submit_course_writing` (nhận chấm lại). Bản
    trước chỉ sửa nơi thứ ba, nên sau khi tải lại trang em ấy vẫn bị khoá
    (codex #971).
    """
    items = (sub or {}).get("items") or []
    return bool(items) and all(i.get("ok") is None for i in items)


async def submit_course_writing(*, user_id: str, bank_id: str,
                                answers: dict, duration_sec: int = 0,
                                assignment_item_id: str | None = None) -> dict:
    """Nộp CẢ CỤM tự luận, chấm một lượt, ghi một lần trong full attempt.

    MỘT LƯỢT DUY NHẤT TRONG MỖI FULL ATTEMPT. Ràng buộc thật nằm ở
    `UNIQUE (class_assignment_item_id, attempt_no)` của migration 230 — kiểm ở
    đây chỉ để trả về một câu đọc được thay vì lỗi 500 của cơ sở dữ liệu; hai
    lượt bấm song song thì lượt thua va khoá và cũng được kể lại đúng như vậy.

    ĐỦ CÂU MỚI NHẬN. Thiếu một câu là 422 kèm danh sách còn thiếu — trang giữ
    bản nháp và chờ, chứ không tiêu mất lượt chấm duy nhất cho một bài dở dang.
    """
    _bank_meta_or_404(bank_id, user_id)
    try:
        qs = (supabase_admin.table("quiz_questions")
              .select("qid, prompt, explain, order")
              .eq("bank_id", bank_id).eq("type", "writing")
              .order("order").execute().data) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đọc đề tự luận: {exc}")
    if not qs:
        raise HTTPException(404, "Bài tập này không có phần tự luận")

    answers = answers or {}
    missing = [q["qid"] for q in qs if not str(answers.get(q["qid"]) or "").strip()]
    if missing:
        raise HTTPException(422, {
            "message": f"Còn {len(missing)} câu chưa viết.",
            "missing": missing,
        })

    # TỪ CHỐI câu quá dài thay vì cắt rồi chấm phần đầu. Bộ chấm chỉ gửi đi
    # `_MAX_ANSWER_CHARS` ký tự, nhưng bản lưu và bản so sai→sửa lại dùng câu
    # ĐẦY ĐỦ — nên phần đuôi model chưa từng đọc sẽ hiện ra như bị xoá
    # (codex #935). Đây là bài viết LẠI MỘT CÂU, nên trần ấy rộng gấp nhiều lần
    # nhu cầu thật; vượt nó là dán nhầm, và nói ra tốt hơn im lặng chấm một nửa.
    _LIMIT = course_writing_grader.MAX_ANSWER_CHARS
    too_long = [q["qid"] for q in qs
                if len(str(answers.get(q["qid"]) or "").strip()) > _LIMIT]
    if too_long:
        raise HTTPException(422, {
            "message": f"Có {len(too_long)} câu dài quá {_LIMIT} ký tự. "
                       "Bài này viết lại MỘT câu — rút ngắn giúp nhé.",
            "too_long": too_long,
        })

    # PHẢI có mục bài giao. Bank giáo trình chỉ mở được qua bài giao, nên đây
    # luôn có ở luồng thật; đòi tường minh vì "một lượt" nay tính theo MỤC, và
    # một mục NULL sẽ lọt qua UNIQUE của Postgres (NULL không va nhau).
    item = (_assignment_item_for(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    ) if assignment_item_id else _assignment_item_for(bank_id, user_id))
    if not item:
        raise HTTPException(404, "Không tìm thấy bài giao còn hiệu lực")
    attempt_no = course_section_attempt_no(item)

    # Kiểm SỚM, trước khi tốn một lượt gọi model.
    try:
        all_submissions = (supabase_admin.table("course_writing_submissions")
                   .select("id, items, graded_at, attempt_no")
                   .eq("class_assignment_item_id", item["id"])
                   .execute().data) or []
        already = _course_rows_for_attempt(all_submissions, attempt_no)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi kiểm lượt nộp: {exc}")
    # Dòng cũ mà bộ chấm hỏng HOÀN TOÀN thì KHÔNG phải một lượt đã dùng — đó là
    # một lượt bị máy chủ làm hỏng. Cho chấm lại TẠI CHỖ, dùng lại đúng dòng ấy.
    retry_of = retry_stamp = None
    if already:
        if _writing_row_is_broken(already[0]):
            retry_of = already[0]["id"]
            # Mốc dùng để SO-VÀ-ĐỔI. Hai tab cùng bấm Nộp lại thì cả hai đều
            # qua được phép kiểm ở trên; không có mốc này thì cả hai cùng ghi và
            # bản chấm nào xong SAU sẽ đè lên bản trước, kèm một điểm khác trong
            # sổ lớp (codex #971).
            retry_stamp = already[0].get("graded_at")
        else:
            raise HTTPException(409, "Phần tự luận chỉ nộp được một lần.")

    # `explain` (đáp án mẫu) vào BẢN CHỤP luôn. Đọc nó từ đề hiện hành lúc hiện
    # kết quả thì đề soạn lại sẽ ghép bài cũ với đáp án mẫu của một đề khác, còn
    # đổi mã câu thì đáp án mẫu biến mất (codex #935).
    items = [{"qid": q["qid"], "prompt": q.get("prompt") or "",
              "explain": q.get("explain") or "",
              "answer": str(answers.get(q["qid"]) or "").strip()} for q in qs]
    graded, model_name = await course_writing_grader.grade(items)

    # ── CHẤM HỎNG HẾT THÌ KHÔNG TIÊU LƯỢT NỘP ───────────────────────────────
    #
    # Lượt nộp tự luận chỉ có MỘT. Bản trước ghi dòng dù mọi câu `ok=None`, nên
    # một lượt gọi model hỏng ăn mất lượt duy nhất của học viên và không đường
    # nào chấm lại. Ngày 06/08 model `gemini-2.5-flash-lite` bị ngừng cấp và TÁM
    # em mất lượt — phải chạy một kịch bản riêng mới trả lại được.
    #
    # Nay: không ghi gì, nói thẳng, và giữ nguyên bản nháp trên máy chủ để em ấy
    # bấm Nộp lại mà không phải gõ lại chữ nào.
    #
    # Chấm được dù CHỈ MỘT câu thì vẫn ghi: đó là một bản chấm thật, và bắt em
    # ấy nộp lại sẽ vứt luôn phần đã chấm được.
    if graded and all(g.get("ok") is None for g in graded):
        logger.error("[quiz] tự luận: bộ chấm hỏng hoàn toàn, KHÔNG ghi lượt nộp "
                     "item=%s model=%s", item["id"], model_name)
        raise HTTPException(503, {
            "message": "Bộ chấm đang không dùng được nên chưa chấm được bài của "
                       "em. Bài vẫn còn nguyên — bấm Nộp lại sau ít phút.",
            "grader_down": True,
        })

    row = {
        "bank_id": bank_id, "user_id": user_id,
        "class_assignment_item_id": item["id"],
        "attempt_no": attempt_no,
        "items": graded,
        "total": len(graded),
        "clean": sum(1 for g in graded if g.get("ok") is True),
        "model": model_name,
        "duration_sec": max(0, min(int(duration_sec or 0), 12 * 60 * 60)),
    }
    try:
        if retry_of:
            # Chấm lại một lượt máy chủ đã làm hỏng — dùng lại đúng dòng cũ, nên
            # ràng buộc "một lượt mỗi mục/attempt" (mig 230) không bị đụng tới.
            #
            # SO-VÀ-ĐỔI trên `graded_at`: chỉ ghi khi dòng vẫn đúng như lúc đọc.
            # Người ĐẦU thắng; người sau nhận 409 thay vì lặng lẽ đè lên.
            q = (supabase_admin.table("course_writing_submissions")
                 .update({**row, "graded_at": _now()})
                 .eq("id", retry_of))
            res = (q.eq("graded_at", retry_stamp) if retry_stamp
                   else q.is_("graded_at", "null")).execute()
            if not (res.data or []):
                raise HTTPException(409, "Bài đang được chấm lại ở nơi khác. "
                                         "Tải lại trang để xem kết quả.")
        else:
            res = supabase_admin.table("course_writing_submissions").insert(row).execute()
    except HTTPException:
        # Giữ nguyên lỗi nghiệp vụ của compare-and-swap. Nếu hai tab cùng chấm
        # lại một dòng hỏng, tab thua phải nhận 409 để tải lại kết quả của tab
        # thắng — không được bị khối bắt lỗi DB bên dưới đổi thành 500.
        raise
    except Exception as exc:  # noqa: BLE001
        # 23505 = va UNIQUE: hai tab cùng bấm Nộp. Đó là "đã nộp rồi", không
        # phải lỗi máy chủ — và bản chấm vừa tốn tiền gọi model thì bỏ, vì bản
        # ĐẦU TIÊN mới là bản thật.
        if "23505" in str(exc) or "duplicate key" in str(exc).lower():
            raise HTTPException(409, "Phần tự luận chỉ nộp được một lần.")
        raise HTTPException(500, f"Lỗi lưu bài tự luận: {exc}")

    saved = (res.data or [{}])[0]

    result = {
        "items":     graded,
        "total":     row["total"],
        "clean":     row["clean"],
        "graded_at": saved.get("graded_at"),
        "duration_sec": row["duration_sec"],
    }
    try:
        result["course"] = refresh_course_completion(
            user_id=user_id, bank_id=bank_id, item_id=item["id"],
            assignment_id=item.get("assignment_id"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] writing completion refresh failed item=%s: %s",
                       item.get("id"), exc)
        result["completion_pending"] = True
    return result


def bank_has_writing(bank_id: str | None, *, memo: dict | None = None) -> bool | None:
    """Bộ đề này có câu TỰ LUẬN không; ``None`` khi chưa đọc được.

    KHÔNG có cache dài hạn. Bộ nhập bài tập theo buổi cập nhật lại ĐÚNG
    `bank_id` rồi thay bộ câu hỏi, nên một giá trị nhớ từ trước re-import sẽ sai
    — và sai theo hai chiều đều tệ: nhớ "có" thì bài kẹt vĩnh viễn khi phần tự
    luận bị bỏ; nhớ "không" thì chốt sổ trước phần viết vừa thêm (codex cục bộ
    06/08). Bộ nhập chạy ở tiến trình khác nên không xoá cache hộ được.

    `memo` là chỗ nhớ trong MỘT lượt gọi — trang lớp hỏi cùng một bank cho nhiều
    mục, và một lượt đọc là đủ cho cả trang. Cả trạng thái ``None`` cũng được
    nhớ trong lượt ấy: một truy vấn hỏng không nên bị lặp lại cho từng học viên.
    """
    if not bank_id:
        return False
    if memo is not None and bank_id in memo:
        return memo[bank_id]
    try:
        has = bool((supabase_admin.table("quiz_questions").select("id", count="exact")
                    .eq("bank_id", bank_id).eq("type", "writing")
                    .limit(1).execute()).count or 0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] không đếm được câu tự luận bank=%s: %s — giữ "
                       "trạng thái CHƯA BIẾT", bank_id, exc)
        if memo is not None:
            memo[bank_id] = None
        return None
    if memo is not None:
        memo[bank_id] = has
    return has


_COURSE_SECTION_LABELS = {
    "quiz": "Trắc nghiệm",
    "writing": "Viết câu",
    "reading": "Đọc hiểu",
    "listening": "Nghe hiểu",
    "pronunciation": "Phát âm",
}


COURSE_WEIGHT_POLICY_HYBRID_QUESTION_COUNT_V1 = "hybrid_question_count_v1"
_COURSE_WEIGHT_EQUAL_SHARE = 0.5


def _normalize_course_weights(
    raw: dict[str, float], required: list[str],
) -> dict[str, float]:
    """Chuẩn hoá về đúng 100%, kể cả sau khi làm tròn từng phần."""
    total = sum(raw.values()) or 1
    normalized = {name: round(raw[name] / total * 100, 2)
                  for name in required}
    if required:
        last = required[-1]
        normalized[last] = round(
            normalized[last] + 100 - sum(normalized.values()), 2)
    return normalized


def course_section_weight_snapshot(
    *, questions: list[dict], meta: dict | None = None,
    pronunciation_sets: list[dict] | None = None,
) -> dict:
    """Chụp hình dạng bank và trọng số hybrid tại lúc GIAO bài.

    Một nửa trọng số chia đều theo kỹ năng, một nửa theo số đơn vị được giao.
    Nhờ vậy 90 câu trắc nghiệm có thêm bằng chứng thì nặng hơn 10 câu viết,
    nhưng không thể nuốt gần hết điểm tổng như phép chia thuần 90/142.

    Kết quả được lưu vào ``class_assignments.content_config``. Việc chụp lúc
    giao là một phần của hợp đồng chấm: re-import bank sau đó không được đổi
    luật dưới chân học viên, và revision 20 câu vẫn dùng số câu của đề gốc.
    """
    meta = meta if isinstance(meta, dict) else {}
    pronunciation_sets = pronunciation_sets or []
    counts: dict[str, int] = {}

    quiz_n = sum(1 for row in questions if _is_course_quiz_question(row))
    writing_n = sum(1 for row in questions if row.get("type") == "writing")
    if quiz_n:
        counts["quiz"] = quiz_n
    if writing_n:
        counts["writing"] = writing_n

    reading = meta.get("short_reading")
    reading_answers = (reading.get("answers")
                       if isinstance(reading, dict) else None)
    if isinstance(reading_answers, list) and reading_answers:
        counts["reading"] = len(reading_answers)

    listening = meta.get("short_listening")
    solution = listening.get("solution") if isinstance(listening, dict) else None
    listening_answers = (solution.get("answers")
                         if isinstance(solution, dict) else None)
    if isinstance(listening_answers, list) and listening_answers:
        counts["listening"] = len(listening_answers)

    if pronunciation_sets:
        sentences = pronunciation_sets[0].get("sentences")
        if not isinstance(sentences, list) or not sentences:
            raise ValueError("Bộ phát âm đang bật nhưng chưa có câu mẫu.")
        counts["pronunciation"] = len(sentences)

    required = list(counts)
    if not required:
        raise ValueError("Bộ bài tập chưa có nội dung có thể chấm.")
    total_units = sum(counts.values())
    section_share = 1 / len(required)
    raw = {
        name: (_COURSE_WEIGHT_EQUAL_SHARE * section_share
               + (1 - _COURSE_WEIGHT_EQUAL_SHARE)
               * counts[name] / total_units)
        for name in required
    }
    return {
        "weight_policy": COURSE_WEIGHT_POLICY_HYBRID_QUESTION_COUNT_V1,
        "section_counts": counts,
        "section_weights": _normalize_course_weights(raw, required),
    }


def _snapshotted_course_sections(assignment: dict | None) -> list[str] | None:
    """Các phần đã được giao; ``None`` nghĩa là assignment legacy dùng bank live."""
    cfg = (assignment or {}).get("content_config") or {}
    if cfg.get("weight_policy") != COURSE_WEIGHT_POLICY_HYBRID_QUESTION_COUNT_V1:
        return None
    counts = cfg.get("section_counts")
    if not isinstance(counts, dict) or not counts:
        raise HTTPException(500, "Bài giao thiếu bản chụp cấu trúc tính điểm.")
    unknown = set(counts) - set(_COURSE_SECTION_LABELS)
    valid = []
    for name in _COURSE_SECTION_LABELS:
        if name not in counts:
            continue
        try:
            amount = float(counts[name])
        except (TypeError, ValueError):
            amount = 0
        if amount <= 0:
            raise HTTPException(500, "Bản chụp cấu trúc tính điểm không hợp lệ.")
        valid.append(name)
    if unknown or not valid:
        raise HTTPException(500, "Bản chụp cấu trúc tính điểm không hợp lệ.")
    return valid


def _course_section_weights(assignment: dict, required: list[str]) -> dict[str, float]:
    """Đọc trọng số đã chụp; bài legacy vắng cấu hình giữ phép chia đều cũ."""
    configured = ((assignment.get("content_config") or {}).get("section_weights")
                  if assignment else None)
    configured = configured if isinstance(configured, dict) else {}
    raw: dict[str, float] = {}
    valid_override = bool(configured) and all(name in configured for name in required)
    for name in required:
        try:
            value = float(configured.get(name)) if valid_override else 1
        except (TypeError, ValueError):
            valid_override = False
            break
        if not 0 < value <= 100:
            valid_override = False
            break
        raw[name] = value
    if not valid_override:
        if _snapshotted_course_sections(assignment) is not None:
            # Assignment policy mới luôn có một bản chụp đầy đủ. Rơi về chia
            # đều ở đây sẽ âm thầm đổi luật chấm, chính điều snapshot phải chặn.
            raise HTTPException(500, "Bài giao thiếu bản chụp trọng số hợp lệ.")
        raw = {name: 1 for name in required}
    return _normalize_course_weights(raw, required)


def _course_live_required_sections(bank_id: str) -> list[str]:
    """Required sections for legacy assignments that predate shape snapshots."""
    try:
        bank_rows = (supabase_admin.table("quiz_banks").select("meta")
                     .eq("id", bank_id).limit(1).execute().data) or []
        questions = (supabase_admin.table("quiz_questions")
                     .select("id, type, counts_toward_mastery")
                     .eq("bank_id", bank_id).limit(2000).execute().data) or []
        pronunciation_sets = (supabase_admin.table("course_pronunciation_sets")
                              .select("id").eq("bank_id", bank_id)
                              .eq("is_active", True).limit(1).execute().data) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đọc cấu trúc bài tập: {exc}") from exc

    meta = (bank_rows[0].get("meta") or {}) if bank_rows else {}
    required: list[str] = []
    if any(_is_course_quiz_question(q) for q in questions):
        required.append("quiz")
    if any(q.get("type") == "writing" for q in questions):
        required.append("writing")
    reading = meta.get("short_reading")
    if (isinstance(reading, dict) and isinstance(reading.get("answers"), list)
            and reading.get("answers")):
        required.append("reading")
    listening = meta.get("short_listening")
    solution = listening.get("solution") if isinstance(listening, dict) else None
    if (isinstance(solution, dict) and isinstance(solution.get("answers"), list)
            and solution.get("answers")):
        required.append("listening")
    if pronunciation_sets:
        required.append("pronunciation")
    return required


def course_required_sections(
    assignment: dict | None, bank_id: str | None = None,
) -> list[str]:
    """Một mẫu số phần bắt buộc dùng chung cho mọi mặt admin.

    Bài mới giữ snapshot trong ``content_config``. Bài cũ trước snapshot phải
    đọc hình dạng bank hiện tại; nếu tally dùng ``[]`` còn attempt-report dùng
    bank thật thì hai tab sẽ cho hai mẫu số khác nhau về cùng một bài.
    """
    snap = _snapshotted_course_sections(assignment)
    if snap:
        return snap
    resolved_bank_id = bank_id or (assignment or {}).get("content_id")
    return _course_live_required_sections(resolved_bank_id) if resolved_bank_id else []


def begin_course_full_retry(
    *, user_id: str, bank_id: str, assignment_item_id: str | None = None,
) -> dict:
    """Mở lượt full mới mà không xoá bất kỳ submission hay ledger cũ nào."""
    for _cas in range(3):
        item = _assignment_item_for(
            bank_id, user_id, assignment_item_id=assignment_item_id,
        )
        if not item:
            raise HTTPException(404, "Không tìm thấy bài giao còn hiệu lực")
        if item.get("passed_at"):
            raise HTTPException(409, "Bài này đã đạt, không cần mở lượt làm lại.")

        mastery = dict(item.get("mastery") or {})
        cfg = mastery_config(item)
        attempts = list(mastery.get("attempts") or [])
        if not attempts or _recorded_next_action(attempts[-1], int(
                cfg["pass_pct"])) != "retry_full":
            raise HTTPException(409, "Kết quả hiện tại chưa yêu cầu làm lại toàn bài.")

        current_no = course_section_attempt_no(item)
        if mastery.get("section_attempt_pending") is True:
            return {"ok": True, "item_id": item["id"],
                    "attempt_no": current_no, "already_started": True}

        next_no = current_no + 1
        now = _now()
        next_mastery = {
            **mastery,
            "active_section_attempt_no": next_no,
            "section_attempt_pending": True,
            "section_attempt_started_at": now,
        }
        try:
            query = (supabase_admin.table("class_assignment_items")
                     .update({"mastery": next_mastery, "updated_at": now})
                     .eq("id", item["id"]))
            if item.get("updated_at") is not None:
                query = query.eq("updated_at", item["updated_at"])
            changed = query.execute().data or []
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Không mở được lượt làm lại: {exc}") from exc
        if changed:
            return {"ok": True, "item_id": item["id"],
                    "attempt_no": next_no, "already_started": False}
    raise HTTPException(409, "Lượt làm lại đang được mở ở nơi khác; hãy thử lại.")


def _course_completion_evidence(
    *, bank_id: str, item_id: str, user_id: str, attempt: dict | None,
    assignment: dict | None = None, attempt_no: int = 1,
) -> tuple[list[str], dict[str, dict], dict[str, str | None]]:
    """Đọc hình dạng đề và kết quả canonical của từng phần cho đúng item."""
    # Assignment mới dùng hình dạng đã chụp tại lúc giao. Chỉ assignment legacy
    # mới tiếp tục đọc live shape để giữ nguyên contract trước policy này.
    required = course_required_sections(assignment, bank_id)

    results: dict[str, dict] = {}
    artifacts: dict[str, str | None] = {"quiz": None, "writing": None}
    quiz = ((attempt or {}).get("sections") or {}).get("quiz")
    if isinstance(quiz, dict) and quiz.get("completed"):
        results["quiz"] = dict(quiz)
        artifacts["quiz"] = next(iter((attempt or {}).get("sessions") or []), None)

    try:
        all_writing_rows = (supabase_admin.table("course_writing_submissions")
                            .select("id, total, clean, duration_sec, graded_at, attempt_no")
                            .eq("class_assignment_item_id", item_id)
                            .execute().data) or []
        writing_rows = _course_rows_for_attempt(all_writing_rows, attempt_no)
        all_section_rows = (supabase_admin.table("course_section_submissions")
                            .select("section, total, correct, score, duration_sec, "
                                    "submitted_at, attempt_no")
                            .eq("class_assignment_item_id", item_id).execute().data) or []
        section_rows = _course_rows_for_attempt(all_section_rows, attempt_no)
        all_pronunciation_rows = (supabase_admin.table("course_pronunciation_submissions")
                              .select("id, pronunciation_score, duration_sec, graded_at, "
                                      "created_at, attempt_no")
                              .eq("class_assignment_item_id", item_id)
                              .eq("status", "completed")
                              .order("created_at", desc=True)
                              .execute().data) or []
        pronunciation_rows = _course_rows_for_attempt(
            all_pronunciation_rows, attempt_no,
        )[:1]
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đọc kết quả các phần: {exc}")

    if writing_rows:
        row = writing_rows[0]
        total = int(row.get("total") or 0)
        clean = int(row.get("clean") or 0)
        if total:
            writing_pct = course_hand_in_score(
                has_mcq=False, clean=clean, total=total)
            results["writing"] = {
                "completed": True, "correct": clean, "total": total,
                "pct": writing_pct,
                "duration_sec": int(row.get("duration_sec") or 0),
                "completed_at": row.get("graded_at"),
            }
            artifacts["writing"] = row.get("id")
    for row in section_rows:
        name = row.get("section")
        if name in {"reading", "listening"}:
            results[name] = {
                "completed": True,
                "correct": int(row.get("correct") or 0),
                "total": int(row.get("total") or 0),
                "pct": round(float(row.get("score") or 0), 1),
                "duration_sec": int(row.get("duration_sec") or 0),
                "completed_at": row.get("submitted_at"),
            }
    if pronunciation_rows and pronunciation_rows[0].get("pronunciation_score") is not None:
        row = pronunciation_rows[0]
        results["pronunciation"] = {
            "completed": True, "correct": None, "total": None,
            "pct": round(float(row.get("pronunciation_score")), 1),
            "duration_sec": int(row.get("duration_sec") or 0),
            "completed_at": row.get("graded_at"),
        }
    return required, results, artifacts


def _course_completion_payload(
    *, attempt: dict, attempts: list[dict], cfg: dict, required: list[str],
    results: dict[str, dict], weights: dict[str, float], passed_before: bool = False,
) -> dict:
    sections = [{
        "key": name,
        "label": _COURSE_SECTION_LABELS[name],
        "required": True,
        "completed": name in results,
        "pct": (results.get(name) or {}).get("pct"),
        "correct": (results.get(name) or {}).get("correct"),
        "total": (results.get(name) or {}).get("total"),
        "duration_sec": int((results.get(name) or {}).get("duration_sec") or 0),
        "weight": weights.get(name),
        "carried": (results.get(name) or {}).get("carried") is True,
    } for name in required]
    complete = bool(required) and all(row["completed"] for row in sections)
    pct = attempt.get("pct") if complete else None
    passed = bool(passed_before or (complete and attempt.get("next_action") == "passed"))
    return {
        "completed": complete,
        "passed": passed if complete else None,
        "pct": float(pct) if pct is not None else None,
        "threshold": cfg["pass_pct"],
        "near_threshold": near_pass_pct(cfg["pass_pct"]),
        "next_action": ("passed" if passed_before else attempt.get("next_action")) if complete else None,
        "phase": attempt.get("phase") or "run",
        "retake_size": cfg["retake_size"],
        "retakes": sum(1 for row in attempts if row.get("phase") == "retake"),
        "remaining": [row["key"] for row in sections if not row["completed"]],
        "sections": sections,
        "duration_sec": int(attempt.get("duration_sec") or 0),
        "history": _course_attempt_history(attempts, cfg["pass_pct"]),
    }


def refresh_course_completion(
    *, user_id: str, bank_id: str, item_id: str,
    assignment_id: str | None = None,
) -> dict:
    """Cập nhật checklist; chỉ kết luận và thu bài khi mọi phần đã hoàn thành."""
    for _cas in range(3):
        try:
            item_rows = (supabase_admin.table("class_assignment_items")
                         .select("id, assignment_id, passed_at, submitted_at, score, mastery, updated_at")
                         .eq("id", item_id).limit(1).execute().data) or []
            if not item_rows:
                raise HTTPException(404, "Không tìm thấy mục bài giao")
            item = item_rows[0]
            resolved_assignment_id = item.get("assignment_id") or assignment_id
            if not resolved_assignment_id:
                raise HTTPException(500, "Mục bài giao thiếu assignment_id")
            assignment_rows = (supabase_admin.table("class_assignments")
                               .select("id, content_config")
                               .eq("id", resolved_assignment_id).limit(1)
                               .execute().data) or []
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Lỗi đọc sổ hoàn thành: {exc}")

        assignment = assignment_rows[0] if assignment_rows else {}
        cfg = mastery_config(assignment)
        mastery = dict(item.get("mastery") or {})
        attempts = list(mastery.get("attempts") or [])
        attempt_no = course_section_attempt_no(item)
        attempt = attempts[-1] if attempts else None
        if (mastery.get("section_attempt_pending") is True
                and (not attempt or int(attempt.get("attempt_no") or 0) != attempt_no)):
            attempt = None
        required, results, artifacts = _course_completion_evidence(
            bank_id=bank_id, item_id=item_id, user_id=user_id, attempt=attempt,
            assignment=assignment, attempt_no=attempt_no,
        )
        if not attempt:
            # Bank không có trắc nghiệm vẫn cần một lượt hợp nhất. Bank có quiz
            # phải chờ verdict server-side tạo section quiz trước.
            if "quiz" in required:
                attempt = {"phase": "run", "sessions": [], "sections": {},
                           "attempt_no": attempt_no, "completed": False,
                           "pct": None, "at": None}
                return _course_completion_payload(
                    attempt=attempt, attempts=attempts, cfg=cfg, required=required,
                    results=results, weights=_course_section_weights(assignment, required),
                )
            attempt = {"phase": "run", "sessions": [], "sections": {},
                       "attempt_no": attempt_no, "completed": False,
                       "pct": None, "at": None}
            attempts.append(attempt)

        # Một lượt đã chốt là lịch sử bất biến. Gọi lại do retry mạng chỉ đọc
        # kết quả ấy, không thay điểm bằng submission phát âm mới hơn.
        if attempt.get("completed") is True and attempt.get("pct") is not None:
            snap = attempt.get("sections") or {}
            return _course_completion_payload(
                attempt=attempt, attempts=attempts, cfg=cfg, required=required,
                results=snap, weights={k: float((v or {}).get("weight") or 0)
                                       for k, v in snap.items()},
                passed_before=bool(item.get("passed_at")),
            )

        weights = _course_section_weights(assignment, required)
        snapshot: dict[str, dict] = {}
        for name in required:
            if name in results:
                snapshot[name] = {**results[name], "weight": weights[name]}
        complete = bool(required) and all(name in snapshot for name in required)
        attempt["sections"] = snapshot
        attempt["completed"] = complete
        if complete:
            pct = round(sum(float(snapshot[name]["pct"]) * weights[name] / 100
                            for name in required), 1)
            attempt["pct"] = pct
            attempt["at"] = _now()
            attempt["duration_sec"] = sum(int(snapshot[name].get("duration_sec") or 0)
                                          for name in required)
            attempt["next_action"] = mastery_next_action(pct, cfg["pass_pct"])
        else:
            attempt["pct"] = None
            attempt["at"] = None
            attempt["duration_sec"] = sum(int(v.get("duration_sec") or 0)
                                          for v in snapshot.values())
            attempt.pop("next_action", None)

        next_mastery = {**mastery, "threshold": cfg["pass_pct"], "attempts": attempts}
        if complete:
            next_mastery["section_attempt_pending"] = False
        patch = {
            "mastery": next_mastery,
            "updated_at": _now(),
        }
        already_passed = bool(item.get("passed_at"))
        if complete and not already_passed:
            patch["score"] = attempt["pct"]
            if attempt["next_action"] == "passed":
                patch["passed_at"] = attempt["at"]
        try:
            q = (supabase_admin.table("class_assignment_items")
                 .update(patch).eq("id", item_id))
            if item.get("updated_at") is not None:
                q = q.eq("updated_at", item["updated_at"])
            changed = q.execute().data or []
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Lỗi ghi sổ hoàn thành: {exc}")
        if not changed:
            continue

        passed = already_passed or (complete and attempt.get("next_action") == "passed")
        if passed and not item.get("submitted_at"):
            artifact_id = artifacts.get("quiz") or artifacts.get("writing")
            artifact_kind = "quiz_session" if artifacts.get("quiz") else "course_writing"
            if not artifact_id or not mark_item_submitted(
                supabase_admin, item_id=item_id, artifact_kind=artifact_kind,
                artifact_id=artifact_id, score=float(attempt["pct"]),
            ):
                # Phân biệt no-op do một request song song đã chốt với lỗi ghi.
                check = (supabase_admin.table("class_assignment_items")
                         .select("submitted_at").eq("id", item_id).limit(1)
                         .execute().data) or []
                if not check or not check[0].get("submitted_at"):
                    raise HTTPException(500, "Đã tính điểm nhưng chưa thu được bài; hãy thử lại")
        return _course_completion_payload(
            attempt=attempt, attempts=attempts, cfg=cfg, required=required,
            results=snapshot, weights=weights, passed_before=already_passed,
        )
    raise HTTPException(500, "Sổ hoàn thành đang bị ghi tranh chấp — thử lại")


def course_verdict(
    *, user_id: str, bank_id: str, session_ids: list[str],
    assignment_item_id: str | None = None,
) -> dict:
    """Xét ĐẠT/CHƯA ĐẠT bài tập buổi từ chính các phiên server đang giữ.

    Client chỉ NÊU TÊN các phiên của lượt vừa làm (10 phiên chặng, hoặc 1 phiên
    kiểm tra lại); điểm cộng từ những dòng server đã ghi, không nhận tổng do
    client tự khai. Suy lượt từ khảo cổ toàn bộ phiên của em ấy thì học viên xoá
    localStorage làm lại là mẫu số phình gấp đôi — nêu tên tường minh né hẳn.

    Kết luận GHI THẲNG vào class_assignment_items (passed_at + sổ mastery):
    giáo viên đọc một cột, không đoán từ bảng phiên.

    RANH GIỚI TIN CẬY (ghi nhận từ codex #928, chưa xử trong tầng này): toàn bộ
    hệ quiz phát ĐỀ KÈM ĐÁP ÁN xuống client — phản hồi tức thì từng câu là yêu
    cầu sản phẩm, nên một client script có thể nộp answer_given chép từ chính
    payload đề và qua cổng này. Cổng thuộc bài vì thế chặn được khai-man-tổng-số
    và mọi đường gian lận "rẻ", KHÔNG chặn được client tự động hoá có chủ đích;
    muốn chặn nốt phải đổi hợp đồng phát đề (giấu đáp án + chấm từng câu phía
    server) cho cả engine quiz — một thay đổi sản phẩm, không phải một bản vá.
    Giáo viên vẫn thấy tín hiệu bất thường qua duration_sec/response_time_ms.

    Mỗi lần ghi sổ kèm `bank_rev` (vân tay qid:answer của đề TẠI THỜI ĐIỂM xét):
    pass là sự kiện lịch sử — re-import đề không thu hồi pass cũ, nhưng vân tay
    cho phép trả lời "em ấy đạt trên bản đề nào" khi cần kiểm toán. Đổi đề ở
    mức thay ruột thì tạo bank mới, đừng ghi đè bank cũ.
    """
    if not session_ids or len(session_ids) > 40:
        raise HTTPException(422, "session_ids phải có 1–40 phiên")

    item = (_assignment_item_for(
        bank_id, user_id, assignment_item_id=assignment_item_id,
    ) if assignment_item_id else _assignment_item_for(bank_id, user_id))
    if not item:
        raise HTTPException(404, "Không tìm thấy bài giao còn hiệu lực")

    try:
        asg = (supabase_admin.table("class_assignments")
               .select("id, content_config")
               .eq("id", item["assignment_id"]).limit(1).execute().data) or []
        assignment = asg[0] if asg else {}
        cfg = mastery_config(assignment)

        rows = (supabase_admin.table("quiz_sessions")
                .select("id, user_id, bank_id, class_assignment_item_id, kind, ended_by, "
                        "created_at, duration_sec")
                .in_("id", session_ids).execute().data) or []

        cur = (supabase_admin.table("class_assignment_items")
               .select("id, passed_at, submitted_at, mastery, score, updated_at")
               .eq("id", item["id"]).limit(1).execute().data) or []

        # Đề GỐC — thước để server tự chấm lại. Câu tự luận không chấm máy nên
        # đứng ngoài thước.
        qrows = (supabase_admin.table("quiz_questions")
                 .select("qid, answer, type, counts_toward_mastery")
                 .eq("bank_id", bank_id).limit(2000).execute().data) or []

        # Lượt làm ĐÃ LƯU của các phiên được nêu tên. Phân trang tường minh:
        # PostgREST cắt 1000 dòng im lặng (lớp lỗi tái diễn — xem bộ nhớ dự án),
        # và một lịch sử làm-lại dài hoàn toàn có thể vượt.
        att, off = [], 0
        while True:
            page = (supabase_admin.table("quiz_attempts")
                    .select("session_id, qid, answer_given, created_at")
                    .in_("session_id", session_ids)
                    .range(off, off + 999).execute()).data or []
            att.extend(page)
            if len(page) < 1000:
                break
            off += 1000
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đọc dữ liệu xét đạt: {exc}")
    if not cur:
        raise HTTPException(404, "Không tìm thấy mục bài giao")
    cur = cur[0]

    # TỪNG phiên phải là của đúng người, đúng bank, đúng mục, và ĐÃ chốt.
    # Thiếu một phiên (id lạ, của người khác) → từ chối cả lượt chứ không xét
    # phần còn lại: mẫu số thiếu làm điểm ẢO cao lên.
    if len(rows) != len(set(session_ids)):
        raise HTTPException(422, "Có phiên không tồn tại")
    for s in rows:
        if (s.get("user_id") != user_id or s.get("bank_id") != bank_id
                or s.get("class_assignment_item_id") != item["id"]):
            raise HTTPException(422, "Có phiên không thuộc lượt làm này")
        if s.get("ended_by") != "completed":
            raise HTTPException(422, "Có phiên chưa hoàn thành")

    kinds = {s.get("kind") or "run" for s in rows}
    if len(kinds) > 1:
        raise HTTPException(422, "Không trộn phiên chặng với phiên kiểm tra lại")
    phase = kinds.pop()
    if phase == "retake" and len(rows) != 1:
        # Một bài kiểm tra lại là MỘT phiên. Cho ghép nhiều phiên dở dang thì
        # hợp-các-mảnh vẫn đủ cỡ mẫu và vượt được rào "đủ N câu" (codex R3).
        raise HTTPException(422, "Bài kiểm tra lại phải là đúng một phiên")

    # ── Server TỰ CHẤM LẠI, không tin sổ của client ──────────────────────────
    # `total_correct` trên phiên là con số client khai lúc kết phiên; một client
    # sửa được payload sẽ khai 100% và mua một kết luận đạt vĩnh viễn. Thước
    # thật là: đáp án ĐÃ LƯU (answer_given, ghi theo vị trí gốc) so với đáp án
    # trong đề. is_correct trong attempts cũng là lời client — bỏ qua nốt.
    key = {q["qid"]: q for q in qrows
           if q.get("qid") and _is_course_quiz_question(q)
           and q.get("answer") is not None}
    known_non_quiz = {q["qid"] for q in qrows
                      if q.get("qid") and q.get("type") != "writing"
                      and not _is_course_quiz_question(q)}
    if not key:
        raise HTTPException(422, "Bộ đề không có câu trắc nghiệm nào")
    # Vân tay đề tại thời điểm xét — thứ tự độc lập (sort theo qid) vì nó phục
    # vụ kiểm toán, không cần khớp vân tay phía runner.
    bank_rev = hashlib.sha256("|".join(
        f"{qid}:{q.get('answer')}" for qid, q in sorted(key.items())
    ).encode()).hexdigest()[:12]

    # Một câu có thể xuất hiện HAI LẦN khi em ấy làm lại một chặng — chuyện
    # thường, không phải dấu gian lận. Bản trước bác cả lượt, và một học viên
    # làm đủ 9 chặng bị chặn khỏi kết quả của chính mình: em Lê Ngọc Hà Linh có
    # 10 phiên chốt cho 9 chặng vì chặng 3 làm hai lần.
    #
    # Nay giữ LƯỢT ĐẦU của mỗi câu, đúng luật `course_answer_report` đã dùng
    # ("lần em ấy thật sự nghĩ"). Client KHÔNG chọn được lượt nào thắng: thứ tự
    # do dấu thời gian trên máy chủ quyết, nên nộp thêm phiên chỉ có thể kéo về
    # lượt SỚM HƠN, không bao giờ về lượt điểm cao hơn.
    seen: dict = {}
    for a in sorted(att, key=lambda x: x.get("created_at") or ""):
        qid = a.get("qid")
        if qid not in key:
            # Một số phiên production đã bị client cũ nhét câu bổ trợ của CHÍNH
            # bank vào lane Grammar. Chúng không được tính điểm, nhưng cũng không
            # được làm hỏng 90 câu Grammar hợp lệ đã lưu. Qid thật sự xa lạ vẫn
            # bị bác để client không thể tự co mẫu số.
            if qid in known_non_quiz:
                continue
            raise HTTPException(422, "Có lượt làm không thuộc bộ đề này")
        if qid in seen:
            continue
        seen[qid] = a

    # ── Phủ ĐỦ đề — chặn cả gian lận lẫn dương tính giả ─────────────────────
    # Lượt chính phải trả lời ĐỦ MỌI câu trắc nghiệm của bộ: client chỉ nêu tên
    # các phiên điểm cao (bỏ chặng làm kém, hay chặng rớt mạng lúc chốt) thì mẫu
    # số co lại và điểm ẢO cao lên. Kiểm tra lại thì phải đủ cỡ mẫu đã cấu hình
    # (kẹp theo kho — kho 15 câu thì mẫu 15 là đủ).
    if phase == "run":
        missing = len(set(key) - set(seen))
        if missing:
            raise HTTPException(
                422, f"Lượt làm thiếu {missing} câu chưa có kết quả trên hệ thống")
    else:
        need = min(cfg["retake_size"], len(key))
        if len(seen) < need:
            raise HTTPException(
                422, f"Bài kiểm tra lại phải đủ {need} câu (mới có {len(seen)})")

    graded = len(seen)
    correct = sum(1 for qid, a in seen.items()
                  if grade_attempt(a.get("answer_given"), key[qid].get("answer")) is True)
    pct = round(correct / graded * 100, 1)
    quiz_result = {
        "completed": True,
        "correct": correct,
        "total": graded,
        "pct": pct,
        "duration_sec": sum(max(0, int(s.get("duration_sec") or 0)) for s in rows),
    }

    sess_key = sorted(set(session_ids))
    # Ghi sổ bằng CAS trên updated_at: đọc-gộp-ghi không khoá thì hai tab cùng
    # chốt (mỗi tab một retake) sẽ đè sổ của nhau — mất một kết quả thật khỏi
    # mắt giáo viên (codex R3). Patch tự đặt updated_at mới; kẻ thua vòng ghi
    # thấy 0 dòng khớp, đọc lại sổ mới rồi gộp lại. Ba vòng là quá đủ cho một
    # người dùng thật; hết vòng vẫn thua → 500, không báo đạt miệng.
    for _cas in range(3):
        mastery = cur.get("mastery") or {}
        attempts = list(mastery.get("attempts") or [])
        attempt_no = course_section_attempt_no({"mastery": mastery})
        existing_attempt = next(
            (a for a in attempts
             if a.get("phase") == phase and a.get("sessions") == sess_key),
            None,
        )

        if (existing_attempt and existing_attempt.get("completed") is True
                and existing_attempt.get("pct") is not None):
            required, evidence, artifacts = _course_completion_evidence(
                bank_id=bank_id, item_id=item["id"], user_id=user_id,
                attempt=existing_attempt, assignment=assignment,
                attempt_no=int(existing_attempt.get("attempt_no") or attempt_no),
            )
            weights = {name: float(((existing_attempt.get("sections") or {})
                                    .get(name) or {}).get("weight") or 0)
                       for name in required}
            multi_section = len(required) > 1
            final_attempt = existing_attempt
            break

        # Retake 20 câu chỉ dành cho trạng thái GẦN ĐẠT của lượt NGAY TRƯỚC.
        # Một lượt dưới near-threshold phải làm lại toàn bộ bank; cho nó tự tạo
        # retake sẽ biến đường ngắn thành lối tắt qua luật mới.
        # Nộp lại đúng cùng session (F5/mạng retry) là luỹ đẳng: bản ghi
        # của chính nó đang là dòng cuối, không thể dùng nó làm "lượt
        # trước" rồi tự bác lần gọi lại.
        if phase == "retake" and existing_attempt is None:
            prior_action = _recorded_next_action(
                attempts[-1] if attempts else None, cfg["pass_pct"])
            if prior_action != "retake":
                raise HTTPException(
                    422, "Chỉ được kiểm tra lại sau một lượt gần đạt — "
                         "lượt này cần làm lại toàn bộ bài.")

        # Tải lại trang ở màn kết quả sẽ gọi xét lại CÙNG một lượt — sổ không
        # được phình theo số lần bấm. So với TOÀN sổ chứ không chỉ dòng cuối:
        # sau một lần kiểm tra lại trượt, F5 khôi phục về màn kết quả lượt
        # chính và nộp lại đúng bộ phiên cũ — dòng cuối lúc ấy là retake, so
        # mỗi dòng cuối thì lượt chính bị ghi trùng (codex R2).
        # Sau ``retry_full``, các phiên cũ không được tái sử dụng để lách
        # yêu cầu làm lại toàn bài. Mốc này phải sống qua một full rerun
        # gần đạt; nếu chỉ nhìn action CUỐI (`retake`) thì reload sẽ kéo
        # lượt fail cũ trở lại. UI lọc để khôi phục đúng, server lọc để
        # client cũ/giả mạo không thể trộn session.
        if phase == "run" and existing_attempt is None and attempts:
            boundary = _full_retry_boundary(attempts, cfg["pass_pct"])
            if boundary:
                created = [_at(s.get("created_at")) for s in rows]
                if boundary and any(at is None or at <= boundary for at in created):
                    raise HTTPException(
                        422, "Lượt dưới mức gần đạt phải làm lại toàn bộ "
                             "bằng các phiên mới.")

        candidate = dict(existing_attempt) if existing_attempt else {
            "phase": phase, "sessions": sess_key,
        }
        candidate["attempt_no"] = attempt_no
        candidate["sections"] = {**(candidate.get("sections") or {}),
                                 "quiz": quiz_result}
        required, evidence, artifacts = _course_completion_evidence(
            bank_id=bank_id, item_id=item["id"], user_id=user_id,
            attempt=candidate, assignment=assignment, attempt_no=attempt_no,
        )
        if (phase == "run" and existing_attempt is None and attempts
                and len(required) > 1
                and _recorded_next_action(attempts[-1], cfg["pass_pct"]) == "retry_full"
                and mastery.get("section_attempt_pending") is not True):
            raise HTTPException(
                409, "Hãy mở lượt làm lại mới trước khi nộp full session.",
            )
        if (phase == "run" and existing_attempt is None and len(required) > 1
                and mastery.get("section_attempt_pending") is True):
            started_at = _at(mastery.get("section_attempt_started_at"))
            created = [_at(s.get("created_at")) for s in rows]
            if started_at and any(at is None or at <= started_at for at in created):
                raise HTTPException(
                    422, "Lượt làm lại chỉ nhận các phiên được mở sau khi bắt đầu lượt mới.",
                )
        weights = _course_section_weights(assignment, required)
        snapshot = {name: {**evidence[name], "weight": weights[name]}
                    for name in required if name in evidence}
        if phase == "retake" and existing_attempt is None and attempts:
            # Revision quiz dùng lại kết quả các phần của cùng full attempt. Điểm vẫn tham gia
            # aggregate, nhưng thời gian ấy đã thuộc lượt trước và không được
            # cộng lần hai vào lịch sử/tổng thời gian của admin.
            for name in required:
                if name == "quiz" or name not in snapshot:
                    continue
                if any(name in (old.get("sections") or {}) for old in attempts):
                    snapshot[name] = {**snapshot[name], "carried": True,
                                      "duration_sec": 0}
        complete = bool(required) and all(name in snapshot for name in required)
        combined_pct = (round(sum(float(snapshot[name]["pct"]) * weights[name] / 100
                                  for name in required), 1)
                        if complete else None)

        # Giữ nguyên contract lịch sử của bank chỉ có quiz. Cổng nhiều phần chỉ
        # mở khi bank thật sự có hơn một dạng; không viết lại hàng nghìn ledger
        # quiz cũ chỉ để thêm một wrapper section không mang thêm thông tin.
        multi_section = len(required) > 1
        if multi_section:
            candidate["sections"] = snapshot
            candidate["completed"] = complete
            candidate["pct"] = combined_pct
            candidate["at"] = _now() if complete else None
            candidate["duration_sec"] = sum(int(v.get("duration_sec") or 0)
                                            for v in snapshot.values())
            if complete:
                candidate["next_action"] = mastery_next_action(
                    combined_pct, cfg["pass_pct"])
            else:
                candidate.pop("next_action", None)
        else:
            candidate = {
                "phase": phase, "pct": pct, "at": (existing_attempt or {}).get("at") or _now(),
                "sessions": sess_key,
                "next_action": mastery_next_action(pct, cfg["pass_pct"]),
            }

        if existing_attempt is None:
            attempts.append(candidate)
        else:
            index = attempts.index(existing_attempt)
            # F5 cùng một lượt single-section là no-op tuyệt đối.
            if not multi_section and existing_attempt.get("pct") == pct:
                final_attempt = existing_attempt
                break
            if multi_section and candidate == existing_attempt:
                final_attempt = existing_attempt
                break
            attempts[index] = candidate
        final_attempt = candidate
        next_mastery = {**mastery, "threshold": cfg["pass_pct"],
                        "bank_rev": bank_rev, "attempts": attempts}
        if complete:
            next_mastery["section_attempt_pending"] = False
        patch: dict = {
            "mastery": next_mastery,
            "updated_at": _now(),
        }
        already = bool(cur.get("passed_at"))
        if complete and not already:
            patch["score"] = combined_pct
            if candidate.get("next_action") == "passed":
                patch["passed_at"] = candidate.get("at")
        try:
            q = (supabase_admin.table("class_assignment_items")
                 .update(patch).eq("id", item["id"]))
            if cur.get("updated_at") is not None:
                q = q.eq("updated_at", cur["updated_at"])
            res = q.execute()
        except Exception as exc:  # noqa: BLE001
            # Kết luận mà không ghi được thì KHÔNG được báo đạt — học viên sẽ
            # rời trang với niềm tin đã xong trong khi giáo viên không thấy gì.
            raise HTTPException(500, f"Lỗi ghi kết luận: {exc}")
        if res.data:
            break
        try:
            fresh = (supabase_admin.table("class_assignment_items")
                     .select("id, passed_at, submitted_at, mastery, score, updated_at")
                     .eq("id", item["id"]).limit(1).execute().data) or []
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Lỗi đọc lại sổ sau tranh chấp ghi: {exc}")
        if not fresh:
            raise HTTPException(404, "Không tìm thấy mục bài giao")
        cur = fresh[0]
    else:
        raise HTTPException(500, "Sổ bài giao đang bị ghi tranh chấp — thử lại")

    payload = _course_completion_payload(
        attempt=final_attempt, attempts=attempts, cfg=cfg,
        required=required, results=(final_attempt.get("sections") or evidence),
        weights=weights, passed_before=bool(cur.get("passed_at")),
    )
    # Bank nhiều phần chỉ được thu khi điểm gộp đã đạt. Bank quiz-only giữ
    # nguyên đường chốt cũ để tránh thay đổi contract ngoài phạm vi task.
    if multi_section and payload.get("passed") and not cur.get("submitted_at"):
        artifact_id = artifacts.get("quiz")
        marked = bool(artifact_id) and mark_item_submitted(
            supabase_admin, item_id=item["id"], artifact_kind="quiz_session",
            artifact_id=artifact_id, score=payload.get("pct"),
        )
        if not marked:
            # `passed_at` và `submitted_at` là hai ghi riêng. Nếu lượt trước đã
            # ghi điểm nhưng mạng rớt trước bước thu bài, retry phải tự chữa
            # trạng thái ấy thay vì trả `passed=true` trong khi admin vẫn thấy
            # bài chưa nộp. Một request song song có thể đã thu trước, nên đọc
            # canonical state trước khi kết luận lỗi.
            try:
                check = (supabase_admin.table("class_assignment_items")
                         .select("submitted_at").eq("id", item["id"]).limit(1)
                         .execute().data) or []
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(
                    500, f"Đã đạt nhưng chưa xác nhận được trạng thái thu bài: {exc}")
            if not check or not check[0].get("submitted_at"):
                raise HTTPException(500, "Đã tính điểm nhưng chưa thu được bài; hãy thử lại")
    return payload


# ── Analytics (Pha 5a) ───────────────────────────────────────────────

# Hai giới hạn KHÁC NHAU và cần cả hai: `_REPORT_PAGE` chặn số dòng trả về
# (PostgREST cắt ở 1000 và không báo gì), `_REPORT_IDS` chặn số id gửi đi trong
# `in.(...)` — một lớp làm bài mỗi ngày tích đủ phiên để chuỗi truy vấn thành
# hàng chục KB rồi mặt đọc 500 thay vì hiện được gì.
# Quá ngưỡng này trên MỘT câu trắc nghiệm thì gần như chắc chắn học viên đã rời
# máy, không phải đang nghĩ. Xem ghi chú ở `course_answer_report.totals`.
IDLE_CUTOFF_SEC = 180

_REPORT_PAGE = 1000
_REPORT_IDS = 100


def _report_pages(table: str, cols: str, shape, *, order: str = "id", db=None):
    """Đọc hết bảng theo trang. Trả về danh sách đầy đủ.

    `db` để nơi gọi chỉ ra ĐÚNG client nó đang dùng. Mặc định lấy client toàn
    cục của module này — nhưng một hàm nhận `db` để GHI mà lại ĐỌC bằng client
    toàn cục thì hai nửa của cùng một việc chạy trên hai kết nối, và một chốt
    thử patch client của router sẽ lặng lẽ gọi ra Supabase thật (codex vòng 5).

    `range()` KHÔNG ĐI MỘT MÌNH được: không có `ORDER BY` thì Postgres không hứa
    hẹn gì về thứ tự giữa hai truy vấn, nên trang thứ hai không neo vào trang
    thứ nhất — dòng bị lặp hoặc bị bỏ, và báo cáo vẫn trông đầy đủ. Một lớp 30
    em × 100 câu vượt 1000 dòng dễ dàng (codex PR 945).
    """
    out: list[dict] = []
    start = 0
    while True:
        rows = (shape((db or supabase_admin).table(table).select(cols))
                .order(order)
                .range(start, start + _REPORT_PAGE - 1).execute().data) or []
        out.extend(rows)
        if len(rows) < _REPORT_PAGE:
            return out
        start += _REPORT_PAGE


def _course_review_gate(
    bank_id: str, user_id: str, assignment_item_id: str | None = None,
) -> dict | None:
    """None = cho xem. Ngược lại trả phần thân nói VÌ SAO chưa cho.

    Đọc hỏng thì CHO XEM: đây là màn ôn tập, và chặn một em đã đạt khỏi bài của
    chính em ấy vì một lượt đọc phụ trợ là cái giá đắt hơn. Rủi ro ngược lại chỉ
    xảy ra khi cơ sở dữ liệu đang lỗi, và lúc ấy em ấy cũng không làm bài được.
    """
    item = _assignment_item_for_review(bank_id, user_id, assignment_item_id)
    if not item:
        return None          # không phải bài giao theo lớp: giữ nguyên như cũ
    try:
        row = (supabase_admin.table("class_assignment_items")
               .select("passed_at").eq("id", item["id"]).limit(1).execute().data) or []
        if row and row[0].get("passed_at"):
            return None
        asg = (supabase_admin.table("class_assignments")
               .select("id, content_config")
               .eq("id", item["assignment_id"]).limit(1).execute().data) or []
        threshold = mastery_config(asg[0] if asg else None)["pass_pct"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] review gate read failed bank=%s: %s", bank_id, exc)
        return None
    return {"locked": True, "threshold": threshold}


def course_answer_report(*, user_id: str, bank_id: str,
                         assignment_id: str | None = None,
                         assignment_item_id: str | None = None) -> dict:
    """Bài làm CHI TIẾT của một học viên: câu nào đúng, câu nào sai, em chọn gì,
    đáp án là gì, và vì sao phương án em chọn sai.

    Dùng chung cho HAI mặt đọc — của học viên (xem lại bài mình) và của giáo
    viên (xem bài một em). Một bộ dựng cho hai nơi, vì hai bộ dựng cho cùng một
    nội dung là hai chỗ để trôi khỏi nhau.

    Chỉ lấy lượt làm của lượt CHÍNH (`kind='run'`) thuộc đúng bài giao: phiên
    kiểm tra lại bốc mẫu ngẫu nhiên và trộn đáp án, trộn nó vào đây thì cùng một
    câu hiện hai lần với hai chỉ số phương án khác nhau.

    Với mỗi câu chỉ giữ lượt làm ĐẦU TIÊN. Học viên chỉ trả lời được một lần mỗi
    câu trong một chặng, nhưng làm lại chặng (đóng tab giữa chừng) sinh ra lượt
    thứ hai — và cái giáo viên muốn đọc là lần em ấy thật sự nghĩ.
    """
    out: dict = {"questions": [], "totals": {}, "history": [], "summary": {},
                 "stale": False}
    threshold = PASS_PCT_DEFAULT

    # ── CỔNG HAI MỨC ────────────────────────────────────────────────────────
    #
    # Màn này trả về HAI thứ khác hẳn nhau về mức nhạy cảm:
    #
    #   · TRỤC YẾU  — "em sai 6/8 câu ở trục chia động từ". Không lộ đáp án nào,
    #     và đây đúng là thứ giúp em ấy ôn cho kỳ kiểm tra lại.
    #   · TỪNG CÂU  — đề bài, em chọn gì, ĐÁP ÁN ĐÚNG là gì, lời giải, dọn sẵn
    #     thành một bảng đọc trong ba giây.
    #
    # ĐỪNG NHẦM ĐÂY LÀ MỘT CỔNG BẢO MẬT. Đường phát đề (`/api/quiz/banks/{id}`)
    # gửi `select("*")`, nên `answer` + `explain` + `why_wrong` của MỌI câu trắc
    # nghiệm đã nằm trong tab Network TỪ LÚC em ấy mở bài — đó là cái giá của
    # việc chấm ngay tại trang để phản hồi từng câu. Chỗ này chỉ bỏ đi con đường
    # TIỆN, không bỏ được con đường CÓ. Muốn chặn thật thì phải chấm phía máy
    # chủ và chỉ phát đáp án của đúng câu vừa trả lời (việc riêng, lớn hơn).
    #
    # Nên chưa đạt thì mở mức một, khoá mức hai. Bản trước khoá cả hai, và đánh
    # đổi ấy sai chiều: em CHƯA đạt mới là em cần biết mình yếu chỗ nào nhất.
    #
    # Cắt ở ĐÂY, không phải ở trang: giấu bằng CSS thì mở tab Network là đọc
    # được, và lượt viết chỉ có MỘT.
    #
    # Ngưỡng do giáo viên đặt (`mastery_config`), không phải hằng số ở đây.
    # Chỉ áp cho đường của HỌC VIÊN — giáo viên chấm bài, không làm bài.
    locked = (_course_review_gate(bank_id, user_id, assignment_item_id)
              if not assignment_id else None)

    # Phiên thuộc đúng bài giao. Không nêu bài giao thì lấy mục còn hiệu lực của
    # chính em ấy — đường của học viên tự xem lại bài mình.
    #
    # NÊU bài giao = đường của GIÁO VIÊN, và đường ấy KHÔNG đi qua cổng học
    # viên: cổng ấy đòi bài còn mở và còn hạn, nên mở "Bài từng em" cho một bài
    # đã quá hạn hay đã đóng sẽ nhận 404 — đúng lúc giáo viên cần đọc nhất
    # (codex cục bộ 06/08). Quyền đã kiểm ở tầng tuyến (require_admin).
    bank = ({} if assignment_id else _bank_meta_for_review_or_404(bank_id, user_id))
    if assignment_id:
        try:
            rows = (supabase_admin.table("quiz_banks").select("id, title")
                    .eq("id", bank_id).limit(1).execute().data) or []
            assignment_rows = (supabase_admin.table("class_assignments")
                               .select("id, content_config").eq("id", assignment_id)
                               .limit(1).execute().data) or []
            if assignment_rows:
                threshold = mastery_config(assignment_rows[0])["pass_pct"]
        except Exception as exc:  # noqa: BLE001
            # Chỉ mất TÊN bộ đề, không mất bài làm — nhưng vẫn phải nói ra:
            # mọi lượt đọc hỏng đều bật cờ, không có ngoại lệ "lỗi nhẹ".
            logger.warning("[quiz] answer-report bank failed: %s", exc)
            out["stale"] = True
            rows = []
        bank = rows[0] if rows else {}

    item_ids: set[str] = set()
    item_rows: list[dict] = []
    try:
        if assignment_id:
            item_rows = _report_pages(
                "class_assignment_items", "id, student_id",
                lambda q: q.eq("assignment_id", assignment_id))
            item_ids = {i["id"] for i in item_rows}
        else:
            it = _assignment_item_for_review(bank_id, user_id, assignment_item_id)
            item_ids = {it["id"]} if it else set()
            if item_ids:
                item_rows = [{"id": next(iter(item_ids)), "student_id": None}]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] answer-report items failed: %s", exc)
        out["stale"] = True
        return out
    if not item_ids:
        return out

    try:
        sessions = _report_pages(
            "quiz_sessions",
            "id, user_id, kind, class_assignment_item_id, duration_sec, ended_at",
            lambda q: q.eq("bank_id", bank_id).eq("user_id", user_id))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] answer-report sessions failed: %s", exc)
        out["stale"] = True
        return out
    owned_sessions = [x for x in sessions
                      if x.get("class_assignment_item_id") in item_ids]

    # Session rows are operational history and may include abandoned work. The
    # mastery ledger is the canonical list of GRADED full runs/revisions, so the
    # learner summary comes from that ledger and only uses sessions to identify
    # the exact assignment item represented by this report.
    progress_ids = {x.get("class_assignment_item_id") for x in owned_sessions
                    if x.get("class_assignment_item_id")}
    if not progress_ids and not assignment_id:
        progress_ids = set(item_ids)
    if not progress_ids and assignment_id:
        # Bank chỉ-có-Writing không tạo quiz_session, nên session không thể chỉ
        # ra item của học viên. Nối user → student → item thay vì trả summary rỗng.
        try:
            student_rows = _report_pages(
                "students", "id", lambda q: q.eq("user_id", user_id))
            target_student_ids = {row["id"] for row in student_rows if row.get("id")}
            progress_ids = {x["id"] for x in item_rows
                            if x.get("student_id") in target_student_ids}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] answer-report learner item failed: %s", exc)
            out["stale"] = True
    progress = None
    if progress_ids:
        try:
            progress_rows = _report_pages(
                "class_assignment_items", "id, mastery",
                lambda q: q.in_("id", list(progress_ids)))
            progress = next((x for x in progress_rows if x.get("mastery")), None)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] answer-report history item failed: %s", exc)
            out["stale"] = True
    mastery = (progress or {}).get("mastery") or {}
    try:
        threshold = int(mastery.get("threshold")
                        or ((locked or {}).get("threshold") if locked else 0)
                        or threshold)
        out["history"] = _course_attempt_history(
            mastery.get("attempts") or [], threshold)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] answer-report history failed: %s", exc)
        out["stale"] = True

    completed_history = [row for row in out["history"]
                         if row.get("completed") and row.get("pct") is not None]
    latest = completed_history[-1] if completed_history else None
    # Dựng kết luận TRƯỚC các return của đường quiz. Writing-only vẫn có mastery
    # history và quyết định đạt/fail dù hoàn toàn không có quiz_session.
    out["summary"] = {
        "pass_pct": threshold,
        "near_pass_pct": near_pass_pct(threshold),
        "latest_pct": latest.get("pct") if latest else None,
        "latest_action": latest.get("next_action") if latest else None,
        "latest_attempt_number": latest.get("number") if latest else None,
        "latest_sections": latest.get("sections") if latest else [],
        "baseline_quiz_pct": None,
        "baseline_correct": 0,
        "baseline_answered": 0,
    }

    sessions = [x for x in owned_sessions if (x.get("kind") or "run") == "run"]
    if not sessions:
        return out
    sids = [x["id"] for x in sessions]

    attempts: list[dict] = []
    for i in range(0, len(sids), _REPORT_IDS):
        try:
            attempts += _report_pages(
                "quiz_attempts",
                "session_id, qid, is_correct, answer_given, response_time_ms, created_at",
                lambda q, c=sids[i:i + _REPORT_IDS]: q.in_("session_id", c))
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] answer-report attempts failed: %s", exc)
            out["stale"] = True

    first: dict[str, dict] = {}
    for a in sorted(attempts, key=lambda x: x.get("created_at") or ""):
        if a.get("qid") and a["qid"] not in first:
            first[a["qid"]] = a
    if not first:
        return out

    try:
        qs_rows = _report_pages(
            "quiz_questions",
            "qid, type, subtype, prompt, options, answer, explain, why_wrong, "
            "item_key, counts_toward_mastery, order",
            lambda q: q.eq("bank_id", bank_id), order="order")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] answer-report questions failed: %s", exc)
        out["stale"] = True
        return out

    rows = []
    for q in qs_rows:
        a = first.get(q.get("qid"))
        if not a or not _is_course_quiz_question(q):
            continue
        opts = q.get("options") or []
        # `answer_given` là CHỈ SỐ phương án, lưu dạng chuỗi. Đổi về số để tra
        # nhãn; không đổi được thì giữ nguyên chuỗi cho người đọc tự xoay xở.
        try:
            picked = int(a.get("answer_given"))
        except (TypeError, ValueError):
            picked = None
        correct = q.get("answer") if isinstance(q.get("answer"), int) else None
        # CHẤM LẠI từ `answer_given` so với đáp án của đề, không tin cờ
        # `is_correct` do CLIENT gửi lên (`log_progress` nhận nguyên cờ ấy).
        # `course_verdict` đã tự chấm lại từ lâu vì đúng lý do này; báo cáo tin
        # cờ client thì một payload sửa tay biến câu sai thành câu đúng, giấu
        # luôn đáp án thật, và làm hỏng cả bảng của giáo viên (codex PR 952).
        #
        # Không so được (đề không phải trắc nghiệm, hoặc thiếu đáp án) thì mới
        # dùng cờ đã lưu — thà giữ nguyên còn hơn kết luận bừa.
        graded_ok = grade_attempt(a.get("answer_given"), correct)
        ok = bool(a.get("is_correct")) if graded_ok is None else graded_ok
        rows.append({
            "qid":       q.get("qid"),
            "item_key":  q.get("item_key"),
            "subtype":   q.get("subtype"),
            "prompt":    q.get("prompt"),
            "options":   opts,
            "picked":    picked,
            "picked_text": opts[picked] if (picked is not None and 0 <= picked < len(opts)) else None,
            "answer":    correct,
            "answer_text": opts[correct] if (correct is not None and 0 <= correct < len(opts)) else None,
            "is_correct": ok,
            # Vì sao phương án EM CHỌN sai — thứ có ích hơn hẳn lời giải chung.
            "why_wrong": ((q.get("why_wrong") or {}).get(str(picked))
                          if picked is not None and not ok else None),
            "explain":   q.get("explain"),
            "seconds":   (round(a["response_time_ms"] / 1000, 1)
                          if isinstance(a.get("response_time_ms"), (int, float))
                          and a["response_time_ms"] > 0 else None),
        })

    times = [r["seconds"] for r in rows if r["seconds"] is not None]
    times.sort()
    # Từ LƯỢT ĐẦU của mỗi câu — cùng tập với `rows` và với bảng lớp. Đếm mọi
    # lượt thì một chặng làm lại được tính hai lần, và `active_sec`/`idle_sec`
    # lệch khỏi chính trung vị ngay bên cạnh nó (codex PR 952).
    secs = [(a.get("response_time_ms") or 0) / 1000 for a in first.values()]
    if locked:
        # Giữ ĐÚNG những gì cần để gom trục, bỏ hết phần lộ đáp án. Danh sách
        # trường được viết THẲNG ra, không phải xoá bớt khoá: thêm một trường
        # mới ở trên mà quên xoá ở đây thì nó tự động lọt ra ngoài.
        # ĐÚNG BA trường, đủ để gom trục và không hơn. `subtype` từng nằm đây
        # nhưng hợp đồng chỉ hứa trục + đúng/sai + thời gian, và một trường thừa
        # trong danh sách giữ-lại là một trường không ai xét.
        rows = [{"item_key": r["item_key"], "is_correct": r["is_correct"],
                 "seconds": r["seconds"]}
                for r in rows]
        out["locked"] = True
        out["threshold"] = locked["threshold"]
    out["questions"] = rows
    out["totals"] = {
        "answered": len(rows),
        "correct":  sum(1 for r in rows if r["is_correct"]),
        # Trung vị, không phải trung bình: một câu bỏ dở 20 phút kéo trung bình
        # đi xa khỏi mọi câu thật.
        "median_sec": times[len(times) // 2] if times else None,
        "active_sec": round(sum(min(x, IDLE_CUTOFF_SEC) for x in secs)),
        # RỜI MÁY (ƯỚC LƯỢNG), không phải một con số đo được.
        #
        # `response_time_ms` là khoảng từ lúc câu hiện ra tới lúc bấm trả lời —
        # nó GỘP cả suy nghĩ lẫn đi pha trà, và dữ liệu không tách được hai thứ.
        # Hiệu "đồng hồ treo tường trừ thời gian trả lời" cũng không dùng được:
        # nó luôn ÂM vì thời gian trả lời đã bao trùm.
        #
        # Nên ước lượng bằng phần VƯỢT NGƯỠNG. Đo trên bank C1-B01 (277 lượt):
        # trung vị 17s, p95 98s, p99 213s, dài nhất 29 phút. Ngưỡng 180s cắt
        # đúng 1,4% số lượt nhưng chúng chiếm 18% tổng thời gian — tức là đúng
        # cái đuôi cần tách, không phải một lát cắt tuỳ tiện.
        "idle_sec":   round(sum(max(0.0, x - IDLE_CUTOFF_SEC) for x in secs)),
        "idle_cutoff_sec": IDLE_CUTOFF_SEC,
        "bank_title": bank.get("title"),
        "scope": "baseline_quiz",
    }
    baseline_pct = (round(out["totals"]["correct"] / out["totals"]["answered"] * 100, 1)
                    if out["totals"]["answered"] else None)
    out["summary"] = {**out["summary"],
        "baseline_quiz_pct": baseline_pct,
        "baseline_correct": out["totals"]["correct"],
        "baseline_answered": out["totals"]["answered"],
    }
    return out


def _course_stage_count(bank_id: str) -> tuple[int, int, bool]:
    """(số CHẶNG, số câu TỰ LUẬN, đọc-được-hay-không) của một bộ đề theo buổi.

    Chặng = số câu trắc nghiệm chia 10, làm tròn lên. Cần con số này mới nói
    được "xong": không có nó thì một em làm 1/10 chặng rồi dừng vẫn đọc thành
    đã hoàn thành.

    Số câu tự luận cần cho một chuyện khác: chúng nằm NGOÀI vòng chặng, nên xong
    hết chặng vẫn CHƯA phải xong bài. Không tách ra thì một em xong 9 chặng rồi
    dừng trước phần viết trông y hệt một em đã hoàn thành — và đó đúng là điều
    đã xảy ra với em Phương Anh Nguyễn.
    """
    mcq_qids, writing, ok = _course_bank_shape(bank_id)
    if not ok:
        # Không đếm được thì trả 0, và `0` được đọc là "chưa biết": nhánh gọi
        # KHÔNG bao giờ kết luận "xong" khi chưa biết cần bao nhiêu chặng.
        # `_course_bank_shape` đã log lỗi và trả cờ đọc-được để mặt admin bật
        # `stale`, thay vì diễn giải dữ liệu thiếu như một con số thật.
        return 0, 0, False
    return -(-len(mcq_qids) // 10), writing, True


def course_attempt_report(*, bank_id: str, assignment_id: str) -> dict:
    """Học viên làm bài tập theo buổi TRONG BAO LÂU, và vướng ở đâu.

    Ba câu hỏi của giáo viên mà tới nay không mặt đọc nào trả lời được:

      · em ấy ngồi bao lâu?            → `minutes` (cộng các chặng đã chốt)
      · em ấy đang đứng ở đâu?         → `stages_done` + `state`
      · cả lớp vướng chỗ nào?          → `axes` (trục sai nhiều nhất)

    `state` phân biệt BA chuyện mà cho tới nay bị gộp thành "chưa nộp":
      'done'      xong hết các chặng
      'doing'     đang làm dở — có phiên chưa chốt CÓ BÀI
      'stalled'   mở bài rồi bỏ, không đụng tới nữa quá 24 giờ
      'untouched' chưa mở bài lần nào

    Thời gian LẤY TỪ `duration_sec` của phiên đã chốt, không phải hiệu
    `ended_at - started_at` của cả lượt: học viên đóng tab rồi mở lại hôm sau
    thì hiệu ấy là "một ngày rưỡi", một con số đúng về đồng hồ và vô nghĩa về
    việc học.

    Báo cáo neo vào MỘT BÀI GIAO, không phải vào bank: cùng một bộ đề giao được
    cho nhiều lớp, nên đọc theo bank sẽ trộn lượt làm của lớp khác vào cả bảng
    lẫn trục vướng — và bỏ sót đúng những em ĐƯỢC GIAO mà chưa mở bài lần nào,
    tức là bỏ sót đúng điều bảng này sinh ra để nói (codex PR 945).
    """
    # `stale` = có ít nhất một lượt đọc hỏng, nên các con số dưới đây CÓ THỂ
    # thiếu. Im lặng ở đây là vẽ ra một báo cáo trông bình thường mà sai: lượt
    # đang làm dở đọc thành "chưa mở", và trục vướng biến mất sạch.
    out: dict = {"students": [], "axes": [], "bank_id": bank_id,
                 "stages_total": 0, "writing_total": 0, "stale": False,
                 "idle_cutoff_sec": IDLE_CUTOFF_SEC}

    assignment: dict = {}
    required_sections: list[str] = []
    try:
        assignment_rows = (supabase_admin.table("class_assignments")
                           .select("id, content_config").eq("id", assignment_id)
                           .limit(1).execute().data) or []
        assignment = assignment_rows[0] if assignment_rows else {}
        required_sections = course_required_sections(assignment, bank_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] attempt-report assignment shape failed asg=%s: %s",
                       assignment_id, exc)
        out["stale"] = True

    # Sổ người nhận của CHÍNH bài giao này = danh sách học viên của báo cáo.
    try:
        items = _report_pages(
            "class_assignment_items", "id, student_id, passed_at, score, mastery",
            lambda q: q.eq("assignment_id", assignment_id),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] attempt-report items failed asg=%s: %s", assignment_id, exc)
        out["stale"] = True
        return out
    item_ids = {i["id"] for i in items}
    item_of_student = {i["student_id"]: i["id"] for i in items if i.get("student_id")}
    item_row_of_student = {i["student_id"]: i for i in items if i.get("student_id")}
    if not item_ids:
        return out

    # student_id → user_id. Phiên ghi theo TÀI KHOẢN, sổ ghi theo HỌC VIÊN, nên
    # phải có cầu nối — nhưng danh tính của một DÒNG là học viên, không phải tài
    # khoản: em chưa kích hoạt có `user_id` NULL và vẫn phải có một dòng.
    sids = [i["student_id"] for i in items if i.get("student_id")]
    roster: dict[str, str | None] = {sid: None for sid in sids}
    for i in range(0, len(sids), _REPORT_IDS):
        try:
            for st in _report_pages(
                "students", "id, user_id",
                lambda q, c=sids[i:i + _REPORT_IDS]: q.in_("id", c),
            ):
                roster[st["id"]] = st.get("user_id")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] attempt-report roster failed: %s", exc)
            out["stale"] = True

    out["stages_total"], out["writing_total"], _count_ok = _course_stage_count(bank_id)
    if not _count_ok:
        out["stale"] = True

    # Ai ĐÃ NỘP phần tự luận. Đọc theo MỤC BÀI GIAO, không theo (bank, học
    # viên): giao lại cùng bộ bài là một lượt khác (mig 192).
    submitted_writing: set[str] = set()
    if out["writing_total"]:
        try:
            for w in _report_pages(
                "course_writing_submissions", "id, class_assignment_item_id",
                lambda q: q.eq("bank_id", bank_id),
            ):
                if w.get("class_assignment_item_id") in item_ids:
                    submitted_writing.add(w["class_assignment_item_id"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] attempt-report writing failed: %s", exc)
            out["stale"] = True

    try:
        sessions = _report_pages(
            "quiz_sessions",
            "id, user_id, ended_at, started_at, duration_sec, total_questions, "
            "total_correct, accuracy, kind, class_assignment_item_id",
            lambda q: q.eq("bank_id", bank_id),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] attempt-report sessions failed bank=%s: %s", bank_id, exc)
        out["stale"] = True
        sessions = []

    sessions = [x for x in sessions if (x.get("kind") or "run") == "run"]
    # Chỉ phiên thuộc ĐÚNG bài giao này. Phiên không gắn mục nào là phiên tự
    # luyện, cũng không thuộc về bảng này.
    sessions = [x for x in sessions if x.get("class_assignment_item_id") in item_ids]

    by_user: dict[str, list[dict]] = {}
    for x in sessions:
        if x.get("user_id"):
            by_user.setdefault(x["user_id"], []).append(x)

    # Phiên nào CÓ BÀI — phân biệt "đang làm dở" với "bấm vào rồi thoát ngay".
    # Tải lại trang từng đẻ ra hàng loạt phiên rỗng; đếm chúng là đang-làm-dở
    # sẽ báo cả lớp đang dở dang trong khi không ai đụng vào bài.
    open_ids = [x["id"] for x in sessions if not x.get("ended_at")]
    with_work: set[str] = set()
    slow: dict[str, list[int]] = {}
    wrong: dict[str, int] = {}
    attempted: dict[str, int] = {}
    students_by_axis: dict[str, set[str]] = {}
    affected_by_axis: dict[str, set[str]] = {}
    # Thời gian theo TỪNG HỌC VIÊN, để bảng lớp nói được "em nào chậm bất
    # thường" mà không phải mở từng báo cáo một.
    per_user_secs: dict[str, list[float]] = {}
    seen_q: set = set()
    first_by_user: dict[str, list[dict]] = {}
    sess_user = {x["id"]: x.get("user_id") for x in sessions}
    # THU hết trước, XỬ LÝ sau. Sắp trong từng lô là sai: `seen_q` dùng chung
    # cho mọi lô, nên một lượt MỚI hơn ở lô đầu chặn mất lượt CŨ hơn ở lô sau —
    # và bảng lớp cho ra con số khác báo cáo từng em (codex cục bộ 06/08).
    all_rows: list[dict] = []
    for i in range(0, len(sessions), _REPORT_IDS):
        ids = [x["id"] for x in sessions[i:i + _REPORT_IDS]]
        try:
            all_rows += _report_pages(
                "quiz_attempts",
                # `answer_given` PHẢI có mặt: `_ok()` đọc nó để tự chấm lại, và
                # thiếu nó thì mọi lượt rơi về cờ client — bản vá thành vô hiệu
                # mà không có gì đỏ (codex cục bộ 06/08).
                "session_id, item_key, qid, is_correct, answer_given, "
                "response_time_ms, created_at",
                lambda q, c=ids: q.in_("session_id", c),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[quiz] attempt-report attempts failed: %s", exc)
            out["stale"] = True

    # Đáp án GỐC của đề, để tự chấm lại — cùng lý do như `course_answer_report`.
    key_of: dict[str, int] = {}
    axis_of: dict[str, str] = {}
    try:
        for q in _report_pages(
                "quiz_questions",
                "qid, answer, type, item_key, counts_toward_mastery",
                               lambda q2: q2.eq("bank_id", bank_id)):
            if not _is_course_quiz_question(q):
                continue
            if isinstance(q.get("answer"), int):
                key_of[q["qid"]] = q["answer"]
            if q.get("item_key"):
                axis_of[q["qid"]] = q["item_key"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] attempt-report answers failed: %s", exc)
        out["stale"] = True

    def _ok(a: dict) -> bool:
        """Đúng/sai TÍNH LẠI từ `answer_given`, không tin cờ client gửi.

        Dùng CHUNG `grade_attempt` với lượt xét và báo cáo cá nhân — ba nơi này
        từng chấm ba kiểu và cho ba con số cho cùng một lượt làm.
        """
        got = grade_attempt(a.get("answer_given"), key_of.get(a.get("qid")))
        return bool(a.get("is_correct")) if got is None else got

    all_rows.sort(key=lambda x: x.get("created_at") or "")
    for a in all_rows:
        if a["session_id"] in open_ids:
            with_work.add(a["session_id"])
        uid = sess_user.get(a["session_id"])
        if a.get("qid") not in key_of:
            # Attempts của section bổ trợ từng lọt qua runner cũ không phải bằng
            # chứng Grammar và không được làm phình số câu/tỷ lệ sai của admin.
            continue
        key2 = (uid, a.get("qid"))
        # LƯỢT ĐẦU của mỗi câu, giống hệt `course_answer_report`. Áp cho CẢ trục
        # sai lẫn số đúng/tổng, không chỉ cho thời gian: em làm Q1 đúng, đóng
        # tab, làm lại và trả lời Q1 sai thì hai mặt đọc phải nói cùng một điều.
        # LƯỢT ĐẦU của mỗi câu (`key2 not in seen_q`) — giống hệt
        # `course_answer_report`.
        if not uid or not a.get("qid") or key2 in seen_q:
            continue
        seen_q.add(key2)
        first_by_user.setdefault(uid, []).append(a)
        # TRỤC lấy từ ĐỀ, không lấy từ cờ client gửi lên: `log_progress` lưu
        # nguyên `item_key` client khai, nên một payload sửa tay đổi được cả
        # bảng "cả lớp vướng ở đâu" của giáo viên. Báo cáo từng em vốn đã đọc
        # từ đề — hai mặt đọc phải cùng một nguồn (codex cục bộ 06/08).
        key = axis_of.get(a.get("qid")) or a.get("item_key")
        a["is_correct"] = _ok(a)
        if key:
            attempted[key] = attempted.get(key, 0) + 1
            students_by_axis.setdefault(key, set()).add(uid)
            if not a["is_correct"]:
                wrong[key] = wrong.get(key, 0) + 1
                affected_by_axis.setdefault(key, set()).add(uid)
        ms = a.get("response_time_ms")
        if isinstance(ms, (int, float)) and ms > 0:
            if key:
                slow.setdefault(key, []).append(int(ms))
            per_user_secs.setdefault(uid, []).append(ms / 1000)

    now = datetime.now(timezone.utc)
    # MỘT DÒNG CHO MỖI HỌC VIÊN ĐƯỢC GIAO — kể cả em chưa kích hoạt tài khoản
    # (`user_id` NULL). Lọc theo `user_id` sẽ vứt các em ấy đi và bảng đếm thiếu
    # sĩ số, hoặc báo "chưa ai mở" cho một lớp toàn em chưa kích hoạt.
    lines: list[tuple[str, str | None]] = list(roster.items())
    # Phiên của một tài khoản KHÔNG còn trong sổ (em đã bị gỡ khỏi lớp sau khi
    # làm bài): vẫn hiện, vì bài ấy đã xảy ra thật.
    seen_uids = {u for u in roster.values() if u}
    lines += [(None, uid) for uid in by_user if uid not in seen_uids]

    for sid, uid in lines:
        rows = by_user.get(uid) or [] if uid else []
        done = [x for x in rows if x.get("ended_at")]
        live = [x for x in rows if not x.get("ended_at") and x["id"] in with_work]
        secs = sum(int(x.get("duration_sec") or 0) for x in done)
        # Từ LƯỢT ĐẦU của mỗi câu, không cộng tổng của các phiên: làm lại một
        # chặng khiến tổng phiên đếm câu ấy hai lần, và con số lệch khỏi báo cáo
        # từng em.
        firsts = first_by_user.get(uid) or []
        asked = len(firsts)
        right = sum(1 for a in firsts if a.get("is_correct"))
        last = max((x.get("ended_at") or x.get("started_at") or "") for x in rows) if rows else ""
        total_stages = out["stages_total"]
        wrote = (item_of_student.get(sid) in submitted_writing) if sid else False
        item_row = item_row_of_student.get(sid) or {}
        mastery_attempts = list(((item_row.get("mastery") or {}).get("attempts")) or [])
        latest_attempt = mastery_attempts[-1] if mastery_attempts else {}
        try:
            summary = course_admin_summary(
                item_row, assignment, required_sections=required_sections)
        except Exception as exc:  # noqa: BLE001
            # Một JSONB mastery hỏng chỉ làm dòng ấy không đọc được; tab tiến độ
            # của cả lớp vẫn phải mở và nói rõ dữ liệu đang stale.
            logger.warning("[quiz] attempt-report summary failed item=%s: %s",
                           item_row.get("id"), exc)
            out["stale"] = True
            summary = unavailable_course_admin_summary(
                item_row, assignment, required_sections=required_sections)
        latest_complete = bool(latest_attempt) and latest_attempt.get(
            "completed", latest_attempt.get("pct") is not None)
        if item_row.get("passed_at"):
            state = "done"
        elif latest_complete:
            state = "needs_retry"
        elif total_stages and len(done) >= total_stages:
            # XONG CHẶNG CHƯA PHẢI XONG BÀI. Phần tự luận nằm ngoài vòng chặng,
            # nên gộp hai chuyện lại là báo với giáo viên rằng một em đã hoàn
            # thành trong khi em ấy còn mười câu chưa động tới.
            state = "completing_sections"
        elif live or done:
            # Làm xong 1/10 chặng rồi dừng KHÔNG phải là xong. Nhánh cũ gọi nó
            # là 'done' và giấu đi đúng những lượt dở dang mà bảng này sinh ra
            # để tìm (codex PR 945).
            state = "doing"
        else:
            state = "untouched"
        # Bỏ dở = có động vào nhưng im lặng quá 24 giờ. Đây là dòng giáo viên
        # cần nhìn thấy, và tới nay nó trốn trong đám "chưa nộp".
        if state == "doing" and last:
            try:
                gap = now - datetime.fromisoformat(last.replace("Z", "+00:00"))
                if gap > timedelta(hours=24):
                    state = "stalled"
            except ValueError:
                pass
        row_flags = list(summary["flags"])
        if state == "stalled":
            row_flags.append({
                "code": "course_stalled", "severity": "medium",
                "label": "Bỏ dở quá 24 giờ",
                "why": "Học viên đã có câu trả lời nhưng không tiếp tục trong hơn 24 giờ.",
                "action": "Mở tiến độ, xác nhận phần đang dở rồi nhắc học viên tiếp tục.",
            })
        mine = sorted(per_user_secs.get(uid) or []) if uid else []
        out["students"].append({
            "student_id":  sid,
            "user_id":     uid,
            # Trung vị giây/câu và ước lượng thời gian rời máy — xem ghi chú ở
            # `course_answer_report.totals` về vì sao là ƯỚC LƯỢNG.
            "median_sec":  round(mine[len(mine) // 2], 1) if mine else None,
            "idle_sec":    round(sum(max(0.0, x - IDLE_CUTOFF_SEC) for x in mine)) if mine else 0,
            "state":       state,
            "wrote":       wrote,
            "stages_done": len(done),
            "minutes":     round(secs / 60, 1),
            "questions":   asked,
            "correct":     right,
            "accuracy":    round(right / asked, 3) if asked else None,
            "last_at":     last or None,
            "attempts":    summary["attempts"],
            "combined_pct": summary["latest_pct"],
            "next_action": summary["next_action"],
            "pass_pct": summary["pass_pct"],
            "near_pass_pct": summary["near_pass_pct"],
            "sections_done": summary["sections_done"],
            "sections_total": summary["sections_total"],
            "section_results": summary["section_results"],
            "missing_sections": summary["missing_sections"],
            "flags": row_flags,
            "attempt_minutes": summary["attempt_minutes"],
            "current_attempt_minutes": summary["current_attempt_minutes"],
        })

    # Việc cần làm lên đầu: bỏ dở trước, rồi tới xong-chặng-chưa-nộp-viết.
    _ORDER = {"stalled": 0, "needs_retry": 1, "completing_sections": 2,
              "doing": 3, "untouched": 4, "done": 5}
    out["students"].sort(key=lambda r: (_ORDER.get(r["state"], 9), -r["stages_done"]))

    # Trục vướng nhất của CẢ LỚP: nhiều lỗi sai, và tốn thời gian.
    axes = []
    for key, n_attempted in attempted.items():
        n_wrong = wrong.get(key, 0)
        if not n_wrong:
            continue
        times = sorted(slow.get(key) or [])
        med = times[len(times) // 2] if times else None
        student_sample = len(students_by_axis.get(key) or set())
        affected_students = len(affected_by_axis.get(key) or set())
        axes.append({
            "axis": key,
            "wrong": n_wrong,
            "attempted": n_attempted,
            "wrong_rate": round(n_wrong / n_attempted, 3) if n_attempted else None,
            "affected_students": affected_students,
            "student_sample": student_sample,
            "affected_rate": (round(affected_students / student_sample, 3)
                              if student_sample else None),
            "median_sec": round(med / 1000, 1) if med else None,
            "scope": "first_attempt",
            # Ba học viên là mẫu tối thiểu để xếp một misconception như tín hiệu
            # cấp LỚP. Lớp nhỏ vẫn thấy dữ liệu, nhưng nó nằm sau mẫu đủ lớn và UI
            # nói rõ chỉ nên tham khảo thay vì biến 1/1 thành kết luận rộng.
            "sample_low": student_sample < 3,
        })
    axes.sort(key=lambda a: (a["sample_low"], -(a["affected_rate"] or 0),
                             -(a["wrong_rate"] or 0), -a["wrong"]))
    out["axes"] = axes[:15]
    return out


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
        # “Phiên gần đây” chỉ là phiên đã kết thúc. Trang mở quiz đã INSERT một
        # dòng; nếu người học đóng ngay thì ended_at=NULL và mọi ô kết quả trống.
        sessions = (sq.not_.is_("ended_at", "null")
                    .order("started_at", desc=True).limit(20).execute().data or [])
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
