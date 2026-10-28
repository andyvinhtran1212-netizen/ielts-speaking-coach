"""routers/admin_staff_security.py — ADMINAAL2-0032 T006 staff security routes.

  GET   /admin/mfa/status                      caller's own AAL state (FR-004; the
                                               only route an AAL1 admin may call)
  PATCH /admin/users/{user_id}/active          suspend / reactivate staff (FR-006)
  POST  /admin/users/{user_id}/revoke-sessions retry a revocation (FR-008)
  GET   /admin/users/{user_id}/security-audit  "Lịch sử quyền" (FR-015)

``PATCH /admin/users/{user_id}/role`` stays in routers/admin.py and delegates
to the same service (FR-007). The database rules live in migration 332's
``fn_set_staff_privilege``; see services/staff_security.py.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Header, HTTPException, Query

import routers.admin as admin_module
from models.staff_security import (
    AdminMfaStatusOut,
    RevokeSessionsIn,
    RevokeSessionsOut,
    SecurityAuditOut,
    StaffActiveIn,
    StaffActiveOut,
)
from routers.admin import require_admin
from services import staff_guard, staff_security
from services.request_context import current_request_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _target_id(user_id: str) -> str:
    """A path id that is not a UUID names no user."""
    try:
        return str(uuid.UUID(user_id))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(404, "User not found") from None


# Read at call time so tests can patch routers.admin's client and engine.
def _db():
    return admin_module.supabase_admin


def _auth_admin():
    return admin_module.supabase_admin.auth.admin


@router.get("/mfa/status", response_model=AdminMfaStatusOut)
async def admin_mfa_status(authorization: str | None = Header(default=None)):
    """The caller's own second-factor state. Requires role admin and an active
    account, but accepts an AAL1 session so the MFA page can enroll or
    challenge (FR-004). Returns no other user's or domain data."""
    admin = await require_admin(authorization, allow_aal1=True)
    assurance = staff_guard.evaluate_admin_assurance(admin, authorization)
    return {
        "aal": assurance.aal,
        "enforce": staff_guard.enforcement_enabled(),
        "verified_factor_count": assurance.verified_factor_count,
        "next_step": assurance.next_step,
    }


@router.patch("/users/{user_id}/active", response_model=StaffActiveOut)
async def admin_set_staff_active(
    user_id: str,
    payload: StaffActiveIn,
    authorization: str | None = Header(default=None),
):
    """Suspend (``is_active: false``) or reactivate an admin or instructor.

    Suspension sets the durable marker, then bans sign-in and revokes every
    session. A revocation failure keeps the suspension and answers
    ``sessions_revoked: false`` with ``revoke_error`` (retry with
    ``POST …/revoke-sessions``). Reactivation clears the marker and lifts the
    ban; ``sign_in_restored: false`` means repeat this request. A repeat of the
    same request writes no second audit row.
    """
    admin = await require_admin(authorization)
    target = _target_id(user_id)
    actor = _actor(admin)
    if actor == target:
        raise HTTPException(400, "Không thể tự khóa tài khoản của chính mình.")

    db = _db()
    request_id = current_request_id()
    change = staff_security.set_staff_privilege(
        db, actor_id=actor, target_id=target, is_active=payload.is_active,
        reason=payload.reason.strip(), request_id=request_id,
    )

    sessions_revoked = revoke_error = sign_in_restored = None
    if change.suspended:
        # Also on a repeat: the revocation is idempotent and a repeat is how
        # a caller re-asserts the suspension's ban (research.md §9.2).
        outcome, _ = await staff_security.revoke_and_record(
            db, target_id=target, actor_id=actor, ban=True, trigger="suspend",
            engine=admin_module._db_engine, auth_admin=_auth_admin(),
            reason=payload.reason.strip(), request_id=request_id,
        )
        sessions_revoked, revoke_error = outcome.sessions_revoked, outcome.revoke_error
    elif payload.is_active:
        sign_in_restored = staff_security.restore_sign_in(_auth_admin(), target)

    after = change.after or {}
    return {
        "ok": True,
        "id": target,
        "is_active": bool(after.get("is_active")),
        "suspended_at": after.get("suspended_at"),
        "changed": change.changed,
        "audit_id": change.audit_id,
        "sessions_revoked": sessions_revoked,
        "revoke_error": revoke_error,
        "sign_in_restored": sign_in_restored,
    }


@router.post("/users/{user_id}/revoke-sessions", response_model=RevokeSessionsOut)
async def admin_revoke_staff_sessions(
    user_id: str,
    payload: RevokeSessionsIn | None = None,
    authorization: str | None = Header(default=None),
):
    """Retry a revocation (FR-008). The mode comes from the committed row at
    retry time: ban + delete while the account is suspended, delete only
    otherwise (a demoted or reactivated account is never re-banned). Every
    attempt is audited; a failure also alerts the owner."""
    admin = await require_admin(authorization)
    target = _target_id(user_id)
    actor = _actor(admin)
    db = _db()
    try:
        row = staff_security.read_privilege_row(db, target)
    except Exception as exc:
        logger.error("[staff_security] target read failed target=%s: %r", target, exc)
        raise HTTPException(
            503, {"error_code": "lookup_failed", "message": "Không đọc được tài khoản. Vui lòng thử lại."},
        ) from None
    if row is None:
        raise HTTPException(404, "User not found")

    reason = ((payload.reason or "").strip() or None) if payload else None
    outcome, audit_id = await staff_security.revoke_and_record(
        db, target_id=target, actor_id=actor, ban=bool(row.get("suspended_at")),
        trigger="retry", engine=admin_module._db_engine, auth_admin=_auth_admin(),
        reason=reason, request_id=current_request_id(), record_success=True,
    )
    return {
        "ok": outcome.sessions_revoked,
        "sessions_revoked": outcome.sessions_revoked,
        "revoke_error": outcome.revoke_error,
        "audit_id": audit_id,
    }


@router.get("/users/{user_id}/security-audit", response_model=SecurityAuditOut)
async def admin_staff_security_audit(
    user_id: str,
    limit: int = Query(50, ge=1, le=200),
    authorization: str | None = Header(default=None),
):
    """The user's privilege and security history, newest first, with the
    owner-alert delivery status (FR-015). A lookup failure is a 503, never an
    empty list."""
    await require_admin(authorization)
    target = _target_id(user_id)
    try:
        rows = staff_security.security_history(_db(), target, limit=limit)
    except Exception as exc:
        logger.error("[staff_security] history read failed target=%s: %r", target, exc)
        # A 5xx detail keeps its shape only with ``error_code`` (services/errors.py).
        raise HTTPException(
            503, {"error_code": "lookup_failed", "message": staff_security.HISTORY_LOOKUP_FAILED_MESSAGE},
        ) from None
    return {"rows": rows, "lookup_failed": False}


def _actor(admin: dict) -> str:
    """The acting admin's id from the verified token — never from the body."""
    actor = admin.get("id") if isinstance(admin, dict) else None
    if not actor:
        raise HTTPException(401, "Unauthorized")
    return str(actor)
