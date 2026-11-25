"""
routers/listening.py — Listening module router (user + admin).

Content enters via the markdown import flows (import-fulltest,
skill-drill import) and is managed through the exercise/content/test
CRUD + audit routes below.

Decommissioned 2026-07-17 (usage audit — unused ≥2 months): direct MP3
upload (single/bulk/validate), ElevenLabs AI render, the audio cutter,
AI map-image generation, and the legacy 2-file /convert flow (superseded
by import-fulltest; services/listening_convert.py STAYS — its parser and
marker maps are reused by the fulltest/drill importers and the audit
engine). Manual map-image upload/delete/signed-url remain. See
docs/audits/AUDIT_UPLOAD_QUAN_LY_FILE_READING_LISTENING_2026-07-17.md.

Storage bucket: `listening-audio` (private, signed URLs only — Sprint
11.0 §2A.L2). Bucket creation is a manual operator step; see migration
056 header for instructions.

Package seam (BACKENDSPLIT-0076): the former single file is split into
contiguous blocks (``_common`` so far, listed in ``_SUBMODULES``). Every name
of a submodule is re-exported here as the same object, and ``_SeamModule``
copies a ``setattr`` on this package down to every submodule that binds the
name, so ``monkeypatch.setattr(routers.listening, ...)`` / ``mock.patch(
"routers.listening.X")`` keep reaching moved code. Tests patch this package,
never a submodule. See specs/0076-backend-module-split/plan.md.
"""

from __future__ import annotations

import sys as _sys
import types as _types


def _reexport(sub):
    g = globals()
    for name, value in vars(sub).items():
        if name.startswith("__") or name == "annotations":
            continue
        if name in g and g[name] is not value:
            raise ImportError(f"routers.listening: {sub.__name__}.{name} shadows a different object")
        g[name] = value


from . import _common
from ._common import *  # noqa: F401,F403 — _reexport below also brings names starting with "_"
_reexport(_common)

# ── User route — single content fetch ─────────────────────────────────────────


_STUDENT_LISTENING_CONTENT_FIELDS = (
    "id",
    "title",
    "accent_tag",
    "cefr_level",
    "ielts_section",
    "topic_tags",
    "audio_duration_seconds",
)


def _fetch_published_listening_content_with_signed_url(content_id: str) -> dict:
    """Return student-safe metadata plus a fresh signed audio URL.

    The row also stores the reference transcript and alignment artifacts used
    by graders/admin tooling. Those are answer material and must never ride the
    learner boot response, even when the current UI happens to ignore them.
    """
    blackeye.guard_generic_content(
        supabase_admin, content_id,
        denied_detail="Listening content not found or not published", hidden_status=422,
        direct_parent_first=True)
    res = (
        supabase_admin.table("listening_content")
        .select(",".join((*_STUDENT_LISTENING_CONTENT_FIELDS,
                          "audio_storage_path,status,test_id")))
        .eq("id", content_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Listening content not found or not published")

    row = res.data[0]
    safe = {field: row.get(field) for field in _STUDENT_LISTENING_CONTENT_FIELDS}

    # Bundle sections may use only the parent test's audio. A missing section
    # path is normal (same contract as the admin route), not a storage outage.
    if not row.get("audio_storage_path"):
        safe["audio_signed_url"] = None
        return safe

    # Sign the audio URL with the Supabase admin client (private bucket
    # → only the server can mint URLs). 3600s TTL = Supabase default.
    try:
        signed = supabase_admin.storage.from_(
            settings.LISTENING_AUDIO_BUCKET
        ).create_signed_url(row["audio_storage_path"], 3600)
        # Supabase Python SDK returns dict with 'signedURL' (snake_case
        # 'signed_url' historically — handle both for forward-compat).
        audio_signed_url = signed.get("signedURL") or signed.get("signed_url")
    except Exception as e:
        # Bucket-not-found path mirrors grading.py:240-250 pattern.
        logger.error(
            "[listening] signed URL failed for content_id=%s path=%s: %s",
            content_id, row.get("audio_storage_path"), e,
        )
        raise HTTPException(
            503,
            "Listening audio storage not configured. See migration 056 header.",
        )

    safe["audio_signed_url"] = audio_signed_url
    return safe


def _fetch_published_exercises_for_student(
    *,
    content_id: str,
    exercise_type: str,
) -> list[dict]:
    """Trả exercise đã publish, ĐÃ LỌC ĐÁP ÁN — chỉ dùng cho response học viên.

    Tên hàm GHI THẲNG bảo đảm đó thay vì để người gọi sau tự đoán: bản cũ tên là
    `_fetch_published_listening_exercises`, trả `select("*")` nguyên vẹn, nên
    route boot chép chính tả gửi luôn `payload.answers` xuống trình duyệt.

    Không phải giả định: bộ chuyển đổi xếp `dictation_gap_fill` và
    `dictation_short_answer` vào `exercise_type="dictation"` rồi cất đáp án
    chuẩn ở `payload.answers` (`services/listening_convert.py:1471,1510`). Tôi đã
    xem route này một lượt và kết luận "chép chính tả cần transcript nên không
    lọc được" — sai hai lần trong một câu: đáp án nằm ở `payload.answers` (khoá
    MỨC ĐỈNH bộ lọc đã xoá sẵn từ Sprint 13.5), còn transcript thì nằm ở CỘT
    `segments` riêng (mig 057), ngoài tầm với của bộ lọc (codex cục bộ #967).

    ĐƯỜNG CHẤM BÀI KHÔNG ĐƯỢC DÙNG HÀM NÀY — nó cần payload thô, và nó vốn đã tự
    truy vấn bảng (`listening.py:620`, `:5469`).
    """
    if exercise_type not in _EXERCISE_TYPES:
        raise HTTPException(
            422, f"exercise_type must be one of {sorted(_EXERCISE_TYPES)}",
        )

    blackeye.guard_generic_content(
        supabase_admin, content_id, hidden_status=422, direct_parent_first=True)
    # Keep the publication check behind identity classification on every
    # learner exercise surface, including the direct /exercises route.
    content = (
        supabase_admin.table("listening_content")
        .select("id,status,audio_duration_seconds")
        .eq("id", content_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not content.data:
        raise HTTPException(404, "Listening content not found or not published",
                            headers={"Cache-Control": "private, no-store"})
    res = (
        supabase_admin.table("listening_exercises")
        .select("*")
        .eq("content_id", content_id)
        .eq("exercise_type", exercise_type)
        .eq("status", "published")
        .order("order_num", desc=False)
        .execute()
    )
    from services import listening_test_grader as grader
    rows = grader.strip_answer_keys(res.data or [])
    if exercise_type != "dictation":
        return rows

    # A dictation transcript is the answer itself. The legacy boot used to
    # send segments[].transcript before the learner typed anything, which made
    # the full key visible in DevTools even though the page hid it. The grader
    # reads the raw database row through _resolve_attempt_target(), so learner
    # boot only needs the clip identity and timing window.
    safe_rows: list[dict] = []
    for row in rows:
        safe_row = dict(row)
        raw_segments = row.get("segments")
        safe_row["segments"] = [
            {
                "idx": segment.get("idx"),
                "start_sec": segment.get("start_sec"),
                "end_sec": segment.get("end_sec"),
            }
            for segment in (raw_segments if isinstance(raw_segments, list) else [])
            if isinstance(segment, dict)
        ]
        safe_rows.append(safe_row)
    return safe_rows


@user_router.get("/content/{content_id}")
async def get_listening_content(
    content_id: str,
    authorization: str | None = Header(default=None),
):
    """Fetch one published listening_content row + a fresh signed URL
    to the audio. Used by Sprint 11.2's audio player to load both
    metadata and the playable URL in one round-trip.

    Draft + archived rows return 404 so admins can stage content
    without exposing it. The Sprint 10.6 vocab pattern (return shape
    field always present, derived per request) applies here: the
    `audio_signed_url` is computed on each GET, never stored.
    """
    user = await _require_auth(authorization)  # 401 on missing/bad token
    # `user` reserved for future per-user gating (e.g. premium tier);
    # Sprint 11.1 doesn't use it but the auth check still gates the route.
    _ = user

    return _fetch_published_listening_content_with_signed_url(content_id)


@user_router.get("/dictation/{content_id}/boot")
async def boot_listening_dictation(
    content_id: str,
    authorization: str | None = Header(default=None),
):
    """Combined dictation boot payload.

    Perf-2 collapses the previous frontend waterfall:
    GET /api/listening/content/{id} → GET /api/listening/exercises?...dictation.
    Dictation has no in-progress attempt state; attempts remain POST-only per
    segment, preserving the first-attempt rule in ``post_listening_attempt``.
    """
    user = await _require_auth(authorization)
    _ = user
    content = _fetch_published_listening_content_with_signed_url(content_id)
    exercises = _fetch_published_exercises_for_student(
        content_id=content_id,
        exercise_type="dictation",
    )
    return {"content": content, "exercises": exercises}


# ── User route — submit dictation attempt ─────────────────────────────────────


def _ensure_dictation_exercise(content_id: str) -> str:
    """Sprint 11.2 ships the user-facing dictation surface BEFORE the
    admin exercise-curation UI lands (Sprint 11.4). Every published
    content_id is implicitly a dictation exercise: the script_text IS
    the dictation reference.

    Lazy upsert pattern: on first attempt, create the
    listening_exercises row mirroring the content (one-to-one for
    dictation mode). Returns the exercise_id.

    Sprint 11.3+ replaces this with admin-curated exercise rows
    (gist + T/F + MCQ payloads differ per type — only dictation has
    the "exercise == content" identity)."""
    existing = (
        supabase_admin.table("listening_exercises")
        .select("id")
        .eq("content_id", content_id)
        .eq("exercise_type", "dictation")
        .order("order_num")
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]["id"]

    exercise_id = str(uuid.uuid4())
    try:
        supabase_admin.table("listening_exercises").insert({
            "id":            exercise_id,
            "content_id":    content_id,
            "exercise_type": "dictation",
            "payload":       {},
            "segments":      [],
            "order_num":     1,
            "status":        "published",
        }).execute()
    except Exception as exc:
        if not _is_unique_violation(exc):
            raise
        # Two first attempts can both miss the preflight SELECT. Migration 208
        # serializes the INSERTs through the logical block key; after 23505,
        # adopt the winner instead of surfacing an incidental learner-facing 500.
        winner = (
            supabase_admin.table("listening_exercises")
            .select("id")
            .eq("content_id", content_id)
            .eq("exercise_type", "dictation")
            .order("order_num")
            .limit(1)
            .execute()
        )
        if winner.data:
            return winner.data[0]["id"]
        raise HTTPException(
            409,
            "Dictation exercise was created concurrently; retry the attempt.",
        ) from None
    return exercise_id


@user_router.post("/attempts")
async def post_listening_attempt(
    body: ListeningAttemptRequest,
    authorization: str | None = Header(default=None),
):
    """Submit one dictation attempt.

    Sprint 11.3 — segmented dictation. Body MAY carry:
      - segment_idx + exercise_id  → grade against exercise.segments[idx]
      - segment_idx + content_id   → resolve dictation exercise from content
      - content_id only            → Sprint 11.2 fallback: whole transcript
                                     (only used if no published dictation
                                     exercise exists for the content)

    Sprint 10.3 first-attempt rule: ALL attempts are stored, but only
    the first attempt per (user_id, exercise_id, segment_idx) sets the
    canonical score. Subsequent attempts get stored with their fresh
    score but do not overwrite — analytics treat first attempt as
    ground truth.

    Modes other than 'dictation' return 422 — Sprint 11.4+ flips
    gist / true-false / mcq.
    """
    user = await _require_auth(authorization)
    user_id = user["id"]

    if body.mode not in {"dictation", "gist", "true_false", "mcq"}:
        raise HTTPException(
            422,
            f"mode='{clip_user_value(body.mode)}' not supported — "
            "supported: dictation | gist | true_false | mcq.",
        )
    if not body.content_id and not body.exercise_id:
        raise HTTPException(422, "Either content_id or exercise_id is required.")

    # ── Resolve exercise + parent content ─────────────────────────────────────
    exercise_row, content_row = await run_in_threadpool(_resolve_attempt_target, body)

    # ── Dispatch by mode ──────────────────────────────────────────────────────
    if body.mode == "dictation":
        return _grade_and_save_dictation(
            user_id=user_id,
            body=body,
            exercise_row=exercise_row,
            content_row=content_row,
        )
    if body.mode == "gist":
        _enforce_gist_rate_limit(user_id)
        return _grade_and_save_gist(
            user_id=user_id, body=body, exercise_row=exercise_row,
        )
    if body.mode == "true_false":
        return _grade_and_save_true_false(
            user_id=user_id, body=body, exercise_row=exercise_row,
        )
    if body.mode == "mcq":
        return _grade_and_save_mcq(
            user_id=user_id, body=body, exercise_row=exercise_row,
        )
    # Unreachable — kept defensive.
    raise HTTPException(500, "Unhandled mode dispatch.")


# ── Attempt-handler helpers ───────────────────────────────────────────────────


def _resolve_attempt_target(
    body: ListeningAttemptRequest,
) -> tuple[dict | None, dict]:
    """Look up exercise_row (by exercise_id OR derived from content_id +
    body.mode) and the parent content row. Returns (exercise_row,
    content_row). exercise_row may be None for the Sprint 11.2 dictation
    fallback path; content_row is never None (404 if missing)."""
    exercise_row: dict | None = None
    content_id: str | None = body.content_id

    # Resolve identities only, before transcript/payload reads or lazy writes.
    if body.exercise_id:
        identity = (supabase_admin.table("listening_exercises").select("content_id")
                    .eq("id", body.exercise_id).eq("status", "published").limit(1).execute().data or [])
        if not identity:
            raise HTTPException(404, "Exercise not found or not published.")
        content_id = identity[0]["content_id"]
    blackeye.guard_generic_content(
        supabase_admin, content_id,
        denied_detail="Listening content not found or not published", hidden_status=422,
        direct_parent_first=True)

    if body.exercise_id:
        res = (
            supabase_admin.table("listening_exercises")
            .select("*")
            .eq("id", body.exercise_id)
            .eq("status", "published")
            .limit(1)
            .execute()
        )
        if not res.data:
            raise HTTPException(404, "Exercise not found or not published.")
        exercise_row = res.data[0]
        content_id = exercise_row["content_id"]
        # If the body mode disagrees with the exercise type, that's a
        # client bug — surface it as 422 so it can't masquerade as a
        # silently-mis-graded attempt.
        if exercise_row["exercise_type"] != body.mode:
            raise HTTPException(
                422,
                f"mode='{body.mode}' but exercise_id resolves to "
                f"exercise_type='{exercise_row['exercise_type']}'.",
            )

    content_res = (
        supabase_admin.table("listening_content")
        .select("id,transcript,status")
        .eq("id", content_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not content_res.data:
        raise HTTPException(404, "Listening content not found or not published")
    content_row = content_res.data[0]

    if exercise_row is None and body.mode != "dictation":
        # gist + true_false + mcq require an authored exercise — no lazy upsert.
        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("*")
            .eq("content_id", content_id)
            .eq("exercise_type", body.mode)
            .eq("status", "published")
            .order("order_num", desc=False)
            .limit(1)
            .execute()
        )
        if not ex_res.data:
            raise HTTPException(
                404,
                f"No published {body.mode} exercise exists for this content.",
            )
        exercise_row = ex_res.data[0]

    elif exercise_row is None and body.mode == "dictation":
        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("*")
            .eq("content_id", content_id)
            .eq("exercise_type", "dictation")
            .eq("status", "published")
            .order("order_num", desc=False)
            .limit(1)
            .execute()
        )
        if ex_res.data:
            exercise_row = ex_res.data[0]

    return exercise_row, content_row


def _require_own_listening_session(user_id: str, listening_session_id: str) -> None:
    """Báo cáo săn lỗi B2-12: `listening_session_id` đến thẳng từ body. Ghi
    bằng `supabase_admin` (bỏ qua RLS) mà không kiểm chủ thì một người có thể
    gắn lượt làm của mình vào phiên của người khác. Chỉ nhận phiên của chính
    người gọi; id lạ (không phải UUID) hay phiên không tồn tại đều 404 như
    nhau để không lộ phiên nào có thật.
    """
    try:
        uuid.UUID(str(listening_session_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "Không tìm thấy phiên nghe.") from None
    try:
        res = (
            supabase_admin.table("listening_sessions")
            .select("id")
            .eq("id", str(listening_session_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[listening] session ownership lookup failed user=%s session=%s: %s",
                     user_id, listening_session_id, e, exc_info=True)
        raise HTTPException(503, "Không kiểm được phiên nghe. Vui lòng thử lại.") from None
    if not res.data:
        raise HTTPException(404, "Không tìm thấy phiên nghe.")


def _insert_attempt(
    *,
    user_id: str,
    exercise_id: str,
    segment_idx: int | None,
    user_answer: dict,
    score: float,
    is_correct: bool,
    listen_count: int,
    listening_session_id: str | None = None,
) -> str:
    attempt_id = str(uuid.uuid4())
    row: dict = {
        "id":                   attempt_id,
        "user_id":              user_id,
        "exercise_id":          exercise_id,
        "segment_idx":          segment_idx,
        "user_answer":          user_answer,
        "is_correct":           is_correct,
        "score":                score,
        "replay_count":         max(0, listen_count - 1),
        "audio_play_completed": listen_count >= 1,
    }
    if listening_session_id:
        _require_own_listening_session(user_id, listening_session_id)
        row["listening_session_id"] = listening_session_id
    try:
        supabase_admin.table("listening_attempts").insert(row).execute()
    except Exception as e:
        logger.error("[listening] attempt INSERT failed user=%s exercise=%s: %s",
                     user_id, exercise_id, e, exc_info=True)
        raise HTTPException(500, "Không lưu được lượt làm bài. Vui lòng thử lại.") from None
    return attempt_id


def _check_first_attempt(
    *,
    user_id: str,
    exercise_id: str,
    segment_idx: int | None,
) -> bool:
    q = (
        supabase_admin.table("listening_attempts")
        .select("id")
        .eq("user_id", user_id)
        .eq("exercise_id", exercise_id)
    )
    if segment_idx is not None:
        q = q.eq("segment_idx", segment_idx)
    prior = q.limit(1).execute()
    return not prior.data


# ── Dictation grader (Sprint 11.2/11.3 path) ──────────────────────────────────


def _grade_and_save_dictation(
    *,
    user_id: str,
    body: ListeningAttemptRequest,
    exercise_row: dict | None,
    content_row: dict,
) -> dict:
    segments = (exercise_row or {}).get("segments") or []
    if body.segment_idx is not None:
        if not exercise_row or not segments:
            raise HTTPException(
                422,
                "segment_idx supplied but no segmented dictation exercise "
                "exists for this content.",
            )
        if body.segment_idx >= len(segments):
            raise HTTPException(
                422,
                f"segment_idx {body.segment_idx} out of range "
                f"(0..{len(segments) - 1}).",
            )
        reference_transcript = segments[body.segment_idx].get("transcript", "")
    else:
        reference_transcript = content_row["transcript"]

    graded = grade_dictation(
        reference_transcript=reference_transcript,
        user_transcript=body.user_transcript,
    )

    if exercise_row:
        exercise_id = exercise_row["id"]
    else:
        exercise_id = _ensure_dictation_exercise(content_row["id"])

    is_first_attempt = _check_first_attempt(
        user_id=user_id, exercise_id=exercise_id, segment_idx=body.segment_idx,
    )

    attempt_id = _insert_attempt(
        user_id=user_id,
        exercise_id=exercise_id,
        segment_idx=body.segment_idx,
        user_answer={"text": body.user_transcript, "diff": graded["diff"]},
        score=graded["score"],
        is_correct=graded["is_correct"],
        listen_count=body.listen_count,
        listening_session_id=body.listening_session_id,
    )
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_id,
        "segment_idx":      body.segment_idx,
        "mode":             "dictation",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],
        "correct_words":    graded["correct_words"],
        "total_words":      graded["total_words"],
        "is_correct":       graded["is_correct"],
        "diff":             graded["diff"],
        "grading_version":  LEGACY_POLICY_VERSION,
        "sentence_reference_sha256": text_sha256(reference_transcript),
    }


# ── Gist grading rate limit (W-03) ────────────────────────────────────────────
# Each gist attempt is one paid Claude call. Two caps, mirroring POST /tts (F05):
#   * per-worker sliding minute window per user — stops a burst before the
#     ledger catches up (ledger writes are background, so the daily count lags
#     by the calls in flight);
#   * daily count of this feature's own ledger rows (ai_usage_logs,
#     feature="listening_gist") since UTC midnight. A provider retry logs a row
#     per call, so retries count — conservative on purpose. The keyword
#     fallback (no API key) costs nothing and logs nothing.
# Both fail closed (AIBUDGET-0033 FR-006): a ledger lookup error refuses the
# attempt with `budget_unavailable` instead of counting 0, and a cap of zero or
# less refuses it with `config_invalid` instead of disabling that cap. Either
# answers 503 `ai_budget_exhausted` before the grader runs. No new table.
_GIST_WINDOW_SECONDS = 60.0
_GIST_SWEEP_THRESHOLD = 10_000
_gist_attempts: dict[str, "deque[float]"] = {}
_GIST_FEATURE = "listening_gist"


def _count_gist_gradings_today(user_id: str) -> int:
    try:
        res = (
            supabase_admin.table("ai_usage_logs")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("feature", "listening_gist")
            .gte("created_at", _utc_today_start().isoformat())
            .execute()
        )
    except Exception as exc:
        logger.warning("[listening] gist quota lookup failed user=%s: %s", user_id, exc)
        raise refuse_paid_ai("budget_unavailable", feature=_GIST_FEATURE,
                             quota="LISTENING_GIST_DAILY_LIMIT_PER_USER") from exc
    return counted_rows(res, quota="LISTENING_GIST_DAILY_LIMIT_PER_USER",
                        feature=_GIST_FEATURE)


def _enforce_gist_rate_limit(user_id: str) -> None:
    per_minute = require_paid_ai_cap(settings.LISTENING_GIST_MAX_PER_MINUTE,
                                     quota="LISTENING_GIST_MAX_PER_MINUTE",
                                     feature=_GIST_FEATURE)
    daily = require_paid_ai_cap(settings.LISTENING_GIST_DAILY_LIMIT_PER_USER,
                                quota="LISTENING_GIST_DAILY_LIMIT_PER_USER",
                                feature=_GIST_FEATURE)
    now = time.monotonic()
    cutoff = now - _GIST_WINDOW_SECONDS
    if len(_gist_attempts) > _GIST_SWEEP_THRESHOLD:
        for key in [k for k, q in _gist_attempts.items() if not q or q[-1] <= cutoff]:
            del _gist_attempts[key]
    hits = _gist_attempts.setdefault(user_id, deque())
    while hits and hits[0] <= cutoff:
        hits.popleft()
    if len(hits) >= per_minute:
        retry_after = max(1, int(hits[0] - cutoff) + 1)
        logger.info("[listening] BLOCK gist burst user=%s limit=%d/min", user_id, per_minute)
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": "Bạn đang chấm bài gist quá nhanh. Vui lòng đợi một chút rồi thử lại.",
                "exercise_type": "LISTENING_GIST",
                "limit": per_minute,
                "retry_after": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )
    used = _count_gist_gradings_today(user_id)
    if used >= daily:
        reset_at = _utc_tomorrow_start().isoformat()
        logger.info("[listening] BLOCK gist daily user=%s used=%d limit=%d", user_id, used, daily)
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Đã đạt giới hạn {daily} lượt chấm gist trong ngày. Vui lòng thử lại vào ngày mai.",
                "exercise_type": "LISTENING_GIST",
                "limit": daily,
                "used": used,
                "reset_at": reset_at,
            },
        )
    _gist_attempts[user_id].append(time.monotonic())


# ── Gist grader (Sprint 11.4) ─────────────────────────────────────────────────


def _grade_and_save_gist(
    *,
    user_id: str,
    body: ListeningAttemptRequest,
    exercise_row: dict | None,
) -> dict:
    if not exercise_row:
        raise HTTPException(404, "No gist exercise exists for this content.")
    payload = exercise_row.get("payload") or {}
    model_answer = str(payload.get("model_answer") or "").strip()
    rubric_keywords = list(payload.get("rubric_keywords") or [])
    if not model_answer:
        raise HTTPException(
            422,
            "Gist exercise payload missing model_answer — admin must "
            "author the rubric before grading.",
        )

    graded = grade_gist_response(
        user_response=body.user_transcript,
        model_answer=model_answer,
        rubric_keywords=rubric_keywords,
        usage_user_id=user_id,
    )

    is_first_attempt = _check_first_attempt(
        user_id=user_id, exercise_id=exercise_row["id"], segment_idx=None,
    )
    attempt_id = _insert_attempt(
        user_id=user_id,
        exercise_id=exercise_row["id"],
        segment_idx=None,
        user_answer={
            "text":            body.user_transcript,
            "feedback":        graded["feedback"],
            "keyword_matches": graded["keyword_matches"],
            "ai_used":         graded["ai_used"],
        },
        # listening_attempts.score is NUMERIC(4,2) — gist Haiku returns
        # 0-100, store as 0-1 for consistency with dictation.
        score=round(graded["score"] / 100.0, 2),
        is_correct=graded["score"] >= 80,
        listen_count=body.listen_count,
        listening_session_id=body.listening_session_id,
    )
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_row["id"],
        "mode":             "gist",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],          # 0-100 client-facing
        "feedback":         graded["feedback"],
        "keyword_matches":  graded["keyword_matches"],
        "ai_used":          graded["ai_used"],
        "is_correct":       graded["score"] >= 80,
    }


# ── True/False grader (Sprint 11.4) ───────────────────────────────────────────


def _grade_and_save_true_false(
    *,
    user_id: str,
    body: ListeningAttemptRequest,
    exercise_row: dict | None,
) -> dict:
    if not exercise_row:
        raise HTTPException(404, "No true_false exercise exists for this content.")
    payload = exercise_row.get("payload") or {}
    statements = list(payload.get("statements") or [])
    if not statements:
        raise HTTPException(
            422,
            "true_false exercise payload missing statements.",
        )
    if not isinstance(body.answers, list) or not body.answers:
        raise HTTPException(
            422, "answers[] required for true_false mode.",
        )

    graded = grade_true_false(statements=statements, user_answers=body.answers)

    is_first_attempt = _check_first_attempt(
        user_id=user_id, exercise_id=exercise_row["id"], segment_idx=None,
    )
    attempt_id = _insert_attempt(
        user_id=user_id,
        exercise_id=exercise_row["id"],
        segment_idx=None,
        user_answer={
            "answers": [str(a) for a in body.answers],
            "details": graded["details"],
        },
        score=round(graded["score"], 2),
        is_correct=graded["is_correct"],
        listen_count=body.listen_count,
        listening_session_id=body.listening_session_id,
    )
    # Báo cáo săn lỗi B2-13 (anh Andy chọn 25/11: chỉ báo đúng/sai): như MCQ,
    # KHÔNG trả đáp án đúng về trình duyệt — nếu không, nộp bừa một lần là có
    # đáp án để làm lại đạt 100%. Bản đủ (có `expected`) vẫn lưu ở server.
    safe_details = [
        {
            "idx":        d["idx"],
            "actual":     d.get("actual"),
            "is_correct": d["is_correct"],
        }
        for d in graded["details"]
    ]
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_row["id"],
        "mode":             "true_false",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],
        "correct":          graded["correct"],
        "total":            graded["total"],
        "is_correct":       graded["is_correct"],
        "details":          safe_details,
    }


# ── MCQ grader (Sprint 11.5) ──────────────────────────────────────────────────


def _grade_and_save_mcq(
    *,
    user_id: str,
    body: ListeningAttemptRequest,
    exercise_row: dict | None,
) -> dict:
    if not exercise_row:
        raise HTTPException(404, "No mcq exercise exists for this content.")
    payload = exercise_row.get("payload") or {}
    questions = list(payload.get("questions") or [])
    if not questions:
        raise HTTPException(422, "mcq exercise payload missing questions.")
    if not isinstance(body.mcq_answers, list) or not body.mcq_answers:
        raise HTTPException(422, "mcq_answers[] required for mcq mode.")

    graded = grade_mcq(questions=questions, user_answers=body.mcq_answers)

    is_first_attempt = _check_first_attempt(
        user_id=user_id, exercise_id=exercise_row["id"], segment_idx=None,
    )
    # Strip canonical answers from `details` written to client so a network
    # tap of the response doesn't leak the answer key to subsequent retries.
    safe_details = [
        {
            "idx":          d["idx"],
            "actual_idx":   d["actual_idx"],
            "is_correct":   d["is_correct"],
        }
        for d in graded["details"]
    ]
    attempt_id = _insert_attempt(
        user_id=user_id,
        exercise_id=exercise_row["id"],
        segment_idx=None,
        user_answer={
            "mcq_answers": list(body.mcq_answers),
            "details":     graded["details"],  # full details persisted server-side
        },
        score=round(graded["score"], 2),
        is_correct=graded["is_correct"],
        listen_count=body.listen_count,
        listening_session_id=body.listening_session_id,
    )
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_row["id"],
        "mode":             "mcq",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],
        "correct":          graded["correct"],
        "total":            graded["total"],
        "is_correct":       graded["is_correct"],
        "details":          safe_details,
    }


# ── User route — list exercises for a content ────────────────────────────────


@user_router.get("/exercises")
async def get_listening_exercises(
    content_id: str = Query(..., min_length=1, max_length=64),
    exercise_type: str = Query(default="dictation"),
    authorization: str | None = Header(default=None),
):
    """List published exercises for a content row. Sprint 11.3 dictation
    page calls this to discover the segments JSONB it should iterate.

    Returns: `{exercises: [...]}` ordered by order_num. Empty list when
    no exercise has been authored yet — the client renders an empty
    state pointing the admin at the segment editor.
    """
    user = await _require_auth(authorization)
    _ = user

    if exercise_type not in _EXERCISE_TYPES:
        raise HTTPException(
            422, f"exercise_type must be one of {sorted(_EXERCISE_TYPES)}",
        )

    # Keep every learner exercise surface on the same answer-stripping path.
    # Besides payload answer keys, Dictation must also withhold the reference
    # transcript stored in the top-level `segments` column.
    return {
        "exercises": _fetch_published_exercises_for_student(
            content_id=content_id,
            exercise_type=exercise_type,
        ),
    }


# ── Admin routes — content preview + list ─────────────────────────────────────


@admin_router.get("/content/{content_id}")
async def admin_get_listening_content(
    content_id: str,
    authorization: str | None = Header(default=None),
):
    """Admin-only preview. Same shape as the user GET but no
    `status='published'` filter — admins can review drafts before
    flipping them live.

    Sprint 11.1 falsification #60: user route hard-filters published
    rows, so admin preview previously required a SQL UPDATE workaround.
    This is the proper fix.
    """
    await require_admin(authorization)

    res = (
        supabase_admin.table("listening_content")
        .select("*")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Listening content not found")
    row = res.data[0]

    # Bundle sections may use only the parent test's audio. A missing section
    # path is normal; storage3 rejects None before making a request.
    if not row.get("audio_storage_path"):
        row["audio_signed_url"] = None
        return row

    try:
        signed = supabase_admin.storage.from_(
            settings.LISTENING_AUDIO_BUCKET
        ).create_signed_url(row["audio_storage_path"], 3600)
        row["audio_signed_url"] = signed.get("signedURL") or signed.get("signed_url")
    except Exception as e:
        logger.error(
            "[listening] admin signed URL failed content_id=%s: %s", content_id, e,
        )
        # Admins still see the metadata even if storage is misconfigured.
        row["audio_signed_url"] = None

    return row


@admin_router.get("/content")
async def admin_list_listening_content(
    status: str = Query(default="all"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """List listening_content rows for the admin curation UI.

    Sprint 11.1 falsification #59: the handoff doc assumed this
    existed; it didn't. This ships the proper paginated list so the
    Supabase Dashboard is no longer the canonical view.

    status defaults to 'all' (admins want to see drafts + published
    side by side). Pass status='draft' or 'published' to filter.
    """
    await require_admin(authorization)

    if status != "all" and status not in _STATUS_VALUES:
        raise HTTPException(
            422,
            f"status must be one of {sorted(_STATUS_VALUES | {'all'})}",
        )

    q = (
        supabase_admin.table("listening_content")
        .select("*", count="exact")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if status != "all":
        q = q.eq("status", status)

    q = await run_in_threadpool(blackeye.exclude_tests, supabase_admin, q, key="test_id")
    res = q.execute()
    return {
        "items":  res.data or [],
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }


# ── Admin routes — content metadata + status PATCH (Sprint 13.1) ──────────────


@admin_router.patch("/content/{content_id}")
async def admin_patch_listening_content(
    content_id: str,
    body: ListeningContentMetadataPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Update editable metadata fields on a listening_content row.

    Allow-list: title, transcript, accent_tag, cefr_level, ielts_section,
    topic_tags, is_premium, external_license, external_source_url.

    Only keys present in the request body land in the UPDATE — partial
    updates are first-class. Validation reuses POST /upload rules.

    Premium + NC license combo is rejected at 422 to mirror the upload
    path (Sprint 11.0 §4E). When external_license is being SET in this
    PATCH, external_source_url must also be set (license attribution).
    """
    await require_admin(authorization)

    existing = (
        supabase_admin.table("listening_content")
        .select("*")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Listening content not found")
    current = existing.data[0]

    fields = body.model_fields_set
    expected_updated_at = (body.expected_updated_at or "").strip() or None
    if expected_updated_at and not _same_timestamp(current.get("updated_at"), expected_updated_at):
        raise HTTPException(
            409,
            "Listening content changed after this editor was opened. Reload canonical data before saving.",
        )

    update: dict = {}

    if "title" in fields:
        title = (body.title or "").strip()
        if not title:
            raise HTTPException(422, "title must not be empty")
        update["title"] = title

    if "transcript" in fields:
        transcript = body.transcript or ""
        if not transcript.strip():
            raise HTTPException(422, "transcript must not be empty")
        update["transcript"] = transcript

    if "accent_tag" in fields:
        if body.accent_tag not in _ACCENT_VALUES:
            raise HTTPException(
                422, f"accent_tag must be one of {sorted(_ACCENT_VALUES)}",
            )
        update["accent_tag"] = body.accent_tag

    if "cefr_level" in fields:
        if body.cefr_level is not None and body.cefr_level not in _CEFR_VALUES:
            raise HTTPException(
                422, f"cefr_level must be one of {sorted(_CEFR_VALUES)}",
            )
        update["cefr_level"] = body.cefr_level

    if "ielts_section" in fields:
        if body.ielts_section is not None and not (1 <= body.ielts_section <= 4):
            raise HTTPException(422, "ielts_section must be 1-4")
        update["ielts_section"] = body.ielts_section

    if "topic_tags" in fields:
        if body.topic_tags is None:
            raise HTTPException(422, "topic_tags must be an array")
        tags: list[str] = []
        seen_tags: set[str] = set()
        for raw_tag in body.topic_tags:
            tag = str(raw_tag).strip()
            # Keep this fold in lock-step with the browser editor's
            # String.prototype.toLowerCase(). Python's casefold() is more
            # aggressive (for example, ß -> ss), which made a successful
            # write differ from the exact delta the editor later reconciles.
            folded = tag.lower()
            if tag and folded not in seen_tags:
                seen_tags.add(folded)
                tags.append(tag)
        update["topic_tags"] = tags

    if "is_premium" in fields:
        if body.is_premium is None:
            raise HTTPException(422, "is_premium must be true or false")
        update["is_premium"] = bool(body.is_premium)

    if "external_license" in fields:
        update["external_license"] = (body.external_license or "").strip() or None

    if "external_source_url" in fields:
        from urllib.parse import urlparse
        source_url = (body.external_source_url or "").strip() or None
        if source_url:
            parsed = urlparse(source_url)
            if (parsed.scheme not in {"http", "https"} or not parsed.netloc
                    or any(char.isspace() for char in source_url)):
                raise HTTPException(422, "external_source_url must be an HTTP(S) URL")
        update["external_source_url"] = source_url

    # Cross-field rules — evaluated against the merged shape (current row
    # + this PATCH's deltas) so partial updates can't slip past Sprint
    # 11.0 §4 / §4E by setting one half of a related pair on its own.
    merged = {**current, **update}
    if merged.get("external_license") and not merged.get("external_source_url"):
        raise HTTPException(
            422,
            "external_source_url required when external_license is set "
            "(license attribution rule)",
        )
    if (
        merged.get("is_premium")
        and merged.get("external_license")
        and re.search(
            r"(^|[^A-Z0-9])NC([^A-Z0-9]|$)",
            str(merged["external_license"]).upper(),
        )
    ):
        raise HTTPException(
            422,
            "Cannot mark NC-licensed content as premium — non-commercial "
            "restriction incompatible with paid tier (Sprint 11.0 §4E).",
        )

    if not update:
        # No editable keys present — return current row unchanged. Saves
        # a write but still confirms the PATCH succeeded so the admin UI
        # can refresh consistently.
        return current

    from datetime import datetime, timezone
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    mutation = (supabase_admin.table("listening_content")
                .update(update).eq("id", content_id))
    if expected_updated_at:
        mutation = mutation.eq("updated_at", expected_updated_at)
    res = mutation.execute()
    rows = res.data or []
    if not rows:
        if expected_updated_at:
            raise HTTPException(
                409,
                "Listening content changed while saving. Reload canonical data before retrying.",
            )
        raise HTTPException(
            500,
            "Listening content update was not confirmed by the database.",
        )
    return rows[0]


@admin_router.patch("/content/{content_id}/status")
async def admin_patch_listening_content_status(
    content_id: str,
    body: ListeningContentStatusPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Transition a listening_content row between draft / published /
    archived. Any-to-any direction is allowed (Sprint 13.1 commission D5
    — no workflow gate; explicit Publish/Archive buttons live on the
    admin content-detail page).
    """
    await require_admin(authorization)

    new_status = body.status.strip().lower()
    if new_status not in _STATUS_VALUES:
        raise HTTPException(
            422, f"status must be one of {sorted(_STATUS_VALUES)}",
        )

    existing = (
        supabase_admin.table("listening_content")
        .select("id,status")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Listening content not found")

    res = (
        supabase_admin.table("listening_content")
        .update({"status": new_status})
        .eq("id", content_id)
        .execute()
    )
    rows = res.data or []
    if rows:
        return rows[0]
    return {"id": content_id, "status": new_status}


# ── Admin routes — exercise CRUD (Sprint 11.3) ────────────────────────────────


@admin_router.post("/exercises")
async def admin_upsert_listening_exercise(
    body: ListeningExerciseUpsertRequest,
    authorization: str | None = Header(default=None),
):
    """Create or update a dictation exercise row + segments.

    Sprint 11.3 — segmented dictation authoring. Segments validated
    against the parent content row's audio_duration_seconds:
      - idx contiguous from 0
      - start_sec < end_sec
      - end_sec ≤ content.audio_duration_seconds (+0.5s slack)
      - non-overlapping
      - transcript non-empty

    Legacy callers that omit order_num retain their original "first block of
    this type" semantics. Callers that provide order_num use the complete
    (content_id, exercise_type, order_num) block identity. Native editors
    update an exact exercise_id with an expected_updated_at version token so
    existing attempt rows keep referencing the same exercise.
    """
    await require_admin(authorization)
    if body.exercise_id:
        try:
            uuid.UUID(body.exercise_id)
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(422, "exercise_id must be a valid UUID") from None
    await run_in_threadpool(blackeye.guard_generic_target, supabase_admin,
                            content_id=body.content_id, exercise_id=body.exercise_id)

    if body.exercise_type not in _EXERCISE_TYPES:
        raise HTTPException(
            422, f"exercise_type must be one of {sorted(_EXERCISE_TYPES)}",
        )
    if body.status not in _STATUS_VALUES:
        raise HTTPException(
            422, f"status must be one of {sorted(_STATUS_VALUES)}",
        )

    # ── Resolve parent content (we need its duration for validation) ─────────
    c = (
        supabase_admin.table("listening_content")
        .select("id,audio_duration_seconds,test_id")
        .eq("id", body.content_id)
        .limit(1)
        .execute()
    )
    if not c.data:
        raise HTTPException(404, "Listening content not found")
    content_row = c.data[0]
    duration = content_row["audio_duration_seconds"]
    if content_row.get("test_id") and body.exercise_type in _SINGLE_PUBLISHED_EXERCISE_TYPES:
        raise HTTPException(
            409,
            "Content này thuộc test/drill importer; hãy sửa block trong Listening Tests, không tạo block standalone.",
        )

    # ── Validate per-type payload + segments (Sprint 11.3 + 11.4) ──────────
    validated_segments: list[dict] = []
    validated_payload: dict = dict(body.payload or {})
    if body.exercise_type == "dictation":
        if "segments" not in body.model_fields_set:
            raise HTTPException(422, "segments is required for a dictation save")
        validated_segments = _validate_dictation_segments(
            body.segments,
            audio_duration_seconds=duration,
        )
    elif body.exercise_type == "gist":
        validated_payload = _validate_gist_payload(validated_payload)
    elif body.exercise_type == "true_false":
        validated_payload = _validate_true_false_payload(validated_payload)
    elif body.exercise_type == "mcq":
        validated_payload = _validate_mcq_payload(validated_payload)

    if body.expected_absent and body.expected_updated_at:
        raise HTTPException(
            422,
            "expected_absent and expected_updated_at are mutually exclusive",
        )
    if body.expected_absent and "order_num" not in body.model_fields_set:
        raise HTTPException(422, "order_num is required with expected_absent")
    if body.exercise_id:
        if body.expected_absent:
            raise HTTPException(422, "exercise_id cannot be combined with expected_absent")
        if not body.expected_updated_at:
            raise HTTPException(422, "expected_updated_at is required with exercise_id")
    elif body.expected_updated_at:
        raise HTTPException(422, "exercise_id is required with expected_updated_at")

    # Exact exercise identity is first-class for native editors. Older Gist,
    # T/F and MCQ editors omit both exercise_id and order_num; preserve their
    # first-block semantics so imported blocks at order 2+ are updated rather
    # than shadowed by a new order-1 row.
    explicit_order = "order_num" in body.model_fields_set
    existing_query = (
        supabase_admin.table("listening_exercises")
        .select("id,content_id,exercise_type,order_num,updated_at,payload")
    )
    if body.exercise_id:
        existing_query = existing_query.eq("id", body.exercise_id)
    else:
        existing_query = (
            existing_query
            .eq("content_id", body.content_id)
            .eq("exercise_type", body.exercise_type)
        )
        if explicit_order:
            existing_query = existing_query.eq("order_num", body.order_num)
        else:
            existing_query = existing_query.order("order_num")
    existing = existing_query.limit(1).execute()
    current_exercise = (existing.data or [None])[0]
    resolved_order = body.order_num
    if current_exercise and not body.exercise_id and not explicit_order:
        resolved_order = int(current_exercise.get("order_num") or 1)

    if body.exercise_id and not current_exercise:
        raise HTTPException(
            409,
            "Exercise no longer exists. Reload canonical data before saving.",
        )
    if current_exercise and (
        str(current_exercise.get("content_id")) != body.content_id
        or current_exercise.get("exercise_type") != body.exercise_type
        or int(current_exercise.get("order_num") or 0) != resolved_order
    ):
        raise HTTPException(
            409,
            "Exercise identity no longer matches this content/type/order block.",
        )
    if body.expected_absent and current_exercise:
        raise HTTPException(
            409,
            "Exercise block was created elsewhere. Reload canonical data before saving.",
        )
    if body.expected_updated_at:
        if not current_exercise or not _same_timestamp(
            current_exercise.get("updated_at"), body.expected_updated_at,
        ):
            raise HTTPException(
                409,
                "Exercise block changed after this editor was opened. Reload canonical data before saving.",
            )

    # Standalone learner pages resolve one published block per mode. This
    # preflight gives admins an actionable 409; migration 209 is the atomic
    # backstop when concurrent requests both pass this SELECT.
    current_id = str(current_exercise.get("id")) if current_exercise else None
    if body.status == "published" and body.exercise_type in _SINGLE_PUBLISHED_EXERCISE_TYPES:
        live_orders = _published_standalone_orders(
            body.content_id,
            body.exercise_type,
            exclude_id=current_id,
        )
        if live_orders:
            raise HTTPException(
                409,
                _single_published_conflict_detail(body.exercise_type, live_orders),
            )

    # The native Dictation editor owns segments, not the type-specific JSONB
    # configuration. Preserve an existing payload unless the caller explicitly
    # supplied that field; otherwise a segments-only save would erase importer
    # provenance or future playback/tolerance settings.
    if (
        body.exercise_type == "dictation"
        and current_exercise
        and "payload" not in body.model_fields_set
    ):
        validated_payload = dict(current_exercise.get("payload") or {})

    from services.mock_response_policy import authored_response_policies, ResponsePolicyError
    from services.listening_test_grader import collect_answer_key
    try:
        policies = authored_response_policies("listening", [{"payload": validated_payload}])
        collect_answer_key([{"payload": validated_payload}], pinned_policies=policies)
    except ResponsePolicyError as exc:
        raise HTTPException(422, str(exc)) from exc

    payload = {
        "content_id":    body.content_id,
        "exercise_type": body.exercise_type,
        "payload":       validated_payload,
        "order_num":     resolved_order,
        "status":        body.status,
        "segments":      validated_segments,
    }

    from datetime import datetime, timezone
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()

    if current_exercise:
        exercise_id = current_exercise["id"]
        mutation = (
            supabase_admin.table("listening_exercises")
            .update(payload)
            .eq("id", exercise_id)
        )
        if body.expected_updated_at:
            mutation = mutation.eq("updated_at", body.expected_updated_at)
        try:
            result = mutation.execute()
        except Exception as exc:
            if not _is_unique_violation(exc):
                raise
            live_orders = _published_standalone_orders(
                body.content_id,
                body.exercise_type,
                exclude_id=str(exercise_id),
            ) if body.status == "published" else []
            if live_orders:
                raise HTTPException(
                    409,
                    _single_published_conflict_detail(body.exercise_type, live_orders),
                ) from None
            raise HTTPException(
                409,
                "Exercise block changed concurrently. Reload canonical data before retrying.",
            ) from None
        rows = result.data or []
        if not rows:
            if body.expected_updated_at:
                raise HTTPException(
                    409,
                    "Exercise block changed while saving. Reload canonical data before retrying.",
                )
            raise HTTPException(500, "Exercise update was not confirmed by the database.")
        return {
            "ok": True,
            "exercise_id": exercise_id,
            "created": False,
            "updated_at": rows[0].get("updated_at"),
        }

    exercise_id = str(uuid.uuid4())
    payload["id"] = exercise_id
    try:
        result = supabase_admin.table("listening_exercises").insert(payload).execute()
    except Exception as exc:
        if _is_unique_violation(exc):
            live_orders = _published_standalone_orders(
                body.content_id,
                body.exercise_type,
            ) if body.status == "published" else []
            if live_orders:
                raise HTTPException(
                    409,
                    _single_published_conflict_detail(body.exercise_type, live_orders),
                ) from None
            raise HTTPException(
                409,
                "Exercise block was created concurrently. Reload canonical data before retrying.",
            ) from None
        raise
    rows = result.data or []
    if not rows:
        raise HTTPException(500, "Exercise insert was not confirmed by the database.")
    return {
        "ok": True,
        "exercise_id": exercise_id,
        "created": True,
        "updated_at": rows[0].get("updated_at"),
    }


@admin_router.get("/exercises")
async def admin_list_listening_exercises(
    content_id: str = Query(..., min_length=1, max_length=64),
    exercise_type: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """List exercises for a content row. Admin variant — sees draft +
    archived rows in addition to published. Used by the segment editor
    to load existing segments on re-edit.
    """
    await require_admin(authorization)

    if exercise_type is not None and exercise_type not in _EXERCISE_TYPES:
        raise HTTPException(
            422, f"exercise_type must be one of {sorted(_EXERCISE_TYPES)}",
        )

    q = (
        supabase_admin.table("listening_exercises")
        .select("*")
        .eq("content_id", content_id)
        .order("order_num", desc=False)
    )
    if exercise_type:
        q = q.eq("exercise_type", exercise_type)
    res = q.execute()
    return {"exercises": res.data or []}


@admin_router.delete("/exercises/{exercise_id}")
async def admin_delete_listening_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    """Soft-delete an exercise via status='archived' (Sprint 10.6 vocab
    archive pattern). Hard delete reserved for admin-only DB ops because
    listening_attempts has a FK CASCADE that would lose user history.
    """
    await require_admin(authorization)

    res = (
        supabase_admin.table("listening_exercises")
        .select("id,status")
        .eq("id", exercise_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Exercise not found")

    from datetime import datetime, timezone
    supabase_admin.table("listening_exercises").update({
        "status": "archived",
        # Keep the API truthful even during a rolling deploy before migration
        # 208's trigger is present on every environment.
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", exercise_id).execute()

    return {"ok": True, "exercise_id": exercise_id, "status": "archived"}


# ══════════════════════════════════════════════════════════════════════════════
# Sprint 11.5 — content browse, analytics (+ shared first-attempt helper)
# ══════════════════════════════════════════════════════════════════════════════


# ── User route — content browse (Sprint 11.5) ─────────────────────────────────


@user_router.get("/content", response_model=ListeningContentListResponse)
async def list_listening_content(
    accent_tag: str | None = Query(default=None),
    cefr_level: str | None = Query(default=None),
    ielts_section: int | None = Query(default=None, ge=1, le=4),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """List published listening_content for the user browse page.

    Filters: accent_tag, cefr_level, ielts_section. Returns metadata
    only (no signed URL) — user clicks a card to open the dictation/gist
    /tf/mcq page with `?content_id=...`.
    """
    user = await _require_auth(authorization)

    if accent_tag is not None and accent_tag not in _ACCENT_VALUES:
        raise HTTPException(
            422, f"accent_tag must be one of {sorted(_ACCENT_VALUES)}",
        )
    if cefr_level is not None and cefr_level not in _CEFR_VALUES:
        raise HTTPException(
            422, f"cefr_level must be one of {sorted(_CEFR_VALUES)}",
        )

    # Resolve eligibility before pagination. Reserved/unfinished test sections
    # otherwise occupy the first page while the launchable content is buried.
    content_rows = await run_in_threadpool(
        _published_content_rows, accent_tag=accent_tag, cefr_level=cefr_level,
        ielts_section=ielts_section, newest_first=True,
    )
    content_rows = _drop_hidden_content(
        content_rows, await run_in_threadpool(_hidden_listening_ids, user))
    # Standalone modes sign the section's own audio. A public parent can use
    # assembled audio even when the section is only a render placeholder.
    audio_content_ids = [row["id"] for row in content_rows
                         if str(row.get("audio_storage_path") or "").strip()]
    parent_result, modes_result = await asyncio.gather(
        run_in_threadpool(_browse_public_parents, content_rows),
        run_in_threadpool(_published_content_modes, audio_content_ids),
        return_exceptions=True,
    )
    if isinstance(parent_result, BaseException):
        logger.warning("[listening] parent practice lookup failed: %s", parent_result)
        raise HTTPException(503, "Listening catalogue temporarily unavailable")
    parents = parent_result
    modes_lookup_failed = isinstance(modes_result, BaseException)
    if modes_lookup_failed:
        logger.warning("[listening] available_modes lookup failed: %s", modes_result)
        # Readiness determines membership/total for standalone content. A
        # failure cannot truthfully be reported as zero eligible exercises.
        if any(str(row.get("audio_storage_path") or "").strip()
               and str(row.get("test_id") or "") not in parents for row in content_rows):
            raise HTTPException(503, "Listening catalogue temporarily unavailable")
        modes_by_content = {}
    else:
        modes_by_content, _ = modes_result
    standalone_modes = {"dictation", "gist", "true_false", "mcq"}
    eligible_rows = [row for row in content_rows
                     if str(row.get("test_id") or "") in parents
                     or standalone_modes.intersection(modes_by_content.get(str(row["id"]), []))]
    total = len(eligible_rows)
    page_ids = [row["id"] for row in eligible_rows[offset:offset + limit]]
    if not page_ids:
        return {"items": [], "total": total, "limit": limit, "offset": offset,
                "modes_lookup_failed": modes_lookup_failed, "practice_lookup_failed": False}
    q = (
        supabase_admin.table("listening_content")
        .select(
            "id,title,description,accent_tag,cefr_level,ielts_section,"
            "topic_tags,audio_duration_seconds,is_premium,created_at,test_id",
        )
        .eq("status", "published")
        .neq("source_type", "programme_form")
        .order("created_at", desc=True)
        .in_("id", page_ids)
        .order("id")
    )
    if accent_tag:
        q = q.eq("accent_tag", accent_tag)
    if cefr_level:
        q = q.eq("cefr_level", cefr_level)
    if ielts_section is not None:
        q = q.eq("ielts_section", ielts_section)

    res = await run_in_threadpool(q.execute)
    items = res.data or []
    for c in items:
        parent_id = str(c.pop("test_id", "") or "")
        parent = parents.get(parent_id)
        c["practice_test_id"] = str(parent["id"]) if parent else None
        c["practice_test_type"] = parent["test_type"] if parent else None
        c["available_modes"] = (
            None if modes_lookup_failed
            else sorted(standalone_modes.intersection(modes_by_content.get(str(c.get("id")), [])))
        )

    return {
        "items":  items,
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "modes_lookup_failed": modes_lookup_failed,
        "practice_lookup_failed": False,
    }


# ── User route — analytics (Sprint 11.5) ──────────────────────────────────────


_ANALYTICS_RANGES = {"7d", "30d", "all"}


@user_router.get("/analytics")
async def get_listening_analytics(
    time_range: str = Query(default="30d", alias="range"),
    authorization: str | None = Header(default=None),
):
    """Per-user listening analytics — nguồn: listening_test_attempts.

    Audit 2026-07-17: bảng listening_attempts (hệ exercise Sprint 11.x) đã chết
    từ 05/2026 — mọi hoạt động thật (lesson/mini · drill · full) ghi vào
    listening_test_attempts, nên thống kê đọc từ đó.

    Range buckets: 7d | 30d (default) | all.

    Aggregations:
      - total_attempts: mọi lượt trong range (engagement — gồm đang làm/bỏ dở)
      - by_mode: { mini, drill, full, practice } → {count, avg_score, completion}
        · count      = lượt ĐẦU per test (retry không đếm — Sprint 11.5.1 rule)
        · avg_score  = % đúng TB (score/số câu) của lượt đầu ĐÃ NỘP, 0..1
        · completion = tỉ lệ lượt đã nộp / mọi lượt của loại đó
      - by_day: 14 ngày gần nhất (count + avg_score theo ngày)
      - recent_attempts: 10 lượt gần nhất {type, title, status, accuracy, ...}
      - weakest_mode: loại có avg_score thấp nhất (≥3 lượt đã nộp), else null

    Per CLAUDE.md non-misleading-feedback rule: loại <3 lượt nộp không được
    gắn nhãn "yếu nhất".
    """
    user = await _require_auth(authorization)
    user_id = user["id"]

    if time_range not in _ANALYTICS_RANGES:
        raise HTTPException(
            422, f"range must be one of {sorted(_ANALYTICS_RANGES)}",
        )

    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    if time_range == "7d":
        cutoff = now - timedelta(days=7)
    elif time_range == "30d":
        cutoff = now - timedelta(days=30)
    else:
        cutoff = None

    q = (
        supabase_admin.table("listening_test_attempts")
        .select(
            "id,test_id,status,score,grading_details,created_at,submitted_at,"
            "scoring_policy,result_summary"
        )
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    if cutoff is not None:
        q = q.gte("created_at", cutoff.isoformat())
    attempts_raw = q.execute().data or []
    assisted_attempt_ids = _assisted_programme_attempt_ids([
        str(row["id"]) for row in attempts_raw
        if row.get("scoring_policy") == "report_only"
    ])

    # Resolve test_type + title theo lô (không dùng relational select).
    tests = _rows_by_id(
        "listening_tests",
        [r.get("test_id") for r in attempts_raw],
        "id,test_id,title,test_type",
    )

    flat: list[dict] = []
    from services.listening_test_grader import scored_question_count
    for r in attempts_raw:
        gd = r.get("grading_details") or []
        scored_count = scored_question_count(gd)
        submitted = r.get("status") == "submitted"
        acc = (
            round(r["score"] / scored_count, 4)
            if submitted and r.get("score") is not None and scored_count else None
        )
        tinfo = tests.get(r.get("test_id")) or {}
        flat.append({
            "id":         r["id"],
            "test_id":    r.get("test_id"),
            "type":       ("programme" if r.get("scoring_policy") == "report_only"
                           else tinfo.get("test_type") or "unknown"),
            "scoring_policy": r.get("scoring_policy") or "diagnostic",
            "assisted": str(r["id"]) in assisted_attempt_ids,
            "result_summary": r.get("result_summary") or {},
            "title":      tinfo.get("title") or tinfo.get("test_id"),
            "status":     r.get("status"),
            "accuracy":   acc,
            "score":      r.get("score"),
            "total_questions": scored_count if gd else None,
            "created_at": r["created_at"],
        })

    # First-attempt rule per test (giữ tinh thần Sprint 11.5.1): canonical cho
    # ĐIỂM là lượt NỘP đầu tiên của mỗi bài (lượt bỏ dở/đang làm không chiếm
    # slot — không có điểm để đại diện); mọi lượt vẫn đếm engagement/by_day.
    first_by_test: dict[str, dict] = {}       # lượt đầu (mọi status) — đếm bài đã đụng
    first_submitted: dict[str, dict] = {}     # lượt NỘP đầu — nguồn điểm canonical
    diagnostic_flat = [r for r in flat if r["scoring_policy"] == "diagnostic"]
    for r in reversed(diagnostic_flat):       # flat đang newest-first
        tid = r["test_id"]
        if not tid:
            continue
        if tid not in first_by_test:
            first_by_test[tid] = r
        if r["accuracy"] is not None and tid not in first_submitted:
            first_submitted[tid] = r
    flat_first = list(first_by_test.values())
    flat_first_submitted = list(first_submitted.values())

    # Every persisted test_type, or the dashboard contradicts itself: a
    # practice attempt would raise total_attempts and show up in daily/recent
    # activity while its score sat outside the average, the completion rate and
    # the weakest-mode pick. Keep this in step with the CHECK on
    # listening_tests.test_type (mig 157/173).
    types = ("mini", "drill", "full", "practice")
    by_mode: dict[str, dict] = {}
    for m in types:
        firsts = [r for r in flat_first if r["type"] == m]
        alls = [r for r in diagnostic_flat if r["type"] == m]
        accs = [r["accuracy"] for r in flat_first_submitted if r["type"] == m]
        by_mode[m] = {
            "count":      len(firsts),
            # scored_count/attempts_count: mẫu số đúng cho các chỉ số tổng hợp
            # phía client — count (bài đã đụng, gồm bỏ dở) KHÔNG được làm mẫu
            # số cho avg_score (chỉ tính bài đã nộp) (review P2, PR #809).
            "scored_count":   len(accs),
            "attempts_count": len(alls),
            "avg_score":  round(sum(accs) / len(accs), 4) if accs else None,
            "completion": (round(sum(1 for r in alls if r["status"] == "submitted")
                                 / len(alls), 4) if alls else None),
        }

    candidates = [
        (m, by_mode[m]["avg_score"])
        for m in types
        if by_mode[m]["avg_score"] is not None
        and sum(1 for r in flat_first_submitted if r["type"] == m) >= 3
    ]
    weakest_mode = min(candidates, key=lambda t2: t2[1])[0] if candidates else None

    # by_day — bin vào 14 ngày gần nhất (UTC), mọi lượt.
    by_day: list[dict] = []
    for day_offset in range(14):
        day_start = (now - timedelta(days=day_offset)).replace(
            hour=0, minute=0, second=0, microsecond=0,
        )
        day_end = day_start + timedelta(days=1)
        day_rows = [
            r for r in flat
            if day_start.isoformat() <= r["created_at"] < day_end.isoformat()
        ]
        day_accs = [r["accuracy"] for r in day_rows if r["accuracy"] is not None]
        by_day.append({
            "date":      day_start.date().isoformat(),
            "count":     len(day_rows),
            "avg_score": round(sum(day_accs) / len(day_accs), 4) if day_accs else None,
        })
    by_day.reverse()  # oldest first for chart rendering

    report_only_rows = [r for r in flat if r["scoring_policy"] == "report_only"]
    report_only_submitted = [r for r in report_only_rows if r["status"] == "submitted"]
    return {
        "range":           time_range,
        "total_attempts":  len(flat),
        "by_mode":         by_mode,
        "by_day":          by_day,
        "recent_attempts": flat[:10],
        "weakest_mode":    weakest_mode,
        "report_only": {
            "attempts_count": len(report_only_rows),
            "completed_count": len(report_only_submitted),
            "assisted_completed_count": sum(
                bool(row["assisted"]) for row in report_only_submitted
            ),
            "independent_completed_count": sum(
                not row["assisted"] for row in report_only_submitted
            ),
            "review_needed_count": sum(
                int((r.get("result_summary") or {}).get("unscored_count") or 0)
                for r in report_only_submitted
            ),
        },
    }


from . import admin_import
_reexport(admin_import)


from . import admin_audit
_reexport(admin_audit)


from . import student_fulltest
_reexport(student_fulltest)


from . import dictation
_reexport(dictation)


from . import attempts
_reexport(attempts)


_SUBMODULES = (_common, admin_import, admin_audit, student_fulltest, dictation, attempts)


class _SeamModule(_types.ModuleType):
    """Patch trên routers.listening lan xuống mọi module con đang giữ cùng tên,
    để monkeypatch/mock.patch tiếp tục tác dụng lên mã đã dời (BACKENDSPLIT-0076 FR-002).
    Không đổi hành vi chạy thật: mã sản phẩm không setattr lên package."""

    def __setattr__(self, name, value):
        holders = [sub for sub in _SUBMODULES if name in vars(sub)]
        if holders and name not in vars(self):
            raise AttributeError(
                f"routers.listening.{name} is defined in {holders[0].__name__} but not re-exported")
        super().__setattr__(name, value)
        for sub in holders:
            vars(sub)[name] = value

    def __delattr__(self, name):
        holders = [sub.__name__ for sub in _SUBMODULES if name in vars(sub)]
        if holders:
            raise TypeError("cannot delete a routers.listening name that a submodule also binds; "
                            "patch the value instead", name, holders)
        super().__delattr__(name)


_sys.modules[__name__].__class__ = _SeamModule
