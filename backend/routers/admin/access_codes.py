"""routers.admin.access_codes — access-code generate/list, usage log, foot-traffic and dashboard reads (BACKENDSPLIT-0076 T009).

Cut and pasted unchanged from the former single-file routers/admin.py. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator
from models.admin_overview import DashboardOverviewOut, DashboardTrendsOut
from database import supabase_admin
from services import admin_dashboard, ai_usage_logger, class_archive_service, test_data_visibility
from services.access_code_gen import (
    generate_access_code, insert_one_with_unique_code, insert_with_unique_codes,
)
from services import staff_guard, staff_security
from services import admin_reading_dashboard
from services.access_code_permissions import (
    get_completed_session_counts,
    get_users_code_summary,
    validate_permissions_or_raise,
)
from services.ai_pricing import effective_logged_cost

from routers.admin import (  # noqa: E402 — defined above this block in the package
    logger,
    router,
    require_admin,
    _actor_id,
    _audit_entitlement,
)
from ._common import (  # noqa: E402
    GenerateCodesRequest,
    _validate_code_type_combo,
)
from .users_stats import (  # noqa: E402
    _refuse_archived_cohort,
)


# ── POST /admin/access-codes/generate ─────────────────────────────────────────

@router.post("/access-codes/generate", responses=staff_guard.STEP_UP_RESPONSES)
async def generate_access_codes(
    body: GenerateCodesRequest,
    authorization: str | None = Header(default=None),
):
    """Generate N new unused access codes and persist them.

    ADMINAAL2-0032 Amendment 2 (FR-020, option c): a code that grants a role
    (normalized ``grants_role`` non-null) needs step-up before any DB call;
    an ordinary code keeps the FR-001 guard only."""
    admin = await require_admin(authorization)
    grants_role = (body.grants_role or "").strip().lower() or None
    if grants_role is not None:
        staff_guard.require_recent_mfa(admin, authorization)  # FR-020, before any DB call

    # Sprint 5.2 — fail loudly on typo'd permission strings instead of
    # silently inserting a code that grants nothing-and-no-one. Allowed
    # values live in services.access_code_permissions.ALLOWED_PERMISSIONS.
    try:
        validate_permissions_or_raise(body.permissions)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Sprint 12.2 — validate code_type ↔ cohort_id combo before insert.
    _validate_code_type_combo(body.code_type, body.cohort_id)
    await _refuse_archived_cohort(body.cohort_id, context="generate access codes")

    # W-2 (Option B) — instructor-promote codes MUST be email-bound (fail-closed
    # at mint time so an unbound instructor code can never auto-promote anyone).
    if grants_role is not None and grants_role != "instructor":
        raise HTTPException(400, "grants_role chỉ nhận null hoặc 'instructor'.")
    intended_email = (body.intended_email or "").strip() or None
    if grants_role == "instructor" and not intended_email:
        raise HTTPException(400, "Mã instructor bắt buộc có intended_email (ràng buộc theo email).")

    row_base: dict = {
        "is_used": False,
        "is_active": True,
        "permissions": body.permissions,
        "code_type": body.code_type,
        "issued_by": _actor_id(admin),          # provenance (mig 106)
    }
    if body.session_limit is not None:
        row_base["session_limit"] = body.session_limit
    if body.expires_at is not None:
        row_base["expires_at"] = body.expires_at
    if body.cohort_id is not None:
        row_base["cohort_id"] = body.cohort_id
    if body.notes is not None:
        row_base["notes"] = body.notes
    if grants_role is not None:
        row_base["grants_role"] = grants_role
    if intended_email is not None:
        row_base["intended_email"] = intended_email
    rows = [dict(row_base) for _ in range(body.count)]

    try:
        result, codes = insert_with_unique_codes(
            lambda: supabase_admin.table("access_codes"), rows,
        )
    except Exception as exc:
        logger.error("[admin] generate access codes failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tạo access codes. Vui lòng thử lại.") from None

    actor = _actor_id(admin)
    for row in (result.data or []):
        _audit_entitlement(actor, "create", row.get("id"), after={
            "code":          row.get("code"),
            "permissions":   row.get("permissions"),
            "session_limit": row.get("session_limit"),
            "expires_at":    row.get("expires_at"),
            "code_type":     row.get("code_type"),
            "cohort_id":     row.get("cohort_id"),
            "grants_role":   row.get("grants_role"),
        })

    return {"created": len(result.data or rows), "codes": codes}


# ── GET /admin/access-codes ────────────────────────────────────────────────────

# ── Typecheck pilot (Step A) — response_model for GET /admin/access-codes ──────
# A concrete output schema so the FE can generate a TypeScript type (via
# openapi-typescript) and tsc catches a BE field rename at the call site. The
# field set MUST be a SUPERSET of every key list_access_codes assembles, or
# response_model SILENTLY STRIPS the missing field from the response (breaking the
# admin page). test_access_codes_response_model.py enforces that superset rule —
# the strip-footgun guard (mirrors the writing_feedback NOT-NULL schema test).
# Appended fields are conditional per branch (assigned_users on the happy/empty
# path, association_lookup_failed only on codes whose lookup batch failed), so
# EVERY appended field is Optional+default — else FastAPI 500s on the branch that
# omits it.

class AccessCodeQuota(BaseModel):
    used: int
    limit: int | None = None
    remaining: int | None = None
    limit_type: str


class AccessCodeAssignedUser(BaseModel):
    user_id: str
    name: str
    email: str
    is_fallback_used_by: bool
    removable: bool
    quota: AccessCodeQuota


class AccessCodeOut(BaseModel):
    # Base columns (the .select() list).
    id: str
    code: str
    is_used: bool | None = None
    is_revoked: bool | None = None
    is_active: bool | None = None
    used_by: str | None = None
    used_at: str | None = None
    created_at: str | None = None
    permissions: Any = None          # JSONB — dict/list/null; intentionally loose
    session_limit: int | None = None
    expires_at: str | None = None
    code_type: str | None = None
    cohort_id: str | None = None
    notes: str | None = None
    # Appended in the route (conditional per branch → all Optional+default).
    assigned_user_count: int | None = None
    assigned_users: list[AccessCodeAssignedUser] = Field(default_factory=list)
    cohort_name: str | None = None
    association_lookup_failed: bool | None = None


# PC-J80: list_access_codes reads EVERY access code, so a single
# `.in_("code_id", code_ids)` grows with the table until PostgREST (or the
# gateway in front of it) rejects the URL with a 400 — which flagged every code
# `association_lookup_failed` on staging. 150 UUIDs keep the generated
# `in.(...)` filter near 5.6 KB. Same reason as _ID_CHUNK in
# services/class_assignment_service.py.
_ACCESS_CODE_ID_CHUNK = 150


def _access_code_id_chunks(ids: list[str]) -> list[list[str]]:
    return [ids[i : i + _ACCESS_CODE_ID_CHUNK]
            for i in range(0, len(ids), _ACCESS_CODE_ID_CHUNK)]


@router.get("/access-codes", response_model=list[AccessCodeOut])
async def list_access_codes(authorization: str | None = Header(default=None)):
    """List all access codes, enriched with assigned user count."""
    await require_admin(authorization)

    try:
        codes_res = (
            supabase_admin.table("access_codes")
            .select(
                "id, code, is_used, is_revoked, is_active, used_by, used_at, "
                "created_at, permissions, session_limit, expires_at, "
                "code_type, cohort_id, notes"
            )
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] list access codes failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải access codes. Vui lòng thử lại.") from None

    codes = codes_res.data or []

    if not codes:
        return codes

    code_ids = [c["id"] for c in codes]

    # Fetch ALL assignments (active + inactive), batched by code id and paged
    # past the ~1000-row response cap; derive count + identity from the active
    # ones, and record every (code_id, user_id) pair so the legacy used_by
    # fallback below can tell a deliberately-removed user (inactive row) apart
    # from a true legacy redeemer (no row at all). A failed batch flags ONLY its
    # own codes `association_lookup_failed` — never a silent "no owner".
    code_user_ids: dict[str, list[str]] = {}      # code_id → [active user_id, ...]
    code_any_assignment: dict[str, set] = {}      # code_id → {user_id with ANY row}
    failed_code_ids: set[str] = set()
    id_chunks = _access_code_id_chunks(code_ids)
    for chunk_no, id_chunk in enumerate(id_chunks, start=1):
        try:
            rows = _usage_paged(
                lambda ids=id_chunk: supabase_admin.table("user_code_assignments")
                .select("id, code_id, user_id, is_active")
                .in_("code_id", ids)
            )
        except Exception as exc:
            # Shape only — status, sizes, error class; no ids or user data.
            logger.warning(
                "list_access_codes: assignment lookup failed: batch=%d/%d ids=%d "
                "filter_len=%d status=%s error=%s",
                chunk_no, len(id_chunks), len(id_chunk),
                len("code_id=in.()") + len(",".join(id_chunk)),
                getattr(exc, "code", None), type(exc).__name__,
            )
            failed_code_ids.update(id_chunk)
            continue
        for row in rows:
            cid = row["code_id"]
            code_any_assignment.setdefault(cid, set()).add(row["user_id"])
            if row.get("is_active"):
                code_user_ids.setdefault(cid, []).append(row["user_id"])

    # Fallback: a TRUE legacy code — used_by set but the redeemer has NO
    # assignment row at all. We must NOT synthesize the redeemer when an INACTIVE
    # row exists: that means the admin deliberately removed them (per-user
    # revoke), and post read-path fix #442 they no longer have access. Re-showing
    # them as the "owner" made remove-user look like a no-op (they reappeared as
    # a non-removable redeemer). Mirrors #442: an assignment row, even inactive,
    # is authoritative over the immutable used_by marker.
    fallback_uid: dict[str, str] = {}  # code_id → used_by user_id
    for c in codes:
        ub = c.get("used_by")
        if (
            c["id"] not in failed_code_ids
            and not code_user_ids.get(c["id"])
            and c.get("is_used")
            and ub
            and ub not in code_any_assignment.get(c["id"], set())
        ):
            fallback_uid[c["id"]] = ub

    # Single users lookup covering both assignment UIDs and fallback UIDs.
    user_info: dict[str, dict] = {}
    all_uids = list(
        {uid for uids in code_user_ids.values() for uid in uids}
        | set(fallback_uid.values())
    )
    # Batched for the same URL-length reason as the assignment lookup above.
    for id_chunk in _access_code_id_chunks(all_uids):
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email, display_name")
                .in_("id", id_chunk)
                .execute()
            )
            for u in (ur.data or []):
                user_info[u["id"]] = {
                    "user_id": u["id"],
                    "name":    u.get("display_name") or "",
                    "email":   u.get("email") or "",
                }
        except Exception as exc:
            logger.warning(
                "list_access_codes: user lookup failed: ids=%d status=%s error=%s",
                len(id_chunk), getattr(exc, "code", None), type(exc).__name__,
            )

    # Per-user quota "used" — the CANONICAL count: COMPLETED sessions only (an
    # abandoned in_progress does not consume a lượt) via the
    # fn_completed_session_counts GROUP BY RPC (one query, no N+1, no 1000-row
    # cap). This is the SAME semantic create_session enforces (get_user_session_
    # quota), so the admin display can no longer disagree with enforcement — the
    # old batched `.in_()` count was truncated at db-max-rows (1000) and counted
    # all statuses, showing inflated "remaining" while students were blocked.
    # Graceful: a failed count omits quota rather than failing the whole list.
    session_counts: dict[str, int] = {}
    if all_uids:
        try:
            session_counts = get_completed_session_counts(all_uids)
        except Exception as exc:
            logger.warning("list_access_codes: session count lookup failed: %s", exc)

    def _quota_for(uid: str, code: dict) -> dict:
        used = session_counts.get(uid, 0)
        limit = code.get("session_limit")
        if limit is None:
            return {"used": used, "limit": None, "remaining": None, "limit_type": "unlimited"}
        return {"used": used, "limit": limit, "remaining": max(0, limit - used),
                "limit_type": "per_user_via_code"}

    for c in codes:
        if c["id"] in failed_code_ids:
            # Ownership unknown: no count, no users, no fallback redeemer.
            c["association_lookup_failed"] = True
            continue
        uids = code_user_ids.get(c["id"], [])
        if uids:
            c["assigned_user_count"] = len(uids)
            c["assigned_users"] = [
                dict(user_info.get(uid, {"user_id": uid, "name": "", "email": ""}),
                     is_fallback_used_by=False, removable=True, quota=_quota_for(uid, c))
                for uid in uids
            ]
        elif c["id"] in fallback_uid:
            # Legacy: code was redeemed but no assignment row exists.
            # Show the redeemer but do not offer a remove action — there is no row to deactivate.
            uid = fallback_uid[c["id"]]
            c["assigned_user_count"] = 1
            c["assigned_users"] = [
                dict(user_info.get(uid, {"user_id": uid, "name": "", "email": ""}),
                     is_fallback_used_by=True, removable=False, quota=_quota_for(uid, c))
            ]
        else:
            c["assigned_user_count"] = 0
            c["assigned_users"] = []

    # Sprint 12.2 — enrich rows with cohort_name for the UI (direct codes
    # display the cohort label in the table without a second round trip).
    cohort_ids = list({c.get("cohort_id") for c in codes if c.get("cohort_id")})
    cohort_name_by_id: dict[str, str] = {}
    if cohort_ids:
        try:
            cr = (
                supabase_admin.table("cohorts")
                .select("id, name")
                .in_("id", cohort_ids)
                .execute()
            )
            for row in (cr.data or []):
                cohort_name_by_id[row["id"]] = row.get("name") or ""
        except Exception as exc:
            logger.warning("list_access_codes: cohort lookup failed: %s", exc)
    for c in codes:
        if c.get("cohort_id"):
            c["cohort_name"] = cohort_name_by_id.get(c["cohort_id"], "")
        else:
            c["cohort_name"] = None

    return codes


# Declared BEFORE GET /access-codes/{code_id} so the matcher doesn't read
# "pool" as a code_id (mirrors the prompts/upload-image + fan-out ordering).
@router.get("/access-codes/pool")
async def list_unassigned_codes(authorization: str | None = Header(default=None)):
    """The 'sẵn-sàng-gán' pool for the Mã-kích-hoạt tab: codes never redeemed
    AND not revoked (is_used=false AND is_revoked=false) — the canonical flags
    for 'ready to issue'. Re-issuable (used-but-no-active-assignment) is
    intentionally excluded to keep the pool unambiguous."""
    await require_admin(authorization)
    try:
        r = (
            supabase_admin.table("access_codes")
            .select("id, code, code_type, permissions, session_limit, expires_at, cohort_id, created_at")
            .eq("is_used", False)
            .eq("is_revoked", False)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] list unassigned codes failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải pool mã. Vui lòng thử lại.") from None
    return r.data or []


# ── Sprint 17.2 — usage log (per-user + per-code activity rollups) ────────────────

_USAGE_PAGE = 1000
_USAGE_ID_CHUNK = 200


def _usage_paged(build_query) -> list[dict]:
    """Read a complete PostgREST result with an ``id`` keyset cursor.

    Usage rollups are operational truth, so the implicit ~1000-row response cap
    must not silently turn a real total into a plausible-looking lower number.
    OFFSET pagination is deliberately avoided: concurrent inserts/deletes can
    shift offsets and duplicate or skip existing rows. ``build_query`` returns
    a fresh mutable builder for every page and every selected shape includes id.
    """
    rows: list[dict] = []
    cursor: str | None = None
    while True:
        query = build_query().order("id").limit(_USAGE_PAGE)
        if cursor is not None:
            query = query.gt("id", cursor)
        page = query.execute().data or []
        rows.extend(page)
        if len(page) < _USAGE_PAGE:
            return rows
        next_cursor = page[-1].get("id")
        if not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor:
            raise RuntimeError("usage pagination requires a progressing id cursor")
        cursor = next_cursor


def _usage_id_chunks(user_ids: list[str]):
    for start in range(0, len(user_ids), _USAGE_ID_CHUNK):
        yield user_ids[start : start + _USAGE_ID_CHUNK]


def _usage_at_or_after(value: str | None, boundary: str | None) -> bool:
    """Compare provider timestamps defensively across ``Z``/offset formats."""
    if not value or not boundary:
        return False
    try:
        left = datetime.fromisoformat(value.replace("Z", "+00:00"))
        right = datetime.fromisoformat(boundary.replace("Z", "+00:00"))
        return left >= right
    except (TypeError, ValueError):
        return value >= boundary


def _writing_job_id(usage_event_id: str | None) -> str | None:
    """Extract the stable job id from a canonical Writing ledger event."""
    value = str(usage_event_id or "")
    if not value.startswith("writing:"):
        return None
    parts = value.split(":", 2)
    return parts[1] or None if len(parts) == 3 else None


def _writing_feedback_service(row: dict) -> str:
    """Ledger ``service`` for a writing_feedback row's served model.

    Claude-primary Writing runs (and Deep runs whose Pass 1 Claude served) carry
    a ``claude-*`` model_used; labelling them "gemini" misattributes spend."""
    model = str(row.get("model_used") or "").lower()
    if model.startswith(("claude", "anthropic")):
        return "claude"
    if model.startswith("gpt"):
        return "openai"
    return "gemini"


def _writing_feedback_reconcilable(row: dict) -> bool:
    """Whether a writing_feedback row can carry spend missing from the ledger.

    Gemini rows keep the legacy rule. A row of any provider with job provenance
    and a stored cost_usd is reconciled per job against ai_usage_logs, so a
    Claude-led run whose Gemini pass ledger write failed is not dropped."""
    if not ((row.get("tokens_input") or 0) > 0 or (row.get("tokens_output") or 0) > 0):
        return False
    if str(row.get("model_used") or "").startswith("gemini-"):
        return True
    provenance = row.get("provenance")
    job_id = provenance.get("job_id") if isinstance(provenance, dict) else None
    return bool(job_id) and row.get("cost_usd") is not None


def _writing_feedback_cost(row: dict) -> float:
    cost, _ = effective_logged_cost({
        "service": _writing_feedback_service(row),
        "model": row.get("model_used"),
        "input_tokens": row.get("tokens_input"),
        "output_tokens": row.get("tokens_output"),
        "cost_usd_est": row.get("cost_usd"),
        "pricing_version": (
            "writing_feedback:legacy" if row.get("cost_usd") is not None else None
        ),
        "created_at": row.get("created_at"),
    })
    return float(cost or 0)


_WRITING_RECONCILE_EPSILON_USD = 1e-6


def _writing_feedback_supplemental_cost(
    row: dict,
    *,
    ledger_cost_by_job: dict[str, float],
    ledger_first_seen: str | None,
) -> float:
    """Return only feedback spend not already represented by call-level rows.

    A multi-pass Writing job can persist its aggregate feedback even if one of
    the individual ledger writes fails. Exact job provenance therefore needs a
    cost reconciliation, not an all-or-nothing suppression. Rows from before
    job provenance existed retain the timestamp-based legacy rule.
    """
    feedback_cost = _writing_feedback_cost(row)
    provenance = row.get("provenance")
    job_id = provenance.get("job_id") if isinstance(provenance, dict) else None
    if job_id:
        remainder = feedback_cost - ledger_cost_by_job.get(str(job_id), 0.0)
        # feedback cost_usd is round(sum, 6); a sub-micro-dollar remainder is
        # rounding residue, not unlogged spend, and must not create a row.
        return remainder if remainder >= _WRITING_RECONCILE_EPSILON_USD else 0.0
    if _usage_at_or_after(row.get("created_at"), ledger_first_seen):
        return 0.0
    return feedback_cost

def _aggregate_usage_for_users(
    user_ids: list[str], date_from: str | None = None, date_to: str | None = None
) -> dict[str, dict]:
    """Per-user {sessions, last_active, ai_cost_usd} for the given users.

    Batched in bounded user-id chunks (no per-user N+1), and every source page is
    read past PostgREST's response cap. Pattern #29: a failed sub-query degrades
    THAT metric to None rather than failing the whole rollup. ISO-UTC timestamps
    compare lexicographically.
    """
    out = {uid: {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0} for uid in user_ids}
    if not user_ids:
        return out

    # Freeze both source sets at one request watermark. Without it, a normal
    # practice/log insert whose random UUID sorts into an already-read page can
    # shift later OFFSET ranges and make a pre-existing row appear twice or not
    # at all. New production rows use server/current timestamps, so excluding
    # timestamps after this boundary gives every page the same logical snapshot.
    snapshot_to = datetime.now(timezone.utc).isoformat()

    try:
        for id_chunk in _usage_id_chunks(user_ids):
            def sessions_query():
                query = (
                    supabase_admin.table("sessions")
                    .select("id, user_id, started_at")
                    .in_("user_id", id_chunk)
                    .lte("started_at", snapshot_to)
                )
                if date_from:
                    query = query.gte("started_at", date_from)
                if date_to:
                    query = query.lte("started_at", date_to)
                return query

            for row in _usage_paged(sessions_query):
                uid, ts = row.get("user_id"), row.get("started_at")
                if uid not in out:
                    continue
                out[uid]["sessions"] += 1
                if ts and (out[uid]["last_active"] is None or ts > out[uid]["last_active"]):
                    out[uid]["last_active"] = ts
    except Exception as exc:
        logger.warning("usage: sessions aggregate failed: %s", exc)
        for uid in out:
            out[uid]["sessions"] = None
            out[uid]["last_active"] = None

    try:
        ledger_writing_first_seen: dict[str, str] = {}
        ledger_writing_cost_by_job: dict[str, float] = {}
        ledger_schema_legacy = False
        for id_chunk in _usage_id_chunks(user_ids):
            def costs_query_detailed():
                query = (
                    supabase_admin.table("ai_usage_logs")
                    .select("id, user_id, service, model, input_tokens, output_tokens, "
                            "thinking_tokens, cache_read_tokens, cache_write_tokens, "
                            "audio_seconds, text_chars, cost_usd_est, pricing_version, "
                            "feature, resource_id, usage_event_id, created_at")
                    .in_("user_id", id_chunk)
                    .lte("created_at", snapshot_to)
                )
                if date_from:
                    query = query.gte("created_at", date_from)
                if date_to:
                    query = query.lte("created_at", date_to)
                return query

            def costs_query_legacy():
                query = (
                    supabase_admin.table("ai_usage_logs")
                    .select("id, user_id, service, model, input_tokens, output_tokens, "
                            "cache_read_tokens, cache_write_tokens, audio_seconds, "
                            "text_chars, cost_usd_est, created_at")
                    .in_("user_id", id_chunk)
                    .lte("created_at", snapshot_to)
                )
                if date_from:
                    query = query.gte("created_at", date_from)
                if date_to:
                    query = query.lte("created_at", date_to)
                return query

            try:
                cost_rows = _usage_paged(costs_query_detailed)
            except Exception as exc:
                if not ai_usage_logger.is_legacy_schema_error(exc):
                    raise
                ledger_schema_legacy = True
                cost_rows = _usage_paged(costs_query_legacy)

            for row in cost_rows:
                uid = row.get("user_id")
                if uid in out and out[uid]["ai_cost_usd"] is not None:
                    effective_cost, _ = effective_logged_cost(row)
                    out[uid]["ai_cost_usd"] += float(effective_cost or 0)
                if row.get("feature") == "writing_grading" and row.get("resource_id"):
                    essay_id = str(row["resource_id"])
                    created_at = row.get("created_at")
                    current = ledger_writing_first_seen.get(essay_id)
                    if created_at and (current is None or created_at < current):
                        ledger_writing_first_seen[essay_id] = created_at

        # Before the per-call ledger, Writing spend lived only on feedback rows.
        # Merge those rows using the same dedupe rule as /admin/ai-usage.
        student_user: dict[str, str] = {}
        for id_chunk in _usage_id_chunks(user_ids):
            student_rows = _usage_paged(
                lambda id_chunk=id_chunk: supabase_admin.table("students")
                .select("id, user_id").in_("user_id", id_chunk)
            )
            student_user.update({
                str(row["id"]): str(row["user_id"])
                for row in student_rows if row.get("id") and row.get("user_id")
            })

        essay_user: dict[str, str] = {}
        for student_chunk in _usage_id_chunks(list(student_user)):
            essay_rows = _usage_paged(
                lambda student_chunk=student_chunk: supabase_admin.table("writing_essays")
                .select("id, student_id").in_("student_id", student_chunk)
            )
            essay_user.update({
                str(row["id"]): student_user[str(row["student_id"])]
                for row in essay_rows if row.get("id") and row.get("student_id")
                and str(row["student_id"]) in student_user
            })

        essay_ids = list(essay_user)
        # Dedupe must be date- and attribution-independent. Feedback can be
        # written just after a reporting boundary, and an older ledger row can
        # legitimately have user_id=NULL if account resolution failed.
        if not ledger_schema_legacy:
            for essay_chunk in _usage_id_chunks(essay_ids):
                ledger_rows = _usage_paged(
                    lambda essay_chunk=essay_chunk: supabase_admin.table("ai_usage_logs")
                    .select("id, service, model, input_tokens, output_tokens, "
                            "thinking_tokens, cache_read_tokens, cache_write_tokens, "
                            "audio_seconds, text_chars, cost_usd_est, pricing_version, "
                            "resource_id, usage_event_id, created_at")
                    .eq("feature", "writing_grading")
                    .in_("resource_id", essay_chunk)
                )
                for ledger_row in ledger_rows:
                    if job_id := _writing_job_id(ledger_row.get("usage_event_id")):
                        ledger_cost, _ = effective_logged_cost(ledger_row)
                        ledger_writing_cost_by_job[job_id] = (
                            ledger_writing_cost_by_job.get(job_id, 0.0)
                            + float(ledger_cost or 0)
                        )
                    essay_id = str(ledger_row.get("resource_id") or "")
                    created_at = ledger_row.get("created_at")
                    current = ledger_writing_first_seen.get(essay_id)
                    if essay_id and created_at and (current is None or created_at < current):
                        ledger_writing_first_seen[essay_id] = created_at

        for essay_chunk in _usage_id_chunks(essay_ids):
            def feedback_query():
                query = (
                    # GV-1a SPEND-analytics exception: historical AI cost must
                    # include every feedback version, not only the current view.
                    supabase_admin.table("writing_feedback")
                    .select("id, essay_id, model_used, tokens_input, tokens_output, "
                            "cost_usd, provenance, created_at")
                    .in_("essay_id", essay_chunk)
                    .lte("created_at", snapshot_to)
                )
                if date_from:
                    query = query.gte("created_at", date_from)
                if date_to:
                    query = query.lte("created_at", date_to)
                return query

            for row in _usage_paged(feedback_query):
                essay_id = str(row.get("essay_id") or "")
                if not essay_id or not _writing_feedback_reconcilable(row):
                    continue
                supplemental_cost = _writing_feedback_supplemental_cost(
                    row,
                    ledger_cost_by_job=ledger_writing_cost_by_job,
                    ledger_first_seen=ledger_writing_first_seen.get(essay_id),
                )
                if supplemental_cost <= 0:
                    continue
                uid = essay_user.get(essay_id)
                if uid in out and out[uid]["ai_cost_usd"] is not None:
                    out[uid]["ai_cost_usd"] += supplemental_cost
    except Exception as exc:
        logger.warning("usage: ai cost aggregate failed: %s", exc)
        for uid in out:
            out[uid]["ai_cost_usd"] = None

    for uid in out:
        if isinstance(out[uid]["ai_cost_usd"], float):
            out[uid]["ai_cost_usd"] = round(out[uid]["ai_cost_usd"], 4)
    return out


@router.get("/usage/users")
async def usage_by_user(
    authorization: str | None = Header(default=None),
    date_from: str | None = None,
    date_to: str | None = None,
):
    """Per-user activity rollup (the usage-log landing): every user with their
    session count, last activity, and AI cost. Batched (no N+1)."""
    await require_admin(authorization)
    try:
        users = _usage_paged(
            lambda: supabase_admin.table("users")
            .select("id, email, display_name, role")
        )
    except Exception as exc:
        logger.warning("usage: users list failed: %s", exc)
        raise HTTPException(500, "Không thể tải dữ liệu hoạt động") from exc

    agg = _aggregate_usage_for_users([u["id"] for u in users], date_from, date_to)
    return [
        {
            "user_id": u["id"],
            "email": u.get("email") or "",
            "name": u.get("display_name") or "",
            "role": u.get("role"),
            **agg.get(u["id"], {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0}),
        }
        for u in users
    ]


@router.get("/access-codes/{code_id}/usage")
async def code_usage(code_id: str, authorization: str | None = Header(default=None)):
    """Per-code usage rollup: the code's ACTIVE assigned users with per-user stats
    + aggregate totals. Drilled from the Sprint 17.1 codes UI."""
    await require_admin(authorization)
    code_rows = (
        supabase_admin.table("access_codes")
        .select("id, code, session_limit, code_type, cohort_id")
        .eq("id", code_id)
        .limit(1)
        .execute()
        .data
    ) or []
    if not code_rows:
        raise HTTPException(404, "Mã không tồn tại")
    code = code_rows[0]

    asgn = _usage_paged(
        lambda: supabase_admin.table("user_code_assignments")
        .select("id, user_id, assigned_at")
        .eq("code_id", code_id)
        .eq("is_active", True)   # only active assignments count toward the rollup
    )
    uids = [a["user_id"] for a in asgn]

    users: dict[str, dict] = {}
    if uids:
        for id_chunk in _usage_id_chunks(uids):
            for u in _usage_paged(
                lambda id_chunk=id_chunk: supabase_admin.table("users")
                .select("id, email, display_name, role")
                .in_("id", id_chunk)
            ):
                users[u["id"]] = u

    agg = _aggregate_usage_for_users(uids)
    per_user = [
        {
            "user_id": uid,
            "email": (users.get(uid) or {}).get("email") or "",
            "name": (users.get(uid) or {}).get("display_name") or "",
            "role": (users.get(uid) or {}).get("role"),
            **agg.get(uid, {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0}),
        }
        for uid in uids
    ]
    # A failed source query degrades every corresponding per-user metric to
    # None. Preserve that truth at aggregate level; coercing None to zero would
    # tell admins "no activity/cost" when the backend actually could not read it.
    total_sessions = (
        None
        if any(p["sessions"] is None for p in per_user)
        else sum(p["sessions"] for p in per_user)
    )
    total_cost = (
        None
        if any(p["ai_cost_usd"] is None for p in per_user)
        else round(sum(p["ai_cost_usd"] for p in per_user), 4)
    )
    return {
        "code": code,
        "assigned_users": per_user,
        "aggregate": {
            "assigned_user_count": len(uids),
            "total_sessions": total_sessions,
            "total_ai_cost_usd": total_cost,
        },
    }


# ── Sprint 17.4 — foot-traffic dashboard aggregation ─────────────────────────────

# DEBT-2026-07-22-G — page size / safety ceiling for the foot-traffic read.
# PAGE is the PostgREST per-response cap; MAX_ROWS is a ceiling well above the
# current table size, and hitting it sets `truncated` rather than quietly
# shortening the answer. Module-level so a test can lower the ceiling.
FOOT_TRAFFIC_PAGE = 1000
FOOT_TRAFFIC_MAX_ROWS = 200_000


class FootTrafficPageRow(BaseModel):
    path: str
    views: int


class FootTrafficDayRow(BaseModel):
    date: str
    views: int


class FootTrafficOut(BaseModel):
    date_from: str
    date_to: str | None = None
    route: str | None = None
    snapshot_to: str
    effective_to: str
    data_status: Literal["complete", "partial", "unavailable"]
    total_views: int | None = None
    unique_visitors: int | None = None
    anonymous_hits: int | None = None
    top_pages: list[FootTrafficPageRow]
    daily: list[FootTrafficDayRow]
    truncated: bool


def _foot_traffic_bound(value: str | None, *, end_of_day: bool = False) -> datetime | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        raise HTTPException(422, "Khoảng ngày không hợp lệ")
    try:
        if len(raw) == 10:
            point = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if end_of_day:
                point += timedelta(days=1) - timedelta(microseconds=1)
        else:
            point = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if point.tzinfo is None:
                point = point.replace(tzinfo=timezone.utc)
            point = point.astimezone(timezone.utc)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "Khoảng ngày không hợp lệ") from exc
    return point


@router.get("/analytics/foot-traffic", response_model=FootTrafficOut)
async def foot_traffic(
    authorization: str | None = Header(default=None),
    date_from: str | None = None,
    date_to: str | None = None,
    route: str | None = None,
):
    """Aggregated page-view foot traffic for the admin dashboard. Default window:
    last 30 days. Paged query over page_view events + a Python rollup (no N+1).

    The response explicitly distinguishes complete, partial and unavailable
    reads. An upstream failure must never masquerade as a real zero-traffic
    window in the admin UI.
    """
    await require_admin(authorization)
    # A small lag keeps transactions that started just before the request from
    # committing behind an already-read keyset page. The response exposes this
    # exact boundary as effective_to instead of implying it reaches wall-clock now.
    snapshot_point = datetime.now(timezone.utc) - timedelta(seconds=5)
    snapshot_to = snapshot_point.isoformat()
    date_to_point = _foot_traffic_bound(date_to, end_of_day=True)
    date_from_point = _foot_traffic_bound(date_from)
    if date_from_point is None:
        date_from_point = (date_to_point or snapshot_point) - timedelta(days=30)
    if date_to_point and date_from_point > date_to_point:
        raise HTTPException(422, "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc")
    effective_to_point = min(date_to_point, snapshot_point) if date_to_point else snapshot_point
    if date_from_point > effective_to_point:
        raise HTTPException(422, "Ngày bắt đầu không được nằm sau thời điểm dữ liệu hiện có")
    date_from = date_from_point.isoformat()
    date_to = date_to_point.isoformat() if date_to_point else None
    effective_to = effective_to_point.isoformat()

    rows: list[dict] = []
    truncated = False
    data_status = "complete"
    try:
        # DEBT-2026-07-22-G — this read used to be a bare .select() with no
        # pagination, so PostgREST capped the response at ~1000 rows and every
        # number below (total views, unique visitors, per-path counts, the daily
        # chart) was computed from an arbitrary 1000-row slice. Measured on prod
        # 2026-07-22: the 30-day view reported exactly 1000 views and charted
        # only 22–27/06 — the oldest days — so the panel was WRONG, not just
        # incomplete. Page through the frozen request window using an id keyset;
        # offset paging can repeat or skip rows while this hot table is written.
        cursor_created_at: str | None = None
        cursor_id: Any = None
        while True:
            q = (
                supabase_admin.table("analytics_events")
                .select("id, user_id, event_data, created_at")
                .eq("event_name", "page_view")
                .gte("created_at", date_from)
                .lte("created_at", effective_to)
            )
            if route:
                q = q.contains("event_data", {"path": route})
            if cursor_created_at is not None:
                q = q.or_(
                    f"created_at.gt.{cursor_created_at},"
                    f"and(created_at.eq.{cursor_created_at},id.gt.{cursor_id})"
                )
            page_size = min(FOOT_TRAFFIC_PAGE, FOOT_TRAFFIC_MAX_ROWS - len(rows))
            batch = (
                q.order("created_at")
                .order("id")
                .limit(page_size)
                .execute()
                .data
                or []
            )
            if not batch:
                break
            rows.extend(batch)
            next_created_at = batch[-1].get("created_at")
            next_id = batch[-1].get("id")
            if not next_created_at or next_id is None or (
                next_created_at == cursor_created_at and next_id == cursor_id
            ):
                raise RuntimeError("foot-traffic pagination cursor did not advance")
            cursor_created_at, cursor_id = str(next_created_at), next_id
            if len(rows) >= FOOT_TRAFFIC_MAX_ROWS:
                # Never silent — the caller is told the window was cut.
                truncated = True
                data_status = "partial"
                logger.warning(
                    "foot_traffic: hit the %d-row ceiling; results truncated",
                    FOOT_TRAFFIC_MAX_ROWS,
                )
                break
    except Exception as exc:
        # Review #821 — a failure on page ONE leaves rows empty, which is the
        # documented Pattern #29 zero-on-failure contract. A failure on any
        # LATER page leaves a partial set, and reporting that as complete is
        # exactly the silent-incompleteness defect this endpoint just stopped
        # doing. Partial ⇒ truncated.
        logger.warning("foot_traffic: query failed: %s", exc)
        if rows:
            truncated = True
            data_status = "partial"
        else:
            data_status = "unavailable"

    unique_users: set = set()
    anonymous_hits = 0
    page_counts: dict[str, int] = {}
    daily: dict[str, int] = {}
    for r in rows:
        uid = r.get("user_id")
        if uid:
            unique_users.add(uid)
        else:
            anonymous_hits += 1
        ed = r.get("event_data") or {}
        path = ed.get("path") if isinstance(ed, dict) else None
        if isinstance(path, str) and path:
            page_counts[path] = page_counts.get(path, 0) + 1
        ts = r.get("created_at")
        if ts:
            day = str(ts)[:10]
            daily[day] = daily.get(day, 0) + 1

    top_pages = sorted(
        [{"path": p, "views": c} for p, c in page_counts.items()],
        key=lambda x: x["views"], reverse=True,
    )[:10]
    daily_series = [{"date": d, "views": daily[d]} for d in sorted(daily)]
    coverage_to = effective_to
    if data_status == "partial" and rows:
        last_read = rows[-1].get("created_at")
        if isinstance(last_read, str) and last_read:
            coverage_to = last_read

    return {
        "date_from": date_from,
        "date_to": date_to,
        "route": route,
        "snapshot_to": snapshot_to,
        # For partial reads this is the last successfully scanned event, not
        # the requested watermark. Never imply unread days had zero traffic.
        "effective_to": coverage_to,
        "data_status": data_status,
        "total_views": None if data_status == "unavailable" else len(rows),
        "unique_visitors": None if data_status == "unavailable" else len(unique_users),
        "anonymous_hits": None if data_status == "unavailable" else anonymous_hits,
        "top_pages": top_pages,
        "daily": daily_series,
        # DEBT-2026-07-22-G — true only if the MAX_ROWS ceiling bit. The admin
        # panel renders a warning on it; a truncated count must never read as a
        # complete one.
        "truncated": data_status == "partial",
    }


# ── Sprint 18.2 — GET /admin/dashboard/overview (ops metrics) ────────────────────

@router.get("/dashboard/overview", response_model=DashboardOverviewOut)
async def dashboard_overview(
    authorization: str | None = Header(default=None),
    visitors_window: int = 30,
):
    """6-metric operational overview for the admin Dashboard. `visitors_window`
    (days) drives the distinct-visitors metric (7/30/90; defaults to 30 on any
    other value). One query per metric; Pattern #29 — a partial outage yields a
    NULL metric, never a 500."""
    await require_admin(authorization)
    return admin_dashboard.compute_dashboard_overview(visitors_window_days=visitors_window)


# ── admin-dashboard-redesign — GET /admin/dashboard/trends (daily series) ─────

@router.get("/dashboard/trends", response_model=DashboardTrendsOut)
async def dashboard_trends(
    authorization: str | None = Header(default=None),
    days: int = 30,
):
    """Daily ops trend series (visitors / completed practices / cost) over the
    last `days` (7/30/90; other values clamp to 30). Windowed + bucketed —
    bounded fetch, no migration. Cache-Control: 300s (admin has manual refresh);
    Pattern #29 — a per-series outage yields a zero-filled series, never a 500."""
    await require_admin(authorization)
    body = DashboardTrendsOut.model_validate(
        admin_dashboard.compute_dashboard_trends(days=days)
    )
    return JSONResponse(
        content=body.model_dump(mode="json"),
        headers={"Cache-Control": "max-age=300"},
    )


# ── reading-access-tracking C — GET /admin/dashboard/reading-attempts ─────────


class ReadingAttemptTotalsOut(BaseModel):
    submitted_all_time: int | None = Field(ge=0)
    submitted_window: int | None = Field(ge=0)
    auth_attempts: int | None = Field(ge=0)
    anon_attempts: int | None = Field(ge=0)
    auth_distinct_users: int | None = Field(ge=0)
    anon_distinct_sources: int | None = Field(ge=0)
    truncated: bool


class ReadingBandBucketOut(BaseModel):
    band: float = Field(ge=0, le=9)
    count: int = Field(ge=0)


class ReadingSkillPerformanceOut(BaseModel):
    skill_tag: str
    correct: int = Field(ge=0)
    total: int = Field(gt=0)
    accuracy: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def validate_aggregate(self):
        if self.correct > self.total:
            raise ValueError("correct cannot exceed total")
        return self


class ReadingTimeStatsOut(BaseModel):
    avg_minutes: float | None = Field(default=None, ge=0)
    median_minutes: float | None = Field(default=None, ge=0)
    count: int = Field(ge=0)


class ReadingPerTestOut(BaseModel):
    test_id: str
    title: str
    attempts: int = Field(ge=0)
    auth: int = Field(ge=0)
    anon: int = Field(ge=0)
    avg_band: float | None = Field(default=None, ge=0, le=9)

    @model_validator(mode="after")
    def validate_split(self):
        if self.auth + self.anon != self.attempts:
            raise ValueError("auth + anon must equal attempts")
        return self


class ReadingRecentAttemptOut(BaseModel):
    submitted_at: datetime
    test_title: str
    who: str
    is_anonymous: bool
    band: float | None = Field(default=None, ge=0, le=9)
    time_minutes: float | None = Field(default=None, ge=0)


class ReadingAttemptsDashboardOut(BaseModel):
    ok: bool
    data_status: Literal["complete", "partial", "unavailable"]
    window_days: Literal[7, 30, 90]
    window_start: datetime
    snapshot_to: datetime
    totals: ReadingAttemptTotalsOut
    band_distribution: list[ReadingBandBucketOut]
    skill_performance: list[ReadingSkillPerformanceOut]
    time_stats: ReadingTimeStatsOut
    per_test: list[ReadingPerTestOut]
    recent: list[ReadingRecentAttemptOut]
    malformed_count: int = Field(ge=0)
    lookup_failures: list[Literal[
        "all_time_count", "window_count", "test_titles", "recent_identities"
    ]]
    computed_at: datetime

    @model_validator(mode="after")
    def validate_coverage_contract(self):
        row_counts = (
            self.totals.submitted_window,
            self.totals.auth_attempts,
            self.totals.anon_attempts,
            self.totals.auth_distinct_users,
            self.totals.anon_distinct_sources,
        )
        if self.data_status == "unavailable":
            if self.ok or any(value is not None for value in row_counts):
                raise ValueError("unavailable data must not expose false row counts")
            if self.band_distribution or self.skill_performance or self.per_test or self.recent:
                raise ValueError("unavailable data must not expose row-derived collections")
            return self
        if not self.ok or any(value is None for value in row_counts):
            raise ValueError("available data requires non-null row counts")
        derived = self.totals.auth_attempts + self.totals.anon_attempts
        if derived > self.totals.submitted_window:
            raise ValueError("derived attempt count cannot exceed submitted total")
        degraded = bool(self.totals.truncated or self.malformed_count or self.lookup_failures)
        if (self.data_status == "partial") != degraded:
            raise ValueError("partial status must match a declared degradation reason")
        if self.data_status == "complete" and derived != self.totals.submitted_window:
            raise ValueError("complete attempt split must equal submitted total")
        return self


@router.get("/dashboard/reading-attempts", response_model=ReadingAttemptsDashboardOut)
async def dashboard_reading_attempts(
    response: Response,
    authorization: str | None = Header(default=None),
    days: int = 30,
):
    """Reading-attempt aggregates for the admin dashboard — authenticated +
    anonymous (share-link) takers: counts, per-test usage, band distribution,
    skill performance (weakest first), and time-taken stats over the last
    `days` (7/30/90; other values clamp to 30). Anonymous distinct counts are
    APPROXIMATE (salted-IP-hash dedupe limit) and the raw hash is never
    returned. Aggregated in Python over a bounded fetch (no RPC); Pattern #29 —
    response distinguishes complete, partial and unavailable reads. Counts and
    rows are frozen at one UTC watermark; a query outage yields unavailable or
    partial data, never a false zero. The private response is never cached so
    the explicit refresh action always obtains a new canonical snapshot."""
    await require_admin(authorization)
    response.headers["Cache-Control"] = "private, no-store"
    return admin_reading_dashboard.compute_reading_attempts_dashboard(days=days)
