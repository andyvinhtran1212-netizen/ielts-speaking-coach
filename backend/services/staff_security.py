"""ADMINAAL2-0032 T006 — staff privilege changes, session revocation and the
security history (FR-006, FR-007, FR-008, FR-015, FR-018).

Every role or ``is_active`` change of a staff account goes through the
migration-332 RPC ``fn_set_staff_privilege``. The database owns the rules:
the actor is re-checked under row locks, the last active admin is kept, the
suspension marker is written, and the audit row (plus the owner-alert outbox
row for admin events) is inserted by the users trigger in the same
transaction. This module maps the RPC's P0001 codes to HTTP answers and runs
the steps that live outside the database transaction:

* revocation (research.md §9.2): a suspension bans the GoTrue user first and
  then deletes every ``auth.sessions`` row (refresh tokens cascade); any other
  revocation (demotion, retry of a non-suspended account) deletes sessions
  only. ``service_role`` cannot reach ``auth.sessions``, so the delete runs on
  the backend's direct ``DATABASE_URL`` connection (role ``postgres``);
* reactivation lifts the ban (``ban_duration: "none"``).

The routes hold ``target_lock`` for one target across its database change and
these GoTrue steps, so an overlapping suspension, reactivation or retry on
another worker cannot leave the ban out of step with the committed marker.

A failure of either step never undoes the committed change and is never
silent: the caller reports ``sessions_revoked: false`` / ``sign_in_restored:
false``, and a revocation failure also writes a ``sessions_revoke_failed``
audit row and an owner-alert outbox row (FR-008, FR-011).
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable, Optional

from fastapi import HTTPException
from sqlalchemy import text

logger = logging.getLogger(__name__)

# GoTrue has no "forever"; research.md §9.2 used this value (100 years).
BAN_DURATION = "876000h"
UNBAN_DURATION = "none"

ACCOUNT_SUSPENDED_CODE = "account_suspended"
ACCOUNT_SUSPENDED_MESSAGE = "Tài khoản đang bị tạm khóa — liên hệ admin"
LAST_ADMIN_MESSAGE = "Không thể khóa/hạ quyền admin cuối cùng"
ACTOR_NOT_ADMIN_MESSAGE = "Tài khoản admin của bạn không còn hiệu lực để đổi quyền."
HISTORY_LOOKUP_FAILED_MESSAGE = "⚠ không tải được lịch sử"

# revoke_error codes (FR-008).
REVOKE_BAN_FAILED = "ban_failed"
REVOKE_SESSION_DELETE_FAILED = "session_delete_failed"
REVOKE_UNAVAILABLE = "revocation_unavailable"

STAFF_ROLES = ("admin", "instructor")

TARGET_BUSY_MESSAGE = "Đang có thao tác khác trên tài khoản này. Vui lòng thử lại."
# Waits behind another worker's GoTrue calls; past this the request is a 503.
TARGET_LOCK_TIMEOUT = "15s"


# ── Database error codes ─────────────────────────────────────────────────────

def raised_code(exc: BaseException) -> Optional[str]:
    """The message of a ``RAISE EXCEPTION '<code>' USING ERRCODE = 'P0001'``
    as PostgREST reports it, else None. Migrations 332/336 use the code as the
    whole message, so an exact match is the contract."""
    code = getattr(exc, "code", None)
    message = getattr(exc, "message", None)
    if getattr(exc, "args", None) and isinstance(exc.args[0], dict):
        code = code or exc.args[0].get("code")
        message = message or exc.args[0].get("message")
    if str(code or "") != "P0001" or not isinstance(message, str):
        return None
    return message


def is_account_suspended_error(exc: BaseException) -> bool:
    """Migration 332's suspension guard refused an activation."""
    return raised_code(exc) == ACCOUNT_SUSPENDED_CODE


def account_suspended_exception(status_code: int) -> HTTPException:
    return HTTPException(
        status_code,
        {"code": ACCOUNT_SUSPENDED_CODE, "message": ACCOUNT_SUSPENDED_MESSAGE},
    )


def _rpc_http_error(code: str) -> Optional[HTTPException]:
    if code == "target_not_found":
        return HTTPException(404, "User not found")
    if code == "self_change_forbidden":
        return HTTPException(400, "Không thể tự khóa hoặc đổi quyền tài khoản của chính mình.")
    if code == "target_not_staff":
        return HTTPException(422, "Chỉ tạm khóa hoặc mở khóa được tài khoản admin hoặc giảng viên.")
    if code == "last_admin":
        return HTTPException(409, {"code": "last_admin", "message": LAST_ADMIN_MESSAGE})
    if code == "actor_not_admin":
        return HTTPException(403, {"code": "actor_not_admin", "message": ACTOR_NOT_ADMIN_MESSAGE})
    if code == "invalid_role":
        return HTTPException(400, "Invalid role")
    if code == "invalid_reason":
        return HTTPException(422, "Lý do phải dài 3–500 ký tự.")
    return None


# ── The privilege RPC ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PrivilegeChange:
    changed: bool
    audit_id: Optional[str]
    before: dict
    after: dict

    @property
    def suspended(self) -> bool:
        return bool((self.after or {}).get("suspended_at"))


def set_staff_privilege(
    db: Any,
    *,
    actor_id: str,
    target_id: str,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    reason: Optional[str] = None,
    request_id: Optional[str] = None,
    refusal: Optional[Callable[[BaseException], Optional[HTTPException]]] = None,
) -> PrivilegeChange:
    """Call ``fn_set_staff_privilege``. ``refusal`` (the caller's own mapping,
    e.g. the role route's FR-019 409) is tried first, then the RPC's codes;
    anything else is a 500 that names no database internals."""
    params = {
        "p_actor": actor_id,
        "p_target": target_id,
        "p_role": role,
        "p_is_active": is_active,
        "p_reason": reason,
        "p_request_id": request_id,
    }
    try:
        rows = db.rpc("fn_set_staff_privilege", params).execute().data or []
    except Exception as exc:
        mapped = refusal(exc) if refusal is not None else None
        if mapped is None:
            code = raised_code(exc)
            mapped = _rpc_http_error(code) if code else None
        if mapped is not None:
            raise mapped from None
        logger.error("[staff_security] fn_set_staff_privilege failed target=%s: %r", target_id, exc)
        raise HTTPException(500, "Không đổi được quyền tài khoản. Vui lòng thử lại.") from None
    row = rows[0] if isinstance(rows, list) and rows else (rows if isinstance(rows, dict) else None)
    if not isinstance(row, dict):
        logger.error("[staff_security] fn_set_staff_privilege returned no row target=%s", target_id)
        raise HTTPException(500, "Không đổi được quyền tài khoản. Vui lòng thử lại.")
    audit_id = row.get("audit_id")
    return PrivilegeChange(
        changed=bool(row.get("changed")),
        audit_id=str(audit_id) if audit_id else None,
        before=row.get("before") or {},
        after=row.get("after") or {},
    )


def removes_staff_privilege(before_role: Optional[str], after_role: Optional[str]) -> bool:
    """FR-007: a change that drops admin, or drops instructor without gaining
    admin, revokes the target's sessions."""
    if before_role == "admin":
        return after_role != "admin"
    if before_role == "instructor":
        return after_role not in STAFF_ROLES
    return False


# ── Per-target serialization ─────────────────────────────────────────────────

@asynccontextmanager
async def target_lock(engine: Any, user_id: str) -> AsyncIterator[None]:
    """Serialize suspension, reactivation and revocation retries of one
    account across backend workers (Codex P2 on #1885). The RPC commits on
    its own PostgREST connection, so the ban/unban that follows it is outside
    any row lock: without this, a reactivation could unban and clear the
    marker between a suspension's commit and its ban, which then strands a
    ban on an active account. A transaction advisory lock on the direct
    connection is held until the side effects are done; it is released when
    the connection's transaction ends, also if the worker dies.

    Without ``DATABASE_URL`` there is nothing to lock on (revocation is then
    ``revocation_unavailable`` too); that is logged and the call proceeds.
    Failing to take the lock is a 503 before any change."""
    if engine is None:
        logger.error("[staff_security] no DATABASE_URL: changes to user=%s are not serialized", user_id)
        yield
        return
    busy = HTTPException(503, {"error_code": "target_busy", "message": TARGET_BUSY_MESSAGE})
    try:
        conn = await engine.connect()
    except Exception as exc:
        logger.error("[staff_security] target lock connect failed user=%s: %r", user_id, exc)
        raise busy from None
    try:
        try:
            await conn.begin()
            await conn.execute(text(f"SET LOCAL lock_timeout = '{TARGET_LOCK_TIMEOUT}'"))
            await conn.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                {"key": f"staff-security:{user_id}"},
            )
        except Exception as exc:
            logger.error("[staff_security] target lock failed user=%s: %r", user_id, exc)
            raise busy from None
        yield
    finally:
        try:
            await conn.close()   # rolls the transaction back, releasing the lock
        except Exception as exc:
            logger.warning("[staff_security] target lock release failed user=%s: %r", user_id, exc)


# ── Revocation and sign-in ───────────────────────────────────────────────────

@dataclass(frozen=True)
class RevokeOutcome:
    sessions_revoked: bool
    revoke_error: Optional[str]
    ban: bool


def set_auth_ban(auth_admin: Any, user_id: str, *, banned: bool) -> None:
    """Ban or unban the GoTrue user (raises on failure)."""
    auth_admin.update_user_by_id(
        user_id, {"ban_duration": BAN_DURATION if banned else UNBAN_DURATION},
    )


async def delete_auth_sessions(engine: Any, user_id: str) -> int:
    """Delete every GoTrue session of ``user_id``; refresh tokens cascade.
    Runs on the direct ``postgres`` connection (``service_role`` has no
    privilege on ``auth.sessions``)."""
    async with engine.begin() as conn:
        result = await conn.execute(
            text("DELETE FROM auth.sessions WHERE user_id = CAST(:uid AS uuid)"),
            {"uid": user_id},
        )
    return int(result.rowcount or 0)


async def revoke_sessions(user_id: str, *, ban: bool, engine: Any, auth_admin: Any) -> RevokeOutcome:
    """Suspension (``ban=True``): ban, then delete sessions. Otherwise delete
    sessions only — a demoted account may sign in again under its new role.
    Both steps are idempotent and both are attempted even when the first
    fails; the first failure is the reported ``revoke_error``."""
    error: Optional[str] = None
    if ban:
        try:
            set_auth_ban(auth_admin, user_id, banned=True)
        except Exception as exc:
            logger.error("[staff_security] ban failed user=%s: %r", user_id, exc)
            error = REVOKE_BAN_FAILED
    if engine is None:
        logger.error("[staff_security] session revocation unavailable (no DATABASE_URL) user=%s", user_id)
        error = error or REVOKE_UNAVAILABLE
    else:
        try:
            await delete_auth_sessions(engine, user_id)
        except Exception as exc:
            logger.error("[staff_security] session delete failed user=%s: %r", user_id, exc)
            error = error or REVOKE_SESSION_DELETE_FAILED
    return RevokeOutcome(sessions_revoked=error is None, revoke_error=error, ban=ban)


def restore_sign_in(auth_admin: Any, user_id: str) -> bool:
    """Lift the suspension ban. False (logged) when GoTrue refuses."""
    try:
        set_auth_ban(auth_admin, user_id, banned=False)
        return True
    except Exception as exc:
        logger.error("[staff_security] unban failed user=%s: %r", user_id, exc)
        return False


# ── Revocation audit (FR-008) ────────────────────────────────────────────────

def _emails(db: Any, ids: list[str]) -> dict[str, Optional[str]]:
    ids = sorted({i for i in ids if i})
    if not ids:
        return {}
    rows = db.table("users").select("id, email").in_("id", ids).execute().data or []
    return {str(r.get("id")): r.get("email") for r in rows}


def record_revocation(
    db: Any,
    *,
    target_id: str,
    actor_id: Optional[str],
    outcome: RevokeOutcome,
    trigger: str,
    reason: Optional[str] = None,
    request_id: Optional[str] = None,
) -> Optional[str]:
    """Write a ``sessions_revoked`` / ``sessions_revoke_failed`` audit row.
    A failure also gets an owner-alert outbox row with the same email-safe
    payload shape as migration 332's ``fn_staff_security_record``. Returns
    the audit id, or None when the write itself failed (logged at error)."""
    event = "sessions_revoked" if outcome.sessions_revoked else "sessions_revoke_failed"
    audit_id = str(uuid.uuid4())
    detail = {"trigger": trigger, "ban": outcome.ban}
    if outcome.revoke_error:
        detail["revoke_error"] = outcome.revoke_error
    try:
        db.table("staff_security_audit").insert({
            "id": audit_id,
            "event": event,
            "target_user_id": target_id,
            "actor_user_id": actor_id,
            "source": "admin_api",
            "reason": reason,
            "request_id": request_id,
            "detail": detail,
        }).execute()
    except Exception as exc:
        logger.error("[staff_security] audit write failed event=%s target=%s: %r", event, target_id, exc)
        return None
    if outcome.sessions_revoked:
        return audit_id
    try:
        emails = _emails(db, [target_id, actor_id or ""])
        # Email-safe fields only: no reason text, token or request body.
        payload = {
            "audit_id": audit_id,
            "event": event,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "source": "admin_api",
            "target_user_id": target_id,
            "target_email": emails.get(target_id),
            "actor_user_id": actor_id,
            "actor_email": emails.get(actor_id or ""),
            "before": None,
            "after": None,
            "operator": None,
        }
        db.table("owner_alert_outbox").insert({
            "audit_id": audit_id, "event": event, "payload": payload,
        }).execute()
    except Exception as exc:
        logger.error("[staff_security] alert enqueue failed audit=%s target=%s: %r", audit_id, target_id, exc)
    return audit_id


async def revoke_and_record(
    db: Any,
    *,
    target_id: str,
    actor_id: Optional[str],
    ban: bool,
    trigger: str,
    engine: Any,
    auth_admin: Any,
    reason: Optional[str] = None,
    request_id: Optional[str] = None,
    record_success: bool = False,
) -> tuple[RevokeOutcome, Optional[str]]:
    """Revoke, then audit. A success is audited only when ``record_success``
    (the explicit retry route); a privilege change's own audit row already
    records a successful revocation, so a repeat stays one row (FR-006)."""
    outcome = await revoke_sessions(target_id, ban=ban, engine=engine, auth_admin=auth_admin)
    audit_id = None
    if record_success or not outcome.sessions_revoked:
        audit_id = record_revocation(
            db, target_id=target_id, actor_id=actor_id, outcome=outcome,
            trigger=trigger, reason=reason, request_id=request_id,
        )
    return outcome, audit_id


# ── Reads ────────────────────────────────────────────────────────────────────

def read_privilege_row(db: Any, user_id: str) -> Optional[dict]:
    """``{id, role, is_active, suspended_at}`` or None. Raises on read failure."""
    rows = (
        db.table("users").select("id, role, is_active, suspended_at")
        .eq("id", user_id).limit(1).execute().data or []
    )
    return rows[0] if rows else None


def security_history(db: Any, user_id: str, *, limit: int) -> list[dict]:
    """The target's audit rows newest first, with the actor's email and the
    owner-alert delivery status (FR-015). Raises when any read fails, so the
    caller never shows a partial history as complete."""
    rows = (
        db.table("staff_security_audit")
        .select("id, occurred_at, event, source, actor_user_id, before, after, reason")
        .eq("target_user_id", user_id)
        .order("occurred_at", desc=True)
        .limit(limit)
        .execute().data or []
    )
    if not rows:
        return []
    emails = _emails(db, [str(r.get("actor_user_id") or "") for r in rows])
    audit_ids = [str(r["id"]) for r in rows]
    alerts = (
        db.table("owner_alert_outbox").select("audit_id, status")
        .in_("audit_id", audit_ids).execute().data or []
    )
    status_by_audit = {str(a.get("audit_id")): a.get("status") for a in alerts}
    out = []
    for r in rows:
        actor = str(r.get("actor_user_id") or "") or None
        out.append({
            "id": str(r["id"]),
            "occurred_at": r.get("occurred_at"),
            "event": r.get("event"),
            "source": r.get("source"),
            "actor_user_id": actor,
            "actor_email": emails.get(actor) if actor else None,
            "before": r.get("before"),
            "after": r.get("after"),
            "reason": r.get("reason"),
            "alert_status": status_by_audit.get(str(r["id"])),
        })
    return out
