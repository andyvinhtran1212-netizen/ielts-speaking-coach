import asyncio
import json
import logging
import math
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException, Header, Query
from pydantic import BaseModel, field_validator

from config import settings
from database import supabase_admin
from services.question_visibility import redact_questions, should_reveal
from routers.auth import get_supabase_user
from services.class_assignment_service import (
    DeadlinePassedError,
    ItemNotFoundError,
    TaskMismatchError,
    attach_session_to_class_item,
    is_accepting_submissions,
    mark_item_submitted,
    sync_class_item_score,
    validate_class_item_for_session,
)
from services.access_code_permissions import (
    get_user_access_code_permissions_cached,
    get_user_session_quota,
    has_permission,
)
from services.retention import compute_expiry, content_purge_cutoff, should_touch

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _touch_last_accessed(session_id: str, last_accessed) -> None:
    """Throttled, fire-and-forget refresh of sessions.last_accessed_at (the second
    retention timer). Runs as a BackgroundTask so it never blocks the read, and
    swallows errors so a touch failure can't break GET /sessions/{id} (Pattern #29)."""
    try:
        if not should_touch(last_accessed):
            return
        supabase_admin.table("sessions").update(
            {"last_accessed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", session_id).execute()
    except Exception as exc:  # noqa: BLE001 — touch is best-effort
        logger.warning("[retention] last_accessed_at touch failed for %s: %s", session_id, exc)

_VALID_MODES   = {"practice", "test_part", "test_full"}
_AUDIO_BUCKET  = "audio-responses"
_SIGNED_URL_TTL = 3600   # 1 hour


def _round_band(value: float) -> float:
    """Round to nearest 0.5 — IELTS display convention. Clamps to [1.0, 9.0]."""
    rounded = math.floor(value * 2 + 0.5) / 2
    return max(1.0, min(9.0, rounded))


def _compute_session_bands(session_id: str) -> dict:
    """
    Canonical aggregate: fetch all responses for session and compute band scores.

    Canonical field precedence (P criterion):
      - Use ``responses.final_band_p`` (pronunciation-adjusted) when set.
      - Fall back to ``responses.feedback.band_p`` (raw AI grade) otherwise.

    Canonical overall per response:
      - ``responses.final_overall_band``: pronunciation-adjusted overall for this response.
        Set by the pronunciation service ONLY — admin regrade clears it.
        Meaning:
          • Practice mode: pronunciation-tweaked overall (P-weighted delta applied to overall_band).
          • Test mode: avg(FC, LR, GRA, final_band_p) recomputed after pronunciation.
        This value is an intermediate artifact; it feeds _compute_session_bands but is
        never exposed as the session-level truth.  ``sessions.overall_band`` is the truth
        after finalization.
      - Falls back to ``responses.overall_band`` (raw AI overall) when not set.

    Session-level truth (written by update_session_bands / complete_session):
      - ``sessions.overall_band``  — canonical session overall (the authoritative value).
      - ``sessions.band_fc/lr/gra/p`` — canonical per-criterion averages.

    FC / LR / GRA always come from ``feedback.*`` (pronunciation does not adjust them).
    """
    r_res = (
        supabase_admin.table("responses")
        .select("overall_band, final_band_p, final_overall_band, feedback")
        .eq("session_id", session_id)
        .execute()
    )
    responses = r_res.data or []

    fc_vals, lr_vals, gra_vals, p_vals, r_bands = [], [], [], [], []
    for r in responses:
        # Overall-band fallback (practice mode — no criterion bands in feedback)
        final_ob = r.get("final_overall_band")
        ob = final_ob if final_ob is not None else r.get("overall_band")
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

        for vals, key in ((fc_vals, "band_fc"), (lr_vals, "band_lr"), (gra_vals, "band_gra")):
            v = fb.get(key)
            if v is not None:
                try:
                    vals.append(float(v))
                except (TypeError, ValueError):
                    pass

        # P criterion: pronunciation-adjusted when available, else raw AI grade
        final_p = r.get("final_band_p")
        if final_p is not None:
            p_vals.append(float(final_p))
        else:
            v = fb.get("band_p")
            if v is not None:
                try:
                    p_vals.append(float(v))
                except (TypeError, ValueError):
                    pass

    criteria_bands: dict = {
        "band_fc":  _round_band(sum(fc_vals)  / len(fc_vals))  if fc_vals  else None,
        "band_lr":  _round_band(sum(lr_vals)  / len(lr_vals))  if lr_vals  else None,
        "band_gra": _round_band(sum(gra_vals) / len(gra_vals)) if gra_vals else None,
        "band_p":   _round_band(sum(p_vals)   / len(p_vals))   if p_vals   else None,
    }
    scored = [v for v in criteria_bands.values() if v is not None]
    overall_band = (
        _round_band(sum(scored) / len(scored)) if scored
        else (_round_band(sum(r_bands) / len(r_bands)) if r_bands else None)
    )
    return {"overall_band": overall_band, **criteria_bands}


def update_session_bands(session_id: str) -> None:
    """
    Re-aggregate band scores for a session and persist them (no status change).
    Called by the pronunciation endpoint after writing final_band_p so that the
    session aggregate immediately reflects pronunciation-adjusted scores.
    Safe to call on completed or in-progress sessions.
    """
    try:
        bands = _compute_session_bands(session_id)
    except Exception as e:
        # Mục 14 (B5): make the silent failure observable. This runs as a
        # background task after pronunciation; if it dies quietly the session
        # keeps stale (pre-pronunciation) bands and nobody notices.
        logger.error(
            "[update_session_bands][metric] band_recompute_failed=1 session=%s: %s "
            "— pronunciation-adjusted bands NOT persisted", session_id, e,
        )
        return

    payload = {k: v for k, v in bands.items() if v is not None}
    if not payload:
        return
    try:
        supabase_admin.table("sessions").update(payload).eq("id", session_id).execute()
        logger.info("[update_session_bands] session=%s bands=%s", session_id, payload)
        # GĐ 2 — the band just changed, so a class assignment pointing at this
        # session is now showing a stale score. Score only; the hand-in time and
        # its late/on-time verdict are untouched.
        sync_class_item_score(supabase_admin, session_id)
    except Exception as e:
        logger.error(
            "[update_session_bands][metric] band_persist_failed=1 session=%s: %s "
            "— user will see stale bands", session_id, e,
        )


# Maps session mode → required permission scope
_MODE_SCOPE: dict[str, str] = {
    "practice":  "practice_single",
    "test_part": "practice_part",
    "test_full": "practice_full",
}


# ── Request models ─────────────────────────────────────────────────────────────

class CreateSessionBody(BaseModel):
    mode: str
    part: int
    topic: str
    # When set, this session is part of a sealed 4-skill mock sitting. It is
    # linked at creation (before any response is graded) so per-response speaking
    # grading is sealed from the first answer.
    sitting_id: str | None = None
    # For Full Test Part 2/3 the client identifies only the immediately prior
    # session. The server resolves the canonical attempt id from that owned row;
    # callers never get to choose an attempt id themselves.
    previous_session_id: str | None = None
    # GĐ 2 — when set, this session answers a class assignment. Linked at
    # creation, exactly like sitting_id, so PATCH /complete can record the
    # hand-in without having to guess from the topic string.
    class_assignment_item_id: str | None = None
    # Optional idempotency identity for a retryable plain session create. The
    # UUID becomes sessions.id through the v2 atomic-create RPC, so a
    # network-after-commit retry returns the same row rather than burning a
    # second daily slot. Linked class/mock creates keep their established path
    # until their post-create hooks can report replay state explicitly.
    client_session_id: UUID | None = None
    # Capability marker added with migration 216. Browsers that do not send it
    # are N-1 and must be pinned Legacy at INSERT time; current players send
    # claim-v1 and receive an unclaimed row which their stable player claims
    # before any canonical read/write.
    renderer_affinity_protocol: Literal["claim-v1"] | None = None

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v):
        if v not in _VALID_MODES:
            raise ValueError(f"mode phải là một trong: {sorted(_VALID_MODES)}")
        return v

    @field_validator("part")
    @classmethod
    def validate_part(cls, v):
        if v not in (1, 2, 3):
            raise ValueError("part phải là 1, 2, hoặc 3")
        return v

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, v):
        if not v.strip():
            raise ValueError("topic không được để trống")
        return v.strip()

    @field_validator("previous_session_id")
    @classmethod
    def validate_previous_session_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        session_id = value.strip()
        if not session_id:
            raise ValueError("previous_session_id không được để trống")
        return session_id


class ClaimRendererAffinityBody(BaseModel):
    renderer_affinity: Literal["legacy", "next"]


class FinalizeFullTestBody(BaseModel):
    p1_id: str
    p2_id: str
    p3_id: str

    @field_validator("p1_id", "p2_id", "p3_id")
    @classmethod
    def validate_session_id(cls, value: str) -> str:
        session_id = value.strip()
        if not session_id:
            raise ValueError("session ID không được để trống")
        return session_id


# ── Shared guards ─────────────────────────────────────────────────────────────

def _require_permission(user_id: str, mode: str) -> None:
    """Assert user holds the scope required for the requested session mode.

    PR1 single-source: read the LIVE access-code permissions instead of the
    users.permissions snapshot, so a revoke / access-change is instant. The
    live query honors access_codes.is_revoked/is_active/expires_at AND
    user_code_assignments.is_active (per-user revoke). has_permission honors the
    "all" wildcard (ADMIN_OVERRIDE_PERMISSION="all"), so a live ["all"] code
    keeps all modes.
    """
    required = _MODE_SCOPE.get(mode)
    if not required:
        return  # unknown mode — field_validator above will reject it first

    try:
        perms = get_user_access_code_permissions_cached(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi kiểm tra quyền: {e}")

    if has_permission(perms, required):
        return

    raise HTTPException(
        status_code=403,
        detail=f"Tài khoản không có quyền sử dụng chế độ này (cần: {required})",
    )


def _require_active(user_id: str) -> None:
    try:
        r = (
            supabase_admin.table("users")
            .select("is_active")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi kiểm tra tài khoản: {e}")

    if not r.data or not r.data[0].get("is_active"):
        raise HTTPException(status_code=403, detail="Tài khoản chưa được kích hoạt")


def _resolve_full_test_attempt_id(user_id: str, body: CreateSessionBody) -> str | None:
    """Resolve Part 2/3 membership from the immediately preceding owned row.

    Part 1 receives a fresh id from migration 200's insert trigger. Non-Full-Test
    modes may not smuggle a predecessor. This keeps chain identity canonical on
    the server and makes a manipulated client payload harmless.
    """
    previous_id = body.previous_session_id
    if body.mode != "test_full":
        if previous_id:
            raise HTTPException(400, "previous_session_id chỉ dùng cho Full Test")
        return None
    if body.part == 1:
        if previous_id:
            raise HTTPException(400, "Full Test Part 1 không được có session trước đó")
        return None
    if not previous_id:
        raise HTTPException(
            400,
            f"Full Test Part {body.part} cần session Part {body.part - 1} liền trước",
        )
    try:
        result = (
            supabase_admin.table("sessions")
            .select("id, mode, part, status, full_test_attempt_id")
            .eq("id", previous_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi kiểm tra chuỗi Full Test: {e}")

    row = (result.data or [None])[0]
    if (
        not row
        or row.get("mode") != "test_full"
        or row.get("part") != body.part - 1
        or row.get("status") != "in_progress"
    ):
        raise HTTPException(
            400,
            f"Session trước đó không phải Full Test Part {body.part - 1} đang làm",
        )
    attempt_id = str(row.get("full_test_attempt_id") or "").strip()
    if not attempt_id:
        raise HTTPException(
            409,
            "Session Full Test cũ chưa có mã chuỗi an toàn. Hãy bắt đầu lại Full Test.",
        )
    return attempt_id


def _rollback_unstarted_session(session_id: str) -> None:
    """Best-effort rollback for a session that has not been returned yet."""
    try:
        supabase_admin.table("sessions").delete().eq("id", session_id).execute()
    except Exception as e:
        logger.critical(
            "[create_session] failed to roll back unstarted session=%s: %s",
            session_id,
            e,
        )


def _session_create_payload(session: dict) -> dict:
    return {
        "session_id": session["id"],
        "mode": session["mode"],
        "part": session["part"],
        "topic": session["topic"],
        "started_at": session["started_at"],
        "status": session["status"],
        "full_test_attempt_id": session.get("full_test_attempt_id"),
    }


def _find_replayable_full_test_part(
    user_id: str,
    attempt_id: str | None,
    body: CreateSessionBody,
) -> dict | None:
    """Return the already-created next Part after a lost POST response.

    The client supplies only the immediately preceding session. The canonical
    attempt id has already been resolved from that owned row, so this lookup
    cannot be redirected to another attempt by manipulating the request.
    """
    if body.mode != "test_full" or body.part == 1 or not attempt_id:
        return None
    try:
        result = (
            supabase_admin.table("sessions")
            .select(
                "id, mode, part, topic, started_at, status, sitting_id, "
                "class_assignment_item_id, full_test_attempt_id"
            )
            .eq("user_id", user_id)
            .eq("full_test_attempt_id", attempt_id)
            .eq("part", body.part)
            .limit(2)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi kiểm tra Part Full Test đã tạo: {exc}")

    rows = result.data or []
    if not rows:
        return None
    if len(rows) != 1:
        raise HTTPException(409, "Full Test có nhiều session cho cùng một Part")
    session = rows[0]
    sitting_matches = session.get("sitting_id") in {None, body.sitting_id}
    payload_matches = (
        session.get("mode") == "test_full"
        and session.get("part") == body.part
        and session.get("topic") == body.topic
        and session.get("status") == "in_progress"
        and sitting_matches
        and session.get("class_assignment_item_id") == body.class_assignment_item_id
    )
    if not payload_matches:
        raise HTTPException(409, "Part Full Test đã tồn tại với dữ liệu khác")
    return session


def _bind_session_to_mock_if_requested(
    session_id: str,
    user_id: str,
    sitting_id: str | None,
) -> None:
    if not sitting_id:
        return
    from services import mock_exam_service
    try:
        mock_exam_service.bind_session_to_sitting(session_id, user_id, sitting_id)
    except (
        mock_exam_service.NotFoundError,
        PermissionError,
        mock_exam_service.SittingConflictError,
    ) as exc:
        raise HTTPException(status_code=400, detail=f"Không gắn được session vào kỳ thi: {exc}")


# ── POST /sessions ─────────────────────────────────────────────────────────────

@router.post("")
async def create_session(
    body: CreateSessionBody,
    authorization: str | None = Header(default=None),
):
    """
    Tạo session mới. Yêu cầu tài khoản đã được kích hoạt (is_active=true).
    Giới hạn MAX_SESSIONS_PER_USER_PER_DAY session mỗi ngày.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    if body.client_session_id and (body.sitting_id or body.class_assignment_item_id):
        raise HTTPException(
            status_code=400,
            detail="client_session_id chỉ dùng cho phiên luyện không gắn bài lớp/kỳ thi",
        )

    _require_active(user_id)

    # GĐ 2 — validate the class assignment FIRST, for two reasons.
    #
    # It must happen before the session is created, or a rejection (stale
    # params, an assignment archived between /start and here) still burns one of
    # the student's daily slots on a session they cannot hand in.
    #
    # And a valid assignment ENTITLES its own mode. Access codes are scoped per
    # mode (practice_single / practice_part / …), so a student holding only
    # practice_single who is given a test_part task was counted as assigned,
    # could see it in /api/class/my-assignments, and got a 403 every time they
    # opened it — homework they can see and can never do. The teacher assigning
    # it is the authorisation. This mirrors the existing Writing bridge, where
    # holding a writing assignment unlocks the Writing card
    # (services/access_code_permissions.student_has_writing_assignment).
    entitled_by_assignment = False
    if body.class_assignment_item_id:
        try:
            validate_class_item_for_session(
                supabase_admin, user_id, body.class_assignment_item_id,
                session_mode=body.mode, session_part=body.part, session_topic=body.topic,
            )
            entitled_by_assignment = True
        except DeadlinePassedError as e:
            raise HTTPException(409, str(e))
        except (ItemNotFoundError, TaskMismatchError) as e:
            raise HTTPException(status_code=400, detail=str(e))

    if not entitled_by_assignment:
        _require_permission(user_id, body.mode)

    # Resolve this before consuming a daily slot. Part 2/3 membership comes
    # only from the immediately preceding owned session; the caller cannot
    # choose or replay a raw attempt identifier.
    full_test_attempt_id = _resolve_full_test_attempt_id(user_id, body)
    replay_session = _find_replayable_full_test_part(user_id, full_test_attempt_id, body)
    if replay_session:
        _bind_session_to_mock_if_requested(
            replay_session["id"], user_id, body.sitting_id,
        )
        return _session_create_payload(replay_session)

    # Admin bypass — admins không bị giới hạn quota
    try:
        user_role_result = (
            supabase_admin.table("users")
            .select("role")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        is_admin = bool(
            user_role_result.data
            and user_role_result.data[0].get("role") == "admin"
        )
    except Exception:
        # Defensive: nếu role lookup fail, treat as non-admin (apply quota)
        is_admin = False

    # UTC day-start (matches the "(UTC)" intent). date.today() is the LOCAL date,
    # so in UTC+ timezones it pointed today_start at a FUTURE UTC instant for
    # ~7h/day (local midnight–07:00 in UTC+7), zeroing the daily count and letting
    # users exceed the cap. Use the UTC date. Computed here (not in SQL) so the
    # day-boundary logic stays in one place; passed to the atomic-create RPC.
    today_start = (
        datetime.combine(datetime.now(timezone.utc).date(), datetime.min.time())
        .replace(tzinfo=timezone.utc)
        .isoformat()
    )

    # Per-code lifetime quota (Sprint 5.2 wish #1), via the canonical quota so
    # admin display and enforcement agree. session_limit = total lượt a code
    # grants (NULL = unlimited); multi-code = SUM of live codes' limits.
    # "used" counts ONLY COMPLETED sessions — abandoned in_progress sessions
    # do NOT consume a lượt (counting them locked students out unfairly).
    # SEPARATE from the daily cap below — both must pass. Kept in Python because
    # it counts completed sessions, so it is NOT raceable at creation time.
    if not is_admin:
        try:
            quota = get_user_session_quota(user_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi khi kiểm tra quota: {e}")

        if not quota["unlimited"] and quota["used"] >= quota["limit"]:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Bạn đã dùng hết {quota['limit']} lượt của mã kích hoạt. "
                    f"Liên hệ quản trị viên để được cấp thêm lượt."
                ),
            )

    # Create session — L7: the daily-cap count-then-insert is done atomically in
    # fn_create_session_daily_capped (migration 126) under a per-user advisory
    # lock, so concurrent POST /sessions can't both slip under the daily cap.
    # Admins bypass the cap via an effectively-unlimited ceiling.
    max_daily = 2_000_000_000 if is_admin else settings.MAX_SESSIONS_PER_USER_PER_DAY
    affinity_aware = body.renderer_affinity_protocol == "claim-v1"
    rpc_name = (
        "fn_create_session_daily_capped_v3"
        if affinity_aware
        else (
            "fn_create_session_daily_capped_v2"
            if body.client_session_id
            else "fn_create_session_daily_capped"
        )
    )
    rpc_params = {
        "p_user_id":   user_id,
        "p_mode":      body.mode,
        "p_part":      body.part,
        "p_topic":     body.topic,
        "p_day_start": today_start,
        "p_max_daily": max_daily,
    }
    if affinity_aware:
        # v3 explicitly inserts NULL. Migration 216 gives every legacy/v1/v2
        # insert a database default of Legacy, including requests handled by an
        # N-1 backend instance during a rolling deployment.
        rpc_params["p_session_id"] = str(body.client_session_id or uuid4())
        rpc_params["p_renderer_affinity"] = None
    elif body.client_session_id:
        rpc_params["p_session_id"] = str(body.client_session_id)

    try:
        result = supabase_admin.rpc(rpc_name, rpc_params).execute()
    except Exception as e:
        if "daily_quota_exceeded" in str(e):
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Bạn đã đạt giới hạn {settings.MAX_SESSIONS_PER_USER_PER_DAY} "
                    f"sessions hôm nay. Hãy thử lại vào ngày mai."
                ),
            )
        if "session_id_conflict" in str(e):
            raise HTTPException(status_code=409, detail="Mã tạo phiên đã được dùng cho yêu cầu khác")
        raise HTTPException(status_code=500, detail=f"Không thể tạo session: {e}")

    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Không thể tạo session")
    s = rows[0]

    # Migration 200's trigger creates Part 1's canonical id atomically with the
    # row. Later parts inherit the id resolved above. The partial unique index on
    # (attempt, part) closes double-click/replay races at the database boundary.
    if body.mode == "test_full":
        if body.part == 1:
            if not s.get("full_test_attempt_id"):
                _rollback_unstarted_session(s["id"])
                raise HTTPException(
                    status_code=503,
                    detail="Full Test đang được cập nhật. Vui lòng thử lại sau.",
                )
        else:
            try:
                supabase_admin.table("sessions").update({
                    "full_test_attempt_id": full_test_attempt_id,
                }).eq("id", s["id"]).eq("user_id", user_id).execute()
            except Exception as e:
                _rollback_unstarted_session(s["id"])
                conflict = (
                    "uq_sessions_full_test_attempt_part" in str(e)
                    or "duplicate key" in str(e).lower()
                )
                if conflict:
                    replay_session = _find_replayable_full_test_part(
                        user_id, full_test_attempt_id, body,
                    )
                    if replay_session:
                        _bind_session_to_mock_if_requested(
                            replay_session["id"], user_id, body.sitting_id,
                        )
                        return _session_create_payload(replay_session)
                raise HTTPException(
                    status_code=409 if conflict else 500,
                    detail=(
                        "Part này của Full Test đã được tạo. Hãy mở lại bài đang làm."
                        if conflict else "Không nối được phần tiếp theo của Full Test. Hãy thử lại."
                    ),
                )
            s["full_test_attempt_id"] = full_test_attempt_id

    # GĐ 2 — class assignment: write the link so PATCH /complete can record the
    # hand-in. Validation already happened BEFORE the session was created (see
    # above), so the only thing that can fail here is the UPDATE itself.
    #
    # If it does, the session is deleted rather than returned. A session returned
    # without the link is worse than no session: the student records their answer,
    # completes it, and the teacher still sees "chưa nộp" with nothing to point at
    # — and it would also have consumed one of their daily slots. Nothing has been
    # recorded against it yet, so removing it loses no work.
    if body.class_assignment_item_id:
        linked = False
        try:
            linked = attach_session_to_class_item(
                supabase_admin, s["id"], user_id, body.class_assignment_item_id
            )
        except Exception as e:
            logger.warning(
                "[create_session] class item link failed session=%s item=%s: %s",
                s["id"], body.class_assignment_item_id, e,
            )
        if not linked:
            try:
                supabase_admin.table("sessions").delete().eq("id", s["id"]).execute()
            except Exception as e:
                logger.warning("[create_session] could not roll back session=%s: %s", s["id"], e)
            raise HTTPException(
                status_code=500,
                detail="Không gắn được phiên vào bài tập của lớp. Hãy thử lại.",
            )

    # Mock sitting: link the session AT CREATION (before any response can be
    # graded) so per-response speaking grading is sealed. Validated inside.
    _bind_session_to_mock_if_requested(s["id"], user_id, body.sitting_id)
    return _session_create_payload(s)


# ── GET /sessions ──────────────────────────────────────────────────────────────
#
# Backwards-compat contract:
#   - When NONE of the new params are passed (search / sort / date_from /
#     date_to / page), the response stays a bare list ordered by
#     started_at DESC — exactly what dashboard.html's existing
#     `/sessions?limit=200` call expects.
#   - When ANY new param is passed, the response switches to a paginated
#     dict {sessions, total, page, page_size, total_pages}.
#
# This dual-shape contract avoids breaking the dashboard while letting the
# new search UI consume the richer payload.  Callers opt into the new shape
# simply by passing `page=1` (or any other new param).
#
# Schema notes (verified):
#   - sessions.started_at is the canonical chronological column.
#   - sessions.overall_band is the canonical session-level band score
#     (sessions.py:51 docstring) — this is what `score_desc` / `score_asc`
#     order against, NOT a non-existent `band_score` column.

_SORT_FIELD = {
    "newest":     ("started_at",  True),    # (column, desc)
    "oldest":     ("started_at",  False),
    "score_desc": ("overall_band", True),
    "score_asc":  ("overall_band", False),
}


@router.get("")
async def list_sessions(
    authorization: str | None = Header(default=None),
    status: Optional[str] = Query(default=None, description="Lọc theo status: in_progress | completed"),
    part: Optional[int] = Query(default=None, description="Lọc theo part: 1 | 2 | 3"),
    limit: int = Query(default=20, ge=1, le=200, description="(Legacy) số lượng sessions tối đa trả về khi không dùng pagination"),
    # Phase 2.5 — search / filter / sort / pagination.  All optional; the
    # endpoint stays backwards-compatible when the caller passes none of them.
    search: Optional[str] = Query(default=None, max_length=200, description="Substring match on sessions.topic (ILIKE)."),
    sort: str = Query(default="newest", pattern="^(newest|oldest|score_desc|score_asc)$"),
    date_from: Optional[str] = Query(default=None, description="ISO date/datetime; sessions.started_at >= date_from"),
    date_to: Optional[str] = Query(default=None,   description="ISO date/datetime; sessions.started_at <= date_to"),
    page: Optional[int] = Query(default=None, ge=1, description="1-based page index (omit to disable pagination)"),
    page_size: int = Query(default=20, ge=5, le=100),
    include_hidden: bool = Query(default=False, description="Sprint 16.2.1 — include content-purged (>60d inactive) sessions. Default false hides them from the history list; true powers a future 'Show hidden' view."),
):
    """List the caller's sessions, with optional search / sort / pagination.

    Default behaviour (no new params) returns a list of up to `limit` rows
    ordered by `started_at` DESC — same as before Phase 2.5.

    When any of {search, date_from, date_to, page} is set, OR sort is non-
    default, response switches to a paginated dict so the UI can render
    page controls.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    paginated = (
        page is not None
        or search is not None
        or date_from is not None
        or date_to is not None
        or sort != "newest"
    )

    try:
        # `count="exact"` only when the caller wants pagination — it's a
        # noticeable extra cost on large tables.  For the legacy list mode
        # we skip it so behaviour is identical to before.
        select_kwargs = {"count": "exact"} if paginated else {}
        q = (
            supabase_admin.table("sessions")
            .select("*", **select_kwargs)
            .eq("user_id", user_id)
        )
        if status is not None:
            q = q.eq("status", status)
        else:
            # A1 (audit) — exclude bare in_progress from the DEFAULT history list
            # so the `total` count and the rendered rows agree. The frontend
            # already drops in_progress client-side; counting them server-side
            # made the paginated header over-report (e.g. "25 sessions" with only
            # 20 completed rows shown). An explicit ?status=in_progress still
            # returns them.
            q = q.neq("status", "in_progress")
        if part is not None:
            q = q.eq("part", part)
        if search and search.strip():
            q = q.ilike("topic", f"%{search.strip()}%")
        if date_from:
            q = q.gte("started_at", date_from)
        if date_to:
            q = q.lte("started_at", date_to)

        # Sprint 16.2.1 (model v2) — exclude content-purged sessions (inactive
        # >60d by the more recent of started_at / last_accessed_at) from the
        # history list. Audio purge (15d) does NOT hide a session. No row is
        # deleted; ?include_hidden=true returns everything. content_purged_at IS
        # NULL until the Sprint 16.4 sweep starts writing it.
        if not include_hidden:
            cutoff = content_purge_cutoff()
            q = q.is_("content_purged_at", "null").or_(
                f"started_at.gte.{cutoff},last_accessed_at.gte.{cutoff}"
            )

        sort_col, sort_desc = _SORT_FIELD[sort]
        # nullsfirst=False keeps NULL bands (in-progress sessions) at the
        # bottom regardless of sort direction — otherwise score_desc would
        # surface unfinished sessions at the top.
        q = q.order(sort_col, desc=sort_desc, nullsfirst=False)

        if paginated:
            effective_page = page or 1
            offset = (effective_page - 1) * page_size
            q = q.range(offset, offset + page_size - 1)
        else:
            q = q.limit(limit)

        result = q.execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể tải sessions: {e}")

    rows = result.data or []
    # Sprint 16.2.1 (model v2) — augment each row with read-time retention info
    # (days_until_audio_purge/content_purge, is_audio_purged/is_content_purged,
    # is_hidden) so the warning UI can render countdowns without recomputing
    # policy client-side.
    for row in rows:
        row["retention"] = compute_expiry(row)
    if not paginated:
        return rows

    total = int(result.count or 0)
    effective_page = page or 1
    total_pages = (total + page_size - 1) // page_size if total else 0
    return {
        "sessions":     rows,
        "total":        total,
        "page":         effective_page,
        "page_size":    page_size,
        "total_pages":  total_pages,
    }


# ── GET /sessions/stats ────────────────────────────────────────────────────────

@router.get("/stats")
async def get_session_stats(
    limit: int = Query(default=10, ge=1, le=100),
    authorization: str | None = Header(default=None),
):
    """
    Trả thống kê tổng hợp và danh sách sessions gần nhất (completed).
    Dùng cho dashboard: stat cards + chart data.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Recent completed sessions for chart / last_topic
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id, started_at, mode, part, topic, band_fc, band_lr, band_gra, band_p, overall_band, status")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
        )
        sessions = s_res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải sessions: {e}")

    # total_sessions (all statuses)
    try:
        total_res = (
            supabase_admin.table("sessions")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        total_sessions = total_res.count if total_res.count is not None else len(total_res.data or [])
    except Exception:
        total_sessions = 0

    # avg_band_30d — average overall_band for completed sessions in last 30 days
    try:
        thirty_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        band_res = (
            supabase_admin.table("sessions")
            .select("overall_band")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .gte("started_at", thirty_ago)
            .execute()
        )
        bands = [
            r["overall_band"]
            for r in (band_res.data or [])
            if r.get("overall_band") is not None
        ]
        avg_band_30d = round(sum(bands) / len(bands), 1) if bands else None
    except Exception:
        avg_band_30d = None

    # current_streak — consecutive days with at least one session (any status)
    current_streak = 0
    try:
        streak_res = (
            supabase_admin.table("sessions")
            .select("started_at")
            .eq("user_id", user_id)
            .order("started_at", desc=True)
            .limit(365)
            .execute()
        )
        day_set = {
            r["started_at"][:10]
            for r in (streak_res.data or [])
            if r.get("started_at")
        }
        # UTC, not date.today(): day_set keys are UTC date strings, so the
        # walk-back cursor must be UTC too — local date.today() broke the streak
        # for ~7h/day in UTC+ timezones (same bug/fix as the home + dashboard
        # aggregators).
        cursor = datetime.now(timezone.utc).date()
        while cursor.isoformat() in day_set:
            current_streak += 1
            cursor -= timedelta(days=1)
    except Exception:
        pass

    last_session = sessions[0] if sessions else None

    return {
        "sessions": sessions,
        "summary": {
            "total_sessions": total_sessions,
            "avg_band_30d":   avg_band_30d,
            "current_streak": current_streak,
            "last_topic":     last_session.get("topic") if last_session else None,
            "last_part":      last_session.get("part") if last_session else None,
            "last_mode":      last_session.get("mode") if last_session else None,
            "last_session_at": last_session.get("started_at") if last_session else None,
        },
    }


# ── GET /sessions/{session_id} ─────────────────────────────────────────────────

@router.post("/{session_id}/renderer-affinity")
async def claim_renderer_affinity(
    session_id: UUID,
    body: ClaimRendererAffinityBody,
    authorization: str | None = Header(default=None),
):
    """Claim the stable renderer on first player boot; never move it later."""
    auth_user = await get_supabase_user(authorization)
    try:
        result = supabase_admin.rpc(
            "fn_claim_session_renderer_affinity",
            {
                "p_session_id": str(session_id),
                "p_user_id": auth_user["id"],
                "p_renderer_affinity": body.renderer_affinity,
            },
        ).execute()
    except Exception as exc:
        logger.error(
            "[renderer-affinity] claim failed session=%s renderer=%s: %s",
            session_id,
            body.renderer_affinity,
            exc,
        )
        raise HTTPException(500, "Không thể xác nhận phiên bản player. Hãy tải lại trang.")

    rows = result.data or []
    if len(rows) != 1:
        raise HTTPException(404, "Session không tồn tại")
    affinity = rows[0].get("renderer_affinity")
    if affinity not in {"legacy", "next"}:
        raise HTTPException(500, "Session chưa có renderer hợp lệ")
    return {"session_id": str(session_id), "renderer_affinity": affinity}

@router.get("/{session_id}")
async def get_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Trả chi tiết session kèm danh sách questions và responses."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Fetch session (ownership enforced by eq user_id)
    try:
        s_result = (
            supabase_admin.table("sessions")
            .select("*")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")

    if not s_result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")

    session = s_result.data[0]

    # Sprint 16.2 — refresh the retention "last accessed" timer (throttled,
    # non-blocking). Opening a session keeps it in the 7-day visible window.
    background_tasks.add_task(_touch_last_accessed, session_id, session.get("last_accessed_at"))

    # Questions for this session. Keep lookup failure distinct from a genuine
    # empty session so result clients never present missing data as canonical.
    question_lookup_failed = False
    try:
        q_result = (
            supabase_admin.table("questions")
            .select("*")
            .eq("session_id", session_id)
            .order("order_num")
            .execute()
        )
        # Đây là đường trang gọi ĐẦU TIÊN. Không lọc ở đây thì chữ đã nằm
        # trong phản hồi mạng trước khi bất kỳ bộ lọc nào khác kịp chạy — và
        # "phải nghe mới biết đề hỏi gì" chỉ còn là một câu chữ trên giao diện.
        questions = redact_questions(q_result.data, reveal=should_reveal(session))
    except Exception as exc:
        logger.error("[get_session] questions query FAILED for session=%s: %s", session_id, exc)
        questions = []
        question_lookup_failed = True

    # Responses for this session
    response_lookup_failed = False
    try:
        r_result = (
            supabase_admin.table("responses")
            .select("*")
            .eq("session_id", session_id)
            .execute()
        )
        responses = r_result.data or []
        logger.info("[get_session] %s responses loaded for session=%s", len(responses), session_id)
    except Exception as exc:
        logger.error("[get_session] responses query FAILED for session=%s: %s", session_id, exc)
        responses = []
        response_lookup_failed = True

    # Receipt-only ledger: enough for upload reconciliation and reload/resume,
    # but never enough to reveal a sealed mock's transcript, grading or score.
    # The response row id is required to distinguish a real persisted row from
    # an optimistic/pending client state. persisted_at is server-authored and
    # lets release evidence prove that exact row existed inside its journey
    # window. A retake still has the same row id and therefore remains ambiguous
    # unless the POST itself confirms it.
    response_receipts = [
        {
            "id": row.get("id"),
            "question_id": row.get("question_id"),
            "persisted_at": row.get("persisted_at"),
        }
        for row in responses
        if row.get("id") and row.get("question_id")
    ]

    # Sealed 4-skill mock: withhold the graded responses (bands + feedback) until
    # the sitting is released. Questions still return so recording works. Return
    # the seal decision explicitly as well: clients must not infer "sealed" from
    # an empty response array because a real unanswered session has that same
    # shape. This is canonical backend truth, not a UI heuristic.
    results_sealed = False
    if session.get("sitting_id"):
        from services import mock_exam_service
        results_sealed = mock_exam_service.is_sealed(session["sitting_id"])
        if results_sealed:
            responses = []

    out = {
        **session,
        "session_id": session["id"],   # alias so frontend can use either field
        "retention":  compute_expiry(session),
        "questions":  questions,
        "responses":  responses,
        "response_receipts": response_receipts,
        "question_lookup_failed": question_lookup_failed,
        "response_lookup_failed": response_lookup_failed,
        "results_sealed": results_sealed,
    }
    task = _class_task_state(session)
    if task:
        out["class_task"] = task
    return out


def _class_task_state(session: dict) -> dict | None:
    """Bài giao lớp còn nhận bài nữa không — cho phiếu làm bài biết mà nói thật.

    Phiếu phải TỰ KHOÁ khi hết hạn, thay vì để học viên ghi âm cả mười câu rồi
    mới ăn 409 ở lệnh nộp. Nhưng quyết định ấy phải là CÙNG MỘT câu trả lời với
    cổng thật ở `_record_class_hand_in` — nên gọi lại đúng
    `is_accepting_submissions`, không chép luật ra đây. Chép luật là tạo hai
    nguồn sự thật để trôi khỏi nhau, và bên trôi sẽ là bên học viên nhìn thấy.

    Đọc hỏng thì trả None: trang chạy như trước (khoá thật vẫn nằm ở lệnh nộp),
    chứ không khoá oan một bài còn hạn.
    """
    item_id = session.get("class_assignment_item_id")
    if not item_id:
        return None
    try:
        items = (
            supabase_admin.table("class_assignment_items")
            .select("id, assignment_id, submitted_at")
            .eq("id", item_id).limit(1).execute().data
        ) or []
        if not items:
            return None
        item = items[0]
        rows = (
            supabase_admin.table("class_assignments")
            .select("id, title, due_at, status")
            .eq("id", item["assignment_id"]).limit(1).execute().data
        ) or []
        if not rows:
            return None
        a = rows[0]
        return {
            "item_id":      item["id"],
            "title":        a.get("title"),
            "due_at":       a.get("due_at"),
            "submitted_at": item.get("submitted_at"),
            "accepting":    bool(is_accepting_submissions(a)),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("[sessions] class task state failed session=%s: %s",
                       session.get("id"), exc)
        return None


# ── GET /sessions/{session_id}/audio-urls ─────────────────────────────────────

@router.get("/{session_id}/audio-urls")
async def get_session_audio_urls(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Trả signed URL (1 giờ) cho tất cả audio recordings trong session.
    Chỉ user sở hữu session (hoặc admin) mới truy cập được.

    Strategy:
    - Bucket "audio-responses" là public (Supabase default, paths gồm UUIDs khó đoán).
    - Endpoint này generate signed URL qua backend đã xác thực, thêm lớp expiry-based
      access control trên đầu. Old sessions không có audio_storage_path sẽ trả về
      public URL thẳng (backwards-compatible fallback).
    - Frontend dùng URL này để phát và tải audio; không expose public URL trực tiếp.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Ownership check
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải session: {e}")

    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại hoặc không có quyền truy cập")

    # Fetch responses — select only what we need (no full feedback blob)
    try:
        r_res = (
            supabase_admin.table("responses")
            .select("id, question_id, audio_storage_path, audio_url")
            .eq("session_id", session_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải responses: {e}")

    result = []
    for r in (r_res.data or []):
        path = r.get("audio_storage_path")
        signed_url: str | None = None

        if path:
            try:
                resp = supabase_admin.storage.from_(_AUDIO_BUCKET).create_signed_url(
                    path, _SIGNED_URL_TTL
                )
                # supabase-py v2 returns an object with .data dict
                if hasattr(resp, "data") and resp.data:
                    signed_url = resp.data.get("signedUrl") or resp.data.get("signedURL")
                elif isinstance(resp, dict):
                    signed_url = resp.get("signedUrl") or resp.get("signedURL")
            except Exception as e:
                logger.warning("[audio-urls] Signed URL failed for path=%s: %s", path, e)

        if not signed_url:
            # Fallback: use stored public URL (old sessions or signed URL error)
            signed_url = r.get("audio_url")

        if signed_url:
            result.append({
                "response_id": r["id"],
                "question_id": r["question_id"],
                "url":         signed_url,
                "expires_in":  _SIGNED_URL_TTL if path else None,
            })

    return result


# ── GET /sessions/{session_id}/full-test-summary ───────────────────────────────

_FULL_TEST_SESSION_COLUMNS = (
    "id, mode, part, topic, started_at, status, sitting_id, full_test_attempt_id, "
    "band_fc, band_lr, band_gra, band_p, overall_band"
)


def _feedback_strings(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _grammar_issue_strings(value) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            output.append(item.strip())
            continue
        if not isinstance(item, dict):
            continue
        original = item.get("original") or item.get("error") or item.get("issue")
        correction = item.get("correction") or item.get("corrected")
        if isinstance(original, str) and original.strip():
            text = original.strip()
            if isinstance(correction, str) and correction.strip():
                text += " → " + correction.strip()
            output.append(text)
    return output


def _pronunciation_prosody(payload) -> float | None:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            return None
    if not isinstance(payload, dict):
        return None
    direct = payload.get("prosody_score")
    if direct is None:
        direct = payload.get("ProsodyScore")
    if direct is None:
        nbest = payload.get("NBest")
        assessment = nbest[0].get("PronunciationAssessment", {}) if isinstance(nbest, list) and nbest else {}
        direct = assessment.get("ProsodyScore") if isinstance(assessment, dict) else None
    try:
        return float(direct) if direct is not None else None
    except (TypeError, ValueError):
        return None


def _persisted_pronunciation_summary(responses: list[dict]) -> dict | None:
    completed = [row for row in responses if row.get("pronunciation_status") == "completed"]

    def average(column: str, *, payload: bool = False) -> float | None:
        values: list[float] = []
        for row in completed:
            raw = _pronunciation_prosody(row.get("pronunciation_payload")) if payload else row.get(column)
            try:
                if raw is not None:
                    values.append(float(raw))
            except (TypeError, ValueError):
                continue
        return round(sum(values) / len(values), 1) if values else None

    result = {
        "response_count": len(completed),
        "overall": average("pronunciation_score"),
        "accuracy": average("pronunciation_accuracy"),
        "fluency": average("pronunciation_fluency"),
        "completeness": average("pronunciation_completeness"),
        "prosody": average("pronunciation_payload", payload=True),
    }
    return result if any(value is not None for key, value in result.items() if key != "response_count") else None


@router.get("/{session_id}/full-test-summary")
async def get_full_test_summary(
    session_id: str,
    p2_id: Optional[str] = Query(default=None, description="Legacy Part 2 session ID"),
    p3_id: Optional[str] = Query(default=None, description="Legacy Part 3 session ID"),
    authorization: str | None = Header(default=None),
):
    """Return one canonical, ownership-checked three-Part Full Test result.

    New sessions are resolved by server-owned ``full_test_attempt_id`` from Part 1, so callers
    only need the Part 1 ID. Explicit p2/p3 remain for pre-migration rows, but
    are validated as distinct owned ``test_full`` Part 2/3 sessions. Scores are
    returned only when all three canonical session aggregates are complete and
    the containing mock sitting is not sealed.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        p1_res = (
            supabase_admin.table("sessions")
            .select(_FULL_TEST_SESSION_COLUMNS)
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[full_test_summary] Part 1 lookup failed session=%s: %s", session_id, exc)
        raise HTTPException(500, "Không tải được Full Test. Hãy thử lại.")
    if not p1_res.data:
        raise HTTPException(404, "Full Test không tồn tại hoặc không có quyền truy cập")

    p1 = p1_res.data[0]
    if p1.get("mode") != "test_full" or p1.get("part") != 1:
        raise HTTPException(400, "Session mở kết quả phải là Speaking Full Test Part 1")

    attempt_id = p1.get("full_test_attempt_id")
    session_rows: list[dict]
    all_ids: list[str]
    attempt_verified_by_id = False
    if attempt_id:
        try:
            attempt_res = (
                supabase_admin.table("sessions")
                .select(_FULL_TEST_SESSION_COLUMNS)
                .eq("user_id", user_id)
                .eq("full_test_attempt_id", attempt_id)
                .execute()
            )
        except Exception as exc:
            logger.error("[full_test_summary] attempt lookup failed attempt=%s: %s", attempt_id, exc)
            raise HTTPException(500, "Không tải được chuỗi Full Test. Hãy thử lại.")
        session_rows = attempt_res.data or []
        rows_by_part = {row.get("part"): row for row in session_rows}
        if len(session_rows) == 3 and set(rows_by_part) == {1, 2, 3}:
            all_ids = [rows_by_part[part]["id"] for part in (1, 2, 3)]
            if (p2_id and p2_id != all_ids[1]) or (p3_id and p3_id != all_ids[2]):
                raise HTTPException(400, "Các session trong URL không khớp chuỗi Full Test đã lưu")
            attempt_verified_by_id = True
        elif len(session_rows) < 3 and p2_id and p3_id:
            # Migration 200 backfilled historical rows independently because it
            # could not reconstruct affinity safely. Explicit terminal Part ids
            # remain readable after the same ownership/mode/part/sitting checks,
            # but the response stays unverified instead of inventing affinity.
            all_ids = [session_id, p2_id, p3_id]
            _validate_full_test_chain(all_ids, [])
            try:
                fallback_res = (
                    supabase_admin.table("sessions")
                    .select(_FULL_TEST_SESSION_COLUMNS)
                    .in_("id", all_ids)
                    .eq("user_id", user_id)
                    .execute()
                )
            except Exception as exc:
                logger.error("[full_test_summary] rollout fallback failed p1=%s: %s", session_id, exc)
                raise HTTPException(500, "Không tải được các Part Full Test. Hãy thử lại.")
            session_rows = fallback_res.data or []
            if {row.get("id") for row in session_rows} != set(all_ids):
                raise HTTPException(404, "Một hoặc nhiều Part không tồn tại hoặc không có quyền truy cập")
            if any(row.get("status") not in {"completed", "analysis_failed"} for row in session_rows):
                raise HTTPException(409, "Full Test đang làm phải dùng cùng mã lần thi đã lưu")
        else:
            raise HTTPException(409, "Full Test chưa có đủ ba Part để tổng kết")
    else:
        if not p2_id or not p3_id:
            raise HTTPException(400, "Dữ liệu Full Test cũ cần đủ p1, p2 và p3")
        all_ids = [session_id, p2_id, p3_id]
        _validate_full_test_chain(all_ids, [])
        try:
            sessions_res = (
                supabase_admin.table("sessions")
                .select(_FULL_TEST_SESSION_COLUMNS)
                .in_("id", all_ids)
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as exc:
            logger.error("[full_test_summary] legacy Part lookup failed p1=%s: %s", session_id, exc)
            raise HTTPException(500, "Không tải được các Part Full Test. Hãy thử lại.")
        session_rows = sessions_res.data or []
        if {row.get("id") for row in session_rows} != set(all_ids):
            raise HTTPException(404, "Một hoặc nhiều Part không tồn tại hoặc không có quyền truy cập")
        if any(row.get("status") not in {"completed", "analysis_failed"} for row in session_rows):
            raise HTTPException(409, "Full Test đang làm phải dùng cùng mã lần thi đã lưu")

    _validate_full_test_chain(
        all_ids,
        session_rows,
        allow_legacy_attempt_mismatch=not attempt_verified_by_id,
    )
    sessions_by_id = {row["id"]: row for row in session_rows}
    ordered_sessions = [sessions_by_id[sid] for sid in all_ids]

    try:
        question_res = (
            supabase_admin.table("questions")
            .select("id, session_id")
            .in_("session_id", all_ids)
            .execute()
        )
    except Exception as exc:
        logger.error("[full_test_summary] question lookup failed p1=%s: %s", session_id, exc)
        raise HTTPException(500, "Không kiểm tra được câu hỏi Full Test. Hãy thử lại.")
    question_rows = question_res.data or []
    _validate_full_test_question_counts(all_ids, question_rows)
    question_counts = Counter(row["session_id"] for row in question_rows)

    sitting_id = ordered_sessions[0].get("sitting_id")
    results_sealed = False
    if sitting_id:
        from services import mock_exam_service
        results_sealed = mock_exam_service.is_sealed(sitting_id)

    analysis_failed = any(row.get("status") == "analysis_failed" for row in ordered_sessions)
    results_ready = (
        not results_sealed
        and not analysis_failed
        and all(
            row.get("status") == "completed" and row.get("overall_band") is not None
            for row in ordered_sessions
        )
    )
    result_status = (
        "sealed" if results_sealed else
        "failed" if analysis_failed else
        "ready" if results_ready else
        "pending"
    )
    chain_verified = bool(attempt_verified_by_id)

    response_rows: list[dict] = []
    if results_ready:
        try:
            response_res = (
                supabase_admin.table("responses")
                .select(
                    "id, session_id, question_id, feedback, grading_status, "
                    "pronunciation_status, pronunciation_score, pronunciation_accuracy, "
                    "pronunciation_fluency, pronunciation_completeness, pronunciation_payload"
                )
                .in_("session_id", all_ids)
                .execute()
            )
            response_rows = response_res.data or []
        except Exception as exc:
            logger.error("[full_test_summary] response lookup failed p1=%s: %s", session_id, exc)
            raise HTTPException(500, "Không tải được nhận xét Full Test. Hãy thử lại.")

    all_strengths: list[str] = []
    all_improvements: list[str] = []
    all_grammar: list[str] = []
    per_session_first_feedback: dict[str, dict] = {}
    for response in response_rows:
        if response.get("grading_status") != "completed":
            continue
        raw_feedback = response.get("feedback")
        try:
            feedback = json.loads(raw_feedback) if isinstance(raw_feedback, str) else raw_feedback
        except (json.JSONDecodeError, TypeError):
            feedback = None
        if not isinstance(feedback, dict):
            continue
        strengths = _feedback_strings(feedback.get("strengths"))
        improvements = _feedback_strings(feedback.get("improvements"))
        all_strengths.extend(strengths)
        all_improvements.extend(improvements)
        all_grammar.extend(_grammar_issue_strings(feedback.get("grammar_issues")))
        sid = response.get("session_id")
        if sid and sid not in per_session_first_feedback and (strengths or improvements):
            per_session_first_feedback[sid] = {
                "strength": strengths[0] if strengths else None,
                "improvement": improvements[0] if improvements else None,
            }

    def canonical_average(column: str) -> float | None:
        values = [row.get(column) for row in ordered_sessions]
        if any(value is None for value in values):
            return None
        try:
            return _round_band(sum(float(value) for value in values) / len(values))
        except (TypeError, ValueError):
            return None

    parts = [
        {
            "part": part,
            "session_id": sid,
            "topic": sessions_by_id[sid].get("topic"),
            "status": sessions_by_id[sid].get("status"),
            "questions_count": question_counts.get(sid, 0),
            "band_avg": float(sessions_by_id[sid]["overall_band"])
            if results_ready and sessions_by_id[sid].get("overall_band") is not None else None,
            "key_feedback": per_session_first_feedback.get(sid) if results_ready else None,
        }
        for part, sid in enumerate(all_ids, start=1)
    ]

    return {
        "result_status": result_status,
        "results_ready": results_ready,
        "results_sealed": results_sealed,
        "chain_verified": chain_verified,
        "full_test_attempt_id": str(attempt_id) if attempt_id else None,
        "overall_band": canonical_average("overall_band") if results_ready else None,
        "band_fc": canonical_average("band_fc") if results_ready else None,
        "band_lr": canonical_average("band_lr") if results_ready else None,
        "band_gra": canonical_average("band_gra") if results_ready else None,
        "band_p": canonical_average("band_p") if results_ready else None,
        "parts": parts,
        "top_strengths": [item for item, _ in Counter(all_strengths).most_common(3)],
        "top_improvements": [item for item, _ in Counter(all_improvements).most_common(3)],
        "top_grammar_issues": [item for item, _ in Counter(all_grammar).most_common(5)],
        "pronunciation": _persisted_pronunciation_summary(response_rows) if results_ready else None,
        "started_at": p1.get("started_at"),
    }


# ── Internal helpers for backend-driven finalization ──────────────────────────

def _complete_session_internal(session_id: str) -> None:
    """
    Compute and persist band scores for one session without requiring an HTTP auth context.
    Used by the background task that finalizes a full test after all grading is done.
    Mirrors the logic in complete_session() but is synchronous and auth-free.
    """
    s_res = (
        supabase_admin.table("sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise ValueError(f"Session {session_id} not found")
    session = s_res.data[0]

    if session.get("status") == "completed" and session.get("overall_band") is not None:
        return  # already fully computed — nothing to do

    try:
        bands = _compute_session_bands(session_id)
    except Exception as e:
        raise ValueError(f"Could not compute bands for session {session_id}: {e}")

    overall_band = bands["overall_band"]
    criteria_bands = {k: v for k, v in bands.items() if k != "overall_band"}

    update_payload: dict = {
        "status": "completed",
        "overall_band": overall_band,
        **{k: v for k, v in criteria_bands.items() if v is not None},
    }
    if not session.get("completed_at"):
        update_payload["completed_at"] = datetime.now(timezone.utc).isoformat()

    supabase_admin.table("sessions").update(update_payload).eq("id", session_id).execute()
    logger.info("[finalize_ft] session=%s completed — overall_band=%s", session_id, overall_band)

    # GĐ 2 — a full test can itself be the assigned task (the give modal offers
    # test_full), and this path completes sessions without going through
    # PATCH /complete. Without this the hand-in would never be recorded and the
    # teacher would see the homework as missing however well the student did.
    _record_class_submission({**session, **update_payload, "id": session_id})


def _check_all_responses_graded(session_ids: list) -> bool:
    """
    Return True when every question in each session has a *graded* response row.
    A response is considered graded when grading_status='completed' AND overall_band IS NOT NULL.
    Both conditions must hold — status='completed' with a null band indicates a failed DB write,
    and a non-null band without status='completed' indicates an incomplete grading run.
    """
    for sid in session_ids:
        try:
            q_res = (
                supabase_admin.table("questions")
                .select("id")
                .eq("session_id", sid)
                .execute()
            )
            r_res = (
                supabase_admin.table("responses")
                .select("id, question_id, grading_status, overall_band")
                .eq("session_id", sid)
                .execute()
            )
            question_ids = {
                str(row.get("id")) for row in (q_res.data or []) if row.get("id")
            }
            if not question_ids:
                logger.warning("[finalize_ft] session=%s has no questions", sid)
                return False
            responses = r_res.data or []
            graded_question_ids = {
                str(r.get("question_id")) for r in responses
                if r.get("grading_status") == "completed" and r.get("overall_band") is not None
                and r.get("question_id")
            }
            missing = question_ids - graded_question_ids
            if missing:
                logger.info(
                    "[finalize_ft] session=%s: %d/%d questions graded; missing=%d",
                    sid,
                    len(question_ids & graded_question_ids),
                    len(question_ids),
                    len(missing),
                )
                return False
        except Exception as e:
            logger.warning("[finalize_ft] poll error for session=%s: %s", sid, e)
            return False
    return True


def _validate_full_test_chain(
    session_ids: list[str],
    session_rows: list[dict],
    *,
    allow_legacy_attempt_mismatch: bool = False,
) -> None:
    """Require one owned test_full session for each canonical Speaking part."""
    if len(session_ids) != 3 or len(set(session_ids)) != 3:
        raise HTTPException(400, "Full Test phải có 3 session khác nhau cho Part 1, 2 và 3")
    sessions_by_id = {row["id"]: row for row in session_rows}
    for expected_part, sid in enumerate(session_ids, start=1):
        row = sessions_by_id.get(sid)
        if not row:
            continue  # ownership/missing-id check reports this as 404 at the route boundary
        if row.get("mode") != "test_full" or row.get("part") != expected_part:
            raise HTTPException(
                400,
                f"Session {sid} không phải Full Test Part {expected_part}",
            )
    rows = [sessions_by_id.get(sid) for sid in session_ids]
    if all(rows):
        if not allow_legacy_attempt_mismatch:
            attempt_ids = {
                str(row.get("full_test_attempt_id") or "").strip() for row in rows
            }
            if "" in attempt_ids or len(attempt_ids) != 1:
                raise HTTPException(400, "Ba phần Full Test không thuộc cùng một lần làm bài")
        sitting_ids = {row.get("sitting_id") for row in rows}
        if len(sitting_ids) > 1:
            raise HTTPException(400, "Ba phần Full Test không thuộc cùng một bài thi")


def _validate_full_test_question_counts(
    session_ids: list[str],
    question_rows: list[dict],
) -> None:
    """Fail before finalization when any persisted part is not 9/1/5."""
    expected_by_session = dict(zip(session_ids, (9, 1, 5)))
    actual = Counter(
        row.get("session_id") for row in question_rows if row.get("session_id")
    )
    invalid = [
        f"Part {part}: {actual.get(sid, 0)}/{expected_by_session[sid]}"
        for part, sid in enumerate(session_ids, start=1)
        if actual.get(sid, 0) != expected_by_session[sid]
    ]
    if invalid:
        raise HTTPException(
            409,
            "Bộ câu hỏi Full Test chưa đầy đủ (" + ", ".join(invalid) + ")",
        )


async def _bg_finalize_full_test(session_ids: list) -> None:
    """
    Background task: poll DB every 8 s until all responses are saved (max 90 s),
    then aggregate band scores and mark each session 'completed'.

    If the first 90 s poll window times out, a one-shot 120 s grace period is attempted
    before giving up. This handles slow Whisper/Claude pipelines that finish slightly
    after the primary wait window without needing manual admin recovery.

    Runs entirely on the server — browser tab can close safely after calling the endpoint.
    """
    max_wait  = 90
    poll_sec  = 8
    elapsed   = 0

    logger.info("[finalize_ft] background task started for sessions=%s", session_ids)

    while elapsed < max_wait:
        await asyncio.sleep(poll_sec)
        elapsed += poll_sec
        all_ready = await asyncio.to_thread(_check_all_responses_graded, session_ids)
        if all_ready:
            logger.info("[finalize_ft] all responses saved after %ds — completing sessions", elapsed)
            break
    else:
        logger.warning(
            "[finalize_ft] primary timeout after %ds — entering 120s grace period", max_wait
        )
        await asyncio.sleep(120)
        all_ready = await asyncio.to_thread(_check_all_responses_graded, session_ids)
        if all_ready:
            logger.info("[finalize_ft] all responses saved during grace period — completing sessions")
        else:
            logger.warning(
                "[finalize_ft] grace period exhausted — completing with whatever responses exist"
            )

    for sid in session_ids:
        # P0 (B1/Mục 1): only complete a session — which AGGREGATES band scores —
        # when every response is actually graded. If the grace window expired with
        # grading still pending, completing would compute a band from incomplete
        # data and show the user a silently-wrong score. Mark analysis_failed
        # instead so the user/admin can recover. `all_ready` (group poll) short-
        # circuits the per-session re-check; otherwise re-check THIS session so a
        # fully-graded session isn't failed just because a sibling lagged.
        try:
            session_ready = all_ready or await asyncio.to_thread(
                _check_all_responses_graded, [sid]
            )
            if session_ready:
                await asyncio.to_thread(_complete_session_internal, sid)
            else:
                await asyncio.to_thread(
                    lambda s=sid: supabase_admin.table("sessions")
                    .update({"status": "analysis_failed"})
                    .eq("id", s)
                    .execute()
                )
                logger.error(
                    "[finalize_ft] session=%s incomplete after grace window — marked "
                    "analysis_failed (band NOT aggregated from partial data)", sid,
                )
        except Exception as e:
            logger.error("[finalize_ft] complete failed for session=%s: %s", sid, e)
            try:
                await asyncio.to_thread(
                    lambda s=sid: supabase_admin.table("sessions")
                    .update({"status": "analysis_failed"})
                    .eq("id", s)
                    .execute()
                )
            except Exception as e2:
                # B2/Mục 3 (absorbed — same block): never swallow the recovery
                # write. A silently-failed recovery leaves the session stuck in
                # 'submitted' forever.
                logger.error(
                    "[finalize_ft] recovery update to analysis_failed FAILED for "
                    "session=%s (critical): %s", sid, e2,
                )


# ── POST /sessions/finalize-full-test ─────────────────────────────────────────
# NOTE: This route MUST be declared before /{session_id} routes so FastAPI does
# not treat the literal "finalize-full-test" as a session_id path parameter.

@router.post("/finalize-full-test")
async def finalize_full_test(
    body: FinalizeFullTestBody,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """
    Trigger backend-driven finalization of a Full Test.

    1. Verifies the caller owns all provided session IDs.
    2. Marks every session as 'submitted' immediately (visible in history as "Đang phân tích").
    3. Returns {accepted: true} right away — the browser is done.
    4. A background task polls until all eager-upload grading requests complete in the DB,
       then calls the complete logic for each session (aggregates band scores, sets 'completed').

    The browser tab can close at any point after calling this endpoint — the server
    handles everything from here.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    all_ids = [body.p1_id, body.p2_id, body.p3_id]
    _validate_full_test_chain(all_ids, [])

    # Ownership check — all sessions must belong to this user
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id, mode, part, sitting_id, full_test_attempt_id")
            .in_("id", all_ids)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi kiểm tra sessions: {e}")

    found_ids = {s["id"] for s in (s_res.data or [])}
    missing = [sid for sid in all_ids if sid not in found_ids]
    if missing:
        raise HTTPException(404, f"Session(s) không tồn tại hoặc không có quyền: {missing}")

    _validate_full_test_chain(all_ids, s_res.data or [])

    # Question rows are immutable once answers start. Reject an old/corrupted
    # short set immediately instead of accepting it, waiting 210 seconds and
    # silently aggregating a non-canonical 9/1/5 exam.
    try:
        q_res = (
            supabase_admin.table("questions")
            .select("id, session_id")
            .in_("session_id", all_ids)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi kiểm tra bộ câu hỏi Full Test: {e}")
    _validate_full_test_question_counts(all_ids, q_res.data or [])

    # Mark all sessions 'submitted' immediately — history shows "Đang phân tích"
    try:
        supabase_admin.table("sessions").update({"status": "submitted"}).in_("id", all_ids).execute()
    except Exception as e:
        logger.warning("[finalize_ft] failed to mark submitted (non-fatal): %s", e)

    # Schedule the background aggregation — browser can safely close after this returns
    background_tasks.add_task(_bg_finalize_full_test, all_ids)

    logger.info("[finalize_ft] accepted for sessions=%s user=%s", all_ids, user_id)
    return {"accepted": True, "session_ids": all_ids}


# ── PATCH /sessions/{session_id}/complete ──────────────────────────────────────

def _record_class_submission(session: dict) -> bool:
    """GĐ 2 — record a completed speaking session against its class assignment.

    Best-effort on purpose: a graded session must still complete when the ledger
    write fails. But the failure is logged, not swallowed — an unrecorded hand-in
    shows up to the teacher as the student simply not having done the work.

    Safe to call more than once. mark_item_submitted only writes while
    submitted_at IS NULL, so a retry cannot push the submission time later and
    turn an on-time hand-in into a late one; it also means calling this from the
    already-completed path repairs a previously failed write instead of
    duplicating a good one.
    """
    item_id = session.get("class_assignment_item_id")
    if not item_id:
        return False

    # Giờ phiên HOÀN THÀNH — phải có TRƯỚC phép kiểm hạn bên dưới, vì đó là mốc
    # phép kiểm ấy so với. Trên đường thử lại, "bây giờ" là giờ chạy lệnh sửa
    # chứ không phải giờ em ấy làm xong.
    completed_at = None
    raw = session.get("completed_at")
    if raw:
        try:
            completed_at = datetime.fromisoformat(raw)
        except ValueError:
            pass

    # HẠN NỘP TUYỆT ĐỐI. The start gate cannot cover this on its own: nobody
    # knows in advance how long an answer will take, so a session begun at 18:58
    # can finish at 19:02. Recording it would mean the summary table keeps
    # changing after the deadline it is supposed to close.
    #
    # The session itself still completes and is still graded — the student keeps
    # their practice and their feedback. What is refused is CREDITING it as the
    # class hand-in.
    try:
        a_rows = (
            supabase_admin.table("class_assignments")
            .select("*, class_assignment_items!inner(id)")
            .eq("class_assignment_items.id", item_id)
            .limit(1).execute().data
        ) or []
        # So với GIỜ PHIÊN HOÀN THÀNH, không phải giờ đang chạy lệnh này.
        #
        # Hàm này còn là đường THỬ LẠI: lệnh ghi sổ lần đầu hỏng thì lần hoàn
        # thành sau sẽ gọi lại. So với "bây giờ" nghĩa là một phiên xong lúc
        # 18:00 mà thử lại lúc 20:00 sẽ bị từ chối — chốt hạn quay sang chặn
        # đúng thứ nó sinh ra để bảo vệ. Phiên thật sự xong sau hạn vẫn bị từ
        # chối, vì mốc so là giờ của chính phiên đó.
        if a_rows and not is_accepting_submissions(a_rows[0], now=completed_at):
            logger.info("[class] hand-in refused, deadline passed item=%s", item_id)
            return False
    except Exception as exc:
        # Fail OPEN on a lookup error: refusing every hand-in because one query
        # hiccuped would lose real work, and a hand-in wrongly accepted shows up
        # as late in the summary rather than vanishing.
        logger.warning("[class] deadline check failed item=%s: %s", item_id, exc)
    # The session's own completion time, not "now": on the retry path this runs
    # long after the fact, and stamping the repair time would report work
    # finished before the deadline as late.
    try:
        return mark_item_submitted(
            supabase_admin,
            item_id=item_id,
            artifact_kind="session",
            artifact_id=session["id"],
            score=session.get("overall_band"),
            now=completed_at,
        )
    except Exception as e:
        logger.warning(
            "[complete_session] class item not recorded session=%s item=%s: %s",
            session.get("id"), item_id, e,
        )
        return False


@router.patch("/{session_id}/complete")
async def complete_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Đánh dấu session hoàn thành.
    Tự động tính overall_band = trung bình của các band score != null
    (band_fc, band_lr, band_gra, band_p đã được cập nhật bởi scoring endpoint trước đó).
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        s_result = (
            supabase_admin.table("sessions")
            .select("*")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")

    if not s_result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")

    session = s_result.data[0]

    if session["status"] == "completed" and session.get("overall_band") is not None:
        # Idempotent: already done with a valid band — return current state.
        # The ledger write is retried here on purpose: if it failed the first
        # time, this early return is the ONLY path a retry can take, and without
        # it a transient failure would leave the teacher seeing the homework as
        # never handed in, permanently. _record_class_submission is a no-op once
        # the item already carries a submitted_at.
        _record_class_submission(session)
        return {**session, "session_id": session["id"]}
    if session["status"] == "completed":
        # Already completed but band is null (e.g. prior DB save failure) — fall through to recompute.
        logger.info("[complete_session] re-computing band for already-completed session=%s (overall_band was null)", session_id)

    # Compute canonical bands from responses (prefers final_band_p when available)
    try:
        bands = _compute_session_bands(session_id)
    except Exception as e:
        logger.warning("[complete_session] band compute failed session=%s: %s", session_id, e)
        raise HTTPException(
            status_code=422,
            detail=f"Cannot complete session — band computation failed: {e}",
        )

    overall_band   = bands["overall_band"]
    criteria_bands = {k: v for k, v in bands.items() if k != "overall_band"}

    # Gate: do not mark completed if no usable canonical bands exist.
    #
    # NHƯNG chốt này từng gộp HAI chuyện khác hẳn nhau, và chuyện thứ hai là một
    # cái bẫy: (a) chưa ghi âm gì — từ chối là đúng; (b) đã ghi đủ và bài đã lên
    # máy chủ, nhưng BỘ CHẤM hỏng hết. Ở (b), học viên đã làm xong phần việc của
    # mình mà lệnh nộp vẫn 422 mãi — em ấy bị nhốt trong một bài không có lối
    # ra, vì lỗi nằm ở phía hệ thống (codex #942; 3,8% lượt chấm hỏng trên
    # prod, nên "hỏng cả lượt" không phải giả định xa vời).
    #
    # Có bài mà chưa chấm được thì CHO nộp, với band để trống. Band trống là
    # một sự thật đọc được; một lệnh nộp không bao giờ thành công thì không.
    all_band_vals = [overall_band] + list(criteria_bands.values())
    if all(v is None for v in all_band_vals):
        try:
            saved = (
                supabase_admin.table("responses").select("id", count="exact")
                .eq("session_id", session_id).limit(1).execute()
            ).count or 0
        except Exception as exc:  # noqa: BLE001
            # Đọc hỏng thì giữ nguyên hành vi cũ — chặt hơn là an toàn hơn.
            logger.warning("[complete_session] đếm responses hỏng session=%s: %s",
                           session_id, exc)
            saved = 0
        # ĐỦ CÂU mới cho qua. Chỉ hỏi "có bài nào không" thì một client cũ hoặc
        # một lần thử lại tay gọi /complete sớm sẽ chốt cả bài 12 câu bằng đúng
        # MỘT dòng hỏng — và sổ của giáo viên ghi "đã nộp" cho một bài làm dở
        # (codex #942).
        try:
            asked = (
                supabase_admin.table("questions").select("id", count="exact")
                .eq("session_id", session_id).limit(1).execute()
            ).count or 0
        except Exception as exc:  # noqa: BLE001
            logger.warning("[complete_session] đếm questions hỏng session=%s: %s",
                           session_id, exc)
            asked = 0
        if not saved or (asked and saved < asked):
            raise HTTPException(
                status_code=422,
                detail="Cannot complete session — no usable band scores found in responses. "
                       "Ensure all responses have been graded before calling this endpoint.",
            )
        logger.warning(
            "[complete_session] hoàn thành KHÔNG có band — %s bài đã lưu nhưng "
            "chấm hỏng hết session=%s", saved, session_id)

    update_payload: dict = {
        "status":       "completed",
        "overall_band": overall_band,
        **{k: v for k, v in criteria_bands.items() if v is not None},
    }
    # Only set completed_at if not already set (avoid overwriting original completion time)
    if not session.get("completed_at"):
        update_payload["completed_at"] = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            supabase_admin.table("sessions")
            .update(update_payload)
            .eq("id", session_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể hoàn thành session: {e}")

    completed = result.data[0]
    _record_class_submission(completed)
    return {**completed, "session_id": completed["id"]}
