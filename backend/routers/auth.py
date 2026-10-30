import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, Header, Response

logger = logging.getLogger(__name__)
from pydantic import BaseModel
import httpx

from config import settings
from database import supabase_admin
from models.auth import (
    AuthActivateResponse,
    AuthActiveStatusResponse,
    AuthMeResponse,
    AuthProfileResponse,
    AuthProfileUpdateResponse,
)
from services import activation_gate, staff_security
from services.db_async import aexecute
from services.errors import new_ref, safe_error
from services.request_context import current_request_id
from services.server_timing import record_stage
from services.feature_flags import ais_flashcard_enabled, is_flashcard_enabled
from services import runtime_flags
from services.runtime_flags import require_flag
from services.class_membership_service import remove_student, student_is_active_in_cohort

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Perf (B) — shared keep-alive httpx client for token verification ──────────
# get_supabase_user() runs on EVERY authenticated request. It used to open a
# fresh `httpx.AsyncClient` per call, so every verify paid a full TLS handshake
# to Supabase Auth. Backend (Railway, Singapore) ↔ Supabase (prod ap-southeast-1,
# Singapore; staging ap-northeast-1, Tokyo), so a fresh handshake costs ~2-3 RTT
# on top of the request — on the hottest path in the app, and several times
# dearer on staging's cross-region hop. A module-level client reuses ONE
# keep-alive connection pool, collapsing that to ~1 RTT after the first call.
# Built lazily (must live on the running loop) and closed on app shutdown.
_auth_http_client: httpx.AsyncClient | None = None


def _get_auth_http_client() -> httpx.AsyncClient:
    global _auth_http_client
    if _auth_http_client is None or _auth_http_client.is_closed:
        _auth_http_client = httpx.AsyncClient(
            timeout=20.0,
            limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=60.0),
        )
    return _auth_http_client


async def close_auth_http_client() -> None:
    """Close the shared client on app shutdown (idempotent)."""
    global _auth_http_client
    if _auth_http_client is not None and not _auth_http_client.is_closed:
        await _auth_http_client.aclose()
    _auth_http_client = None


class ActivateRequest(BaseModel):
    access_code: str


class ProfileUpdate(BaseModel):
    target_band: float | None = None
    exam_date: str | None = None          # ISO date string "YYYY-MM-DD"
    self_level: str | None = None
    preferred_topics: list[str] | None = None
    onboarding_completed: bool | None = None
    display_name: str | None = None
    timezone: str | None = None
    weekly_goal: int | None = None        # 1–14 sessions/week
    notification_email: bool | None = None


# ── W-2 instructor-promote helpers (Option B, email-bound) ────────────────────

def _norm_email(value: str | None) -> str | None:
    """Normalise an email for comparison: trim + Unicode casefold. None/empty → None."""
    return ((value or "").strip().casefold()) or None


def _exc_tag(exc: BaseException) -> str:
    """Log-safe exception label for /activate: class + SQLSTATE, never DB text
    (a PostgREST message/detail can echo column values such as the code). An
    app-raised HTTPException keeps its machine code (e.g. student_archived)."""
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            detail = detail.get("code") or detail.get("error_code")
        detail = detail if isinstance(detail, str) else None
        code = detail if detail and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", detail) else None
        return f"HTTPException {exc.status_code}" + (f" {code}" if code else "")
    code = getattr(exc, "code", None)
    return f"{type(exc).__name__} code={code}" if isinstance(code, str) and code else type(exc).__name__


def _activation_error(exc: BaseException, *, context: str, ref: str,
                      status_code: int = 500, message: str | None = None) -> HTTPException:
    """safe_error() for /activate without logging the raw DB exception (SA-3)."""
    logger.error("[auth] activation failed ref=%s %s: %s", ref, context, _exc_tag(exc))
    return safe_error(status_code=status_code, message=message, context=context, ref=ref)


def _audit_promote_attempt(
    user_id: str, code_id: str | None, *,
    ok: bool, before_role: str | None = None, intended_email: str | None = None,
    after_role: str = "instructor", noop: bool = False,
) -> None:
    """Append one row to access_code_audit for a role-promote attempt. BEST-EFFORT:
    never raises (a logging failure must not break/block activation). Records
    both successful promotes (action='promote_role') and rejected ones
    (action='promote_role_rejected') so an email-mismatch attempt is visible."""
    try:
        supabase_admin.table("access_code_audit").insert({
            "actor_user_id":  user_id,          # self-service via code (verified token)
            "action":         "promote_role" if ok else "promote_role_rejected",
            "code_id":        code_id,
            "target_user_id": user_id,
            "before":         {"role": before_role} if ok else None,
            "after":          ({"role": after_role, **({"noop": True} if noop else {})} if ok
                               else {"reason": "email_mismatch", "intended_email": intended_email}),
        }).execute()
    except Exception as e:
        logger.warning("[warn] promote_role audit failed: %s", _exc_tag(e))


def _audit_enroll_reject(user_id: str, code_id: str | None, *,
                         current_owner, attempted_owner) -> None:
    """W-5 — best-effort audit of a BLOCKED enroll-reassign (a different
    instructor's enroll-code tried to take an already-owned student). Never raises."""
    try:
        supabase_admin.table("access_code_audit").insert({
            "actor_user_id":  user_id,
            "action":         "enroll_reassign_rejected",
            "code_id":        code_id,
            "target_user_id": user_id,
            "before":         {"instructor_id": str(current_owner) if current_owner else None},
            "after":          {"attempted_owner": str(attempted_owner) if attempted_owner else None},
        }).execute()
    except Exception as e:
        logger.warning("[warn] enroll_reassign audit failed: %s", _exc_tag(e))


# ── Shared helper ─────────────────────────────────────────────────────────────

async def get_supabase_user(authorization: str | None):
    """Verify Bearer token with Supabase and return the user dict."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.replace("Bearer ", "").strip()

    # A valid Supabase JWT is always ASCII. Reject a non-ASCII token (a garbled
    # / placeholder header, e.g. a Vietnamese "DÁN_TOKEN_VÀO_ĐÂY" pasted into the
    # curl) with a clean 401 — otherwise httpx ascii-encodes the downstream
    # `Authorization` header below and raises UnicodeEncodeError → an opaque 500.
    if not token or not token.isascii():
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header",
        )

    # W-03 — the router-level activation gate verifies the same bearer first;
    # reuse that verification instead of a second Supabase Auth round-trip.
    # The memo lives for one request only (see services.activation_gate).
    remembered = activation_gate.remembered_user(token)
    if remembered is not None:
        return remembered

    auth_start = perf_counter()
    try:
        client = _get_auth_http_client()
        # B2 (audit) — the client is shared across all users' requests for
        # keep-alive. Token verification is a stateless Bearer call (Supabase
        # sets no cookie), but clear the jar before each request so a stray
        # Set-Cookie could never be replayed onto another user's request. The
        # clear is synchronous and runs before the send, so it's race-safe.
        client.cookies.clear()
        response = await client.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": settings.SUPABASE_ANON_KEY,
            },
        )
    except httpx.RequestError as e:
        # Reachable before authentication: the transport error (upstream host,
        # resolver/TLS detail) is logged, never returned to the caller.
        logger.warning("[auth] Supabase token verification transport error: %r", e)
        raise HTTPException(
            status_code=502,
            detail="Không thể kết nối dịch vụ xác thực. Vui lòng thử lại.",
        )
    finally:
        record_stage("auth", (perf_counter() - auth_start) * 1000)

    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Token không hợp lệ hoặc đã hết hạn")

    user = response.json()
    activation_gate.remember_user(token, user)
    return user


# ── GET /auth/me ──────────────────────────────────────────────────────────────

# BL-12 — /auth/me runs on every page load, so writing last_seen_at on each call
# was one users UPDATE per navigation. Activity only needs minute granularity:
# skip the write while the stored value is younger than this interval.
LAST_SEEN_WRITE_INTERVAL = timedelta(minutes=5)


def _last_seen_is_stale(value, now: datetime) -> bool:
    """True when last_seen_at should be rewritten: missing, unparseable, or at
    least LAST_SEEN_WRITE_INTERVAL old. A future timestamp (clock skew) counts as
    fresh only within the interval, so a bad value cannot freeze the column."""
    if not value:
        return True
    try:
        seen = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return True
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    return abs(now - seen) >= LAST_SEEN_WRITE_INTERVAL


@router.get("/me", response_model=AuthMeResponse)
async def get_me(response: Response, authorization: str | None = Header(default=None)):
    # FE migration pilot 3 (authenticated read) entry checklist: effective
    # private responses must be uncacheable by ANY cache layer between the
    # Next/legacy frontend and this API (plan Phase 2 per-pilot checklist).
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)

    user_id = auth_user["id"]
    email = auth_user.get("email")
    metadata = auth_user.get("user_metadata", {}) or {}

    # PC-J05 D1a — /auth/me runs on every page load; its DB calls go through
    # the async-DB facade (USE_ASYNC_DB off = the same sync calls as before).
    def _select_user(db):
        return db.table("users").select("*").eq("id", user_id).limit(1)

    try:
        existing = await aexecute(_select_user, sync_client=supabase_admin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi truy vấn người dùng: {e}")

    if not existing.data:
        try:
            # First visit. Two concurrent /auth/me calls (or another worker, or
            # /auth/activate) can both see no row; ON CONFLICT (id) DO NOTHING
            # lets the loser fall through to the re-SELECT instead of a 500,
            # and never overwrites the winner's role / is_active.
            await aexecute(
                lambda db: db.table("users").upsert({
                    "id": user_id,
                    "email": email,
                    "display_name": metadata.get("full_name") or metadata.get("name"),
                    "avatar_url": metadata.get("avatar_url"),
                    "role": "user",
                    "is_active": False,
                }, on_conflict="id", ignore_duplicates=True),
                sync_client=supabase_admin,
            )

            existing = await aexecute(_select_user, sync_client=supabase_admin)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi khi tạo người dùng: {e}")

    user = existing.data[0]

    now = datetime.now(timezone.utc)
    if _last_seen_is_stale(user.get("last_seen_at"), now):
        try:
            await aexecute(
                lambda db: db.table("users").update(
                    {"last_seen_at": now.isoformat()}
                ).eq("id", user_id),
                sync_client=supabase_admin,
            )
        except Exception:
            pass  # non-fatal

    flags = user.get("feature_flags") or {}
    # PR1 single-source: /auth/me returns the LIVE access-code permissions (same
    # source as /api/student/permissions), NOT the users.permissions snapshot —
    # so the two agree and a revoke is reflected immediately. No snapshot
    # fallback: an empty live list means no access (don't re-grant a default).
    from services.access_code_permissions import (  # local — avoid import cycle
        aget_user_access_code_permissions_cached,
    )
    live_permissions = await aget_user_access_code_permissions_cached(user_id)
    # Phase D Wave 2 — strict default-deny via the canonical helper so
    # frontends can rely on `=== true` without re-implementing the rule.
    # Two-key curated rollout: learner cohort opt-in AND the hot runtime read
    # switch. Both default deny so the legacy hub remains the automatic fallback.
    # PC-J05: with USE_ASYNC_DB on, both reads (per-user flag row; runtime flag
    # on a cache miss) await the async client; off, the same sync calls as before.
    curated_opt_in = flags.get("vocab_curated_enabled") is True
    if settings.USE_ASYNC_DB:
        flashcard_enabled = await ais_flashcard_enabled(
            user_id, settings.FLASHCARD_ENABLED, run=aexecute)
        vocab_curated_enabled = curated_opt_in and await runtime_flags.ais_enabled(
            "vocab_units_read", default=False, run=aexecute)
    else:
        flashcard_enabled = is_flashcard_enabled(user_id, settings.FLASHCARD_ENABLED)
        vocab_curated_enabled = curated_opt_in and runtime_flags.is_enabled(
            "vocab_units_read", default=False)
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role", "user"),
        "is_active": user.get("is_active", False),
        "suspended": bool(user.get("suspended_at")),
        "permissions": live_permissions,
        "onboarding_completed": user.get("onboarding_completed", False),
        "target_band": user.get("target_band"),
        "exam_date": str(user["exam_date"]) if user.get("exam_date") else None,
        "self_level": user.get("self_level"),
        "preferred_topics": user.get("preferred_topics") or [],
        "vocab_bank_enabled": flags.get("vocab_enabled") is True,
        "d1_enabled": settings.D1_ENABLED and flags.get("d1_enabled") is True,
        "d3_enabled": settings.D3_ENABLED and flags.get("d3_enabled") is True,
        "flashcard_enabled": flashcard_enabled,
        "vocab_curated_enabled": vocab_curated_enabled,
    }


# ── GET /auth/check-active ────────────────────────────────────────────────────

@router.get("/check-active", response_model=AuthActiveStatusResponse)
async def check_active(authorization: str | None = Header(default=None)):
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        result = await aexecute(
            # "*" so this hot learner read keeps working before migration 332
            # adds suspended_at (absent column = not suspended).
            lambda db: db.table("users").select("*").eq("id", user_id).limit(1),
            sync_client=supabase_admin,
        )
    except Exception as e:
        # ASYNCAUTH-0036 Revision 2: a DB failure is 503, like the activation
        # gate and the staff guards. main.py still replaces this 5xx detail
        # with the sanitized {error_code, message, ref} envelope; the detail
        # itself carries no DB text either (PC-J157), the error is logged.
        logger.warning("[auth] check-active lookup failed user=%s: %r", user_id, e)
        raise HTTPException(
            status_code=503,
            detail="Lỗi khi kiểm tra trạng thái tài khoản. Vui lòng thử lại.",
        ) from None

    if not result.data:
        return {"is_active": False, "suspended": False}

    row = result.data[0]
    return {
        "is_active": bool(row.get("is_active", False)),
        # ADMINAAL2-0032 FR-018: /login shows the suspended message instead
        # of the activation dialog.
        "suspended": bool(row.get("suspended_at")),
    }


# ── GET /auth/profile ─────────────────────────────────────────────────────────

@router.get("/profile", response_model=AuthProfileResponse)
async def get_profile(response: Response, authorization: str | None = Header(default=None)):
    """Return the full user profile including extended fields from migration 013."""
    # Pilot-3 checklist: private response — never shared-cacheable (see /me).
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        result = (
            supabase_admin.table("users")
            .select("*")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải profile: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Người dùng không tồn tại")

    user = result.data[0]

    # Aggregate session stats for the profile page
    stats = {"total_sessions": 0, "avg_band": None, "joined_at": None}
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("overall_band, started_at")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .execute()
        )
        sessions = s_res.data or []
        stats["total_sessions"] = len(sessions)
        bands = [s["overall_band"] for s in sessions if s.get("overall_band") is not None]
        if bands:
            # C2 (audit 2026-07-03): half-up via the canonical ielts_round, not
            # banker's round(x*2)/2, so the profile average matches the web.
            from services.band_rounding import ielts_round  # local — avoid cycle
            stats["avg_band"] = ielts_round(sum(bands) / len(bands))
    except Exception:
        pass  # non-fatal — stats are display-only

    joined = user.get("joined_at") or user.get("created_at")

    return {
        "id": user["id"],
        "email": user.get("email"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role", "user"),
        "is_active": user.get("is_active", False),
        "onboarding_completed": user.get("onboarding_completed", False),
        "target_band": user.get("target_band"),
        "exam_date": str(user["exam_date"]) if user.get("exam_date") else None,
        "self_level": user.get("self_level"),
        "preferred_topics": user.get("preferred_topics") or [],
        "timezone": user.get("timezone") or "Asia/Ho_Chi_Minh",
        "weekly_goal": user.get("weekly_goal") or 5,
        "notification_email": user.get("notification_email", True),
        "joined_at": str(joined) if joined else None,
        "stats": stats,
    }


# ── POST /auth/activate ───────────────────────────────────────────────────────

# F09 (ACTIVATELIMIT-0034) — per-user rate limit on activation, shared by every
# worker and replica: migration 334's fn_activate_attempt_check counts ALLOWED
# attempts in Postgres (10 per rolling 10 minutes) and records this one
# atomically. It runs before the code is looked up or claimed, so a refusal
# never consumes a code. Fail closed: if the counter cannot answer, refuse with
# 503 instead of allowing unlimited attempts (the code stays unused).
_ACTIVATE_RATE_LIMITED_MESSAGE = "Quá nhiều lần thử kích hoạt. Vui lòng đợi vài phút rồi thử lại."
_ACTIVATE_UNAVAILABLE_MESSAGE = (
    "Chưa kiểm tra được lượt kích hoạt. Mã CHƯA được sử dụng — vui lòng thử lại sau ít phút."
)


def _rate_limit_activate(user_id: str) -> None:
    """Record one attempt; raise 429 over the limit, 503 when the check fails."""
    try:
        verdict = supabase_admin.rpc(
            "fn_activate_attempt_check", {"p_user_id": user_id}).execute().data
        allowed = verdict["allowed"]
        retry_after_s = verdict["retry_after_s"]
        if not isinstance(allowed, bool) or type(retry_after_s) is not int or retry_after_s < 0:
            raise ValueError(f"malformed fn_activate_attempt_check result: {verdict!r}")
    except Exception as e:
        raise safe_error(e, status_code=503, error_code="activation_unavailable",
                         message=_ACTIVATE_UNAVAILABLE_MESSAGE,
                         context=f"activate rate limit user={user_id}")
    if not allowed:
        retry_after_s = max(1, retry_after_s)
        raise HTTPException(
            status_code=429,
            detail={"error_code": "activate_rate_limited", "retry_after_s": retry_after_s,
                    "message": _ACTIVATE_RATE_LIMITED_MESSAGE},
            headers={"Retry-After": str(retry_after_s)},
        )


_ARCHIVED_PROFILE_DETAIL = (
    "Hồ sơ học viên đã được lưu trữ — liên hệ admin. Mã CHƯA được sử dụng."
)


def _restore_archived_account_state(user_id: str, *, was_already_active: bool,
                                    student_ids: list[str]) -> None:
    """Undo /activate's Step 3 when a concurrent archive won (STUDENTARCHIVE-0029).

    A fresh activation is reverted (as on a lost claim race). An already-active
    account is set inactive again only if the latest archive locked it.
    """
    deactivate = not was_already_active
    if not deactivate and student_ids:
        try:
            audit = (supabase_admin.table("student_lifecycle_audit")
                     .select("action, detail, created_at")
                     .in_("student_id", student_ids)
                     .order("created_at", desc=True).limit(1).execute().data or [])
            latest = audit[0] if audit else {}
            deactivate = (latest.get("action") == "archive"
                          and bool((latest.get("detail") or {}).get("account_deactivated")))
        except Exception as e:
            # Unknown archive intent: fail closed to the archive's strictest state.
            logger.error("[auth] archive audit read failed user=%s: %s", user_id, _exc_tag(e))
            deactivate = True
    if not deactivate:
        return
    try:
        supabase_admin.table("users").update({"is_active": False}).eq("id", user_id).execute()
    except Exception as e:
        logger.error("[auth] archive rollback of is_active FAILED for user=%s (critical): %s",
                     user_id, _exc_tag(e))


def is_cohort_archived_error(exc: BaseException) -> bool:
    """Recognize 337's guard message without matching unrelated DB detail."""
    return (getattr(exc, "message", None) or str(exc)).strip() == "cohort_archived"


def _audit_class_activation_rejected(
    user_id: str, code_id: str | None, cohort_id: str, *,
    request_id: str, race: bool = False, compensation_failed: bool = False,
    unrestored_fields: list[str] | None = None,
) -> None:
    # Migration 099 has before/after JSON, not a top-level detail column.
    # Keep the rejection detail inside after so this works before 337 too.
    detail = {"request_id": request_id, "race": race, "compensation_failed": compensation_failed}
    if compensation_failed:
        # The real final state: these users fields may still hold this request's
        # Step 3 values (runbook: docs/runbooks/activation-compensation-failed.md).
        detail["unrestored_fields"] = sorted(unrestored_fields or [])
    try:
        supabase_admin.table("access_code_audit").insert({
            "actor_user_id": user_id,
            "target_user_id": user_id,
            "code_id": code_id,
            "action": "enroll_rejected_cohort_archived",
            "after": {"cohort_id": str(cohort_id), "detail": detail},
        }).execute()
    except Exception as e:
        logger.error("[auth] class activation rejection audit failed request_id=%s user=%s: %s",
                     request_id, user_id, _exc_tag(e))


def _restore_class_activation_snapshot(
    user_id: str, snapshot: dict, written: dict, request_id: str, *, log_failure: bool = True,
) -> tuple[bool, list[str]]:
    """Undo this request's Step 3 write; one retry, never claim on failure.

    Only fields Step 3 actually changed are restored, and only while they still
    hold the value Step 3 wrote: a concurrent admin change (e.g. is_active=false
    or stripped permissions) wins over the snapshot. Nothing is restored once the
    row carries another code: a newer activation of the same user owns it
    (Codex r4422345951). A snapshot that is another request's provisional
    activation (an active row with a code this user does not own) is never
    restored: the target is then the inactive, code-less state (PC-J420).
    Returns (ok, fields that may still hold this request's values when not ok).
    """
    changed = {key: snapshot.get(key) for key, value in written.items()
               if value != snapshot.get(key)}
    own_code = written["access_code_used"]
    snapshot_code = snapshot.get("access_code_used")
    check_snapshot = bool(snapshot.get("is_active") and snapshot_code and snapshot_code != own_code)
    for attempt in range(2):
        try:
            if check_snapshot and not _activation_code_committed(user_id, snapshot_code):
                inactive = {"is_active": False, "access_code_used": None, "permissions": None}
                changed = {key: inactive[key] for key, value in written.items()
                           if value != inactive[key]}
            check_snapshot = False
            if not changed:
                return True, []
            rows = (supabase_admin.table("users")
                    .select(", ".join(sorted({*changed, "access_code_used"})))
                    .eq("id", user_id).limit(1).execute().data or [])
            if not rows:
                raise RuntimeError("activation compensation found no user")
            if rows[0].get("access_code_used") != own_code:
                return True, []
            restore = {key: value for key, value in changed.items()
                       if rows[0].get(key) == written[key]}
            if not restore:
                return True, []
            # Compare-and-swap on ownership and on every restored field (jsonb as
            # its JSON text), so a write landing after the read above is kept.
            query = (supabase_admin.table("users").update(restore)
                     .eq("id", user_id).eq("access_code_used", own_code))
            for key in restore:
                if key != "access_code_used":
                    value = written[key]
                    query = query.eq(key, json.dumps(value) if isinstance(value, (list, dict)) else value)
            if not query.execute().data:
                raise RuntimeError("activation compensation updated no user")
            return True, []
        except Exception as e:
            logger.warning("[auth] activation compensation attempt=%s request_id=%s user=%s: %s",
                           attempt + 1, request_id, user_id, _exc_tag(e))
    if log_failure:
        logger.critical("[auth] cohort-archive activation revert FAILED request_id=%s user=%s (activation_incomplete)",
                        request_id, user_id)
    return False, sorted(changed)


def _activation_code_committed(user_id: str, code: str) -> bool:
    """Whether an account state carrying `code` is committed, not in flight (PC-J420).

    Step 3 writes the code before Step 4 claims it, so another request's
    provisional activation looks like an active account. It is committed only
    when the user owns the code (access_codes.used_by) or was granted it (any
    user_code_assignments row, also an inactive one after a remove-user). A
    code row that no longer exists cannot be in flight (legacy hard delete).
    """
    rows = (supabase_admin.table("access_codes").select("id, used_by")
            .eq("code", code).limit(1).execute().data or [])
    if not rows:
        return True
    if rows[0].get("used_by") is not None and str(rows[0]["used_by"]) == str(user_id):
        return True
    grants = (supabase_admin.table("user_code_assignments").select("code_id")
              .eq("user_id", user_id).eq("code_id", rows[0]["id"]).limit(1).execute().data or [])
    return bool(grants)


def _promote_after_claim(user_id: str, before_role: str | None,
                         request_id: str) -> tuple[str | None, str | None, bool]:
    """W-2 promote, run only after this request owns the code (SA-REVIEW-152).

    Upgrade-only compare-and-swap on the Step 2 role, one retry. Returns
    (final_role, failure_reason, noop); failure_reason is None when the account
    ends at instructor or above, noop is True when that role was written by
    someone else (this request's CAS matched no row).
    """
    final_role: str | None = None
    for attempt in range(2):
        try:
            query = supabase_admin.table("users").update({"role": "instructor"}).eq("id", user_id)
            if before_role is None:
                query = query.is_("role", "null")
            else:
                query = query.eq("role", before_role)
            if query.execute().data:
                return "instructor", None, False
            # 0 rows: the role changed since Step 2 (never overwrite it), or the
            # client returned no representation — read back to tell them apart.
            rows = (supabase_admin.table("users").select("role")
                    .eq("id", user_id).limit(1).execute().data or [])
            final_role = rows[0].get("role") if rows else None
            if final_role in ("instructor", "admin"):
                return final_role, None, True
            return final_role, "write_failed" if final_role == before_role else "role_changed", False
        except Exception as e:
            # 332 (account_suspended) or, on this role-only write, 336
            # (account_suspended_role_change): the trigger rolled it back.
            if staff_security.raised_code(e) in ("account_suspended", "account_suspended_role_change"):
                return before_role, "account_suspended", False
            logger.warning("[auth] instructor promote attempt=%s request_id=%s user=%s: %s",
                           attempt + 1, request_id, user_id, _exc_tag(e))
    try:  # record the real final role in the audit; None = unknown
        rows = (supabase_admin.table("users").select("role")
                .eq("id", user_id).limit(1).execute().data or [])
        final_role = rows[0].get("role") if rows else None
    except Exception as e:
        logger.warning("[auth] promote read-back failed request_id=%s user=%s: %s",
                       request_id, user_id, _exc_tag(e))
    if final_role in ("instructor", "admin"):
        return final_role, None, False
    return final_role, "write_failed", False


def _audit_promote_failed(user_id: str, code_id: str | None, *, before_role: str | None,
                          final_role: str | None, reason: str, request_id: str) -> None:
    """Best-effort audit of a claimed instructor code whose promote did not land."""
    try:
        supabase_admin.table("access_code_audit").insert({
            "actor_user_id": user_id,
            "target_user_id": user_id,
            "code_id": code_id,
            "action": "promote_role_failed",
            "before": {"role": before_role},
            "after": {"role": final_role, "reason": reason, "code_claimed": True,
                      "request_id": request_id},
        }).execute()
    except Exception as e:
        logger.error("[auth] promote_role_failed audit failed request_id=%s user=%s: %s",
                     request_id, user_id, _exc_tag(e))


@router.post("/activate", response_model=AuthActivateResponse)
async def activate_account(
    payload: ActivateRequest,
    authorization: str | None = Header(default=None),
):
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _rate_limit_activate(user_id)
    email = auth_user.get("email")
    metadata = auth_user.get("user_metadata", {}) or {}
    code = payload.access_code.strip().upper()
    request_id = current_request_id() or new_ref()
    unused_message = "Mã CHƯA được sử dụng — vui lòng thử lại"

    # ── Step 1: look up the access code ──────────────────────────────────────
    try:
        code_result = (
            supabase_admin.table("access_codes")
            .select("*")
            .eq("code", code)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise _activation_error(e, context="activation code lookup", ref=request_id) from None

    # Audit 2026-07-03 S5 — anti-enumeration. Distinct messages for
    # not-found / used / revoked / expired let a caller distinguish a code that
    # EXISTS-but-is-unusable from one that never existed (36^8 keyspace probe).
    # Collapse all of those to ONE generic message so existence isn't revealed.
    # The one exception is the caller's OWN already-activated code: telling them
    # "you already activated this" leaks nothing (they clearly possess the code)
    # and is the common, legitimate confusion — so keep that message specific.
    _GENERIC = "Access code không hợp lệ hoặc không thể sử dụng. Kiểm tra lại mã hoặc liên hệ admin."

    if not code_result.data:
        raise HTTPException(status_code=400, detail=_GENERIC)

    access_code_row = code_result.data[0]

    if access_code_row.get("is_used") and access_code_row.get("used_by") == user_id:
        raise HTTPException(status_code=400, detail="Bạn đã kích hoạt mã này rồi.")

    if access_code_row.get("is_used"):
        raise HTTPException(status_code=400, detail=_GENERIC)

    if access_code_row.get("is_revoked"):
        raise HTTPException(status_code=400, detail=_GENERIC)

    # Sprint 5.2.1 RED hotfix — refuse activation of a code past its
    # expiry. Activating an expired code would create a "ghost" link in
    # user_code_assignments that the live permission lookup correctly
    # ignores (post-Sprint 5.2.1) but that admins can't easily explain.
    # (Message collapsed into the generic anti-enumeration string above.)
    from services.access_code_permissions import _is_expired  # local — avoid cycle
    if _is_expired(access_code_row.get("expires_at"), datetime.now(timezone.utc)):
        raise HTTPException(status_code=400, detail=_GENERIC)

    # ── Step 1b (W-2): instructor-promote gate (Option B, email-bound) ───────
    # Evaluate BEFORE activating/consuming so a mismatch fails CLOSED (HARD-403)
    # WITHOUT marking the code used — the code stays valid for the intended GV.
    # Email check applies ONLY to grants_role='instructor' codes; ordinary codes
    # (grants_role NULL) are untouched (students activate normally). The email is
    # the VERIFIED token email (auth_user), never request body.
    promote_role: str | None = None
    if (access_code_row.get("grants_role") or "").strip().lower() == "instructor":
        intended = _norm_email(access_code_row.get("intended_email"))
        if not intended or intended != _norm_email(email):
            _audit_promote_attempt(
                user_id, access_code_row.get("id"),
                ok=False, intended_email=access_code_row.get("intended_email"),
            )
            raise HTTPException(
                status_code=403,
                detail="Email không khớp với instructor-code này. Mã CHƯA được sử "
                       "dụng — đăng nhập bằng đúng email được cấp, hoặc liên hệ admin.",
            )
        promote_role = "instructor"

    # ── Step 1c (STUDENTARCHIVE-0029): archived roster profile ───────────────
    # An archived learner must not re-activate through a new code. Refuse BEFORE
    # Step 3 touches users.is_active and before the code is claimed, so the
    # account state is unchanged and the code stays unused. The profile is the
    # one Step 3b would fold into: the user's linked rows (archived only when
    # every linked row is), else the unlinked/self-linked row of this code.
    try:
        linked_profiles = (supabase_admin.table("students").select("id, user_id, archived_at")
                           .eq("user_id", user_id).limit(20).execute().data or [])
        code_profiles = (supabase_admin.table("students").select("id, user_id, archived_at")
                         .eq("student_code", code).limit(1).execute().data or [])
    except Exception as e:
        raise _activation_error(e, context="activation profile pre-check", ref=request_id) from None
    if linked_profiles:
        profile_archived = all(row.get("archived_at") for row in linked_profiles)
    else:
        code_owner = code_profiles[0].get("user_id") if code_profiles else None
        profile_archived = bool(
            code_profiles and code_profiles[0].get("archived_at")
            and (not code_owner or str(code_owner) == str(user_id))
        )
    if profile_archived:
        raise HTTPException(status_code=403, detail=_ARCHIVED_PROFILE_DETAIL)

    # W1 / CLASSARCHIVE-0030: refuse before Step 2/3 write any account state.
    # Select * so deploying before 337 (no archived_at column) stays usable.
    code_cohort_id = access_code_row.get("cohort_id")
    code_cohort = None
    if code_cohort_id:
        try:
            cohorts = (await asyncio.to_thread(
                lambda: supabase_admin.table("cohorts").select("*")
                .eq("id", str(code_cohort_id)).limit(1).execute()
            )).data or []
            code_cohort = cohorts[0] if cohorts else None
        except Exception as e:
            raise _activation_error(e, status_code=503, message=unused_message,
                                    context="activation class pre-check", ref=request_id) from None
        if code_cohort and code_cohort.get("is_active") is False and code_cohort.get("archived_at"):
            logger.info("[auth] activation rejected: cohort_archived request_id=%s user=%s cohort=%s",
                        request_id, user_id, code_cohort_id)
            await asyncio.to_thread(
                _audit_class_activation_rejected,
                user_id, access_code_row.get("id"), code_cohort_id, request_id=request_id,
            )
            raise HTTPException(400, _GENERIC)

    # ── Step 1d (ADMINAAL2-0032 FR-018): suspended staff account ─────────────
    # A suspension is lifted only by an admin (PATCH /admin/users/{id}/active),
    # never by a code. Refuse before Step 3 and before the code is claimed, so
    # the code stays unused. Migration 332's trigger also refuses Step 3 if a
    # suspension commits between this read and that write.
    # select("*"), not the column: before migration 332 there is no marker and
    # nothing can be suspended, so learner activation must not 500 on it.
    try:
        suspension = (supabase_admin.table("users").select("*")
                      .eq("id", user_id).limit(1).execute().data or [])
    except Exception as e:
        raise _activation_error(e, context="activation suspension pre-check", ref=request_id) from None
    if suspension and suspension[0].get("suspended_at"):
        raise staff_security.account_suspended_exception(403)

    # ── Step 2: upsert user row (in case /me was never called) ───────────────
    # Snapshot the fields Step 3 changes, including nullable permissions/code.
    try:
        existing = (
            supabase_admin.table("users")
            .select("id, role, is_active, access_code_used, permissions")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            supabase_admin.table("users").insert({
                "id": user_id,
                "email": email,
                "display_name": metadata.get("full_name") or metadata.get("name"),
                "avatar_url": metadata.get("avatar_url"),
                "role": "user",
                "is_active": False,
            }).execute()
            # Capture actual database defaults for a newly created account too.
            existing = await asyncio.to_thread(
                lambda: supabase_admin.table("users")
                .select("id, role, is_active, access_code_used, permissions")
                .eq("id", user_id).limit(1).execute()
            )
        user_before = existing.data[0]
    except Exception as e:
        raise _activation_error(e, context="activation user snapshot", ref=request_id) from None

    # ── Step 3: activate the user ─────────────────────────────────────────────
    # Copy permissions from access_code so they survive code revocation later.
    code_permissions = access_code_row.get("permissions") or ["practice_single", "practice_part", "practice_full"]
    update_fields = {
        "is_active": True,
        "access_code_used": code,
        "permissions": code_permissions,
    }
    # Pair the write with its rollback snapshot. If another activation lands
    # after Step 2, refresh the snapshot and retry once; never undo its success
    # using the older inactive state (Codex r4422565648).
    #
    # PC-J420: write only over a committed snapshot. An active snapshot whose
    # code this user does not own is another request's provisional Step 3 (still
    # before its claim, or already rejected/lost and not yet compensated).
    # Writing over it would make that provisional state this request's rollback
    # target, so two failing activations could leave the account active without
    # a code. Refuse like a twice-changed snapshot; the code stays unused.
    for attempt in range(2):
        activation_snapshot = {key: user_before.get(key) for key in update_fields}
        snapshot_committed = True
        snapshot_code = user_before.get("access_code_used")
        if user_before.get("is_active") and snapshot_code:
            try:
                snapshot_committed = await asyncio.to_thread(
                    _activation_code_committed, user_id, snapshot_code)
            except Exception as e:
                raise _activation_error(e, status_code=503, message=unused_message,
                                        context="activation snapshot ownership", ref=request_id) from None
            # Same code: a duplicate submit of this activation, not a rival one.
            if not snapshot_committed and snapshot_code != code:
                raise safe_error(status_code=503, error_code="activation_conflict", ref=request_id,
                                 message=unused_message,
                                 context="activation snapshot holds another request's code")
        try:
            query = supabase_admin.table("users").update(update_fields).eq("id", user_id)
            for key, value in activation_snapshot.items():
                if value is None:
                    query = query.is_(key, "null")
                else:
                    query = query.eq(key, json.dumps(value) if key == "permissions" else value)
            if (await asyncio.to_thread(lambda: query.execute())).data:
                break
        except Exception as e:
            if staff_security.is_account_suspended_error(e):
                raise staff_security.account_suspended_exception(403) from None
            raise _activation_error(e, context="activation user update", ref=request_id) from None
        if attempt == 1:
            raise safe_error(status_code=503, error_code="activation_conflict", ref=request_id,
                             message=unused_message, context="activation snapshot changed twice")
        try:
            fresh = (await asyncio.to_thread(
                lambda: supabase_admin.table("users")
                .select("id, role, is_active, access_code_used, permissions")
                .eq("id", user_id).limit(1).execute()
            )).data or []
            if not fresh:
                raise RuntimeError("activation snapshot found no user")
            user_before = fresh[0]
        except Exception as e:
            raise _activation_error(e, status_code=503, message=unused_message,
                                    context="activation snapshot refresh", ref=request_id) from None

    # Both rollback paths must use the snapshot matched by the successful write.
    # An uncommitted snapshot here can only be a duplicate submit of this code.
    was_already_active = bool(user_before.get("is_active")) and snapshot_committed
    current_role = user_before.get("role") or "user"
    # W-2 — the role promote is NOT part of this write (SA-REVIEW-152): it runs
    # only after Step 4 wins the claim, so every pre-claim failure (Step 3b
    # error, archive race, lost/indeterminate claim) leaves the role untouched.
    # Upgrade-only: never downgrade admin; no-op if already ≥ instructor. Only
    # when the email-bound gate above passed.
    will_promote = promote_role == "instructor" and current_role not in ("admin", "instructor")

    # ── Step 3b (W-5): enroll-chain — stamp students.instructor_id ATOMICALLY,
    # BEFORE the code is consumed (seam-defect #4: no bolt-tail). Any failure here
    # RAISES → Step 4 (mark is_used) never runs → the code stays valid → retry-able.
    #
    # Owner = the CODE'S issuer IF that issuer is an instructor; admin/mass codes
    # (or no issuer) → NULL (never stamp an admin → keeps roster/metrics clean).
    # owner is read server-side from access_codes.issued_by, NEVER the request body.
    issued_by = access_code_row.get("issued_by")
    owner: str | None = None
    if issued_by:
        try:
            ir = (supabase_admin.table("users").select("role")
                  .eq("id", issued_by).limit(1).execute().data or [None])[0]
        except Exception as e:
            raise _activation_error(e, message=unused_message, context="activation issuer lookup",
                                    ref=request_id) from None
        if ir and ir.get("role") == "instructor":
            owner = str(issued_by)

    # E6 — a CLASS/COHORT code must attach the student to the CLASS's owner
    # (cohorts.created_by), not only to the code issuer. An instructor who mints
    # their OWN class code already resolves `owner` above (issuer == owner), but
    # an admin minting a class code on an instructor's behalf leaves `owner` NULL
    # — the student then enrolls into the cohort (via students.cohort_id + the
    # mig-227 membership trigger) yet is orphaned from the instructor roster /
    # submission-matrix / individual-assign surfaces, which are all scoped by
    # students.instructor_id. `enroll_owner` falls back to the cohort owner so a
    # class code always links the student to the class's instructor.
    #
    # It is kept SEPARATE from `owner` on purpose: `owner` (issuer-derived) still
    # drives the cross-instructor conflict 403 below, so this fallback can never
    # turn an admin's legitimate second-class enroll of an already-owned student
    # into a 403. It is used ONLY to stamp a NULL instructor_id. Mass/speaking
    # codes carry no cohort → enroll_owner stays None (anti-pollution preserved).
    enroll_owner: str | None = owner
    if enroll_owner is None and code_cohort_id:
        cohort_owner = (code_cohort or {}).get("created_by")
        if cohort_owner:
            enroll_owner = str(cohort_owner)
    try:
        linked_rows = (supabase_admin.table("students")
                       .select("id, user_id, instructor_id, cohort_id, archived_at")
                       .eq("user_id", user_id).limit(20).execute().data or [])
        # Fold into an active profile only; an archived one stays archived.
        by_user = [row for row in linked_rows if not row.get("archived_at")][:1]
        by_code = (supabase_admin.table("students")
                   .select("id, user_id, instructor_id, cohort_id, archived_at")
                   .eq("student_code", code).limit(1).execute().data or [])
    except Exception as e:
        raise _activation_error(e, message=unused_message, context="activation enrollment lookup",
                                ref=request_id) from None

    target = None
    if by_user:
        target = by_user[0]                              # this user already has a profile
    elif by_code and not by_code[0].get("user_id"):
        target = by_code[0]                              # admin-precreated unlinked bridge
    elif by_code and str(by_code[0].get("user_id")) == str(user_id):
        target = by_code[0]                              # already linked to me (idempotent)

    # Archived between Step 1c and here (a concurrent fn_archive_student): every
    # linked profile is now archived, or the code's own profile is. Refuse before
    # any enroll write or claim — never create a replacement profile — and undo
    # this request's Step 3 activation so the archive's account state stands.
    if (linked_rows and not by_user) or (target and target.get("archived_at")):
        _restore_archived_account_state(
            user_id, was_already_active=was_already_active,
            student_ids=[row["id"] for row in [*linked_rows, *([target] if target else [])]
                         if row.get("id") and row.get("archived_at")],
        )
        raise HTTPException(status_code=403, detail=_ARCHIVED_PROFILE_DETAIL)

    # 2nd-code cross-instructor block: an already-owned student can NOT be moved to
    # a different instructor by another GV's enroll-code → REJECT 403, leave is_used
    # FALSE (don't burn the code), audit. Same owner = idempotent; owner NULL on the
    # new code (admin/mass) = no ownership change → proceed.
    if target:
        cur_owner = target.get("instructor_id")
        if cur_owner and owner and str(cur_owner) != owner:
            _audit_enroll_reject(user_id, access_code_row.get("id"),
                                 current_owner=cur_owner, attempted_owner=owner)
            raise HTTPException(
                status_code=403,
                detail="Học viên này đã thuộc một giảng viên khác. Mã CHƯA được sử "
                       "dụng — liên hệ admin để chuyển giảng viên/lớp.",
            )

    # B1 (PR #589 review, comment 2): Step 3b runs BEFORE the code is claimed
    # (Step 4), so a request that later LOSES the claim race may already have
    # linked or created a students row for itself. Record what we write here so
    # the lost-race path can undo it. This keeps W-5 intact (the claim still runs
    # LAST, so an enroll-write failure still does NOT consume the code).
    enroll_inserted_id: str | None = None
    enroll_revert: tuple | None = None  # (student_id, {field: prior_value_to_restore})
    enroll_added_cohort: tuple[str, str] | None = None  # rollback-only membership
    try:
        if target:
            upd: dict = {}
            revert: dict = {}
            already_in_code_cohort = bool(code_cohort_id) and student_is_active_in_cohort(
                supabase_admin, target["id"], str(code_cohort_id), target.get("cohort_id")
            )
            if not target.get("user_id"):
                upd["user_id"] = user_id
                revert["user_id"] = None
            if code_cohort_id:
                upd["cohort_id"] = code_cohort_id            # cohort fold (same atomic write)
                revert["cohort_id"] = target.get("cohort_id")
            if enroll_owner and not target.get("instructor_id"):
                upd["instructor_id"] = enroll_owner           # stamp ONLY when currently NULL
                revert["instructor_id"] = None
            if upd:
                supabase_admin.table("students").update(upd).eq("id", target["id"]).execute()
                enroll_revert = (target["id"], revert)
                if code_cohort_id and not already_in_code_cohort:
                    # Migration 217's compatibility trigger mirrored this
                    # provisional legacy pointer as an additive membership.
                    enroll_added_cohort = (target["id"], str(code_cohort_id))
        elif by_code:
            # student_code==code exists but is linked to ANOTHER user (code/account
            # mismatch — NOT an ownership conflict). Existing behaviour: log + skip
            # the enroll (don't relink, don't 403). Activation still proceeds.
            # Log the code row id, never the code itself (SA-3).
            logger.warning(
                "[auth] student code of code_id=%s linked to user=%s; refusing relink to %s",
                access_code_row.get("id"), by_code[0].get("user_id"), user_id,
            )
        elif owner or code_cohort_id:
            # ENROLL SIGNAL only (instructor code OR cohort/class code) AND no row
            # exists → create the profile. A plain mass/speaking code (no owner, no
            # cohort) creates NOTHING — don't pollute the writing roster with
            # student rows for speaking-only users.
            full_name = (metadata.get("full_name") or metadata.get("name")
                         or (email.split("@")[0] if email else None) or "Học viên")
            _ins = supabase_admin.table("students").insert({
                "user_id":       user_id,
                "student_code":  code,
                "full_name":     full_name,
                "created_by":    issued_by,        # provenance: who issued the code
                "instructor_id": enroll_owner,     # code issuer if GV, else the class owner
                "cohort_id":     code_cohort_id,
            }).execute()
            if _ins.data:
                enroll_inserted_id = (_ins.data[0] or {}).get("id")
        # else: no row + no enroll signal (plain mass code) → no-op (no pollution).
    except HTTPException:
        raise
    except Exception as e:
        if is_cohort_archived_error(e):
            logger.warning("[auth] activation race: cohort_archived request_id=%s user=%s cohort=%s",
                           request_id, user_id, code_cohort_id)
            restored, unrestored = await asyncio.to_thread(
                _restore_class_activation_snapshot,
                user_id, activation_snapshot, update_fields, request_id,
            )
            await asyncio.to_thread(
                _audit_class_activation_rejected,
                user_id, access_code_row.get("id"), code_cohort_id, request_id=request_id,
                race=True, compensation_failed=not restored, unrestored_fields=unrestored,
            )
            if not restored:
                raise safe_error(
                    status_code=503, error_code="activation_incomplete", ref=request_id,
                    message="Kích hoạt chưa hoàn tất. Mã CHƯA được sử dụng — vui lòng thử lại sau ít phút hoặc liên hệ admin.",
                ) from None
            raise HTTPException(400, _GENERIC) from None
        # FATAL, BEFORE consume — fail closed so the code stays retry-able.
        raise _activation_error(e, message=unused_message, context="activation enrollment write",
                                ref=request_id) from None

    # The students row this activation enrolled (created or folded). Used after
    # the claim succeeds to backfill the cohort's open gives for a late joiner.
    enrolled_student_id = enroll_inserted_id or (target["id"] if target else None)

    # ── Step 4: atomically CLAIM the access code (B1 / review Mục 2) ─────────
    # P0 fix for double-redemption. The is_used check in Step 1 and this write
    # used to be a TOCTOU pair: two concurrent activations of the SAME code both
    # read is_used=false, both activated a (different) user → one code redeemed
    # twice. The `.eq("is_used", False)` guard turns this into an atomic
    # compare-and-swap — under the row lock only the FIRST writer matches, the
    # loser's conditional UPDATE affects 0 rows. No migration needed: the
    # row-level WHERE clause IS the lock. PostgREST does not evaluate "now()", so
    # use a real ISO timestamp.
    now_iso = datetime.now(timezone.utc).isoformat()

    claimed = False
    indeterminate = False
    try:
        claim = (
            supabase_admin.table("access_codes")
            .update({"is_used": True, "used_by": user_id, "used_at": now_iso})
            .eq("id", access_code_row["id"])
            .eq("is_used", False)
            .execute()
        )
        if claim.data:
            claimed = True  # our conditional UPDATE matched the row → we won
        else:
            # 0 rows: either we LOST the race or it's our own idempotent re-claim.
            # Re-read to disambiguate (also robust to clients that don't return the
            # updated representation — then claim.data is empty even on a win).
            fresh = (
                supabase_admin.table("access_codes")
                .select("is_used, used_by")
                .eq("id", access_code_row["id"])
                .limit(1)
                .execute()
            )
            frow = (fresh.data or [{}])[0]
            # Not actually used (no real contention) OR used BY US → we hold it.
            if (not frow.get("is_used")) or str(frow.get("used_by")) == str(user_id):
                claimed = True
            # else: another user owns it → claimed stays False (lost the race).
    except Exception as e:
        # PR #589 review, comment 1: an exception here makes the claim/readback
        # INDETERMINATE — we cannot confirm we own the code. FAIL CLOSED (claimed
        # stays False) rather than fall through to Step 5, which would risk a
        # second active redemption in a transient DB/PostgREST failure window.
        indeterminate = True
        logger.error("[auth] access-code claim indeterminate — failing closed request_id=%s: %s",
                     request_id, _exc_tag(e))

    if not claimed:
        # Lost the race (or indeterminate claim). Undo EVERY side effect this
        # request made BEFORE the claim so the loser is neither active nor
        # enrolled on a code another user owns (PR #589 review, comments 1 & 2).
        if not was_already_active:
            try:
                # CAS: a newer activation of this user (another code) keeps its state.
                supabase_admin.table("users").update(
                    {"is_active": False}
                ).eq("id", user_id).eq("access_code_used", code).eq("is_active", True).execute()
            except Exception as e:
                logger.error(
                    "[auth] race rollback of is_active FAILED for user=%s (critical): %s",
                    user_id, _exc_tag(e),
                )
        # PC-J420: also put back the code and permissions Step 3 wrote (and
        # is_active if the write above failed), field by field under the same
        # ownership CAS, so the row never keeps a code this user lost, nor its
        # permissions; a newer activation or an admin change still wins.
        restored, unrestored = await asyncio.to_thread(
            _restore_class_activation_snapshot,
            user_id, activation_snapshot, update_fields, request_id, log_failure=False,
        )
        if not restored:
            logger.error("[auth] race rollback of activation fields FAILED request_id=%s user=%s "
                         "fields=%s (critical)", request_id, user_id, ",".join(unrestored))
        if enroll_inserted_id:
            try:
                supabase_admin.table("students").delete().eq("id", enroll_inserted_id).execute()
            except Exception as e:
                logger.error(
                    "[auth] race rollback of inserted student FAILED id=%s (critical): %s",
                    enroll_inserted_id, _exc_tag(e),
                )
        elif enroll_revert:
            _sid, _fields = enroll_revert
            try:
                if enroll_added_cohort:
                    remove_student(
                        supabase_admin, student_id=enroll_added_cohort[0],
                        cohort_id=enroll_added_cohort[1],
                    )
                    # remove_student atomically restores another active primary
                    # (or NULL), so a second cohort_id write would be stale.
                    _fields = {key: value for key, value in _fields.items()
                               if key != "cohort_id"}
                if _fields:
                    supabase_admin.table("students").update(_fields).eq("id", _sid).execute()
            except Exception as e:
                logger.error(
                    "[auth] race rollback of student link FAILED id=%s (critical): %s",
                    _sid, _exc_tag(e),
                )
        if indeterminate:
            # Transient DB/PostgREST failure — we don't actually know the code is
            # used. Ask the user to retry rather than wrongly claiming it's spent.
            raise HTTPException(
                status_code=503,
                detail="Lỗi tạm thời khi kích hoạt mã. Vui lòng thử lại.",
            )
        raise HTTPException(status_code=400, detail="Access code này đã được sử dụng rồi")

    # W-2 promote, now that this request owns the code. The claim is immutable,
    # so a promote that does not land is audited with the real final role and
    # reported after Steps 5–6 (the code stays this user's), never silently.
    promote_failure: str | None = None
    if will_promote:
        final_role, promote_failure, promote_noop = await asyncio.to_thread(
            _promote_after_claim, user_id, user_before.get("role"), request_id,
        )
        if promote_failure is None:
            _audit_promote_attempt(user_id, access_code_row.get("id"), ok=True,
                                   before_role=current_role, after_role=final_role,
                                   noop=promote_noop)
        else:
            logger.critical("[auth] instructor promote FAILED after claim request_id=%s user=%s "
                            "code_id=%s reason=%s", request_id, user_id,
                            access_code_row.get("id"), promote_failure)
            await asyncio.to_thread(
                _audit_promote_failed, user_id, access_code_row.get("id"),
                before_role=user_before.get("role"), final_role=final_role,
                reason=promote_failure, request_id=request_id,
            )

    # ── Step 5: upsert assignment row so admin panel can show the redeemer ───
    try:
        supabase_admin.table("user_code_assignments").upsert({
            "user_id":     user_id,
            "code_id":     access_code_row["id"],
            "assigned_at": now_iso,
            "is_active":   True,
        }, on_conflict="user_id,code_id").execute()
    except Exception as e:
        logger.warning("[warn] Could not create user_code_assignment: %s", _exc_tag(e))

    # ── Step 6 (E1): backfill the cohort's open gives for a late joiner ──────
    # Runs AFTER the claim so a lost-race user gets nothing (and needs no undo).
    # `fan_out_assignment` snapshots the roster at give-time, so a student who
    # joins the class later has no writing_assignments row for gives already made
    # to the cohort. Reconcile that here (idempotent, skip-existing). Best-effort:
    # a failure must NOT fail an otherwise-complete activation — the one-off
    # backfill script (scripts/backfill_class_enrollment_roster.py) is the safety
    # net for any row missed here.
    if enrolled_student_id and code_cohort_id:
        try:
            from services.cohort_assignment_service import (
                backfill_cohort_writing_assignments,
            )
            backfill_cohort_writing_assignments(
                supabase_admin,
                student_id=str(enrolled_student_id),
                cohort_id=str(code_cohort_id),
            )
        except Exception as e:
            logger.warning(
                "[auth] cohort give backfill failed student=%s cohort=%s: %s",
                enrolled_student_id, code_cohort_id, _exc_tag(e),
            )

    # (Phase-2.1 student-link + WF-1 cohort enroll moved to Step 3b above and
    # folded into the atomic, pre-consume enroll write — see W-5.)

    if promote_failure == "account_suspended":
        raise staff_security.account_suspended_exception(403)
    if promote_failure:
        raise safe_error(
            status_code=503, error_code="promote_incomplete", ref=request_id,
            message="Mã đã được kích hoạt cho tài khoản này nhưng chưa cấp được quyền "
                    "giảng viên — vui lòng liên hệ admin kèm mã tham chiếu.",
        )

    return {
        "success": True,
        "message": "Tài khoản đã được kích hoạt!",
    }


# ── PATCH /auth/profile ───────────────────────────────────────────────────────

# FE migration pilot 4 — FIRST require_flag adoption (ADR-010): flag
# `profile_update`, default enabled (missing row = on, legacy unaffected);
# admin flip via PATCH /admin/runtime-flags/profile_update is live within one
# 15 s cache window on every instance, killing the mutation for BOTH stacks
# at the backend seam. Disabled → 503 {"code": "feature_disabled", ...}.
@router.patch(
    "/profile",
    response_model=AuthProfileUpdateResponse,
    dependencies=[Depends(require_flag("profile_update"))],
)
async def update_profile(
    payload: ProfileUpdate,
    response: Response,
    authorization: str | None = Header(default=None),
):
    # Pilot-3/4 checklist: private response — never shared-cacheable.
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    updates: dict = {}
    if payload.target_band is not None:
        updates["target_band"] = payload.target_band
    if payload.exam_date is not None:
        updates["exam_date"] = payload.exam_date
    if payload.self_level is not None:
        valid_levels = {"beginner", "intermediate", "upper_intermediate", "advanced"}
        if payload.self_level not in valid_levels:
            raise HTTPException(
                status_code=400,
                detail=f"self_level không hợp lệ. Phải là: {', '.join(valid_levels)}",
            )
        updates["self_level"] = payload.self_level
    if payload.preferred_topics is not None:
        updates["preferred_topics"] = payload.preferred_topics
    if payload.onboarding_completed is not None:
        updates["onboarding_completed"] = payload.onboarding_completed
    if payload.display_name is not None:
        updates["display_name"] = payload.display_name.strip()[:100]
    if payload.timezone is not None:
        updates["timezone"] = payload.timezone
    if payload.weekly_goal is not None:
        updates["weekly_goal"] = max(1, min(14, payload.weekly_goal))
    if payload.notification_email is not None:
        updates["notification_email"] = payload.notification_email

    if not updates:
        raise HTTPException(status_code=400, detail="Không có trường nào để cập nhật.")

    try:
        result = (
            supabase_admin.table("users")
            .update(updates)
            .eq("id", user_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi cập nhật profile: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")

    user = result.data[0]
    return {
        "id": user["id"],
        "email": user.get("email"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role", "user"),
        "is_active": user.get("is_active", False),
        "onboarding_completed": user.get("onboarding_completed", False),
        "target_band": user.get("target_band"),
        "exam_date": str(user["exam_date"]) if user.get("exam_date") else None,
        "self_level": user.get("self_level"),
        "preferred_topics": user.get("preferred_topics") or [],
        "timezone": user.get("timezone") or "Asia/Ho_Chi_Minh",
        "weekly_goal": user.get("weekly_goal") or 5,
        "notification_email": user.get("notification_email", True),
    }
