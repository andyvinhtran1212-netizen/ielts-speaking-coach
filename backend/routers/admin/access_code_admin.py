"""routers.admin.access_code_admin — access-code patch, revoke, detail, user removal, reassignment, hard delete and audit (BACKENDSPLIT-0076 T009).

Cut and pasted unchanged from the former single-file routers/admin.py. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from database import supabase_admin
from services.class_membership_service import active_memberships_for_students, add_student
from services.student_service import student_archived_error
from services.access_code_gen import (
    generate_access_code, insert_one_with_unique_code, insert_with_unique_codes,
)
from services import staff_guard, staff_security
from services.access_code_permissions import (
    get_completed_session_counts,
    get_users_code_summary,
    validate_permissions_or_raise,
)

from routers.admin import (  # noqa: E402 — defined above this block in the package
    logger,
    router,
    require_admin,
    _actor_id,
    _audit_entitlement,
)
from ._common import (  # noqa: E402
    PatchCodeRequest,
    _validate_code_type_combo,
)
from .users_stats import (  # noqa: E402
    _refuse_archived_cohort,
)


# ── PATCH /admin/access-codes/{code_id} ───────────────────────────────────────

@router.patch("/access-codes/{code_id}")
async def patch_access_code(
    code_id: str,
    body: PatchCodeRequest,
    authorization: str | None = Header(default=None),
):
    """Update permissions on an existing access code."""
    admin = await require_admin(authorization)

    # Sprint 5.2 — same allowlist guard as the generate endpoint.
    if "permissions" in body.model_fields_set and body.permissions is not None:
        try:
            validate_permissions_or_raise(body.permissions)
        except ValueError as e:
            raise HTTPException(400, str(e))

    # Use model_fields_set to distinguish "field omitted" vs "field set to null"
    set_fields = body.model_fields_set
    update: dict = {}
    if "permissions"   in set_fields: update["permissions"]   = body.permissions
    if "session_limit" in set_fields: update["session_limit"] = body.session_limit
    if "expires_at"    in set_fields: update["expires_at"]    = body.expires_at
    if "is_active"     in set_fields: update["is_active"]     = body.is_active
    # Sprint 12.2 — extend PATCH to allow editing code_type + cohort_id + notes.
    if "code_type" in set_fields: update["code_type"] = body.code_type
    if "cohort_id" in set_fields: update["cohort_id"] = body.cohort_id
    if "notes"     in set_fields: update["notes"]     = body.notes

    # If either code_type or cohort_id was touched, re-validate the combo.
    # We need the effective post-update values, so fall back to current row
    # values for whichever side wasn't sent.
    if "code_type" in set_fields or "cohort_id" in set_fields:
        existing = (
            supabase_admin.table("access_codes")
            .select("code_type, cohort_id")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            raise HTTPException(404, "Access code không tồn tại")
        eff_type   = update.get("code_type", existing.data[0].get("code_type") or "mass")
        eff_cohort = update.get("cohort_id", existing.data[0].get("cohort_id"))
        _validate_code_type_combo(eff_type, eff_cohort)
        # CLASSARCHIVE-0030 W6: moving a code INTO an archived class is refused.
        # Re-sending the code's current class (a notes-only edit from the full
        # form) is not a change and stays allowed.
        if eff_cohort and str(eff_cohort) != str(existing.data[0].get("cohort_id") or ""):
            await _refuse_archived_cohort(eff_cohort, context="patch access code")

    if not update:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    # Snapshot the BEFORE-state of ONLY the fields being changed (for the audit
    # diff) — fetched before the write, best-effort.
    before: dict = {}
    try:
        cur = (
            supabase_admin.table("access_codes")
            .select(", ".join(update.keys()))
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
        if cur.data:
            before = {k: cur.data[0].get(k) for k in update}
    except Exception:
        before = {}

    try:
        res = (
            supabase_admin.table("access_codes")
            .update(update)
            .eq("id", code_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] update access code failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi cập nhật access code. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "Access code không tồn tại")

    _audit_entitlement(_actor_id(admin), "edit", code_id, before=before, after=update)
    return res.data[0]


# ── DELETE /admin/access-codes/{code_id} (soft revoke) ────────────────────────

@router.delete("/access-codes/{code_id}", status_code=204)
async def delete_access_code(
    code_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Soft-revoke an access code.

    Blocked if any active user assignments exist — admin must remove all users first.
    Sets is_revoked=true on the code (preserving audit trail).
    """
    admin = await require_admin(authorization)

    # Fetch the code first
    try:
        code_res = (
            supabase_admin.table("access_codes")
            .select("id, code, is_revoked, is_used, used_by")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load access code for revoke failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải access code. Vui lòng thử lại.") from None

    if not code_res.data:
        raise HTTPException(404, "Access code không tồn tại")

    row = code_res.data[0]
    if row.get("is_revoked"):
        return  # already revoked — idempotent

    # ADMINIA-0074 FR-055: a used code (redeemed: is_used / used_by, even with
    # no assignment row left) is revoked only from the code page's danger
    # zone, with step-up, a typed confirmation and a reason.
    if row.get("is_used") or row.get("used_by"):
        raise HTTPException(409, {
            "code": "code_used",
            "message": "Mã đã dùng: thu hồi ở Vùng nguy hiểm của trang mã (cần gõ lại mã và lý do).",
        })

    # Block if active user assignments exist
    try:
        active_res = (
            supabase_admin.table("user_code_assignments")
            .select("id", count="exact")
            .eq("code_id", code_id)
            .eq("is_active", True)
            .execute()
        )
        active_count = active_res.count or 0
    except Exception as exc:
        # C1 (audit 2026-07-03): FAIL-CLOSED. A DB blip here previously set
        # active_count=0, disabling the "can't revoke a code with active users"
        # guard → destructive action on canonical data. Refuse instead.
        logger.warning("delete_access_code: active-assignment count failed code=%s: %s", code_id, exc)
        raise HTTPException(500, "Không kiểm tra được user đang dùng mã — thử lại sau.")

    if active_count > 0:
        raise HTTPException(
            400,
            f"Không thể thu hồi: còn {active_count} user đang dùng mã này. "
            "Hãy gỡ tất cả user khỏi mã trước."
        )

    # Mark code as revoked
    try:
        supabase_admin.table("access_codes").update({"is_revoked": True, "is_active": False}).eq("id", code_id).execute()
    except Exception as exc:
        logger.error("[admin] revoke access code failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi thu hồi access code. Vui lòng thử lại.") from None

    _audit_entitlement(
        _actor_id(admin), "revoke", code_id,
        before={"is_revoked": bool(row.get("is_revoked"))},
        after={"is_revoked": True, "is_active": False},
    )


# ── POST /admin/access-codes/{code_id}/revoke-used ────────────────────────────
# ADMINIA-0074 FR-055: revoking a code that is in use happens only in the code
# page's danger zone. The admin retypes the code and gives a reason; the code
# is revoked in one write (a revoked code grants nothing, see
# services/access_code_permissions.py), assignments and redemption history
# (is_used / used_by / used_at) stay as they are. The reason and the people
# who lose access go to access_code_audit FIRST; the code is revoked only once
# that row exists, so a failed audit leaves the code usable.

REVOKE_REASON_MIN = 10
REVOKE_REASON_MAX = 500


class RevokeUsedCodeRequest(BaseModel):
    confirm_code: str = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=1, max_length=REVOKE_REASON_MAX)


class RevokeUsedCodeOut(BaseModel):
    id: str
    code: str
    is_revoked: bool
    already_revoked: bool
    affected_user_count: int
    audit_recorded: bool


@router.post(
    "/access-codes/{code_id}/revoke-used",
    response_model=RevokeUsedCodeOut,
    responses=staff_guard.STEP_UP_RESPONSES,
)
async def revoke_used_access_code(
    code_id: str,
    body: RevokeUsedCodeRequest,
    authorization: str | None = Header(default=None),
):
    """Revoke an access code that people are using, with a typed confirmation
    and a required reason (ADMINIA-0074 FR-055). Idempotent on a revoked code."""
    admin = await require_admin(authorization)
    staff_guard.require_recent_mfa(admin, authorization)  # FR-020, before any DB call

    reason = body.reason.strip()
    if len(reason) < REVOKE_REASON_MIN:
        raise HTTPException(422, {
            "code": "reason_too_short",
            "message": f"Lý do cần ít nhất {REVOKE_REASON_MIN} ký tự.",
        })

    try:
        code_res = await asyncio.to_thread(
            lambda: supabase_admin.table("access_codes")
            .select("id, code, is_revoked, is_active, used_by")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load access code for revoke-used failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải mã kích hoạt. Vui lòng thử lại.") from None
    if not code_res.data:
        raise HTTPException(404, "Mã kích hoạt không tồn tại")
    row = code_res.data[0]
    code_value = str(row.get("code") or "")

    if body.confirm_code.strip().upper() != code_value.strip().upper():
        raise HTTPException(422, {
            "code": "confirm_code_mismatch",
            "message": "Mã gõ lại không khớp. Hãy gõ đúng mã cần thu hồi.",
        })

    if row.get("is_revoked"):
        # A replay never claims an audit row it has not seen.
        return {
            "id": row["id"], "code": code_value, "is_revoked": True,
            "already_revoked": True, "affected_user_count": 0,
            "audit_recorded": await _revoke_audit_exists(code_id),
        }

    # Fail closed: the count goes into the audit and the confirmation the
    # admin reads, so a lookup error must not become "0 people affected".
    # Who loses access mirrors services/access_code_permissions._active_code_rows:
    # every active assignment, plus the legacy `used_by` redeemer when that
    # user has no assignment row at all for this code.
    try:
        rows_res = await asyncio.to_thread(
            lambda: supabase_admin.table("user_code_assignments")
            .select("user_id, is_active")
            .eq("code_id", code_id)
            .execute()
        )
        affected = _revoke_access_holders(row, rows_res.data or [])
    except Exception as exc:
        logger.warning("revoke_used_access_code: active-assignment lookup failed code=%s: %s", code_id, exc)
        raise HTTPException(500, "Không kiểm tra được ai đang dùng mã — thử lại sau.") from None

    # The reason is written BEFORE the revoke: if the audit insert fails, the
    # code stays usable and nobody loses access without a recorded reason.
    try:
        audit_row = {
            "actor_user_id": _actor_id(admin),
            "action": "revoke",
            "code_id": code_id,
            "target_user_id": None,
            "before": {"is_revoked": False, "is_active": bool(row.get("is_active"))},
            "after": {
                "is_revoked": True, "is_active": False,
                "reason": reason, "affected_user_ids": affected,
                "source": "danger_zone",
            },
        }
        audit_res = await asyncio.to_thread(
            lambda: supabase_admin.table("access_code_audit").insert(audit_row).execute()
        )
    except Exception as exc:
        logger.error("access_code_audit insert failed (revoke-used code=%s): %s", code_id, exc)
        audit_res = None
    if audit_res is None or not getattr(audit_res, "data", None):
        raise HTTPException(500, {
            "code": "audit_not_recorded",
            "message": "Không ghi được lý do thu hồi nên mã CHƯA bị thu hồi. Thử lại sau.",
        })

    try:
        upd = await asyncio.to_thread(
            lambda: supabase_admin.table("access_codes")
            .update({"is_revoked": True, "is_active": False})
            .eq("id", code_id)
            .eq("is_revoked", False)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] revoke-used access code failed after audit (code=%s): %s", code_id, exc, exc_info=True)
        raise HTTPException(500, {
            "code": "revoke_failed",
            "message": "Đã ghi lý do nhưng thu hồi mã bị lỗi; mã có thể vẫn dùng được. Tải lại trang để xem trạng thái thật.",
        }) from None
    if not upd.data:
        # Another admin revoked it between the read and the write; their
        # request wrote its own audit row, and this one wrote ours.
        return {
            "id": row["id"], "code": code_value, "is_revoked": True,
            "already_revoked": True, "affected_user_count": 0, "audit_recorded": True,
        }

    return {
        "id": row["id"], "code": code_value, "is_revoked": True,
        "already_revoked": False, "affected_user_count": len(affected),
        "audit_recorded": True,
    }


def _revoke_access_holders(code_row: dict, assignment_rows: list[dict]) -> list[str]:
    """Who loses access when this code is revoked, sorted. Mirrors
    services/access_code_permissions._active_code_rows: every active
    assignment, plus the legacy `used_by` redeemer when that user has no
    assignment row at all for the code (an inactive row is a deliberate
    removal and does not re-grant). The code page shows this same list."""
    rows = [r for r in assignment_rows if r.get("user_id")]
    holders = {str(r["user_id"]) for r in rows if r.get("is_active")}
    legacy_user = str(code_row.get("used_by") or "")
    if legacy_user and legacy_user not in {str(r["user_id"]) for r in rows}:
        holders.add(legacy_user)
    return sorted(holders)


async def _revoke_audit_exists(code_id: str) -> bool:
    """Whether access_code_audit holds a revoke row for this code. A lookup
    error answers False: the response must not claim a record it cannot see."""
    try:
        res = await asyncio.to_thread(
            lambda: supabase_admin.table("access_code_audit")
            .select("id")
            .eq("code_id", code_id)
            .eq("action", "revoke")
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception as exc:
        logger.warning("revoke_used_access_code: audit lookup failed code=%s: %s", code_id, exc)
        return False


# ── GET /admin/access-codes/{code_id} ─────────────────────────────────────────

@router.get("/access-codes/{code_id}")
async def get_access_code_detail(
    code_id: str,
    authorization: str | None = Header(default=None),
):
    """Return code metadata + list of assigned users."""
    await require_admin(authorization)

    try:
        code_res = (
            supabase_admin.table("access_codes")
            .select("id, code, is_used, is_revoked, is_active, used_by, used_at, created_at, permissions, session_limit, expires_at, code_type, cohort_id, notes")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load access code detail failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải access code. Vui lòng thử lại.") from None

    if not code_res.data:
        raise HTTPException(404, "Access code không tồn tại")

    code = code_res.data[0]

    # Fetch assignments
    association_lookup_failed = False
    try:
        asgn_res = (
            supabase_admin.table("user_code_assignments")
            .select("id, user_id, assigned_at, is_active")
            .eq("code_id", code_id)
            .order("assigned_at", desc=True)
            .execute()
        )
        assignments = asgn_res.data or []
    except Exception as exc:
        # Do NOT swallow silently: a DB blip here is indistinguishable from
        # "no assignment rows", and the legacy fallback below would then show
        # non-canonical ownership for a code that actually HAS an active user.
        # Log it and flag it (mirrors the list endpoint's association_lookup_failed).
        logger.warning(
            "get_access_code_detail: assignment lookup failed code=%s: %s", code_id, exc
        )
        assignments = []
        association_lookup_failed = True

    # Fallback: if no ACTIVE assignment rows exist but access_codes.used_by is set,
    # synthesize a read-only entry — covers both legacy codes (no rows ever) and codes
    # where the only assignment was deactivated by remove-user.
    # Guard on `not association_lookup_failed`: only synthesize when the lookup
    # SUCCEEDED and genuinely returned no active rows — never when it errored.
    # FR-055: the danger zone names exactly the people the revoke counts.
    access_holder_ids = None if association_lookup_failed else _revoke_access_holders(code, assignments)

    has_active = any(a.get("is_active") for a in assignments)
    if not association_lookup_failed and not has_active and code.get("used_by"):
        assignments = [{
            "id":                  None,
            "user_id":             code["used_by"],
            "assigned_at":         code.get("used_at"),
            # Mục 13 (B5): this branch fires precisely because there is NO active
            # assignment row — so the synthesized entry must NOT claim is_active=True
            # (DB truth). The redeemer is still identifiable via is_fallback_used_by.
            "is_active":           False,
            "is_fallback_used_by": True,
            "removable":           False,
        }]
    else:
        # Real rows: mark as removable when active, not a fallback.
        for a in assignments:
            a.setdefault("is_fallback_used_by", False)
            a.setdefault("removable", bool(a.get("is_active")))

    # Enrich assignments with user name/email in a single lookup.
    user_ids = list({a["user_id"] for a in assignments} | set(access_holder_ids or []))
    user_map: dict[str, dict] = {}
    if user_ids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email, display_name")
                .in_("id", user_ids)
                .execute()
            )
            for u in (ur.data or []):
                user_map[u["id"]] = {
                    "email":        u.get("email") or "",
                    "display_name": u.get("display_name") or "",
                }
        except Exception as exc:
            logger.warning("get_access_code_detail: user lookup failed: %s", exc)

    for a in assignments:
        info = user_map.get(a["user_id"], {})
        a["email"]        = info.get("email", "")
        a["display_name"] = info.get("display_name", "")

    code["assignments"] = assignments
    code["association_lookup_failed"] = association_lookup_failed
    code["access_holders"] = None if access_holder_ids is None else [
        {"user_id": uid, **user_map.get(uid, {"email": "", "display_name": ""})}
        for uid in access_holder_ids
    ]
    return code


# ── DELETE /admin/access-codes/{code_id}/users/{user_id} ──────────────────────

@router.delete("/access-codes/{code_id}/users/{user_id}", status_code=204)
async def remove_user_from_code(
    code_id: str,
    user_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Deactivate a user's assignment to a code.
    Never deletes session history. Does NOT deactivate the user account.
    """
    admin = await require_admin(authorization)

    try:
        res = (
            supabase_admin.table("user_code_assignments")
            .update({"is_active": False})
            .eq("code_id", code_id)
            .eq("user_id", user_id)
            .eq("is_active", True)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] remove user from code failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi gỡ user khỏi code. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "Không tìm thấy assignment này")
    # access_codes.used_by / used_at / is_used are intentionally NOT cleared here.
    # Redemption history must remain immutable so the code cannot be reused.
    _audit_entitlement(
        _actor_id(admin), "remove_user", code_id,
        target_user_id=user_id,
        before={"is_active": True}, after={"is_active": False},
    )


# ── Sprint 17.5 — reassignment / refill (Direction E) ────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _assign_user_to_code(code_id: str, user_id: str, admin_id: str | None, reason: str | None) -> None:
    """Upsert an ACTIVE user_code_assignment with audit. Mirrors the activation
    upsert (on_conflict user_id,code_id) so re-activating a prior inactive row works."""
    supabase_admin.table("user_code_assignments").upsert({
        "user_id":     user_id,
        "code_id":     code_id,
        "is_active":   True,
        "assigned_at": _now_iso(),
        "assigned_by": admin_id,
        "reason":      reason,
        "revoked_at":  None,
    }, on_conflict="user_id,code_id").execute()


def _issue_code_and_assign(*, user_id: str, admin_id: str | None, reason: str | None,
                           code_type: str = "direct", cohort_id: str | None = None,
                           permissions: list | None = None, session_limit=None,
                           expires_at=None) -> dict:
    """Create a fresh access code (claimed by user_id) + an active assignment with
    audit. Returns the new code row. Sets is_used/used_by/used_at AT ISSUANCE (the
    code's initial state) — this is the first write, not a mutation of a used code."""
    row = {
        "is_used":     True,
        "used_by":     user_id,
        "used_at":     _now_iso(),
        "is_active":   True,
        "permissions": permissions or ["all"],
        "code_type":   code_type,
        "cohort_id":   cohort_id,
    }
    if session_limit is not None:
        row["session_limit"] = session_limit
    if expires_at is not None:
        row["expires_at"] = expires_at
    res, code = insert_one_with_unique_code(lambda: supabase_admin.table("access_codes"), row)
    new_code = (res.data or [{**row, "code": code}])[0]
    _assign_user_to_code(new_code["id"], user_id, admin_id, reason)
    return new_code


def _activate_user_for_code(user_id: str, code: str | None, permissions) -> None:
    """Admin-granted access == activation (W-03). Login and the learner gate
    read users.is_active independently of code entitlements, so every admin
    path that hands a user an ACTIVE code assignment activates the account the
    way self-service /auth/activate does: is_active + the access_code_used /
    permissions snapshot. Never changes role or onboarding. Raises 404 when the
    user row does not exist."""
    try:
        activated = (
            supabase_admin.table("users").update({
                "is_active": True,
                "access_code_used": code,
                "permissions": permissions,
            }).eq("id", user_id).execute()
        )
    except Exception as exc:
        # ADMINAAL2-0032 FR-018: migration 332 refuses to activate a suspended
        # account; only PATCH /admin/users/{id}/active reactivates it.
        if staff_security.is_account_suspended_error(exc):
            raise staff_security.account_suspended_exception(409) from None
        raise
    if not activated.data:
        raise HTTPException(404, "Không tìm thấy người dùng để kích hoạt")


def _activate_with_issued_code(user_id: str, new_code: dict) -> None:
    """Activate the holder of a code `_issue_code_and_assign` just minted; on
    failure, revoke that issuance (generate-and-assign, refill, cohort add)."""
    # Login gates on users.is_active, independently of code entitlements. Match
    # self-service activation so an admin-assigned learner can sign in without
    # entering the already-claimed code. Never change their role or onboarding.
    try:
        _activate_user_for_code(user_id, new_code["code"], new_code["permissions"])
    except Exception:
        # Compensate this issuance only: a failed activation must not leave a
        # live grant that a retry could duplicate. Revoke the code first so
        # even a later assignment-cleanup failure cannot keep granting access.
        # Retain its immutable redemption history instead of deleting records.
        supabase_admin.table("access_codes").update({
            "is_revoked": True, "is_active": False,
        }).eq("id", new_code["id"]).eq("used_by", user_id).execute()
        supabase_admin.table("user_code_assignments").update({
            "is_active": False, "revoked_at": _now_iso(),
        }).eq("code_id", new_code["id"]).eq("user_id", user_id).execute()
        raise


class ReassignRequest(BaseModel):
    from_user_id: str
    to_user_id: str
    reason: str | None = None


class RefillRequest(BaseModel):
    to_user_id: str | None = None   # default: the code's current redeemer (used_by)
    reason: str | None = None


@router.post("/access-codes/{code_id}/reassign")
async def reassign_code(code_id: str, body: ReassignRequest,
                        authorization: str | None = Header(default=None)):
    """Transfer a code from one user to another. Activates the target FIRST, then
    deactivates the source (the SDK has no multi-statement transaction, so this
    ordering means the target never loses access on a partial failure). NEVER
    touches is_used/used_by/used_at (immutability)."""
    admin = await require_admin(authorization)
    admin_id = admin.get("id") if isinstance(admin, dict) else None
    if body.from_user_id == body.to_user_id:
        raise HTTPException(400, "Người nhận trùng với người hiện tại.")

    code = (
        supabase_admin.table("access_codes").select("id, code, permissions, is_revoked")
        .eq("id", code_id).limit(1).execute().data
    ) or []
    if not code:
        raise HTTPException(404, "Mã không tồn tại")
    if code[0].get("is_revoked"):
        raise HTTPException(400, "Mã đã bị thu hồi")

    existing = (
        supabase_admin.table("user_code_assignments").select("id")
        .eq("code_id", code_id).eq("user_id", body.from_user_id).eq("is_active", True).execute().data
    ) or []
    if not existing:
        raise HTTPException(404, "Người dùng nguồn không có assignment đang hoạt động cho mã này")

    target_held = (
        supabase_admin.table("user_code_assignments").select("id")
        .eq("code_id", code_id).eq("user_id", body.to_user_id).eq("is_active", True).execute().data
    ) or []
    _assign_user_to_code(code_id, body.to_user_id, admin_id, body.reason)   # activate target first
    # W-03 — the transferred grant must be usable: activate the target account
    # like generate-and-assign. On failure undo ONLY the grant this call added
    # (never one the target already held) and leave the source untouched.
    try:
        _activate_user_for_code(body.to_user_id, code[0].get("code"), code[0].get("permissions"))
    except Exception:
        if not target_held:
            supabase_admin.table("user_code_assignments").update({
                "is_active": False, "revoked_at": _now_iso(),
            }).eq("code_id", code_id).eq("user_id", body.to_user_id).execute()
        raise
    supabase_admin.table("user_code_assignments").update({
        "is_active": False, "revoked_at": _now_iso(), "assigned_by": admin_id, "reason": body.reason,
    }).eq("code_id", code_id).eq("user_id", body.from_user_id).eq("is_active", True).execute()

    _audit_entitlement(
        admin_id, "reassign", code_id,
        target_user_id=body.to_user_id,
        before={"assigned_user": body.from_user_id},
        after={"assigned_user": body.to_user_id},
    )
    return {"ok": True, "code_id": code_id,
            "from_user_id": body.from_user_id, "to_user_id": body.to_user_id}


@router.post("/access-codes/{code_id}/refill")
async def refill_code(code_id: str, body: RefillRequest,
                      authorization: str | None = Header(default=None)):
    """Refill (e-new): issue a NEW code mirroring the source (type/perms/cohort/
    limit) and assign it to the user — the source's redeemer by default. The old
    code is left untouched (history preserved). Refill-as-quota-bump is the
    existing PATCH /admin/access-codes/{id} instead (no new code)."""
    admin = await require_admin(authorization)
    admin_id = admin.get("id") if isinstance(admin, dict) else None

    src = (supabase_admin.table("access_codes").select("*").eq("id", code_id).limit(1).execute().data) or []
    if not src:
        raise HTTPException(404, "Mã không tồn tại")
    src = src[0]
    target = body.to_user_id or src.get("used_by")
    if not target:
        raise HTTPException(400, "Không xác định được người dùng để cấp mã mới.")
    # CLASSARCHIVE-0030 W6: a refill mints a new code into the source's class.
    await _refuse_archived_cohort(src.get("cohort_id"), context="refill code")

    new_code = _issue_code_and_assign(
        user_id=target, admin_id=admin_id, reason=body.reason,
        code_type=src.get("code_type") or "direct", cohort_id=src.get("cohort_id"),
        permissions=src.get("permissions"), session_limit=src.get("session_limit"),
        expires_at=src.get("expires_at"),
    )
    _activate_with_issued_code(target, new_code)   # W-03 — usable grant (may be a new user)
    # Audit both the refill on the source code and the creation of the new code.
    _audit_entitlement(
        admin_id, "refill", code_id, target_user_id=target,
        after={"new_code_id": new_code.get("id"), "new_code": new_code.get("code")},
    )
    _audit_entitlement(
        admin_id, "create", new_code.get("id"), target_user_id=target,
        after={"permissions": new_code.get("permissions"),
               "session_limit": new_code.get("session_limit"),
               "via": "refill", "source_code_id": code_id},
    )
    return {"ok": True, "user_id": target,
            "new_code": new_code.get("code"), "new_code_id": new_code.get("id")}


class GenerateAndAssignRequest(BaseModel):
    user_id:       str
    permissions:   list[str]  = Field(default=["all"], description="Quyền cấp cho mã")
    session_limit: int | None = Field(default=None, ge=1, description="Giới hạn sessions (null = không giới hạn)")
    expires_at:    str | None = Field(default=None, description="Ngày hết hạn ISO 8601 (null = không hết hạn)")
    code_type:     str        = Field(default="mass", description='"mass" | "direct" | "staff"')
    cohort_id:     str | None = Field(default=None, description="UUID lớp (bắt buộc khi code_type='direct')")


@router.post("/access-codes/generate-and-assign")
async def generate_and_assign_code(
    body: GenerateAndAssignRequest,
    authorization: str | None = Header(default=None),
):
    """Admin-side activation: create ONE fresh code dedicated to a single user and
    immediately assign it — onboards an existing account that has no active code
    WITHOUT the student having to enter a code. Reuses `_issue_code_and_assign`
    (the same activation core as /refill): it sets is_used/used_by/used_at AT
    ISSUANCE (first write on a brand-new code, NOT a mutation of a used code) and
    upserts an active user_code_assignment, so the immutability invariant and the
    code-derived entitlement both stay canonical."""
    admin = await require_admin(authorization)
    actor = _actor_id(admin)

    # Same validation as POST /generate so the combos can't drift.
    try:
        validate_permissions_or_raise(body.permissions)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _validate_code_type_combo(body.code_type, body.cohort_id)

    # Target must be a real user row.
    target = (
        supabase_admin.table("users").select("id").eq("id", body.user_id).limit(1).execute().data
    ) or []
    if not target:
        raise HTTPException(404, "Không tìm thấy người dùng")

    # STUDENTARCHIVE-0029: resolve the class bridge's roster row BEFORE minting.
    # An archived profile cannot rejoin a class (migration 326 guard), so refuse
    # with 409 and mint no code instead of issuing it and logging a warning.
    bridge_student_id: str | None = None
    if body.cohort_id:
        linked = (
            supabase_admin.table("students").select("id, archived_at")
            .eq("user_id", body.user_id).limit(20).execute().data
        ) or []
        active = [row for row in linked if not row.get("archived_at")]
        if linked and not active:
            raise student_archived_error([row["id"] for row in linked if row.get("id")])
        bridge_student_id = active[0]["id"] if active else None
        # CLASSARCHIVE-0030 W6, after the 0029 check (student_archived first).
        await _refuse_archived_cohort(body.cohort_id, context="generate-and-assign")

    new_code = _issue_code_and_assign(
        user_id=body.user_id, admin_id=actor, reason="admin tạo + gán trực tiếp",
        code_type=body.code_type, cohort_id=body.cohort_id,
        permissions=body.permissions, session_limit=body.session_limit,
        expires_at=body.expires_at,
    )

    _activate_with_issued_code(body.user_id, new_code)

    # A direct cohort-linked code adds that class membership without revoking
    # any class the learner already attends. Entitlement remains independent.
    if body.cohort_id and bridge_student_id:
        try:
            add_student(
                supabase_admin, student_id=bridge_student_id,
                cohort_id=body.cohort_id, added_by=actor,
            )
        except Exception as e:
            logger.warning(
                "[admin] cohort bridge failed for user=%s code=%s: %s",
                body.user_id, new_code.get("id"), e,
            )

    _audit_entitlement(
        actor, "create", new_code.get("id"), target_user_id=body.user_id,
        after={"code":          new_code.get("code"),
               "permissions":   new_code.get("permissions"),
               "session_limit": new_code.get("session_limit"),
               "code_type":     body.code_type,
               "cohort_id":     body.cohort_id,
               "via":           "generate-and-assign"},
    )
    return {"ok": True, "user_id": body.user_id,
            "code": new_code.get("code"), "code_id": new_code.get("id")}


# ── DELETE /admin/access-codes/{code_id}/remove (hard delete) ─────────────────

@router.delete("/access-codes/{code_id}/remove", status_code=204)
async def hard_delete_access_code(
    code_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Hard-delete an access code from the database.
    Blocked if any active user assignments exist.
    Cascades to delete all assignments for this code first (since no active ones exist).
    """
    admin = await require_admin(authorization)

    # Verify code exists (and snapshot a little config for the audit before-state)
    try:
        code_res = (
            supabase_admin.table("access_codes")
            .select("id, code, permissions, session_limit")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load access code for hard delete failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải access code. Vui lòng thử lại.") from None

    if not code_res.data:
        raise HTTPException(404, "Access code không tồn tại")

    # Block if active assignments exist
    try:
        active_res = (
            supabase_admin.table("user_code_assignments")
            .select("id", count="exact")
            .eq("code_id", code_id)
            .eq("is_active", True)
            .execute()
        )
        active_count = active_res.count or 0
    except Exception as exc:
        # C1 (audit 2026-07-03): FAIL-CLOSED on a hard-delete. A DB blip must
        # NOT collapse the "code still has active users" guard and let a code in
        # use be destroyed. Refuse the delete.
        logger.warning("hard_delete_access_code: active-assignment count failed code=%s: %s", code_id, exc)
        raise HTTPException(500, "Không kiểm tra được user đang dùng mã — thử lại sau.")

    if active_count > 0:
        raise HTTPException(
            400,
            f"Không thể xóa: còn {active_count} user đang dùng mã này. "
            "Hãy gỡ tất cả user khỏi mã trước (trong Chi tiết → Gỡ khỏi code)."
        )

    # Delete all (inactive) assignments first. Do NOT swallow silently: if this
    # fails we must not proceed to delete the code and leave orphaned rows.
    try:
        supabase_admin.table("user_code_assignments").delete().eq("code_id", code_id).execute()
    except Exception as exc:
        logger.warning("hard_delete_access_code: assignment cleanup failed code=%s: %s", code_id, exc)
        raise HTTPException(500, "Không xóa được assignment của mã — hủy thao tác xóa để tránh dữ liệu mồ côi.")

    # Hard-delete the code
    try:
        supabase_admin.table("access_codes").delete().eq("id", code_id).execute()
    except Exception as exc:
        logger.error("[admin] hard delete access code failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi xóa access code. Vui lòng thử lại.") from None

    # The audit row OUTLIVES the code (code_id has no FK), so the deletion is
    # recorded with what was removed.
    _snap = code_res.data[0]
    _audit_entitlement(
        _actor_id(admin), "hard_delete", code_id,
        before={"code": _snap.get("code"), "permissions": _snap.get("permissions"),
                "session_limit": _snap.get("session_limit")},
        after=None,
    )


# ── GET /admin/access-codes/{code_id}/audit ──────────────────────────────────

@router.get("/access-codes/{code_id}/audit")
async def get_access_code_audit(
    code_id: str,
    authorization: str | None = Header(default=None),
):
    """Read-only entitlement-edit history for one code (admin), newest first.
    Records who changed what and when: create / edit / revoke / remove_user /
    reassign / refill / hard_delete."""
    await require_admin(authorization)
    try:
        res = (
            supabase_admin.table("access_code_audit")
            .select("id, actor_user_id, action, code_id, target_user_id, before, after, created_at")
            .eq("code_id", code_id)
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load access code audit failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải lịch sử chỉnh sửa. Vui lòng thử lại.") from None
    return res.data or []
