"""Response contracts for staff security (ADMINAAL2-0032 T006)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdminMfaStatusOut(_StrictOut):
    """The caller's own second-factor state (FR-004). No other user's data."""
    aal: Literal["aal1", "aal2"]
    enforce: bool
    verified_factor_count: int = Field(ge=0)
    next_step: Literal["none", "enroll", "challenge"]


class StaffActiveIn(BaseModel):
    is_active: bool
    reason: str = Field(min_length=3, max_length=500)


class StaffActiveOut(_StrictOut):
    ok: bool
    id: str
    is_active: bool
    suspended_at: datetime | None = None
    changed: bool
    audit_id: str | None = None
    # null when the change does not revoke (reactivation).
    sessions_revoked: bool | None = None
    revoke_error: str | None = None
    # null when the change does not restore sign-in (suspension).
    sign_in_restored: bool | None = None


class UserRoleChangeOut(_StrictOut):
    ok: bool
    id: str
    role: str
    changed: bool
    audit_id: str | None = None
    # null when the change removes no admin or instructor privilege.
    sessions_revoked: bool | None = None
    revoke_error: str | None = None


class RevokeSessionsIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class RevokeSessionsOut(_StrictOut):
    ok: bool
    sessions_revoked: bool
    revoke_error: str | None = None
    audit_id: str | None = None


class SecurityAuditRowOut(_StrictOut):
    id: str
    occurred_at: datetime
    event: str
    source: str
    actor_user_id: str | None = None
    actor_email: str | None = None
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    reason: str | None = None
    # pending | sent | failed; null when the event sends no owner alert.
    alert_status: Literal["pending", "sent", "failed"] | None = None


class SecurityAuditOut(_StrictOut):
    rows: list[SecurityAuditRowOut]
    lookup_failed: Literal[False] = False
