"""routers.admin.users_stats — users list, user admin actions, e2e cleanup and /admin/stats (BACKENDSPLIT-0076 T009).

Cut and pasted unchanged from the former single-file routers/admin.py. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlparse
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
import uuid as _uuid
from pydantic import BaseModel, Field, model_validator
from config import settings
from models.admin_users import AdminTestDataVisibilityOut, AdminUserDirectoryRowOut
from models.staff_security import UserRoleChangeOut
from database import supabase_admin
from services.errors import clip_user_value, clip_user_values, new_ref, safe_error
from services.class_membership_service import active_memberships_for_students, add_student
from services import admin_dashboard, ai_usage_logger, class_archive_service, test_data_visibility
from services import staff_guard, staff_security
from services.request_context import current_request_id
from services.access_code_permissions import (
    get_completed_session_counts,
    get_users_code_summary,
    validate_permissions_or_raise,
)

from routers.admin import (  # noqa: E402 — defined above this block in the package
    logger,
    router,
    _STAGING_E2E_SUPABASE_HOST,
    _STAGING_E2E_EMAIL_SUFFIX,
    _STAGING_E2E_AUDIO_BUCKET,
    _STAGING_E2E_TOPICS,
    _db_engine,
    require_admin,
)


# ── GET /admin/users ───────────────────────────────────────────────────────────


_VALID_ROLES = {"admin", "instructor", "student"}


def _staging_e2e_cleanup_enabled() -> bool:
    """Fail closed unless this is the one certified staging project."""
    environment = (settings.ENVIRONMENT or "").strip().lower()
    try:
        supabase_host = (urlparse(settings.SUPABASE_URL).hostname or "").lower()
    except ValueError:
        return False
    return environment == "staging" and supabase_host == _STAGING_E2E_SUPABASE_HOST


def _is_staging_e2e_topic(topic: object) -> bool:
    value = str(topic or "")
    return value in _STAGING_E2E_TOPICS or value.startswith("E2E chủ đề ")


@router.delete("/e2e/sessions/{session_id}", status_code=204)
async def admin_cleanup_e2e_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """Delete one synthetic release-smoke session from the certified staging DB.

    This deliberately is not a general session-delete API. It requires an
    admin, refuses every non-staging runtime/project, and only accepts an
    unassigned session owned by a staging-E2E identity with a frozen test
    topic. The narrow route lets the soak suite release its daily-quota rows
    without rotating identities or exposing the service key to GitHub Actions.
    """
    await require_admin(authorization)
    if not _staging_e2e_cleanup_enabled():
        raise HTTPException(404, "Not found")

    try:
        session_result = (
            supabase_admin.table("sessions")
            .select("id, user_id, topic, sitting_id, class_assignment_item_id")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load E2E session failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không thể kiểm tra E2E session. Vui lòng thử lại.") from None

    rows = session_result.data or []
    if not rows:
        return Response(status_code=204)
    session = rows[0]
    if session.get("sitting_id") or session.get("class_assignment_item_id"):
        raise HTTPException(403, "Session có liên kết nghiệp vụ, không được cleanup")
    if not _is_staging_e2e_topic(session.get("topic")):
        raise HTTPException(403, "Session không thuộc staging E2E")

    try:
        owner_result = (
            supabase_admin.table("users")
            .select("email")
            .eq("id", session.get("user_id"))
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load E2E session owner failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không thể kiểm tra chủ E2E session. Vui lòng thử lại.") from None
    owner_rows = owner_result.data or []
    owner_email = str(owner_rows[0].get("email") or "").lower() if owner_rows else ""
    if not owner_email.endswith(_STAGING_E2E_EMAIL_SUFFIX):
        raise HTTPException(403, "Session không thuộc tài khoản staging E2E")

    try:
        response_result = (
            supabase_admin.table("responses")
            .select("audio_storage_path")
            .eq("session_id", session_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load E2E session audio failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không thể kiểm tra audio E2E session. Vui lòng thử lại.") from None
    audio_paths = sorted({
        str(row.get("audio_storage_path"))
        for row in (response_result.data or [])
        if row.get("audio_storage_path")
    })
    expected_prefix = f"{session.get('user_id')}/{session_id}/"
    if any(not path.startswith(expected_prefix) for path in audio_paths):
        raise HTTPException(409, "Audio path của E2E session không hợp lệ")

    try:
        # Storage-first is intentional. If object removal fails, keep the DB
        # paths so the cleanup remains discoverable and retryable rather than
        # creating permanent orphans outside the retention sweep's reach.
        if audio_paths:
            supabase_admin.storage.from_(_STAGING_E2E_AUDIO_BUCKET).remove(audio_paths)
        # This FK predates the later CASCADE conventions and is NO ACTION.
        # Questions/responses cascade; usage/vocabulary references SET NULL.
        supabase_admin.table("grammar_recommendations").delete().eq(
            "session_id", session_id,
        ).execute()
        supabase_admin.table("sessions").delete().eq("id", session_id).execute()
    except Exception as exc:
        logger.error("[admin] cleanup E2E session failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không thể cleanup E2E session. Vui lòng thử lại.") from None
    return Response(status_code=204)


class UserRolePayload(BaseModel):
    role: str = Field(..., description=f"new role (one of {sorted(_VALID_ROLES)})")


# ADMINAAL2-0032 FR-019 (migration 336): the database freezes the role of a
# suspended account; an admin must reactivate it first.
_SUSPENDED_ROLE_CHANGE_CODE = "account_suspended_role_change"
_SUSPENDED_ROLE_CHANGE_MESSAGE = (
    "Không thể đổi vai trò của tài khoản đang bị tạm khóa. "
    "Hãy mở khóa tài khoản trước, rồi đổi vai trò."
)


def _is_suspended_role_change(exc: Exception) -> bool:
    """Recognize only migration 336's SQLSTATE + exact message."""
    code = getattr(exc, "code", None)
    message = getattr(exc, "message", None)
    if exc.args and isinstance(exc.args[0], dict):
        code = code or exc.args[0].get("code")
        message = message or exc.args[0].get("message")
    return str(code or "") == "P0001" and message == _SUSPENDED_ROLE_CHANGE_CODE


def _suspended_role_change_refusal(exc: Exception) -> HTTPException | None:
    if not _is_suspended_role_change(exc):
        return None
    return HTTPException(
        409, {"code": _SUSPENDED_ROLE_CHANGE_CODE, "message": _SUSPENDED_ROLE_CHANGE_MESSAGE},
    )


@router.patch("/users/{user_id}/role", response_model=UserRoleChangeOut,
              responses=staff_guard.STEP_UP_RESPONSES)
async def admin_set_user_role(
    user_id: str,
    payload: UserRolePayload,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Sprint 12.8 — change a user's role.

    Admin-only. Self-demotion is blocked so an admin can't accidentally
    lock themselves out of the panel. Role values are constrained to a
    small allow-list so a typo doesn't quietly write garbage.

    ADMINAAL2-0032 FR-007: the change goes through ``fn_set_staff_privilege``
    (audited, attributed, 409 ``last_admin``), and a change that removes admin
    or instructor privilege revokes the target's sessions. A revocation
    failure keeps the change and answers ``sessions_revoked: false`` with
    ``revoke_error`` (FR-008). FR-019 (migration 336): a suspended account's
    role change is 409 ``account_suspended_role_change``.
    """
    admin_user = await require_admin(authorization)
    staff_guard.require_recent_mfa(admin_user, authorization)  # FR-020, before any DB call
    role = (payload.role or "").strip().lower()
    if role not in _VALID_ROLES:
        raise HTTPException(
            400,
            f"Invalid role '{clip_user_value(payload.role)}'. Allowed: {sorted(_VALID_ROLES)}",
        )

    admin_id = admin_user.get("id") if isinstance(admin_user, dict) else None
    if admin_id and admin_id == user_id and role != "admin":
        raise HTTPException(400, "Không thể tự hạ quyền admin của chính mình.")
    if admin_id and admin_id == user_id:
        # Keeping one's own admin role is a no-op; the RPC refuses any
        # self-change, so answer it here.
        return {"ok": True, "id": user_id, "role": role, "changed": False,
                "audit_id": None, "sessions_revoked": None, "revoke_error": None}
    try:
        target = str(_uuid.UUID(user_id))
    except ValueError:
        raise HTTPException(404, "User not found") from None

    request_id = current_request_id()
    try:
        change = staff_security.set_staff_privilege(
            supabase_admin, actor_id=admin_id, target_id=target, role=role,
            request_id=request_id, refusal=_suspended_role_change_refusal,
        )
    except staff_security.PrivilegeOutcomeUnknown:
        # The RPC may have committed before its answer was lost (PC-J66 F05):
        # its audit row carries this request's id. Found → carry on as a
        # committed change, so a demotion still revokes; otherwise the 500.
        change = _committed_role_change(target, request_id, role)
        if change is None:
            raise
    sessions_revoked = revoke_error = revoke_audit_id = None
    if change.changed:
        revoke = staff_security.removes_staff_privilege(
            change.before.get("role"), change.after.get("role"))
    else:
        revoke = _demotion_may_be_unrevoked(target, role)
    if revoke:
        # A suspended account's role is frozen (FR-019), so a demotion never
        # bans: the demoted account may sign in again under its new role.
        outcome, revoke_audit_id = await staff_security.revoke_and_record(
            supabase_admin, target_id=target, actor_id=admin_id, ban=False,
            trigger="role_change", engine=_db_engine, auth_admin=None,  # no ban
            request_id=request_id,
        )
        sessions_revoked, revoke_error = outcome.sessions_revoked, outcome.revoke_error
    # Committed: the owner alerts go out after the response (FR-011).
    staff_security.schedule_owner_alerts(background_tasks, _db_engine, change.audit_id, revoke_audit_id)
    return {"ok": True, "id": target, "role": role, "changed": change.changed,
            "audit_id": change.audit_id, "sessions_revoked": sessions_revoked,
            "revoke_error": revoke_error}


def _committed_role_change(target: str, request_id: str | None, role: str):
    """The change to ``role`` this request committed, or None — also when the
    audit or the account is unreadable (logged); the caller then answers the
    RPC's 500 and a repeat finishes the revocation
    (``_demotion_may_be_unrevoked``). The request id can come from the
    client's X-Request-ID, so an older row that shares a replayed id is not
    proof on its own: the row must end at ``role`` and the account's current
    role, read fresh, must be ``role`` too."""
    try:
        change = staff_security.committed_privilege_change(
            supabase_admin, target_id=target, request_id=request_id, event="role_changed")
        if change is None or change.after.get("role") != role:
            return None
        account = staff_security.read_privilege_row(supabase_admin, target)
    except Exception as exc:
        logger.error("[admin] role change outcome lookup failed target=%s: %r", target, exc)
        return None
    if not account or account.get("role") != role:
        return None
    return change


def _demotion_may_be_unrevoked(target: str, role: str) -> bool:
    """A repeat of a demotion revokes again (PC-J66 F05): its first attempt
    may have committed without revoking (answer lost, then a 500), and a
    success of the delete is not audited, so a repeat cannot tell the two
    apart. The delete is idempotent; the account signs in again under its
    current role. True when the newest role change removed staff privilege
    and led to ``role``, or when the audit cannot be read (fail closed)."""
    if role == "admin":
        return False
    try:
        last = staff_security.last_role_change(supabase_admin, target)
    except Exception as exc:
        logger.error("[admin] role history lookup failed target=%s, revoking: %r", target, exc)
        return True
    if not last:
        return False
    before, after = last.get("before") or {}, last.get("after") or {}
    return after.get("role") == role and staff_security.removes_staff_privilege(
        before.get("role"), after.get("role"))


@router.get("/users", response_model=list[AdminUserDirectoryRowOut])
async def list_users(authorization: str | None = Header(default=None)):
    """List all users with today's session count appended."""
    admin = await require_admin(authorization)

    try:
        users_res = (
            supabase_admin.table("users")
            .select("id, email, display_name, created_at, is_active, role")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] list users failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải danh sách users. Vui lòng thử lại.") from None

    users = users_res.data or []
    if test_data_visibility.hide_for(email=admin.get("email"), is_admin=True):
        users = [u for u in users if not test_data_visibility.is_test_email(u.get("email"))]

    # Count today's sessions per user (UTC)
    today_start = (
        datetime.now(timezone.utc)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .isoformat()
    )
    try:
        sessions_today_res = (
            supabase_admin.table("sessions")
            .select("user_id")
            .gte("started_at", today_start)
            .execute()
        )
        today_counts: dict[str, int] = {}
        for s in (sessions_today_res.data or []):
            uid = s["user_id"]
            today_counts[uid] = today_counts.get(uid, 0) + 1
    except Exception:
        today_counts = {}

    for u in users:
        u["sessions_today"] = today_counts.get(u["id"], 0)

    # Class labels per user from the canonical active membership roster. Keep
    # cohort_name as the compatibility primary label; cohort_names is complete.
    cohort_names_by_user: dict[str, list[str]] = {}
    primary_name_by_user: dict[str, str] = {}
    cohort_lookup_failed = False
    user_ids = [u["id"] for u in users]
    if user_ids:
        try:
            srows = (
                supabase_admin.table("students")
                .select("id, user_id, cohort_id")
                .in_("user_id", user_ids)
                .execute()
            ).data or []
            try:
                memberships = active_memberships_for_students(
                    supabase_admin, [s.get("id") for s in srows])
            except Exception as exc:
                cohort_lookup_failed = True
                logger.warning("list_users: membership lookup failed: %s", exc)
                memberships = []
            membership_ids_by_student: dict[str, list[str]] = {}
            for membership in memberships:
                membership_ids_by_student.setdefault(
                    membership["student_id"], []).append(membership["cohort_id"])
            # Rolling/test compatibility: migration 227 backfills every legacy
            # pointer. If a row is absent, retain that visible association.
            for student in srows:
                if not membership_ids_by_student.get(student.get("id")) and student.get("cohort_id"):
                    membership_ids_by_student[student["id"]] = [student["cohort_id"]]
            cohort_ids = list({cid for ids in membership_ids_by_student.values() for cid in ids})
            names: dict[str, str] = {}
            if cohort_ids:
                cr = (
                    supabase_admin.table("cohorts")
                    .select("id, name")
                    .in_("id", cohort_ids)
                    .execute()
                ).data or []
                names = {c["id"]: (c.get("name") or "") for c in cr}
            for s in srows:
                uid = s.get("user_id")
                if not uid:
                    continue
                ids = membership_ids_by_student.get(s.get("id"), [])
                cohort_names_by_user[uid] = sorted(
                    (names[cid] for cid in ids if names.get(cid)), key=str.casefold)
                if s.get("cohort_id") and names.get(s["cohort_id"]):
                    primary_name_by_user[uid] = names[s["cohort_id"]]
                elif cohort_names_by_user[uid]:
                    primary_name_by_user[uid] = cohort_names_by_user[uid][0]
        except Exception as exc:
            cohort_lookup_failed = True
            logger.warning("list_users: cohort lookup failed: %s", exc)

    for u in users:
        u["cohort_name"] = primary_name_by_user.get(u["id"])
        u["cohort_names"] = cohort_names_by_user.get(u["id"], [])
        u["cohort_lookup_failed"] = cohort_lookup_failed

    # Merge access-codes (the merged "Người dùng" tab): each user's LIVE
    # code(s) — code/type/permissions-union/status — via a BATCHED summary
    # (no N+1; honors the #442 used_by fallback + excludes revoked codes).
    # READ-ONLY here: code-wide mutations stay on the "Mã kích hoạt" tab.
    code_summary = get_users_code_summary(user_ids)
    for u in users:
        u["code_summary"] = code_summary.get(
            u["id"],
            {"codes": [], "code_count": 0, "code_type": None,
             "permissions": [], "has_active_code": False},
        )

    return users


@router.get("/test-data/visibility", response_model=AdminTestDataVisibilityOut)
async def get_test_data_visibility(authorization: str | None = Header(default=None)):
    """TASK B2 — lets the admin UI show its "show test data" toggle only where
    staging hiding is active, and report what this request saw."""
    admin = await require_admin(authorization)
    enabled = test_data_visibility.hiding_enabled()
    return {
        "hiding_enabled": enabled,
        "showing_test_data": enabled and not test_data_visibility.hide_for(
            email=admin.get("email"), is_admin=True),
    }


# ── GET /admin/stats ───────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(authorization: str | None = Header(default=None)):
    """Return aggregated platform usage statistics."""
    await require_admin(authorization)

    now   = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week  = today - timedelta(days=today.weekday())   # Monday of current week
    month = today.replace(day=1)

    try:
        all_sessions = (
            supabase_admin.table("sessions")
            .select("started_at, tokens_used, status")
            .execute()
        ).data or []
    except Exception as exc:
        logger.error("[admin] load stats failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải stats. Vui lòng thử lại.") from None

    today_iso = today.isoformat()
    week_iso  = week.isoformat()
    month_iso = month.isoformat()

    def _started_after(s: dict, cutoff: str) -> bool:
        return bool(s.get("started_at") and s["started_at"] >= cutoff)

    sessions_today  = sum(1 for s in all_sessions if _started_after(s, today_iso))
    sessions_week   = sum(1 for s in all_sessions if _started_after(s, week_iso))
    sessions_month  = sum(1 for s in all_sessions if _started_after(s, month_iso))
    sessions_total  = len(all_sessions)
    sessions_done   = sum(1 for s in all_sessions if s.get("status") == "completed")

    tokens_total = sum(
        int(s["tokens_used"])
        for s in all_sessions
        if s.get("tokens_used") is not None
    )

    # Cost estimate: blended ~$8 / 1 M tokens (Claude Sonnet)
    cost_usd = round(tokens_total / 1_000_000 * 8, 4)

    try:
        users_res  = supabase_admin.table("users").select("id").execute()
        total_users = len(users_res.data or [])
    except Exception:
        total_users = 0

    try:
        active_users_res = (
            supabase_admin.table("users")
            .select("id")
            .eq("is_active", True)
            .execute()
        )
        active_users = len(active_users_res.data or [])
    except Exception:
        active_users = 0

    return {
        "sessions_today":     sessions_today,
        "sessions_week":      sessions_week,
        "sessions_month":     sessions_month,
        "sessions_total":     sessions_total,
        "sessions_completed": sessions_done,
        "tokens_total":       tokens_total,
        "cost_usd_estimate":  cost_usd,
        "total_users":        total_users,
        "active_users":       active_users,
    }


async def _refuse_archived_cohort(cohort_id: str | None, *, context: str) -> None:
    """CLASSARCHIVE-0030 FR-002 (W5/W6): no code into an archived class.

    Raises the staff 409 ``cohort_archived`` before anything is written. A legacy
    inactive class (``archived_at IS NULL``) and an unknown id pass; the caller's
    own lookup or FK decides those. A failed class read refuses with a generic
    5xx (never DB text): a gate must not open on a failed read.
    """
    if not cohort_id:
        return
    try:
        accepts = await asyncio.to_thread(
            class_archive_service.cohort_accepts_work, supabase_admin, cohort_id)
    except Exception as exc:
        raise safe_error(exc, error_code="cohort_lookup_failed", context=context) from None
    if not accepts:
        raise class_archive_service.cohort_archived_error()
