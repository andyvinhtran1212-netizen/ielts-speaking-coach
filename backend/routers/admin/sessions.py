"""routers.admin.sessions — speaking sessions, alerts, regrade and summary rebuild (BACKENDSPLIT-0076 T009).

Cut and pasted unchanged from the former single-file routers/admin.py. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

import asyncio
import json
import math
import time
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from models.admin_speaking import (
    AdminResponseRegradeResponse,
    AdminSessionRegradeResponse,
    AdminSpeakingSessionDetail,
    AdminSpeakingSessionRow,
    AdminSummaryRebuildResponse,
)
from database import supabase_admin
from services.class_assignment_service import sync_class_item_score
from services.errors import clip_user_value, clip_user_values, new_ref, safe_error
from services.core_attempt_observation import bind_owned_attempt, note_operation_failure, observe_operation
from services import admin_dashboard, ai_usage_logger, class_archive_service, test_data_visibility
from services.recording_audio import attach_playback_urls, recording_path
from services.claude_grader import grade_response as _claude_grade
from services.grading_telemetry import log_fallback_events
from services.whisper import transcribe_from_bytes

from routers.admin import (  # noqa: E402 — defined above this block in the package
    logger,
    router,
    require_admin,
)


# ── GET /admin/sessions ────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[AdminSpeakingSessionRow])
async def admin_list_sessions(
    authorization: str | None = Header(default=None),
    user_id:    str | None = None,
    user_email: str | None = None,
    mode:       str | None = None,
    status:     str | None = None,
    error_code: str | None = None,
    has_error:  bool | None = None,
    date_from:  str | None = None,  # ISO date string, e.g. "2024-01-01"
    date_to:    str | None = None,
    limit:      int = 50,
    offset:     int = 0,
):
    """
    List all sessions across users (admin only).
    Supports filtering by user_id or exact user_email, mode, status,
    error_code, has_error, date range.
    Returns sessions enriched with user email.
    """
    await require_admin(authorization)

    # Resolve an exact email on the server. Fetching the whole user directory in
    # the browser is incomplete once PostgREST applies its row cap. A lookup
    # outage must fail visibly instead of looking like zero matching sessions.
    if not user_id and user_email and user_email.strip():
        try:
            matches = (
                supabase_admin.table("users")
                .select("id")
                .eq("email", user_email.strip().lower())
                .limit(2)
                .execute()
            ).data or []
        except Exception as exc:
            logger.error("[admin] session email lookup failed: %s", exc, exc_info=True)
            raise HTTPException(500, "Lỗi khi tra email học viên. Vui lòng thử lại.") from None
        if len(matches) > 1:
            raise HTTPException(409, "Có nhiều tài khoản dùng email này; hãy lọc bằng User ID.")
        if not matches:
            return []
        user_id = matches[0].get("id")
        if not user_id:
            raise HTTPException(500, "Kết quả tra email học viên không có User ID.")

    q = (
        supabase_admin.table("sessions")
        .select(
            "id, user_id, mode, part, topic, status, started_at, completed_at, "
            "overall_band, band_fc, band_lr, band_gra, band_p, "
            "error_code, error_message, failed_step, last_error_at, pdf_status"
        )
        .order("started_at", desc=True)
        .order("id", desc=True)
        .range(offset, offset + limit - 1)
    )

    if user_id:    q = q.eq("user_id", user_id)
    if mode:       q = q.eq("mode", mode)
    if status:     q = q.eq("status", status)
    if error_code: q = q.eq("error_code", error_code)
    if has_error is True:
        q = q.filter("error_code", "not.is", "null")
    elif has_error is False:
        q = q.is_("error_code", "null")
    if date_from:  q = q.gte("started_at", date_from)
    if date_to:
        try:
            next_day = (datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)).date().isoformat()
        except ValueError:
            raise HTTPException(400, "date_to phải theo định dạng YYYY-MM-DD")
        # Exclusive next-day bound includes timestamps with fractional seconds.
        q = q.lt("started_at", next_day)

    try:
        res = q.execute()
    except Exception as exc:
        logger.error("[admin] list sessions failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải sessions. Vui lòng thử lại.") from None

    sessions = res.data or []

    # Enrich with user email
    uids = list({s["user_id"] for s in sessions if s.get("user_id")})
    email_map: dict[str, str] = {}
    user_lookup_failed = False
    if uids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email, display_name")
                .in_("id", uids)
                .execute()
            )
            for u in (ur.data or []):
                email_map[u["id"]] = u.get("email") or ""
        except Exception:
            user_lookup_failed = True

    for s in sessions:
        s["user_email"] = email_map.get(s.get("user_id") or "", "")
        # An empty email and a failed enrichment query are different truths.
        # The admin UI must not present an outage as "this user has no email".
        s["user_lookup_failed"] = user_lookup_failed

    return sessions


# ── GET /admin/sessions/{session_id} ──────────────────────────────────────────

@router.get("/sessions/{session_id}", response_model=AdminSpeakingSessionDetail)
async def admin_get_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Full session detail for admin: session row + questions + responses.
    Does NOT enforce user_id ownership — admin can see any session.
    """
    await require_admin(authorization)

    # Session row
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("*")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] get session failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải session. Vui lòng thử lại.") from None

    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại")

    session = s_res.data[0]

    # A full-test session is only one part of the canonical attempt. Resolve the
    # other parts server-side instead of relying on non-existent p2/p3 columns
    # on the selected row. Keep the lookup scoped to the same user as a second
    # guard against ever exposing another learner's session ID.
    session["p1_session_id"] = None
    session["p2_session_id"] = None
    session["p3_session_id"] = None
    session["full_test_siblings_lookup_failed"] = False
    if session.get("mode") == "test_full" and session.get("full_test_attempt_id"):
        try:
            siblings_query = (
                supabase_admin.table("sessions")
                .select("id, user_id, mode, part, full_test_attempt_id")
                .eq("full_test_attempt_id", session["full_test_attempt_id"])
                .eq("mode", "test_full")
            )
            if not session.get("user_id"):
                raise ValueError("full-test session has no user_id")
            siblings_query = siblings_query.eq("user_id", session["user_id"])
            sibling_rows = siblings_query.execute().data or []
            ids_by_part: dict[int, str] = {}
            duplicate_part = False
            for sibling in sibling_rows:
                part = sibling.get("part")
                sibling_id = sibling.get("id")
                if part not in (1, 2, 3) or not sibling_id:
                    continue
                if part in ids_by_part and ids_by_part[part] != sibling_id:
                    duplicate_part = True
                    continue
                ids_by_part[part] = sibling_id
            if duplicate_part:
                session["full_test_siblings_lookup_failed"] = True
            else:
                session["p1_session_id"] = ids_by_part.get(1)
                session["p2_session_id"] = ids_by_part.get(2)
                session["p3_session_id"] = ids_by_part.get(3)
        except Exception:
            session["full_test_siblings_lookup_failed"] = True

    # Enrich with user email
    uid = session.get("user_id")
    session["user_email"] = ""
    session["user_lookup_failed"] = False
    if uid:
        try:
            ur = (
                supabase_admin.table("users")
                .select("email, display_name")
                .eq("id", uid)
                .limit(1)
                .execute()
            )
            if ur.data:
                session["user_email"]        = ur.data[0].get("email") or ""
                session["user_display_name"] = ur.data[0].get("display_name") or ""
        except Exception:
            session["user_lookup_failed"] = True

    # Questions
    try:
        q_res = (
            supabase_admin.table("questions")
            .select("*")
            .eq("session_id", session_id)
            .order("order_num")
            .execute()
        )
        questions = q_res.data or []
    except Exception:
        questions = []
        session["questions_lookup_failed"] = True
    else:
        session["questions_lookup_failed"] = False

    # Responses (includes transcript, feedback, band scores, status fields)
    try:
        r_res = (
            supabase_admin.table("responses")
            .select(
                "id, question_id, transcript, overall_band, feedback, "
                "audio_url, audio_storage_path, grading_status, stt_status"
            )
            .eq("session_id", session_id)
            .execute()
        )
        responses = r_res.data or []
    except Exception:
        responses = []
        session["responses_lookup_failed"] = True
    else:
        session["responses_lookup_failed"] = False

    await attach_playback_urls(supabase_admin, responses)

    return {
        **session,
        "session_id": session["id"],
        "questions":  questions,
        "responses":  responses,
    }


# ── GET /admin/alerts ──────────────────────────────────────────────────────────

@router.get("/alerts")
async def admin_get_alerts(
    authorization: str | None = Header(default=None),
    limit: int = 30,
):
    """
    Return recently failed sessions and responses for the admin alert panel.
    Groups into session-level errors (stt_failed, etc.) and response-level
    grading failures.
    """
    await require_admin(authorization)

    # Session-level errors (last `limit` sessions with error_code set)
    try:
        se_res = (
            supabase_admin.table("sessions")
            .select(
                "id, user_id, mode, part, topic, error_code, error_message, "
                "failed_step, last_error_at, started_at, status"
            )
            .or_("error_code.not.is.null,status.eq.grading_failed")
            .order("last_error_at", desc=True)
            .order("started_at", desc=True)
            .order("id", desc=True)
            .limit(limit)
            .execute()
        )
        session_errors = se_res.data or []
    except Exception as exc:
        logger.error("[admin] alerts session errors load failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải session errors. Vui lòng thử lại.") from None

    for session_error in session_errors:
        if not session_error.get("error_code") and session_error.get("status") == "grading_failed":
            session_error["error_code"] = "grading_failed"
            session_error["error_message"] = session_error.get("error_message") or "Session ở trạng thái degraded sau admin regrade."
            session_error["failed_step"] = session_error.get("failed_step") or "admin_regrade_session"

    # Response-level grading failures (last `limit` rows)
    try:
        re_res = (
            supabase_admin.table("responses")
            .select("id, session_id, question_id, grading_status, stt_status")
            .eq("grading_status", "failed")
            .limit(limit)
            .execute()
        )
        grading_failures = re_res.data or []
    except Exception as exc:
        logger.error("[admin] alerts grading failures load failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải grading failures. Vui lòng thử lại.") from None

    # Enrich both lists with user email (collect all user_ids at once)
    session_error_ids = {s.get("user_id") for s in session_errors if s.get("user_id")}
    grading_session_ids = {r.get("session_id") for r in grading_failures if r.get("session_id")}

    # For grading failures we need to look up session → user_id
    user_id_for_session: dict[str, str] = {}
    if grading_session_ids:
        try:
            gs_res = (
                supabase_admin.table("sessions")
                .select("id, user_id")
                .in_("id", list(grading_session_ids))
                .execute()
            )
            for row in (gs_res.data or []):
                user_id_for_session[row["id"]] = row.get("user_id") or ""
        except Exception:
            pass

    all_user_ids = session_error_ids | set(user_id_for_session.values())
    email_map: dict[str, str] = {}
    if all_user_ids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email")
                .in_("id", list(all_user_ids))
                .execute()
            )
            for u in (ur.data or []):
                email_map[u["id"]] = u.get("email") or ""
        except Exception:
            pass

    for s in session_errors:
        s["user_email"] = email_map.get(s.get("user_id") or "", "")

    for r in grading_failures:
        uid = user_id_for_session.get(r.get("session_id") or "", "")
        r["user_email"] = email_map.get(uid, "")

    # Exclude sessions that are already in session_errors to avoid duplication
    session_error_ids_set = {s["id"] for s in session_errors}
    grading_failures = [r for r in grading_failures if r.get("session_id") not in session_error_ids_set]

    return {
        "session_errors":   session_errors,
        "grading_failures": grading_failures,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# REGRADE FLOW
# ═══════════════════════════════════════════════════════════════════════════════

_REGRADE_AUDIO_BUCKET = "audio-responses"


def _regrade_round_band(v: float) -> float:
    rounded = math.floor(v * 2 + 0.5) / 2
    return max(1.0, min(9.0, rounded))


def _reattach_pronunciation_for_regrade(grading: dict, response_id: str, mode: str) -> None:
    """Audit 2026-07-02 (P1) — re-attach the audio-measured pronunciation band to
    a regraded response, in place. The grader no longer scores pronunciation
    (Azure does, during the original grade); a regrade only re-scores FC/LR/GRA,
    but the audio is unchanged so the persisted Azure score is still valid. Best-
    effort; test mode only (practice has no P criterion). No-op when the response
    was never assessed (old rows) → band_p stays absent → honest "chưa đánh giá"."""
    if mode == "practice":
        return
    try:
        from routers.grading import _pron_band_from_scores
        row = (
            supabase_admin.table("responses")
            .select("pronunciation_score, pronunciation_fluency, feedback")
            .eq("id", response_id)
            .limit(1)
            .execute()
        )
        r = (row.data or [{}])[0]
        band_p = _pron_band_from_scores(r.get("pronunciation_score"), r.get("pronunciation_fluency"))
        if band_p is None:
            return
        grading["band_p"] = band_p
        grading["pronunciation_source"] = "azure"
        # Carry over the original Azure pronunciation feedback text if stored.
        old_fb = r.get("feedback")
        if old_fb:
            try:
                fb = json.loads(old_fb) if isinstance(old_fb, str) else old_fb
                if isinstance(fb, dict) and fb.get("p_feedback"):
                    grading["p_feedback"] = fb["p_feedback"]
            except (json.JSONDecodeError, TypeError):
                pass
    except Exception as ex:  # noqa: BLE001 — never block a regrade
        logger.warning("[regrade] pronunciation reattach failed (non-fatal): %s", ex)


def _regrade_apply_heuristic_caps(grading: dict, word_count: int, part: int) -> dict:
    """Mirror of grading.py _apply_heuristic_caps — keeps regrade calibration consistent."""
    grading = dict(grading)
    thresholds      = {1: (3, 5, 40), 2: (3, 5, 100), 3: (4, 5, 50)}
    very_short_lims = {1: 15, 2: 40, 3: 20}
    short_lims      = {1: 40, 2: 100, 3: 50}
    very_short_cap, short_cap, _ = thresholds.get(part, (3, 5, 40))
    vt = very_short_lims.get(part, 15)
    st = short_lims.get(part, 40)
    fc = grading.get("band_fc")
    if fc is not None:
        if word_count < vt and fc > very_short_cap:
            grading["band_fc"] = float(very_short_cap)
            for k in ("band_lr", "band_gra"):
                if grading.get(k) is not None and grading[k] > 5:
                    grading[k] = 5.0
        elif word_count < st and fc > short_cap:
            grading["band_fc"] = float(short_cap)
    crit = [float(grading[k]) for k in ("band_fc", "band_lr", "band_gra", "band_p") if grading.get(k) is not None]
    if crit:
        grading["overall_band"] = _regrade_round_band(sum(crit) / len(crit))
    return grading


def _regrade_compute_session_bands(session_id: str) -> dict:
    """
    Read all response feedback for a session, compute aggregate band scores.
    Returns dict with overall_band, band_fc/lr/gra/p (or None if missing data).

    Canonical P precedence: use final_band_p (pronunciation-adjusted) when set,
    fall back to feedback.band_p. After a regrade, final_band_p is cleared on the
    regraded response so the fresh AI grade is used directly.
    """
    r_res = (
        supabase_admin.table("responses")
        .select("overall_band, final_band_p, feedback")
        .eq("session_id", session_id)
        .execute()
    )
    responses = r_res.data or []
    fc_v, lr_v, gra_v, p_v, r_bands = [], [], [], [], []
    for r in responses:
        ob = r.get("overall_band")
        if ob is not None:
            r_bands.append(float(ob))
        raw = r.get("feedback")
        if not raw:
            continue
        try:
            fb = json.loads(raw) if isinstance(raw, str) else raw
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(fb, dict):
            continue
        for lst, key in ((fc_v, "band_fc"), (lr_v, "band_lr"), (gra_v, "band_gra")):
            v = fb.get(key)
            if v is not None:
                try:
                    lst.append(float(v))
                except (TypeError, ValueError):
                    pass
        # P criterion: pronunciation-adjusted when available, else raw AI grade
        final_p = r.get("final_band_p")
        if final_p is not None:
            p_v.append(float(final_p))
        else:
            v = fb.get("band_p")
            if v is not None:
                try:
                    p_v.append(float(v))
                except (TypeError, ValueError):
                    pass
    band_fc  = _regrade_round_band(sum(fc_v)  / len(fc_v))  if fc_v  else None
    band_lr  = _regrade_round_band(sum(lr_v)  / len(lr_v))  if lr_v  else None
    band_gra = _regrade_round_band(sum(gra_v) / len(gra_v)) if gra_v else None
    band_p   = _regrade_round_band(sum(p_v)   / len(p_v))   if p_v   else None
    crit = [b for b in [band_fc, band_lr, band_gra, band_p] if b is not None]
    overall = (
        _regrade_round_band(sum(crit) / len(crit)) if crit
        else (_regrade_round_band(sum(r_bands) / len(r_bands)) if r_bands else None)
    )
    return {"overall_band": overall, "band_fc": band_fc, "band_lr": band_lr, "band_gra": band_gra, "band_p": band_p}


def _regrade_incomplete_response_ids(session_id: str) -> list[str]:
    """Return persisted or missing responses that prevent canonical completion."""
    question_result = (
        supabase_admin.table("questions")
        .select("id")
        .eq("session_id", session_id)
        .execute()
    )
    response_result = (
        supabase_admin.table("responses")
        .select("id, question_id, grading_status, overall_band")
        .eq("session_id", session_id)
        .execute()
    )
    responses = response_result.data or []
    question_ids = {row.get("id") for row in (question_result.data or []) if row.get("id")}
    incomplete = [
        row.get("id") or "unknown"
        for row in responses
        if row.get("grading_status") == "failed" or row.get("overall_band") is None
    ]
    answered_question_ids = {row.get("question_id") for row in responses if row.get("question_id")}
    incomplete.extend(
        f"question:{question_id}:missing_response"
        for question_id in (row.get("id") for row in (question_result.data or []))
        if question_id and question_id not in answered_question_ids
    )
    incomplete.extend(
        f"response:{row.get('id') or 'unknown'}:unknown_question"
        for row in responses
        if not row.get("question_id") or row.get("question_id") not in question_ids
    )
    return list(dict.fromkeys(incomplete))


async def _run_regrade_response(
    resp: dict,
    session: dict,
    question_text: str,
    admin_email: str,
) -> dict:
    """
    Core regrade logic for one response dict already loaded from DB.
    Returns {overall_band, re_transcribed, error}.
    Raises HTTPException on non-recoverable errors.
    """
    part     = session["part"]
    mode     = session.get("mode", "practice") or "practice"
    user_id  = session["user_id"]
    response_id = resp["id"]

    transcript = (resp.get("transcript") or "").strip()
    word_count = len(transcript.split()) if transcript else 0
    re_transcribed = False

    if word_count < 3:
        # Try re-transcribing from stored audio
        audio_path = recording_path(resp)
        if not audio_path:
            raise HTTPException(422, f"Response {response_id}: không có transcript và không có audio path")
        try:
            audio_bytes = await asyncio.to_thread(
                supabase_admin.storage.from_(_REGRADE_AUDIO_BUCKET).download,
                audio_path,
            )
        except Exception as e:
            logger.error("[admin] regrade audio download failed response=%s: %s",
                         response_id, e, exc_info=True)
            raise HTTPException(502, f"Response {response_id}: không thể tải audio. Vui lòng thử lại.") from None

        ext = ("." + audio_path.rsplit(".", 1)[-1]) if "." in audio_path else ".webm"
        stt = await transcribe_from_bytes(audio_bytes, filename=f"audio{ext}")
        transcript = stt.get("transcript", "").strip()
        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_whisper_async(
            user_id=user_id,
            session_id=resp["session_id"],
            model=stt.get("transcript_model", "whisper-1"),
            audio_seconds=stt.get("duration_seconds", 0.0),
            feature="speaking_stt",
            operation="admin_retranscribe_response",
            resource_type="response",
            resource_id=response_id,
        ))
        if not transcript:
            raise HTTPException(422, f"Response {response_id}: Whisper không nhận dạng được giọng nói")
        word_count = len(transcript.split())
        re_transcribed = True

    reliability = {"reliability_label": "high", "reliability_score": 0.9}
    # S3 — the same audit trail as live grading (routers/grading.py): every
    # provider attempt, success or failure, lands in grading_events with its
    # latency. Best-effort; log_fallback_events never raises.
    fallback_events: list = []
    started = time.monotonic()
    outcome = "error"
    try:
        grading = await _claude_grade(
            question=question_text,
            transcript=transcript,
            part=part,
            mode=mode,
            user_id=user_id,
            session_id=resp["session_id"],
            reliability=reliability,
            word_count=word_count,
            fallback_events=fallback_events,
        )
        outcome = "success"
    finally:
        log_fallback_events(
            session_id=resp["session_id"],
            question_id=resp.get("question_id"),
            response_id=response_id,
            events=fallback_events,
        )
        logger.info(
            "[admin/regrade-response] graded response=%s outcome=%s latency_ms=%d attempts=%d",
            response_id, outcome, int((time.monotonic() - started) * 1000), len(fallback_events),
        )
    # Audit 2026-07-02 (P1) — the grader no longer scores pronunciation (Azure
    # measures it server-side during the original grade). A regrade re-grades
    # FC/LR/GRA only; the audio is UNCHANGED, so re-attach the previously
    # audio-measured P band instead of dropping it — otherwise result/history
    # pages and _regrade_compute_session_bands lose pronunciation after a regrade.
    _reattach_pronunciation_for_regrade(grading, response_id, mode)
    grading = _regrade_apply_heuristic_caps(grading, word_count, part)  # recomputes overall incl. P

    now = datetime.now(timezone.utc).isoformat()
    old_count = resp.get("regrade_count") or 0

    # Persist the preserved P as the canonical final_band_p so the session
    # aggregator (final_band_p precedence) keeps pronunciation. None (test mode
    # with no stored Azure score, or practice mode) → cleared, honest "chưa đánh giá".
    _preserved_p = grading.get("band_p") if mode != "practice" else None
    update: dict = {
        "feedback":           json.dumps(grading, ensure_ascii=False),
        "overall_band":       grading["overall_band"],
        "grading_status":     "completed",
        "final_band_p":       _preserved_p,
        "final_overall_band": grading["overall_band"] if _preserved_p is not None else None,
    }
    if re_transcribed:
        update["transcript"] = transcript

    # Best-effort: save regrade metadata (columns may not exist on old deployments)
    try:
        full_update = {
            **update,
            "last_regraded_at": now,
            "last_regraded_by": admin_email,
            "regrade_count":    old_count + 1,
        }
        supabase_admin.table("responses").update(full_update).eq("id", response_id).execute()
    except Exception:
        supabase_admin.table("responses").update(update).eq("id", response_id).execute()

    return {"overall_band": grading["overall_band"], "re_transcribed": re_transcribed}


# ── POST /admin/responses/{response_id}/regrade ───────────────────────────────

@router.post("/responses/{response_id}/regrade", response_model=AdminResponseRegradeResponse)
@observe_operation("speaking", "grade")
async def admin_regrade_response(
    response_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Chấm lại một response cụ thể.
    Dùng transcript hiện có (nếu đủ dài), hoặc re-transcribe từ audio nếu cần.
    """
    admin = await require_admin(authorization)
    admin_email = admin.get("email", "admin")

    # Load response
    r_res = (
        supabase_admin.table("responses")
        .select("id, session_id, question_id, transcript, audio_storage_path, audio_url, grading_status, regrade_count")
        .eq("id", response_id)
        .limit(1)
        .execute()
    )
    if not r_res.data:
        raise HTTPException(404, "Response không tồn tại")
    resp = r_res.data[0]

    # Load session
    s_res = (
        supabase_admin.table("sessions")
        .select("id, part, mode, user_id, full_test_attempt_id, renderer_affinity")
        .eq("id", resp["session_id"])
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại")
    session = s_res.data[0]

    # Load question
    q_res = (
        supabase_admin.table("questions")
        .select("question_text")
        .eq("id", resp["question_id"])
        .limit(1)
        .execute()
    )
    if not q_res.data:
        raise HTTPException(404, "Câu hỏi không tồn tại")
    question_text = q_res.data[0]["question_text"]
    bind_owned_attempt(session)

    session_id = resp["session_id"]
    logger.info("[admin/regrade-response] response=%s session=%s by=%s", response_id, session_id, admin_email)

    result = await _run_regrade_response(resp, session, question_text, admin_email)

    # Recompute and persist session-level bands so Session History reflects the update.
    # Use the same canonical gate as complete_session(): only block if ALL band values are None.
    bands = _regrade_compute_session_bands(session_id)
    session_updated = False
    incomplete_ids = _regrade_incomplete_response_ids(session_id)
    all_band_vals = [bands.get("overall_band")] + [
        bands.get(k) for k in ("band_fc", "band_lr", "band_gra", "band_p")
    ]
    if not all(v is None for v in all_band_vals):
        now = datetime.now(timezone.utc).isoformat()
        sess_update: dict = {**bands}
        if incomplete_ids:
            sess_update.update({
                "status": "grading_failed",
                "error_code": "grading_failed",
                "error_message": f"Admin regrade còn {len(incomplete_ids)} response lỗi hoặc thiếu band.",
                "failed_step": "admin_regrade_response",
                "last_error_at": now,
            })
        else:
            sess_update.update({
                "status": "completed",
                "error_code": None,
                "error_message": None,
                "failed_step": None,
                "last_error_at": None,
            })
        try:
            supabase_admin.table("sessions").update({
                **sess_update,
                "last_regraded_at": now,
                "last_regraded_by": admin_email,
            }).eq("id", session_id).execute()
        except Exception:
            supabase_admin.table("sessions").update(sess_update).eq("id", session_id).execute()
        session_updated = not incomplete_ids
        logger.info("[admin/regrade-response] session bands updated session=%s overall_band=%s", session_id, bands["overall_band"])
        # Only a canonical-complete result may replace the class ledger score.
        if session_updated:
            sync_class_item_score(supabase_admin, session_id)

    return {
        "ok":              True,
        "response_id":     response_id,
        "session_id":      session_id,
        "overall_band":    result["overall_band"],
        "re_transcribed":  result["re_transcribed"],
        "session_updated": session_updated,
        "remaining_failed": len(incomplete_ids),
        "session_band":    bands["overall_band"],
    }


# ── POST /admin/sessions/{session_id}/regrade ─────────────────────────────────

@router.post("/sessions/{session_id}/regrade", response_model=AdminSessionRegradeResponse)
@observe_operation("speaking", "grade")
async def admin_regrade_session(
    session_id: str,
    force: bool = Query(default=False, description="force=true: regrade ALL responses; force=false (default): repair only failed/missing responses"),
    authorization: str | None = Header(default=None),
):
    """
    Repair or fully regrade a session.

    force=False (default): partial repair — only regrade responses where
      grading_status == 'failed' OR overall_band is None.
      Use this to recover from grading failures without re-running good responses.

    force=True: full regrade — regrade ALL responses regardless of current status.
      Use this when you want to apply updated grading logic to an entire session.

    In both cases, session-level bands are recomputed from all responses afterward.
    """
    admin = await require_admin(authorization)
    admin_email = admin.get("email", "admin")

    # Load session
    s_res = (
        supabase_admin.table("sessions")
        .select("id, part, mode, user_id, status, full_test_attempt_id, renderer_affinity")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại")
    session = s_res.data[0]
    bind_owned_attempt(session)

    # Load questions
    q_res = (
        supabase_admin.table("questions")
        .select("id, question_text")
        .eq("session_id", session_id)
        .execute()
    )
    question_map = {q["id"]: q["question_text"] for q in (q_res.data or [])}

    # Load all responses for this session
    r_res = (
        supabase_admin.table("responses")
        .select("id, session_id, question_id, transcript, audio_storage_path, audio_url, grading_status, overall_band, regrade_count")
        .eq("session_id", session_id)
        .execute()
    )
    all_responses = r_res.data or []

    # Determine which responses need regrading
    def _needs_regrade(r: dict) -> bool:
        if force:
            return True  # full regrade — include all responses
        if r.get("grading_status") == "failed":
            return True
        if r.get("overall_band") is None:
            return True
        return False

    to_regrade = [r for r in all_responses if _needs_regrade(r)]
    skip_count = len(all_responses) - len(to_regrade)

    logger.info("[admin/regrade-session] session=%s total=%d to_regrade=%d skip=%d by=%s",
                session_id, len(all_responses), len(to_regrade), skip_count, admin_email)

    regraded, failed_ids, failed_errors = 0, [], []
    if not all_responses:
        failed_ids.append("session:no_responses")
        failed_errors.append("Session không có response để chấm hoặc tổng hợp")
    for resp in to_regrade:
        qid = resp.get("question_id")
        question_text = question_map.get(qid)
        if not question_text:
            failed_ids.append(resp["id"])
            failed_errors.append(f"{resp['id']}: question_text not found")
            continue
        try:
            await _run_regrade_response(resp, session, question_text, admin_email)
            regraded += 1
        except HTTPException as exc:
            failed_ids.append(resp["id"])
            failed_errors.append(f"{resp['id']}: {exc.detail}")
        except Exception:
            ref = new_ref()
            logger.error("[admin/regrade-session] response=%s failed ref=%s",
                         resp["id"], ref, exc_info=True)
            failed_ids.append(resp["id"])
            failed_errors.append(f"{resp['id']}: Chấm lại thất bại, vui lòng thử lại. (ref={ref})")

    # Read persisted truth back after the loop. A grader call can return without
    # producing a usable row, and a response outside the immediate exception
    # list may still be failed/missing-band. Neither repair mode may finalize
    # the session while any such row remains.
    remaining_ids = _regrade_incomplete_response_ids(session_id)
    failed_ids = list(dict.fromkeys([*failed_ids, *remaining_ids]))
    partial_failure = len(failed_ids) > 0

    # Recompute session-level bands from all responses (including already-good ones)
    bands = _regrade_compute_session_bands(session_id)
    now = datetime.now(timezone.utc).isoformat()

    if partial_failure:
        # Mark session as degraded so the admin knows it needs attention.
        # Do NOT restore status="completed" — the band scores are untrustworthy
        # because some responses kept their old scores.
        session_update: dict = {
            **bands,
            "status": "grading_failed",
            "error_code": "grading_failed",
            "error_message": (
                f"Admin regrade chỉ hoàn tất một phần: {regraded} response thành công, "
                f"{len(failed_ids)} response lỗi."
            ),
            "failed_step": "admin_regrade_session",
            "last_error_at": now,
        }
    else:
        session_update = {
            **bands,
            "status": "completed",
            "error_code": None,
            "error_message": None,
            "failed_step": None,
            "last_error_at": None,
        }

    try:
        full_sess_update = {
            **session_update,
            "last_regraded_at": now,
            "last_regraded_by": admin_email,
            "regrade_count":    ((supabase_admin.table("sessions").select("regrade_count").eq("id", session_id).limit(1).execute().data or [{}])[0].get("regrade_count") or 0) + 1,
        }
        supabase_admin.table("sessions").update(full_sess_update).eq("id", session_id).execute()
        # Only a canonical-complete result may replace the class ledger score.
        if not partial_failure:
            sync_class_item_score(supabase_admin, session_id)
    except Exception:
        supabase_admin.table("sessions").update(session_update).eq("id", session_id).execute()

    if partial_failure:
        note_operation_failure()

    return {
        "ok":               not partial_failure,
        "partial_failure":  partial_failure,
        "session_id":       session_id,
        "regraded":         regraded,
        "skipped":          skip_count,
        "failed":           len(failed_ids),
        "failed_details":   failed_errors[:5],   # cap for response size
        "overall_band":     bands["overall_band"],
        "band_fc":          bands["band_fc"],
        "band_lr":          bands["band_lr"],
        "band_gra":         bands["band_gra"],
        "band_p":           bands["band_p"],
    }


# ── POST /admin/sessions/{session_id}/rebuild-summary ─────────────────────────

@router.post("/sessions/{session_id}/rebuild-summary", response_model=AdminSummaryRebuildResponse)
@observe_operation("speaking", "finalize")
async def admin_rebuild_summary(
    session_id: str,
    p2_id: str | None = Query(default=None, description="Part 2 session ID (for test_full)"),
    p3_id: str | None = Query(default=None, description="Part 3 session ID (for test_full)"),
    authorization: str | None = Header(default=None),
):
    """
    Tổng hợp lại kết quả từ response data hiện có mà không rerun grading.
    Dùng cho full test hoặc session bị fail ở bước aggregate.
    Cập nhật overall_band / band_fc/lr/gra/p cho tất cả sessions liên quan.
    """
    admin = await require_admin(authorization)
    admin_email = admin.get("email", "admin")

    all_ids = [sid for sid in [session_id, p2_id, p3_id] if sid]

    # Verify sessions exist
    s_res = (
        supabase_admin.table("sessions")
        .select("id, user_id, mode, part, status, full_test_attempt_id, renderer_affinity")
        .in_("id", all_ids)
        .execute()
    )
    found_rows = s_res.data or []
    found_ids = {s["id"] for s in found_rows}
    missing = [sid for sid in all_ids if sid not in found_ids]
    if missing:
        raise HTTPException(404, f"Session không tồn tại: {clip_user_values(missing)}")

    # A multi-part rebuild is allowed only for one canonical Full Test. Never
    # let caller-supplied IDs aggregate unrelated learners or attempts.
    if p2_id or p3_id:
        if not p2_id or not p3_id or len(set(all_ids)) != 3:
            raise HTTPException(400, "Full Test rebuild cần ba session P1/P2/P3 khác nhau")
        rows_by_id = {row.get("id"): row for row in found_rows}
        expected = ((session_id, 1), (p2_id, 2), (p3_id, 3))
        primary = rows_by_id.get(session_id) or {}
        attempt_id = primary.get("full_test_attempt_id")
        user_id = primary.get("user_id")
        valid = bool(attempt_id and user_id)
        for sid, part in expected:
            row = rows_by_id.get(sid) or {}
            valid = valid and (
                row.get("mode") == "test_full"
                and row.get("part") == part
                and row.get("full_test_attempt_id") == attempt_id
                and row.get("user_id") == user_id
            )
        if not valid:
            raise HTTPException(409, "Ba session không thuộc cùng một Full Test canonical")

    logger.info("[admin/rebuild-summary] sessions=%s by=%s", all_ids, admin_email)
    bind_owned_attempt(next(row for row in found_rows if row["id"] == session_id))

    now = datetime.now(timezone.utc).isoformat()
    results = []

    for sid in all_ids:
        bands = _regrade_compute_session_bands(sid)
        if bands["overall_band"] is None:
            results.append({"session_id": sid, "ok": False, "error": "Không có đủ dữ liệu response để tính band"})
            continue

        incomplete_ids = _regrade_incomplete_response_ids(sid)
        if incomplete_ids:
            # Rebuild does not call AI, so it cannot repair failed/missing rows.
            # Persist the recalculated partial bands but keep the session visibly
            # degraded instead of laundering it into a completed result.
            now = datetime.now(timezone.utc).isoformat()
            supabase_admin.table("sessions").update({
                **bands,
                "status": "grading_failed",
                "error_code": "grading_failed",
                "error_message": f"Tổng hợp còn {len(incomplete_ids)} response lỗi hoặc thiếu band.",
                "failed_step": "admin_rebuild_summary",
                "last_error_at": now,
            }).eq("id", sid).execute()
            results.append({
                "session_id": sid,
                "ok": False,
                "error": f"Còn {len(incomplete_ids)} response lỗi hoặc thiếu band",
                **bands,
            })
            continue

        sess_update: dict = {
            **bands,
            "status": "completed",
            "error_code": None,
            "error_message": None,
            "failed_step": None,
            "last_error_at": None,
        }
        try:
            full_update = {
                **sess_update,
                "last_regraded_at": now,
                "last_regraded_by": admin_email,
            }
            supabase_admin.table("sessions").update(full_update).eq("id", sid).execute()
        except Exception:
            supabase_admin.table("sessions").update(sess_update).eq("id", sid).execute()

        # Rebuild is another canonical score write-path. Keep a linked class
        # assignment in step just like response/session regrade does.
        sync_class_item_score(supabase_admin, sid)

        results.append({"session_id": sid, "ok": True, **bands})

    if any(not row["ok"] for row in results):
        note_operation_failure()
    return {"ok": True, "sessions": results}
