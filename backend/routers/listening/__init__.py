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
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_row["id"],
        "mode":             "true_false",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],
        "correct":          graded["correct"],
        "total":            graded["total"],
        "is_correct":       graded["is_correct"],
        "details":          graded["details"],
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


# ── Admin: lượt làm bài nghe của học viên (mini/drill/full) ──────────────────
# Audit 2026-07-17 (AUDIT_LISTENING_ACTIVITY_REPORTING): listening_test_attempts
# giữ toàn bộ hoạt động thật của học viên nhưng không có mặt đọc admin nào —
# 2 endpoint dưới đây trả lời "ai làm bài nào, bao lâu, đúng bao nhiêu, sai ở đâu".


def _iso_to_dt(s):
    from datetime import datetime
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def _attempt_duration_seconds(row: dict) -> int | None:
    """Thời lượng làm bài = submitted_at - started_at (None khi chưa nộp)."""
    a = _iso_to_dt(row.get("started_at"))
    b = _iso_to_dt(row.get("submitted_at"))
    if not a or not b:
        return None
    return max(0, int((b - a).total_seconds()))


def _attempt_public_shape(r: dict, users: dict, tests: dict) -> dict:
    from services.listening_test_grader import scored_question_count
    gd = r.get("grading_details") or []
    total_q = scored_question_count(gd) if gd else None
    score = r.get("score")
    u = users.get(r.get("user_id")) or {}
    t = tests.get(r.get("test_id")) or {}
    # Never infer a historical attempt's policy from an edited current test.
    # Unversioned legacy rows use the same diagnostic default as submit/review.
    scoring_policy = r.get("scoring_policy") or "diagnostic"
    if scoring_policy not in {"diagnostic", "report_only"}:
        raise HTTPException(503, "Không đọc được chế độ tính điểm đã lưu của lượt làm bài.")
    return {
        "id":               r.get("id"),
        "status":           r.get("status"),
        "scoring_policy":   scoring_policy,
        **listening_score_fields(score, gd),
        "total_questions":  total_q,
        "accuracy":         (round(score / total_q, 4)
                             if score is not None and total_q else None),
        "duration_seconds": _attempt_duration_seconds(r),
        # KHÔNG trả audio_duration_listened_seconds: chưa có write path nào ghi
        # nó (luôn = default 0 của mig 068) — hiện "Đã nghe 0s" là misleading.
        # Thêm lại khi có tracking playback thật (review P1, PR #808).
        "started_at":       r.get("started_at"),
        "submitted_at":     r.get("submitted_at"),
        "created_at":       r.get("created_at"),
        "user": {"id": r.get("user_id"), "email": u.get("email"),
                 "display_name": u.get("display_name")},
        "test": {"id": r.get("test_id"), "test_id": t.get("test_id"),
                 "title": t.get("title"), "test_type": t.get("test_type")},
    }


@admin_router.get("/attempts", response_model=AdminListeningAttemptListResponse)
async def admin_list_listening_attempts(
    user_query: str | None = Query(default=None),
    test_query: str | None = Query(default=None),
    test_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Admin: list lượt làm bài nghe (newest first) kèm danh tính học viên + bài.

    - user_query: khớp email/display_name (ilike) — admin gõ tên/email, không UUID.
    - test_query: khớp test_id ngoài (ILR-LIS-…) hoặc title (ilike).
    - test_type: full | mini | drill | practice. status: in_progress | submitted | abandoned.
    Trả {items, total, limit, offset}; item KHÔNG mang grading_details (xem detail).
    """
    await require_admin(authorization)

    if status and status not in {"in_progress", "submitted", "abandoned"}:
        raise HTTPException(422, "status phải là in_progress | submitted | abandoned.")
    # Mọi giá trị test_type mà listening_tests cho phép (CHECK, migration 173)
    # đều phải lọc được ở đây — nếu không, lượt làm bài của loại mới vẫn nằm
    # trong listening_test_attempts nhưng admin không có cách nào lọc ra.
    if test_type and test_type not in {"full", "mini", "drill", "practice"}:
        raise HTTPException(422, "test_type phải là full | mini | drill | practice.")

    # Resolve các filter dạng text → danh sách id TRƯỚC khi query attempts.
    user_ids: list | None = None
    if user_query:
        u_res = (supabase_admin.table("users").select("id")
                 .or_(ilike_or_filter(["email", "display_name"], user_query.strip()))
                 .limit(200).execute())
        user_ids = [r["id"] for r in (u_res.data or [])]
        if not user_ids:
            return {
                "items": [], "total": 0, "limit": limit, "offset": offset,
                "association_lookup_failed": False,
                "association_lookup_failures": [],
            }

    test_ids: list | None = None
    if test_query or test_type:
        t_q = supabase_admin.table("listening_tests").select("id")
        if test_query:
            t_q = t_q.or_(ilike_or_filter(["test_id", "title"], test_query.strip()))
        if test_type:
            t_q = t_q.eq("test_type", test_type)
        t_res = t_q.limit(1000).execute()
        test_ids = [r["id"] for r in (t_res.data or [])]
        if not test_ids:
            return {
                "items": [], "total": 0, "limit": limit, "offset": offset,
                "association_lookup_failed": False,
                "association_lookup_failures": [],
            }

    q = (supabase_admin.table("listening_test_attempts")
         .select("id,user_id,test_id,status,score,grading_details,started_at,"
                 "submitted_at,created_at,scoring_policy", count="exact"))
    if status:
        q = q.eq("status", status)
    if user_ids is not None:
        q = q.in_("user_id", user_ids)
    if test_ids is not None:
        q = q.in_("test_id", test_ids)
    q = await run_in_threadpool(blackeye.exclude_tests, supabase_admin, q, key="test_id")
    res = q.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    rows = res.data or []

    lookup_failures: set[str] = set()
    users = _rows_by_id("users", [r.get("user_id") for r in rows],
                        "id,email,display_name", lookup_failures=lookup_failures)
    tests = _rows_by_id("listening_tests", [r.get("test_id") for r in rows],
                        "id,test_id,title,test_type", lookup_failures=lookup_failures)
    return {
        "items": [_attempt_public_shape(r, users, tests) for r in rows],
        "total": getattr(res, "count", None) or 0,
        "limit": limit, "offset": offset,
        # Không được biến lỗi join thành danh tính/bài thật sự trống. UI admin
        # cần phân biệt canonical absence với visibility/read failure.
        "association_lookup_failed": bool(lookup_failures),
        "association_lookup_failures": sorted(lookup_failures),
    }


@admin_router.get("/attempts/{attempt_id}", response_model=AdminListeningAttemptDetailResponse)
async def admin_get_listening_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    """Admin: chi tiết 1 lượt làm bài — per-question grading_details (học viên trả
    lời gì, đáp án, trap caught/missed) + trap_analytics + band ước lượng."""
    await require_admin(authorization)
    await run_in_threadpool(blackeye.guard_generic_target, supabase_admin, attempt_id=attempt_id)
    res = (supabase_admin.table("listening_test_attempts").select("*")
           .eq("id", attempt_id).limit(1).execute())
    if not res.data:
        raise HTTPException(404, "Không tìm thấy lượt làm bài.")
    r = res.data[0]
    lookup_failures: set[str] = set()
    users = _rows_by_id("users", [r.get("user_id")], "id,email,display_name",
                        lookup_failures=lookup_failures)
    tests = _rows_by_id("listening_tests", [r.get("test_id")],
                        "id,test_id,title,test_type", lookup_failures=lookup_failures)
    out = _attempt_public_shape(r, users, tests)
    out["grading_details"] = r.get("grading_details") or []
    out["trap_analytics"] = r.get("trap_analytics") or {}
    out["band_estimate"] = r.get("band_estimate")
    out["association_lookup_failed"] = bool(lookup_failures)
    out["association_lookup_failures"] = sorted(lookup_failures)
    return out


@user_router.get("/tests/{test_id}/attempts/in-progress", response_model=BlackEyeInProgress | dict[str, Any])
async def get_in_progress_listening_attempt(
    test_id: str,
    sitting_id: str | None = None,
    class_item: str | None = None,
    authorization: str | None = Header(default=None),
    standalone: bool = False,
):
    """The caller's still-open attempt at this test, or null.

    Exists so a Listening runner can RESUME instead of starting over. Without
    it the only path to an attempt was POST /attempts, which abandons the
    previous one and mints an empty replacement — so a refresh (or, inside a
    4-skill mock, the embed's automatic start-click) silently destroyed every
    answer the student had given.

    `sitting_id` SCOPES the lookup to one mock sitting, and the mock runner
    always sends it. Without that scope the query matched on (user, test,
    in_progress) alone, so a student who already had a STANDALONE practice
    attempt open on a test later reused by a mock exam would have the embed
    auto-resume that practice attempt and attach_attempt bind it to the sealed
    sitting — pulling practice answers into a real exam and corrupting both.
    Legacy callers keep the unscoped class lookup. New free-practice runners
    send `standalone=true`, which excludes both class and mock attempts.

    Deliberately a separate endpoint rather than a field on the shared test
    bundle: that bundle is served to several callers and is cacheable, while
    this is per-user and must never be cached.
    """
    user = await _require_auth(authorization)
    if standalone and (class_item or sitting_id):
        raise HTTPException(422, "standalone cannot be combined with class_item or sitting_id")
    target = await run_in_threadpool(blackeye.test_identity, supabase_admin, test_id, missing_status=None)
    if blackeye.is_blackeye(target):
        await run_in_threadpool(blackeye.require_published, supabase_admin, target)
        if class_item or sitting_id or not standalone:
            blackeye.assignment_seam()
        rows = await run_in_threadpool(lambda: (supabase_admin.table("listening_test_attempts").select("*")
                .eq("user_id", user["id"]).eq("test_id", test_id)
                .eq("status", "in_progress").is_("class_assignment_item_id", "null")
                .is_("sitting_id", "null").order("created_at", desc=True).limit(1).execute().data or []))
        if not rows:
            raise HTTPException(404, "Black Eye attempt unavailable.")
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        state = await run_in_threadpool(blackeye.state, supabase_admin, rows[0])
        return JSONResponse({"attempt": jsonable_encoder(state)},
                            headers={"Cache-Control": "private, no-store"})
    query = (
        supabase_admin.table("listening_test_attempts")
        .select(
            "id, started_at, created_at, answers, renderer_affinity, "
            "resume_expires_at, status, playback_started_at,user_id,test_id,sitting_id,"
            "class_assignment_item_id,attempt_purpose,paper_revision,policy_revision"
        )
        .eq("user_id", user["id"])
        .eq("test_id", test_id)
        .eq("status", "in_progress")
    )
    # `class_item` scopes to ONE homework, for the same reason `sitting_id`
    # scopes to one sitting. Resuming is the only path that skips attempt
    # creation, and creation is where the class link is stamped — so without
    # this a student opening their homework would be offered an unfinished
    # free-practice attempt on the same test, resume it, submit it, and the
    # class would still show the task as owed.
    #
    # ONE-WAY, like nothing else here: opening the test from the library
    # (no class_item) may still resume a LINKED homework attempt. The student is
    # finishing work they started, and the link they already earned stands.
    if standalone:
        query = query.is_("class_assignment_item_id", "null")
    elif class_item:
        query = query.eq("class_assignment_item_id", class_item)
    elif not sitting_id:
        test_query = supabase_admin.table("listening_tests").select("test_type").eq("id", test_id).limit(1)
        kind = (await run_in_threadpool(test_query.execute)).data or []
        if kind and kind[0].get("test_type") == "drill":
            query = query.is_("class_assignment_item_id", "null")


    if sitting_id:
        query = query.eq("sitting_id", sitting_id)
    else:
        # STANDALONE must exclude mock attempts, or the mirror of the bug above
        # opens: a student with a live mock attempt who opens the same published
        # test from the normal Listening library would resume the SEALED exam
        # attempt. MockHook is inactive there, so they could replay the audio
        # from the start and edit exam answers outside the runner — and pressing
        # "Bắt đầu test" would abandon their mock attempt outright
        # (Codex review, PR #834).
        query = query.is_("sitting_id", "null")
    res = query.order("created_at", desc=True).limit(1).execute()
    if not res.data or not is_resume_active(res.data[0]):
        return {"attempt": None}
    row = res.data[0]
    from services.mock_paper_policy import guard_owned_attempt, attempt_receipt
    guard_owned_attempt(supabase_admin, "listening", row, purpose="resume")
    from services.mock_attempt_flags import review_flag_state
    return {
        "attempt": {
            **attempt_receipt(row),
            **review_flag_state(supabase_admin, "listening", row),
            "attempt_id": row["id"],
            "started_at": row.get("started_at") or row.get("created_at"),
            # Only answers with real content — a blank row is not progress and
            # would make the resume screen overstate what was recovered.
            "answers": [
                a for a in (row.get("answers") or [])
                if str(a.get("user_answer") or "").strip()
            ],
            "renderer_affinity": row.get("renderer_affinity"),
            "resume_expires_at": row.get("resume_expires_at"),
            "playback_started_at": row.get("playback_started_at"),
        }
    }


@user_router.post("/tests/{test_id}/attempts", response_model=BlackEyeAttemptState | dict[str, Any])
@observe_operation("listening_test", "start", correlate_by=("test_id", "body", "class_item"))
async def start_listening_test_attempt(
    test_id: str,
    body: _ListeningAttemptStartRequest | None = None,
    class_item: str | None = None,
    authorization: str | None = Header(default=None),
    standalone: bool = False,
):
    """Open a student attempt session.

    Standalone report-only programme forms atomically resume-or-create their
    canonical active attempt in Postgres. Other Listening surfaces retain the
    explicit start-over contract: any previous open attempt for the same
    (user, test) is abandoned before a replacement is created.

    NOTE: outside the standalone report-only path this remains destructive by
    design. A caller that wants to CONTINUE must first check GET
    /tests/{test_id}/attempts/in-progress — see that endpoint's docstring.
    """
    user = await _require_auth(authorization)
    if standalone and class_item:
        raise HTTPException(422, "standalone cannot be combined with class_item")

    # Verify the test is published + has audio.
    test_res = (
        supabase_admin.table("listening_tests")
        .select("id,status,exam_only,is_public,public_practice_enabled,full_audio_storage_path,"
                "assembled_audio_storage_path,scoring_policy,content_package_id,test_type,programme_id,metadata")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not test_res.data or test_res.data[0].get("status") != "published":
        raise HTTPException(404, "Test bundle not found or not published")
    test_row = test_res.data[0]
    if blackeye.is_blackeye(test_row):
        # Reuse the trusted row; no second test read or generic assembler.
        result = await run_in_threadpool(blackeye.start, supabase_admin, test_row, user["id"], body.blackeye_binding if body else None,
            standalone=standalone, class_item=class_item, purpose=body.purpose if body else None,
            sitting_id=body.mock_sitting_id if body else None,
            protocol=body.renderer_affinity_protocol if body else None)
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        return JSONResponse(jsonable_encoder(result), headers={"Cache-Control": "private, no-store"})
    if body and body.blackeye_binding is not None:
        raise HTTPException(422, "Black Eye binding does not match target.")
    decision = _assert_listening_exam_content_allowed(test_row, user.get("id"), class_item,
        purpose=body.purpose if body and body.purpose else "delivery",
        sitting_id=body.mock_sitting_id if body else None, allow_admission=True)
    if not (test_row.get("full_audio_storage_path")
            or test_row.get("assembled_audio_storage_path")):
        raise HTTPException(422, "Test chưa có audio sẵn sàng.")

    if decision["attempt_purpose"] == "mock_delivery":
        if standalone or class_item:
            raise HTTPException(422, "mock_delivery cannot be combined with standalone or class_item")
        from services.mock_paper_policy import admit_mock_attempt
        admit_start()
        admitted = admit_mock_attempt(supabase_admin, "listening", test_id, user["id"],
            decision["mock_sitting_id"], affinity_protocol=body.renderer_affinity_protocol if body else None)
        bind_owned_attempt({"id": admitted["attempt_id"], "test_id": test_id,
            "user_id": user["id"], "status": admitted["status"]}, started=not admitted.get("acquired_existing"))
        from services.mock_attempt_flags import review_flag_state
        return {**admitted, **review_flag_state(supabase_admin, "listening", {"id": admitted["attempt_id"]})}

    # Imported programme forms have one canonical standalone resume-or-create
    # path. The legacy start-over path abandons the previous row before its
    # INSERT; a drain-trigger rejection there would erase a valid old attempt.
    if (test_row.get("content_package_id")
            and test_row.get("scoring_policy") == "report_only"
            and not standalone):
        raise HTTPException(422, "Bài trong chương trình Listening cần mở ở chế độ luyện tập.")

    if class_item:
        try:
            validate_class_item_for_test(
                supabase_admin, user["id"], class_item,
                skill="listening", test_id=test_id,
            )
        except DeadlinePassedError as exc:
            # 409, cùng mã với /start: hạn có thể trôi qua GIỮA lúc trang lớp
            # gọi /start và lúc trang đề tạo lượt làm bài. Không bắt ở đây thì
            # học viên nhận 500 — đọc ra là lỗi hệ thống chứ không phải
            # "em hết giờ rồi".
            raise HTTPException(409, str(exc))
        except (ItemNotFoundError, TaskMismatchError) as exc:
            raise HTTPException(400, str(exc))

    admit_start()
    affinity_aware = body is not None and body.renderer_affinity_protocol == "claim-v1"
    if standalone and test_row.get("scoring_policy") == "report_only":
        try:
            acquired = supabase_admin.rpc(
                "fn_acquire_listening_programme_attempt_v2",
                {
                    "p_test_id": test_id,
                    "p_user_id": user["id"],
                    "p_renderer_affinity_protocol": (
                        "claim-v1" if affinity_aware else "legacy"
                    ),
                },
            ).execute()
        except Exception as exc:
            if "listening_programme_new_starts_paused" in str(exc):
                raise HTTPException(
                    409,
                    "Chương trình đang chuyển phiên bản. Bạn vẫn có thể hoàn thành lượt đang dở.",
                ) from exc
            logger.error(
                "[listening-programme-attempt] acquire failed test=%s user=%s: %s",
                test_id,
                user["id"],
                exc,
            )
            raise HTTPException(
                500, "Không thể mở lượt luyện nghe. Hãy thử lại."
            ) from exc

        rows = acquired.data or []
        if len(rows) != 1:
            raise HTTPException(500, "Không thể xác định lượt luyện nghe.")
        acquired_row = rows[0]
        created = acquired_row.get("created") is True
        attempt_id = str(acquired_row.get("attempt_id") or "")
        if not attempt_id:
            raise HTTPException(500, "Lượt luyện nghe không có định danh hợp lệ.")
        observation_row = {
            "id": attempt_id,
            "test_id": test_id,
            "user_id": user["id"],
            "status": acquired_row.get("attempt_status") or "in_progress",
            "renderer_affinity": acquired_row.get("attempt_renderer_affinity"),
        }
        bind_owned_attempt(observation_row, started=created)
        canonical = _fetch_attempt_or_404(attempt_id, user["id"])
        from services.mock_paper_policy import attempt_receipt, guard_owned_attempt
        from services.mock_attempt_flags import review_flag_state
        guard_owned_attempt(supabase_admin, "listening", canonical, purpose="resume")
        return {
            **attempt_receipt(canonical),
            **review_flag_state(supabase_admin, "listening", canonical),
            "attempt_id": attempt_id,
            "status": observation_row["status"],
            "started_at": acquired_row.get("attempt_started_at"),
            "resume_expires_at": acquired_row.get("attempt_resume_expires_at"),
            "answers": acquired_row.get("attempt_answers") or [],
            "renderer_affinity": acquired_row.get("attempt_renderer_affinity"),
            "playback_started_at": acquired_row.get(
                "attempt_playback_started_at"
            ),
            "acquired_existing": not created,
        }

    # Abandon any open attempts for this (user, test).
    abandon_query = (
        supabase_admin.table("listening_test_attempts")
        .update({"status": "abandoned"})
        .eq("user_id", user["id"])
        .eq("test_id", test_id)
        .eq("status", "in_progress")
    )
    if standalone:
        abandon_query = (
            abandon_query
            .is_("class_assignment_item_id", "null")
            .is_("sitting_id", "null")
        )
    if test_row.get("test_type") == "drill":
        abandon_query = (abandon_query.eq("class_assignment_item_id", class_item) if class_item
                         else abandon_query.is_("class_assignment_item_id", "null"))
        abandon_query = abandon_query.is_("sitting_id", "null")
    abandoned_result = abandon_query.execute()
    note_abandoned_exam_attempts(abandoned_result, test_id=test_id, user_id=user["id"])

    attempt_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    expires_at = resume_expires_at(started_at)
    payload = {
        "id":      attempt_id,
        "test_id": test_id,
        "user_id": user["id"],
        "attempt_purpose": decision["attempt_purpose"],
        "status":  "in_progress",
        "answers": [],
        "scoring_policy": test_row.get("scoring_policy") or "diagnostic",
        "started_at": started_at,
        "resume_expires_at": expires_at,
    }
    if affinity_aware:
        payload["renderer_affinity"] = None
    # Class homework: stamp WHICH task this is being done for, so the ledger
    # never has to work it out afterwards (mig 181).
    if class_item:
        payload["class_assignment_item_id"] = class_item
    inserted = (
        supabase_admin.table("listening_test_attempts")
        .insert(payload)
        .execute()
    )
    bind_owned_attempt(payload, started=True)
    from services.mock_paper_policy import attempt_receipt
    from services.mock_attempt_flags import review_flag_state
    canonical = inserted.data[0] if inserted.data else payload
    return {
        **attempt_receipt(canonical),
        **review_flag_state(supabase_admin, "listening", canonical),
        "attempt_id": attempt_id,
        "status": "in_progress",
        "started_at": started_at,
        "resume_expires_at": expires_at,
        "renderer_affinity": None if affinity_aware else "legacy",
        "playback_started_at": None,
    }


class DrillPlaybackCheckpoint(BaseModel):
    stage: Literal["listening", "dictation"]
    page_id: uuid.UUID
    plays: int = Field(ge=0, le=120)
    played_ms: int = Field(ge=0, le=3600000)


_drill_checkpoint_requests: dict[str, deque[float]] = {}


def _limit_drill_checkpoint_requests(user_id: str) -> None:
    now = time.monotonic()
    cutoff = now - 60
    if len(_drill_checkpoint_requests) > 4096:
        for key in [key for key, hits in _drill_checkpoint_requests.items() if not hits or hits[-1] <= cutoff]:
            del _drill_checkpoint_requests[key]
    hits = _drill_checkpoint_requests.setdefault(user_id, deque())
    while hits and hits[0] <= cutoff:
        hits.popleft()
    if len(hits) >= 60:
        retry = max(1, int(hits[0] - cutoff) + 1)
        raise HTTPException(429, "Đang gửi quá nhiều cập nhật audio.", headers={"Retry-After": str(retry)})
    hits.append(now)


@user_router.post("/skill-drill-playback/{attempt_id}", status_code=204)
async def record_skill_drill_playback(
    attempt_id: uuid.UUID, body: DrillPlaybackCheckpoint,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    _limit_drill_checkpoint_requests(user["id"])
    await run_in_threadpool(_record_skill_drill_playback, str(attempt_id), body, user["id"])


def _record_skill_drill_playback(attempt_id: str, body: DrillPlaybackCheckpoint, user_id: str) -> None:
    from services.listening_drill_homework import drill_config
    lookup = _fetch_attempt_or_404 if body.stage == "listening" else _dictation_attempt_or_404
    attempt = lookup(attempt_id, user_id)
    item_id = attempt.get("class_assignment_item_id")
    if not item_id:
        raise HTTPException(404, "Lượt làm không thuộc bài luyện kỹ năng được giao.", headers={"Cache-Control": "private, no-store"})
    if body.stage == "listening":
        if blackeye.attempt_is_blackeye(supabase_admin, attempt):
            raise HTTPException(404, "Black Eye resource unavailable.", headers={"Cache-Control": "private, no-store"})
    else:
        blackeye.guard_generic_target(supabase_admin, test_id=attempt.get("test_id"))
    if attempt.get("status") != "in_progress":
        raise HTTPException(409, "Lượt làm bài đã kết thúc.", headers={"Cache-Control": "private, no-store"})
    try:
        assignment = validate_class_item_for_test(
            supabase_admin, user_id, item_id, skill="listening", test_id=attempt["test_id"])
    except (ItemNotFoundError, TaskMismatchError) as exc:
        raise HTTPException(404, str(exc), headers={"Cache-Control": "private, no-store"}) from exc
    except DeadlinePassedError as exc:
        raise HTTPException(409, str(exc), headers={"Cache-Control": "private, no-store"}) from exc
    if drill_config(assignment) is None:
        raise HTTPException(404, "Lượt làm không thuộc bài luyện kỹ năng được giao.", headers={"Cache-Control": "private, no-store"})
    try:
        supabase_admin.rpc("fn_record_listening_drill_playback_v2", {
            "p_item_id": item_id, "p_stage": body.stage, "p_attempt_id": attempt_id,
            "p_page_id": str(body.page_id), "p_plays": body.plays, "p_played_ms": body.played_ms,
        }).execute()
    except APIError as exc:
        if exc.code == "55000" and exc.message == "skill_drill_attempt_inactive":
            raise HTTPException(409, "Lượt làm bài đã kết thúc.", headers={"Cache-Control": "private, no-store"}) from exc
        if exc.code == "55000" and exc.message == "skill_drill_checkpoint_scope":
            raise HTTPException(404, "Không tìm thấy trang phát audio của lượt làm bài.", headers={"Cache-Control": "private, no-store"}) from exc
        raise

@user_router.post("/tests/attempts/{attempt_id}/playback-started")
async def acknowledge_listening_attempt_playback_started(
    attempt_id: uuid.UUID,
    body: _ListeningAttemptPlaybackStartedRequest,
    authorization: str | None = Header(default=None),
):
    """Atomically persist the single-play start for a report-only attempt.

    The browser calls this only after ``HTMLMediaElement.play()`` resolves.
    ``playback_claim_id`` makes a lost response safely retryable from the same
    page, while a second browser/device receives ``accepted=false`` and must
    stop its player. Once persisted, the player bundle no longer contains a
    signed audio URL for this attempt.
    """
    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(str(attempt_id), user["id"])
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        raise HTTPException(503, "Black Eye player contract unavailable.")
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt không còn hoạt động.")
    require_resume_active(attempt)
    test_rows = (
        supabase_admin.table("listening_tests")
        .select("id,replay_policy,scoring_policy")
        .eq("id", attempt.get("test_id"))
        .limit(1)
        .execute().data or []
    )
    if not test_rows:
        raise HTTPException(404, "Test bundle not found")
    test = test_rows[0]
    if test.get("replay_policy") != "once" or test.get("scoring_policy") != "report_only":
        raise HTTPException(422, "Attempt này không dùng chính sách nghe một lượt.")

    claim_id = str(body.playback_claim_id)
    started_at = datetime.now(timezone.utc).isoformat()
    claimed = (
        supabase_admin.table("listening_test_attempts")
        .update({
            "playback_started_at": started_at,
            "playback_claim_id": claim_id,
        })
        .eq("id", str(attempt_id))
        .eq("user_id", user["id"])
        .eq("status", "in_progress")
        .is_("playback_started_at", "null")
        .execute().data or []
    )
    if claimed:
        return {
            "attempt_id": str(attempt_id),
            "accepted": True,
            "playback_started_at": claimed[0].get("playback_started_at") or started_at,
        }

    canonical = _fetch_attempt_or_404(str(attempt_id), user["id"])
    if canonical.get("status") != "in_progress":
        raise HTTPException(422, "Attempt không còn hoạt động.")
    require_resume_active(canonical)
    canonical_started_at = canonical.get("playback_started_at")
    if not canonical_started_at:
        raise HTTPException(503, "Không thể xác nhận lượt nghe — hãy thử lại.")
    return {
        "attempt_id": str(attempt_id),
        "accepted": canonical.get("playback_claim_id") == claim_id,
        "playback_started_at": canonical_started_at,
    }


@user_router.post("/tests/attempts/{attempt_id}/renderer-affinity")
async def claim_listening_attempt_renderer_affinity(
    attempt_id: uuid.UUID,
    body: _ListeningAttemptRendererAffinityRequest,
    authorization: str | None = Header(default=None),
):
    """Claim a stable Listening player on first boot; never move it later."""
    user = await _require_auth(authorization)
    owned_attempt = _fetch_attempt_or_404(str(attempt_id), user["id"])
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, owned_attempt):
        raise HTTPException(503, "Black Eye player contract unavailable.")
    require_resume_active(owned_attempt)
    try:
        result = supabase_admin.rpc(
            "fn_claim_listening_attempt_renderer_affinity",
            {
                "p_attempt_id": str(attempt_id),
                "p_user_id": user["id"],
                "p_renderer_affinity": body.renderer_affinity,
            },
        ).execute()
    except Exception as exc:
        logger.error(
            "[listening-renderer-affinity] claim failed attempt=%s renderer=%s: %s",
            attempt_id,
            body.renderer_affinity,
            exc,
        )
        if is_active_player_expired_error(exc):
            require_resume_active(owned_attempt)
            raise HTTPException(410, "Attempt đã hết thời gian tiếp tục.") from exc
        raise HTTPException(
            500, "Không thể xác nhận phiên bản player. Hãy tải lại trang."
        )

    rows = result.data or []
    if len(rows) != 1:
        raise HTTPException(404, "Attempt không tồn tại")
    affinity = rows[0].get("renderer_affinity")
    if affinity not in {"legacy", "next"}:
        raise HTTPException(500, "Attempt chưa có renderer hợp lệ")
    return {"attempt_id": str(attempt_id), "renderer_affinity": affinity}


async def _is_admin(authorization: str | None) -> bool:
    """Soft admin check — returns bool, never raises (mirrors routers/health.py
    and the analogous helper added to reading_student.py, 2026-07-12)."""
    if not authorization:
        return False
    from routers.admin import require_admin as _staff_admin_guard
    try:
        await _staff_admin_guard(authorization)
        return True
    except Exception:
        return False


def _mock_sealed(attempt: dict) -> bool:
    """True when this attempt belongs to a still-sealed 4-skill mock sitting.

    The submit/result/review endpoints check this to withhold scores until an
    admin releases the sitting — the server-side seal, not a hidden button."""
    sitting_id = attempt.get("sitting_id")
    if not sitting_id:
        return False
    from services import mock_exam_service
    return mock_exam_service.is_sealed(sitting_id)


@user_router.patch("/tests/attempts/{attempt_id}/answers", response_model=BlackEyeSaveAck | dict[str, Any])
# This shared route accepts Black Eye answers: retry correlation must never
# retain an answer-derived digest. The client operation ID scopes each intent.
@observe_operation("listening_test", "save", correlate_by=("attempt_id",))
async def patch_listening_test_attempt_answer(
    attempt_id: str,
    body: TestAttemptAnswerPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Incrementally save a single answer. The frontend debounces per gap; the
    backend treats this as an upsert keyed by ``q_num``.

    A4b — the merge happens inside ONE statement (fn_upsert_listening_answer,
    mig 161), not as a Python read-modify-write of the whole JSONB array. The
    old shape lost answers whenever two questions were saved at the same moment:
    both requests read the same array and both wrote their own version back, so
    the second silently erased the first. That is the NORMAL case, not an edge
    one — the client debounces per question, so concurrent saves of different
    q_nums are exactly what a fast typist produces.
    """
    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])   # ownership gate
    bind_owned_attempt(attempt)
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        from starlette.responses import JSONResponse
        saved = await run_in_threadpool(blackeye.save, supabase_admin, attempt, body.q_num, body.user_answer)
        ack = BlackEyeSaveAck.model_validate(saved)
        return JSONResponse(ack.model_dump(), headers={"Cache-Control": "private, no-store"})
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể edit.")
    require_resume_active(attempt)
    # CLASSARCHIVE-0030 FR-004: an archived class takes no new answer either,
    # also on an attempt started before the archive (same gate as submit).
    await asyncio.to_thread(
        require_class_attempt_accepts_work, supabase_admin, attempt, surface="listening")
    if not (1 <= body.q_num <= 40):
        raise HTTPException(422, "q_num must be in 1..40")
    # A practice attempt is scored on the FIRST answer to each question, which
    # this route cannot express: fn_upsert_listening_answer replaces by q_num.
    # Left open, it is a way around the whole rule — answer wrong through
    # /check, PATCH the right answer, submit, score inflated. The Luyện nhanh
    # runner never calls this; refuse rather than quietly overwrite.
    if ((attempt.get("scoring_policy") or "diagnostic") == "diagnostic"
            and _attempt_test_type(attempt) == "practice"):
        raise HTTPException(
            422,
            "Luyện nhanh chấm từng câu theo lần trả lời đầu — dùng POST .../check.",
        )

    res = supabase_admin.rpc("fn_upsert_listening_answer", {
        "p_attempt_id":  attempt_id,
        "p_q_num":       body.q_num,
        "p_user_answer": body.user_answer,
    }).execute()
    count = res.data
    if count is None:
        # The RPC also enforces status='in_progress', so a NULL here means the
        # attempt was submitted between the check above and the write — a real
        # race, and the honest answer is that the edit did not land.
        require_resume_active(attempt)
        raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể edit.")
    from services import mock_correction_service
    performance_event_recorded = mock_correction_service.record_answer_commit(
        "listening", attempt_id, attempt.get("user_id"), body.q_num,
        body.user_answer or "",
    )
    return {
        "attempt_id": attempt_id,
        "answer_count": count,
        "performance_event_recorded": performance_event_recorded,
    }


def _attempt_test_type(attempt: dict) -> str:
    """The test_type behind an attempt.

    Fails CLOSED. An unresolvable test row used to come back as None, which
    every caller compares against "practice" and finds unequal — so the exact
    moment the lookup breaks is the moment a practice attempt slips past the
    guard built on it. There is no safe default here, so raise: refusing an
    answer save is recoverable, silently overwriting a canonical first answer
    is not.

    Costs one small indexed read per call. That is a real cost on the PATCH
    autosave path (once per answer); paid deliberately, because the shared
    attempt lookup returns the attempt row alone and widening it would change
    a shape half the Listening endpoints depend on.
    """
    res = (
        supabase_admin.table("listening_tests")
        .select("test_type").eq("id", attempt.get("test_id")).limit(1).execute()
    )
    kind = (res.data[0].get("test_type") if res.data else None)
    if not kind:
        raise HTTPException(500, "Không xác định được loại bài của lượt làm này.")
    return kind


def _source_required_for_test(test_id: str) -> bool:
    rows = (supabase_admin.table("listening_tests").select("programme_id")
            .eq("id", test_id).limit(1).execute().data or [])
    if len(rows) != 1:
        raise HTTPException(503, "Không xác định được chương trình của lượt làm; hãy thử lại.")
    return rows[0].get("programme_id") == SOURCE_PROGRAMME


def _practice_exercise_payloads(test_id: str, *, published_only: bool = False) -> list[dict]:
    """Every exercise payload belonging to a test, via its section rows."""
    sections = supabase_admin.table("listening_content").select("id").eq("test_id", test_id)
    if published_only:
        sections = sections.eq("status", "published")
    sec_res = sections.execute()
    section_ids = [r["id"] for r in (sec_res.data or [])]
    if not section_ids:
        raise HTTPException(500, "Test bundle thiếu section rows.")
    exercises = supabase_admin.table("listening_exercises").select("payload").in_("content_id", section_ids)
    if published_only:
        exercises = exercises.eq("status", "published")
    ex_res = exercises.execute()
    return ex_res.data or []


def _programme_guided_context(attempt: dict) -> tuple[dict, list[dict]]:
    """Check the report-only programme boundary before reading protected keys."""
    if blackeye.attempt_is_blackeye(supabase_admin, attempt):
        raise HTTPException(422, "Black Eye guided feedback unavailable.")
    if attempt.get("status") != "in_progress":
        raise HTTPException(409, "Bài luyện đã kết thúc; hãy mở phần đối chiếu sau bài.")
    require_resume_active(attempt)
    if (attempt.get("scoring_policy") != "report_only"
            or attempt.get("class_assignment_item_id")
            or attempt.get("sitting_id")):
        raise HTTPException(422, "Đối chiếu từng câu không áp dụng cho bài này.")
    from services.mock_paper_policy import guard_owned_attempt, load_marking_snapshot
    guard_owned_attempt(supabase_admin, "listening", attempt, purpose="guided_feedback")
    snapshot = load_marking_snapshot(supabase_admin, "listening", attempt)
    result = (
        supabase_admin.table("listening_tests")
        .select("id,status,is_public,scoring_policy,programme_id,replay_policy,content_package_id,metadata")
        .eq("id", attempt["test_id"]).limit(1).execute()
    )
    test = snapshot["paper_row"] if snapshot else (result.data[0] if result.data else None)
    if (not test or test.get("status") != "published"
            or not test.get("is_public")
            or test.get("scoring_policy") != "report_only"
            or test.get("programme_id") not in {
                "general-listening-practice", "ielts-listening-practice", SOURCE_PROGRAMME,
            }
            or not test.get("content_package_id")):
        raise HTTPException(422, "Bài luyện này chưa hỗ trợ đối chiếu từng câu.")
    package = (
        supabase_admin.table("listening_content_packages")
        .select("status").eq("id", test["content_package_id"])
        .limit(1).execute()
    )
    if not package.data or package.data[0].get("status") != "published":
        raise HTTPException(422, "Nội dung bài luyện hiện không khả dụng.")
    return test, snapshot["marking_rows"] if snapshot else _practice_exercise_payloads(attempt["test_id"], published_only=True)


def _programme_guided_item(
    reveal: dict, exercise_rows: list[dict], replay_policy: str, *, source_required: bool = False,
    audio_granularity: str | None = None,
) -> dict:
    from services.listening_programme_feedback import (
        FeedbackUnavailable, build_guided_feedback,
    )

    try:
        feedback = build_guided_feedback(
            int(reveal["q_num"]), str(reveal["first_answer"]),
            exercise_rows, replay_policy, source_required=source_required, audio_granularity=audio_granularity,
        )
    except FeedbackUnavailable:
        logger.error("[listening-programmes] revealed item has no review material")
        raise HTTPException(503, "Chưa tải được nội dung đối chiếu. Hãy thử lại.") from None
    return {**feedback, "revealed_at": str(reveal["revealed_at"])}


@user_router.get(
    "/tests/attempts/{attempt_id}/guided-state",
    response_model=ListeningGuidedStateResponse,
)
async def get_listening_programme_guided_state(
    attempt_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    """Resume only the questions whose keys this learner already revealed."""
    user = await _require_auth(authorization)
    attempt_id_str = str(attempt_id)
    attempt = _fetch_attempt_or_404(attempt_id_str, user["id"])
    test, exercise_rows = await run_in_threadpool(_programme_guided_context, attempt)
    result = (
        supabase_admin.table("listening_programme_feedback_reveals")
        .select("q_num,first_answer,revealed_at")
        .eq("attempt_id", attempt_id_str).order("q_num").execute()
    )
    items = [
        _programme_guided_item(row, exercise_rows, test.get("replay_policy") or "allowed", source_required=test.get("programme_id") == SOURCE_PROGRAMME,
            audio_granularity=(test.get("metadata") or {}).get("timing_granularity") if test.get("programme_id") == SOURCE_PROGRAMME else None)
        for row in (result.data or [])
    ]
    return {"attempt_id": attempt_id_str, "assisted": bool(items), "items": items}


@user_router.post(
    "/tests/attempts/{attempt_id}/questions/{q_num}/reveal",
    response_model=ListeningGuidedStateResponse,
)
async def reveal_listening_programme_question(
    attempt_id: uuid.UUID,
    q_num: int,
    authorization: str | None = Header(default=None),
):
    """Atomically snapshot a saved first answer, then reveal that question."""
    from services.listening_programme_feedback import (
        FeedbackUnavailable, build_guided_feedback,
    )

    user = await _require_auth(authorization)
    attempt_id_str = str(attempt_id)
    attempt = _fetch_attempt_or_404(attempt_id_str, user["id"])
    test, exercise_rows = await run_in_threadpool(_programme_guided_context, attempt)
    if q_num <= 0:
        raise HTTPException(422, "Câu hỏi không hợp lệ.")
    # Reject broken/missing authored keys before recording any reveal. The RPC
    # performs the membership and persisted-answer checks again under row lock.
    try:
        build_guided_feedback(
            q_num, "content-check", exercise_rows,
            test.get("replay_policy") or "allowed", source_required=test.get("programme_id") == SOURCE_PROGRAMME,
        )
    except FeedbackUnavailable:
        raise HTTPException(503, "Câu này chưa có nội dung đối chiếu hợp lệ.") from None
    try:
        result = supabase_admin.rpc(
            "fn_record_listening_programme_feedback_reveal",
            {"p_attempt_id": attempt_id_str, "p_user_id": user["id"], "p_q_num": q_num},
        ).execute()
    except Exception as exc:
        signal = str(exc)
        if "listening_programme_feedback_answer_required" in signal:
            raise HTTPException(422, "Hãy lưu câu trả lời trước khi đối chiếu.") from None
        if "listening_programme_feedback_question_not_found" in signal:
            raise HTTPException(404, "Không tìm thấy câu hỏi trong bài này.") from None
        if "listening_programme_feedback_attempt_closed" in signal:
            raise HTTPException(409, "Bài luyện đã kết thúc; hãy tải lại trạng thái.") from None
        if "listening_programme_feedback_not_available" in signal:
            raise HTTPException(422, "Bài này không hỗ trợ đối chiếu từng câu.") from None
        logger.warning("[listening-programmes] guided reveal unavailable: %s", type(exc).__name__)
        raise HTTPException(503, "Chưa đối chiếu được câu này. Hãy thử lại.") from None
    rows = result.data if isinstance(result.data, list) else [result.data]
    reveal = rows[0] if rows and isinstance(rows[0], dict) else None
    if not reveal or not reveal.get("first_answer") or not reveal.get("revealed_at"):
        raise HTTPException(503, "Chưa xác minh được câu trả lời đã lưu. Hãy thử lại.")
    item = _programme_guided_item(
        {"q_num": q_num, **reveal}, exercise_rows,
        test.get("replay_policy") or "allowed", source_required=test.get("programme_id") == SOURCE_PROGRAMME,
        audio_granularity=(test.get("metadata") or {}).get("timing_granularity") if test.get("programme_id") == SOURCE_PROGRAMME else None,
    )
    return {"attempt_id": attempt_id_str, "assisted": True, "items": [item]}


@user_router.get("/tests/{test_id}/practice-windows")
async def get_practice_audio_windows(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Per-question audio windows for a Luyện nhanh drill — PRACTICE ONLY.

    The runner plays one question at a time, scoped to that question's few
    seconds of audio. It needs the windows before the learner answers, and
    `GET /tests/{id}` deliberately no longer carries them: a window says where
    in the recording the answer is, which on an exam is most of the skill.

    Practice is the deliberate exception, not an oversight. These clips are
    30–90 seconds holding ~10 questions, and what they drill is hearing a trap
    as it goes past — not scanning a recording for where the answer might be.
    Playing the whole clip for every question made the surface unusable: the
    audio simply ran out, and from question two on there was nothing to hear.

    Returns `{q_num: {start, end}}` and nothing else — no answers, no
    solutions, no transcript. Refused outright for full / mini / drill, so the
    exam guarantee is unchanged and this exception stays visible in one place.
    """
    _user = await _require_auth(authorization)
    target = await run_in_threadpool(blackeye.test_identity, supabase_admin, test_id, missing_status=None)
    if blackeye.is_blackeye(target):
        raise HTTPException(503, "Black Eye player contract unavailable.")

    res = (
        supabase_admin.table("listening_tests")
        .select("id,test_type,status,scoring_policy,metadata")
        .eq("id", test_id).limit(1).execute()
    )
    if not res.data or res.data[0].get("status") != "published":
        raise HTTPException(404, "Test bundle not found or not published")
    test_row = res.data[0]
    if (test_row.get("test_type") != "practice"
            or test_row.get("scoring_policy") != "diagnostic"):
        raise HTTPException(422, "Chỉ bài Luyện nhanh mới có cửa sổ audio theo câu.")

    _assert_listening_exam_content_allowed(test_row, _user["id"], purpose="practice")

    windows: dict[str, dict] = {}
    offsets = (test_row.get("metadata") or {}).get("section_offsets") or {}
    for row in _practice_exercise_payloads(test_id):
        payload = row.get("payload") or {}
        for q, win in (payload.get("audio_windows") or {}).items():
            # Same rebase the review player and /check use. A practice pack is a
            # single section premixed alone (offsets {sid: 0}), so this is a
            # pass-through today — routed through the shared helper so all three
            # readers move together if that ever stops being true.
            rebased = _rebase_audio_window(win, True, offsets)
            if rebased and rebased.get("start") is not None:
                windows[str(int(q))] = {"start": rebased["start"], "end": rebased["end"]}

    return {"test_id": test_id, "windows": windows}


@user_router.post("/tests/attempts/{attempt_id}/check")
@observe_operation("listening_test", "grade", correlate_by=("attempt_id", "body"))
async def check_listening_practice_answer(
    attempt_id: str,
    body: PracticeCheckRequest,
    authorization: str | None = Header(default=None),
):
    """Grade ONE question mid-attempt, for the Luyện nhanh runner.

    Luyện nhanh is a 30–90s drill, not an exam: the learner answers a question,
    finds out immediately, and on a miss the player loops that question's audio
    window until they hear it. Two rules keep that from turning into a way to
    farm a perfect score, or into a hole in exam integrity:

    **practice only.** A full / mini / drill attempt is refused outright. Those
    surfaces are graded once, at submit, precisely so a student cannot probe the
    key answer-by-answer while the recording is still in front of them.

    **first answer is canonical.** The write goes through
    fn_insert_listening_answer_once (mig 174), which appends only when that
    q_num has no answer yet. Retries are graded and returned for the learner's
    benefit but never overwrite the record, so the attempt's eventual score,
    band and trap analytics describe the first listen — the thing worth
    measuring — not the tenth.

    Grading reuses ``grade_attempt`` over the attempt's stored answers with this
    one substituted in, i.e. the SAME path submit takes. A separate
    single-question comparison here would be free to drift from the final score,
    and the learner would be told "correct" by one and "wrong" by the other.

    Returns ``{q_num, correct, canonical_correct, recorded, audio_window, …}``;
    ``expected`` / ``solution`` appear only on a granted reveal.
    """
    from services import listening_test_grader as grader

    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])       # ownership gate
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        raise HTTPException(422, "Black Eye practice feedback unavailable.")
    if attempt.get("sitting_id") or attempt.get("attempt_purpose") == "mock_delivery":
        raise HTTPException(404, "Practice feedback unavailable")
    if not body.reveal:
        # A per-question grade is an operation, never a new attempt or final
        # result. Reveal is read-only and must not claim mutation evidence.
        bind_owned_attempt(attempt)
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể chấm thêm.")
    require_resume_active(attempt)
    if not body.reveal:
        # CLASSARCHIVE-0030 FR-004: a check records the first answer, so it
        # takes the answer PATCH/submit gate; a reveal stays a read. Re-read
        # after the await so the stored answers graded below are not older
        # than the gate.
        await asyncio.to_thread(
            require_class_attempt_accepts_work, supabase_admin, attempt, surface="listening")
        attempt = await asyncio.to_thread(_fetch_attempt_or_404, attempt_id, user["id"])
        if attempt.get("status") != "in_progress":
            raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể chấm thêm.")
        require_resume_active(attempt)

    from services.mock_paper_policy import guard_owned_attempt, load_marking_snapshot, frozen_answer_key
    guard_owned_attempt(supabase_admin, "listening", attempt, purpose="practice_feedback")
    snapshot = load_marking_snapshot(supabase_admin, "listening", attempt)
    test_res = (
        supabase_admin.table("listening_tests")
        .select("id,test_type,metadata")
        .eq("id", attempt["test_id"]).limit(1).execute()
    )
    if not test_res.data:
        raise HTTPException(404, "Test bundle not found")
    test_row = snapshot["paper_row"] if snapshot else test_res.data[0]
    if (attempt.get("scoring_policy") or "diagnostic") == "report_only":
        raise HTTPException(
            422,
            "Bài này đối chiếu từng câu ngay trong màn luyện tập. Chấm nhanh chỉ dành cho Luyện nhanh.",
        )
    if test_row.get("test_type") != "practice":
        raise HTTPException(
            422,
            "Chấm từng câu chỉ dành cho Luyện nhanh. Bài thi chấm một lần khi nộp.",
        )

    payloads = snapshot["marking_rows"] if snapshot else _practice_exercise_payloads(attempt["test_id"])
    answer_key = frozen_answer_key(supabase_admin, "listening", attempt)
    if answer_key is None:
        answer_key = grader.collect_answer_key(payloads)
    key_row = next((k for k in answer_key if k.get("q_num") == body.q_num), None)
    if key_row is None:
        raise HTTPException(404, f"Câu {body.q_num} không thuộc bài này.")

    stored = list(attempt.get("answers") or [])
    prior = next((a for a in stored if a.get("q_num") == body.q_num), None)

    recorded = False
    if not body.reveal:
        wrote = supabase_admin.rpc("fn_insert_listening_answer_once", {
            "p_attempt_id":  attempt_id,
            "p_q_num":       body.q_num,
            "p_user_answer": body.user_answer,
        }).execute().data
        if wrote is None:
            # The RPC re-checks status, so NULL means the attempt was submitted
            # between our read and the write. Say so instead of returning a
            # grade for an answer that was never stored.
            require_resume_active(attempt)
            raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể chấm thêm.")
        if type(wrote) is not bool:
            raise HTTPException(503, "Chưa xác minh được đáp án đã lưu. Hãy thử lại.")
        recorded = wrote
        if recorded:
            prior = {"q_num": body.q_num, "user_answer": body.user_answer}
        elif prior is None:
            # The RPC refused, yet our snapshot showed no answer — a concurrent
            # check won the write between the two. Re-read instead of reporting
            # canonical_correct=False off the stale snapshot, which would tell
            # the learner this question is lost while submit scores it correct.
            fresh = (
                supabase_admin.table("listening_test_attempts")
                .select("answers").eq("id", attempt_id).limit(1).execute()
            )
            stored = list((fresh.data[0].get("answers") if fresh.data else None) or [])
            prior = next((a for a in stored if a.get("q_num") == body.q_num), None)
            if prior is None:
                # FALSE also covers a lost conditional UPDATE when the attempt
                # was submitted concurrently, not only a rival answer. Without
                # a canonical answer, neither a successful check nor its
                # canonical correctness can be asserted.
                raise HTTPException(409, "Bài làm vừa thay đổi. Hãy tải lại để kiểm tra đáp án đã lưu.")

    def _grade(ans_text: str) -> bool:
        merged = [a for a in stored if a.get("q_num") != body.q_num]
        merged.append({"q_num": body.q_num, "user_answer": ans_text})
        res = grader.grade_attempt(merged, answer_key)
        row = next((r for r in res["per_question"] if r.get("q_num") == body.q_num), None)
        return bool(row and row.get("correct"))

    correct = _grade(body.user_answer) if not body.reveal else False
    # What the final score will say for this question — the first answer, which
    # may not be the one just submitted.
    canonical_correct = _grade(prior.get("user_answer") or "") if prior else False

    windows: dict[int, dict] = {}
    solutions: dict[int, dict] = {}
    for row in payloads:
        p = row.get("payload") or {}
        for q, w in (p.get("audio_windows") or {}).items():
            windows[int(q)] = w
        for q, s in (p.get("solutions") or {}).items():
            solutions[int(q)] = s
    # Practice packs are a single section premixed alone with section_offsets
    # {sid: 0}, so this is a pass-through today. Routed through the shared
    # helper anyway: if practice ever gains a nonzero offset, the replay window
    # rebases with the review player instead of silently seeking past the answer.
    win = _rebase_audio_window(
        windows.get(body.q_num),
        (test_row.get("test_type") in ("mini", "practice")),
        (test_row.get("metadata") or {}).get("section_offsets") or {},
    )

    out = {
        "q_num":             body.q_num,
        "correct":           correct,
        "canonical_correct": canonical_correct,
        "recorded":          recorded,        # did THIS call set the canonical answer
        "answered_before":   prior is not None and not recorded,
        "audio_window":      win,
    }

    # Reveal is gated on the canonical answer already being on file AND wrong.
    # That makes it harmless: the score for this question is settled before the
    # key is ever handed out, so seeing it cannot buy back a point.
    if body.reveal:
        if prior is None:
            raise HTTPException(422, "Hãy thử trả lời trước khi xem đáp án.")
        if canonical_correct:
            raise HTTPException(422, "Câu này bạn đã trả lời đúng.")
        out["expected"]     = key_row.get("answer") or ""
        out["alternatives"] = key_row.get("alternatives") or []
        out["solution"]     = solutions.get(body.q_num) or {}
        out["revealed"]     = True
    return out


@user_router.post("/tests/attempts/{attempt_id}/submit", response_model=BlackEyeAttemptState | dict[str, Any])
@observe_operation("listening_test", "submit", correlate_by=("attempt_id",))
async def submit_listening_test_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    """Finalize a student attempt: load the test's answer key, grade
    each user answer, roll up trap analytics, write the grading
    payload back to the attempt row, and return the result.
    """
    from datetime import datetime, timezone

    from services import listening_test_grader as grader

    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    bind_owned_attempt(attempt)
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        result = await run_in_threadpool(blackeye.submit, supabase_admin, attempt, user["id"])
        return JSONResponse(jsonable_encoder(result),
                            headers={"Cache-Control": "private, no-store"})
    if attempt.get("status") == "submitted":
        if (attempt.get("scoring_policy") or "diagnostic") == "report_only":
            exercise_rows = _practice_exercise_payloads(attempt["test_id"])
            report = grader.grade_report_only_attempt(
                attempt.get("answers") or [], exercise_rows, source_required=_source_required_for_test(attempt["test_id"]),
            )
            stored_summary = attempt.get("result_summary") or {}
            stored_details = attempt.get("grading_details") or []
            if stored_summary:
                report.update(stored_summary)
            if stored_details:
                report["per_question"] = stored_details
            return {
                "attempt_id": attempt_id,
                "scoring_policy": "report_only",
                "status": "submitted",
                **report,
            }
        # Lost-ACK reconciliation for the 4-skill mock parent. Retrying a
        # committed sealed submit must return the same opaque receipt; normal
        # attempts keep the historical 422 and never expose a second result.
        if _mock_sealed(attempt):
            receipt = {
                "received": True, "sitting_id": attempt["sitting_id"], "sealed": True
            }
            from services import mock_correction_service
            capture = mock_correction_service.capture_required_envelope(
                "listening", attempt, attempt.get("grading_details") or []
            )
            if capture:
                receipt.update(capture)
            return receipt
        raise HTTPException(422, "Attempt đã submit rồi — không thể submit lại.")
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt status không hợp lệ.")
    require_resume_active(attempt)
    # CLASSARCHIVE-0030 FR-004: an archived class takes no hand-in, also from
    # an attempt started before the archive. The submitted replay above stays.
    await asyncio.to_thread(
        require_class_attempt_accepts_work, supabase_admin, attempt, surface="listening")
    # An answer PATCH (fn_upsert_listening_answer) can commit while the gate
    # above awaits. Grade the answers of this re-read (the last await before
    # grading), and bind both finalize UPDATEs to exactly that array: a save
    # landing after it misses the CAS and the submit 409s, never a grade that
    # drops the answer.
    attempt = await asyncio.to_thread(_fetch_attempt_or_404, attempt_id, user["id"])
    if attempt.get("status") != "in_progress":
        raise HTTPException(409, "Attempt đã thay đổi; hãy tải lại trạng thái.")
    require_resume_active(attempt)
    graded_answers = attempt.get("answers") or []

    # Pull the test's exercises + extract the answer key.
    test_id = attempt["test_id"]
    from services.mock_paper_policy import load_marking_snapshot, guard_owned_attempt
    guard_owned_attempt(supabase_admin, "listening", attempt, purpose="submit")
    marking_snapshot = load_marking_snapshot(supabase_admin, "listening", attempt)
    if marking_snapshot is not None:
        from types import SimpleNamespace
        ex_res = SimpleNamespace(data=marking_snapshot["marking_rows"])
    else:
        sec_res = (
            supabase_admin.table("listening_content")
            .select("id")
            .eq("test_id", test_id)
            .execute()
        )
        section_ids = [r["id"] for r in (sec_res.data or [])]
        if not section_ids:
            raise HTTPException(500, "Test bundle thiếu section rows.")

        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("payload")
            .in_("content_id", section_ids)
            .execute()
        )
    if (attempt.get("scoring_policy") or "diagnostic") == "report_only":
        report = grader.grade_report_only_attempt(
            graded_answers, ex_res.data or [], source_required=_source_required_for_test(test_id),
        )
        summary = {
            key: report[key] for key in (
                "checked_count", "correct_count", "unscored_count",
                "blank_count", "technical_error_count", "completion_count",
                "item_count",
            )
        }
        now_iso = datetime.now(timezone.utc).isoformat()
        finalized = (
            supabase_admin.table("listening_test_attempts")
            .update({
                "status": "submitted",
                "score": None,
                "band_estimate": None,
                "grading_details": report["per_question"],
                "trap_analytics": {},
                "result_summary": summary,
                "submitted_at": now_iso,
            })
            .eq("id", attempt_id)
            .eq("status", "in_progress")
            .eq("answers", json.dumps(graded_answers))
            .gt("resume_expires_at", now_iso)
            .execute()
        )
        if not finalized.data:
            fresh = _fetch_attempt_or_404(attempt_id, user["id"])
            if fresh.get("status") == "in_progress":
                require_resume_active(fresh)
            raise HTTPException(409, "Attempt đã thay đổi; hãy tải lại trạng thái.")
        return {
            "attempt_id": attempt_id,
            "scoring_policy": "report_only",
            "status": "submitted",
            **report,
        }
    from services import mock_correction_service
    from services.mock_paper_policy import frozen_answer_key
    answer_key = frozen_answer_key(supabase_admin, "listening", attempt)
    if answer_key is None:
        answer_key = grader.collect_answer_key(ex_res.data or [])
        from services import mock_correction_service
        answer_key = mock_correction_service.apply_scoring_overrides(
            "listening", test_id, answer_key
        )

    result = grader.grade_attempt(graded_answers, answer_key)
    now_iso = datetime.now(timezone.utc).isoformat()

    finalized = (
        supabase_admin.table("listening_test_attempts")
        .update({
            "status":          "submitted",
            "score":           result["score"],
            "grading_details": result["per_question"],
            "trap_analytics":  result["trap_analytics"],
            "band_estimate":   result["band_estimate"],
            "submitted_at":    now_iso,
        })
        .eq("id", attempt_id)
        .eq("status", "in_progress")
        .eq("answers", json.dumps(graded_answers))
        .gt("resume_expires_at", now_iso)
        .execute()
    )
    if not finalized.data:
        fresh = _fetch_attempt_or_404(attempt_id, user["id"])
        if fresh.get("status") == "in_progress":
            require_resume_active(fresh)
        raise HTTPException(409, "Attempt đã thay đổi; hãy tải lại trạng thái.")

    note_persisted_exam_result(finalized.data[0], expected_questions=answer_key)
    submitted_attempt = {
        **attempt,
        "status": "submitted",
        "score": result["score"],
        "grading_details": result["per_question"],
        "trap_analytics": result["trap_analytics"],
        "band_estimate": result["band_estimate"],
        "submitted_at": now_iso,
    }
    performance_finalized = mock_correction_service.finalize_item_observations(
        "listening", submitted_attempt, result["per_question"]
    )
    # Sealed 4-skill mock: grade + persist above (the admin's draft), but never
    # expose the score to the student until the sitting is released.
    if _mock_sealed(attempt):
        receipt = {"received": True, "sitting_id": attempt["sitting_id"], "sealed": True}
        capture = mock_correction_service.capture_required_envelope(
            "listening", submitted_attempt, result["per_question"]
        )
        if capture:
            receipt.update(capture)
        return receipt

    capture = mock_correction_service.capture_required_envelope(
        "listening", submitted_attempt, result["per_question"]
    )
    if capture:
        capture["performance_finalized"] = performance_finalized
        return capture

    return {
        "attempt_id":        attempt_id,
        **grader.score_fields(result["score"], result["per_question"]),
        "band_estimate":     result["band_estimate"],
        "section_breakdown": result["section_breakdown"],
        "trap_analytics":    result["trap_analytics"],
        "per_question":      result["per_question"],
        "performance_finalized": performance_finalized,
    }


@user_router.get("/tests/attempts/{attempt_id}", response_model=BlackEyeAttemptState | dict[str, Any])
async def get_listening_test_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    """Fetch a past attempt's grading. Owner-only (admin bypass not
    wired here — admins use ``/admin/listening/tests/{id}`` for the
    bundle view; per-attempt admin surfaces land in a future sprint).
    """
    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        result = await run_in_threadpool(blackeye.state, supabase_admin, attempt)
        return JSONResponse(jsonable_encoder(result),
                            headers={"Cache-Control": "private, no-store"})
    if _mock_sealed(attempt):
        raise HTTPException(403, "Kết quả đang chờ giám khảo duyệt.")
    return {
        "attempt_id":      attempt["id"],
        "test_id":         attempt["test_id"],
        "status":          attempt["status"],
        **listening_score_fields(
            attempt.get("score"), attempt.get("grading_details") or []),
        "band_estimate":   attempt.get("band_estimate"),
        "answers":         attempt.get("answers") or [],
        "grading_details": attempt.get("grading_details") or [],
        "trap_analytics":  attempt.get("trap_analytics") or {},
        "scoring_policy":  attempt.get("scoring_policy") or "diagnostic",
        "result_summary":  attempt.get("result_summary") or {},
        "started_at":      attempt.get("started_at"),
        "submitted_at":    attempt.get("submitted_at"),
    }


@user_router.get(
    "/tests/attempts/{attempt_id}/review",
    response_model=BlackEyeActivityReview | ListeningAttemptReviewResponse,
)
async def get_listening_test_attempt_review(
    attempt_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    """listening-review-ui (Phase B) — post-submit chữa-bài for a listening
    full test. Owner-only + HARD-gated on status=='submitted' (409 otherwise).
    Joins the attempt's grading_details (q_num · correct · user_answer ·
    expected) with each question's rich solution + audio replay window (stored
    in listening_exercises.payload.solutions / .audio_windows by the import),
    the per-section transcripts, the band-conversion table, the section offsets,
    and a signed URL for the full premixed audio (so the review player can seek
    each answer's window). Mirrors the reading review contract.

    Admin bypass (2026-07-12): an admin may open ANY submitted attempt's
    review — including a still-sealed 4-skill mock — so the mock-review
    console can reuse this same rich view while deciding the band, before
    releasing results. Everyone else keeps the existing ownership + seal
    gate unchanged."""
    user = await _require_auth(authorization)
    attempt_id = str(attempt_id)
    is_admin = await _is_admin(authorization)
    if is_admin:
        res = supabase_admin.table("listening_test_attempts").select("*").eq(
            "id", attempt_id,
        ).limit(1).execute()
        if not res.data:
            raise HTTPException(404, "Attempt not found", headers={"Cache-Control": "private, no-store"})
        attempt = res.data[0]
    else:
        attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    if attempt.get("user_id") != user["id"]:
        target = await run_in_threadpool(blackeye.test_identity, supabase_admin, attempt["test_id"], missing_status=None)
        if blackeye.is_blackeye(target):
            raise HTTPException(404, "Attempt not found", headers={"Cache-Control": "private, no-store"})
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        if attempt.get("user_id") != user["id"]:
            raise HTTPException(404, "Attempt not found", headers={"Cache-Control": "private, no-store"})
        result = await run_in_threadpool(blackeye.review, supabase_admin, attempt)
        return JSONResponse(jsonable_encoder(result),
                            headers={"Cache-Control": "private, no-store"})
    if attempt.get("status") != "submitted":
        raise HTTPException(409, "Chưa có chữa bài — attempt chưa submit.")
    if not is_admin and _mock_sealed(attempt):
        raise HTTPException(
            403, "Kết quả đang chờ giám khảo duyệt — chưa thể xem chữa bài.")

    if not is_admin:
        from services import mock_correction_service
        if mock_correction_service.capture_required_envelope(
            "listening", attempt, attempt.get("grading_details") or []
        ):
            raise HTTPException(
                409, "Hãy hoàn tất confidence trước khi xem đáp án và chữa bài."
            )

    return _assemble_listening_review(attempt, attempt_id)


@user_router.get("/source-collections/blackeye-v5-upper/units/U1", response_model=BlackEyeUnitPublic)
async def get_blackeye_unit(authorization: str | None = Header(default=None)):
    await _require_auth(authorization)
    from fastapi.encoders import jsonable_encoder
    from starlette.responses import JSONResponse
    inventory = await run_in_threadpool(blackeye.public_inventory, supabase_admin)
    unit = BlackEyeUnitPublic.model_validate(inventory)
    return JSONResponse(jsonable_encoder(unit), headers={"Cache-Control": "private, no-store"})

_SUBMODULES = (_common, admin_import, admin_audit, student_fulltest, dictation)


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
