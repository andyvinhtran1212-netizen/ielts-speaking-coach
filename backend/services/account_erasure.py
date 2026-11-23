"""ACCOUNTDATA-0100: account deletion requests (FR-001…FR-003).

The request side (T004): create, read and cancel one learner's request on
``account_deletion_requests``. The erasure steps that run after the grace
period (T005, plan section 5) follow below.

All SQL runs on the engine from ``services.account_data_db``; every function
takes it as an argument so tests run on a real PostgreSQL with migration 500.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text

from services import account_data_inventory as inventory

logger = logging.getLogger(__name__)

STAFF_ROLES = frozenset({"admin", "instructor"})


def export_lock_key(user_id: str) -> str:
    """``pg_advisory_xact_lock`` key shared by export requests and the
    erasure claim for one learner."""
    return f"account_data_export:{user_id}"


class AccountDataError(Exception):
    """A refusal with an HTTP status and a stable ``error_code``."""

    def __init__(self, status: int, error_code: str, message: str):
        super().__init__(error_code)
        self.status, self.error_code, self.message = status, error_code, message


@dataclass(frozen=True)
class DeletionRequest:
    id: str
    status: str
    requested_at: datetime
    erase_after: datetime
    cancelled_at: Optional[datetime] = None


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def status_body(req: Optional[DeletionRequest]) -> dict:
    """``GET /api/account/deletion-request`` shape (plan section 4)."""
    if req is None or req.status not in ("pending", "erasing"):
        return {"status": "none", "requested_at": None, "erase_after": None}
    return {"status": req.status, "requested_at": _iso(req.requested_at), "erase_after": _iso(req.erase_after)}


def _row(row: Any) -> DeletionRequest:
    m = row._mapping
    return DeletionRequest(id=str(m["id"]), status=m["status"], requested_at=m["requested_at"],
                           erase_after=m["erase_after"], cancelled_at=m.get("cancelled_at"))


_COLUMNS = "id, status, requested_at, erase_after, cancelled_at"


async def open_request(engine: Any, user_id: str) -> Optional[DeletionRequest]:
    async with engine.connect() as conn:
        row = (await conn.execute(text(
            f"SELECT {_COLUMNS} FROM public.account_deletion_requests "
            "WHERE user_id = CAST(:uid AS uuid) AND status IN ('pending', 'erasing') LIMIT 1"
        ), {"uid": user_id})).first()
    return _row(row) if row else None


def normalise_email(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def check_can_request(*, role: Optional[str], login_email: Optional[str], confirm_email: Optional[str]) -> None:
    """FR-001 refusals, before anything is written."""
    if (role or "").strip().lower() in STAFF_ROLES:
        raise AccountDataError(403, "staff_account_not_self_deletable",
                               "Tài khoản nhân viên không tự xoá được. Bạn liên hệ admin nhé.")
    if not normalise_email(login_email) or normalise_email(confirm_email) != normalise_email(login_email):
        raise AccountDataError(422, "confirm_email_mismatch",
                               "Email bạn gõ không khớp email đăng nhập.")


async def create_request(engine: Any, user_id: str, *, grace_days: int) -> tuple[DeletionRequest, bool]:
    """Insert a ``pending`` request, or return the open one unchanged
    (``created`` False). The partial unique index settles a race between two
    POSTs: the loser re-reads the winner's row."""
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "INSERT INTO public.account_deletion_requests (user_id, erase_after) "
            "VALUES (CAST(:uid AS uuid), now() + make_interval(days => :days)) "
            "ON CONFLICT (user_id) WHERE status IN ('pending', 'erasing') DO NOTHING "
            f"RETURNING {_COLUMNS}"
        ), {"uid": user_id, "days": int(grace_days)})).first()
    if row is not None:
        return _row(row), True
    existing = await open_request(engine, user_id)
    if existing is None:  # pragma: no cover - the open row was erased between the two statements
        raise AccountDataError(409, "deletion_in_progress", "Tài khoản đang được xoá.")
    return existing, False


async def cancel_request(engine: Any, user_id: str) -> DeletionRequest:
    """FR-003: ``pending`` → ``cancelled``. 409 when nothing is pending or
    erasure already started."""
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "UPDATE public.account_deletion_requests SET status = 'cancelled', cancelled_at = now() "
            "WHERE user_id = CAST(:uid AS uuid) AND status = 'pending' "
            f"RETURNING {_COLUMNS}"
        ), {"uid": user_id})).first()
    if row is not None:
        return _row(row)
    existing = await open_request(engine, user_id)
    if existing is not None and existing.status == "erasing":
        raise AccountDataError(409, "deletion_in_progress", "Tài khoản đang được xoá, không huỷ được nữa.")
    raise AccountDataError(409, "no_pending_deletion_request", "Không có yêu cầu xoá nào đang chờ.")


async def account_is_erasing(engine: Any, user_id: str) -> bool:
    req = await open_request(engine, user_id)
    return req is not None and req.status == "erasing"


# ── Erasure steps (T005, plan section 5) ─────────────────────────────────────


AUDIO_BUCKET = "audio-responses"
EXPORT_BUCKET = "account-exports"
ERASED_REASON = "account_erased"
STUDENT_TOMBSTONE = "Học viên đã xoá"
EMAIL_TOMBSTONE = "erased-{uid}@erased.invalid"
# users: FR-005(c) keeps id, role, created_at; everything else is cleared.
USERS_KEEP = ("id", "role", "created_at")
# students: the row stays (open question 5) with its ids and class links.
STUDENTS_KEEP = ("id", "student_code", "user_id", "cohort_id", "instructor_id", "created_by",
                 "created_at", "updated_at", "flag_count", "is_under_review", "archived_at", "archived_by")


class LostLease(Exception):
    """Another worker took the request over; stop without touching it."""


def subject_of(column: str) -> str:
    return "student" if column == "student_id" else "user"


async def _fk_edges(conn: Any) -> list[tuple[str, str, str, str]]:
    """``(child, column, parent, confdeltype)`` for every single-column FK
    between public tables."""
    rows = (await conn.execute(text(
        "SELECT cl.relname, a.attname, ft.relname, con.confdeltype::text "
        "  FROM pg_constraint con "
        "  JOIN pg_class cl ON cl.oid = con.conrelid AND cl.relnamespace = 'public'::regnamespace "
        "  JOIN pg_class ft ON ft.oid = con.confrelid AND ft.relnamespace = 'public'::regnamespace "
        "  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1] "
        " WHERE con.contype = 'f' AND cardinality(con.conkey) = 1"))).all()
    return [tuple(r) for r in rows]


async def build_plan(engine: Any) -> dict:
    """The plan ``fn_account_erase_learner`` runs, from the inventory and the
    live catalog. Deletes are ordered so a row whose foreign key does not
    cascade goes before the row it points at (``listening_drill_playback``
    before ``class_assignment_items``, ``grammar_recommendations`` before
    ``responses``/``sessions``…). Raises when a kept table would block a
    delete."""
    async with engine.connect() as conn:
        edges = await _fk_edges(conn)
        present = {r[0] for r in (await conn.execute(text(
            "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p')"
        ))).all()}
    deletes = [e for e in inventory.INVENTORY if e.action == "delete" and e.table != "account_data_exports"]
    delete_tables = {e.table for e in deletes}
    children = {}
    for child, parent in inventory.CHILD_TABLES.items():
        for c, col, p, kind in edges:
            if c == child and p == parent and kind != "c":
                children[child] = (col, parent)
    delete_tables |= set(children)
    blocked = sorted({f"{c}.{col}->{p}" for c, col, p, kind in edges
                      if p in delete_tables and c not in delete_tables and kind in ("r", "a")
                      and c in present})
    if blocked:
        raise RuntimeError("keep_table_blocks_delete:" + ",".join(blocked))
    # Order: a table with a non-cascading FK to another delete table first.
    must_precede = {t: set() for t in delete_tables}
    for c, _col, p, kind in edges:
        if c in delete_tables and p in delete_tables and c != p and kind in ("r", "a"):
            must_precede[p].add(c)
    order: list[str] = []
    seen: set[str] = set()

    def visit(t: str, stack: tuple = ()) -> None:
        if t in seen:
            return
        if t in stack:
            raise RuntimeError("delete_order_cycle:" + "->".join(stack + (t,)))
        for c in sorted(must_precede.get(t, ())):
            visit(c, stack + (t,))
        seen.add(t)
        order.append(t)

    for t in sorted(delete_tables):
        visit(t)
    rank = {t: i for i, t in enumerate(order)}
    items = [{"table": e.table, "column": e.column, "subject": subject_of(e.column)} for e in deletes]
    for child, (col, parent) in children.items():
        parent_entry = next(e for e in deletes if e.table == parent)
        items.append({"table": child, "column": col, "parent": parent, "parent_column": parent_entry.column,
                      "subject": subject_of(parent_entry.column)})
    items.sort(key=lambda i: (rank[i["table"]], i["column"]))
    scrub = [{"table": c.table, "column": c.column,
              "match": "student_id" if c.table == "class_action_log" else "user_id",
              "subject": "student" if c.table == "class_action_log" else "user"}
             for c in inventory.TEXT_COLUMNS if c.action == "anonymize"]
    json_keys = [{"table": j.table, "column": j.column, "key": j.path}
                 for j in inventory.JSON_PATHS if j.action == "anonymize"]
    anonymize = [
        {"table": "users", "match": "id", "subject": "user", "keep": list(USERS_KEEP),
         "values": {"is_active": "false"}, "tombstones": {"email": EMAIL_TOMBSTONE}},
        {"table": "students", "match": "user_id", "subject": "user", "keep": list(STUDENTS_KEEP),
         "tombstones": {"full_name": STUDENT_TOMBSTONE}},
    ]
    return {"version": inventory.INVENTORY_VERSION, "delete": items, "scrub": scrub,
            "json_keys": json_keys, "anonymize": anonymize}


async def due_request_ids(engine: Any, limit: int = 20) -> list[str]:
    async with engine.connect() as conn:
        rows = (await conn.execute(text(
            "SELECT id FROM public.account_deletion_requests "
            " WHERE (status = 'pending' AND erase_after <= now()) "
            "    OR (status = 'erasing' AND lease_until < now()) "
            " ORDER BY erase_after LIMIT :n"), {"n": int(limit)})).all()
    return [str(r[0]) for r in rows]


async def claim(engine: Any, request_id: str, owner: str, lease_seconds: int) -> Optional[str]:
    """Step 0: take the request and cancel the learner's running exports in
    one transaction. Returns the user id, or None (cancelled, not due, or
    held by another worker)."""
    async with engine.begin() as conn:
        uid = (await conn.execute(text(
            "SELECT user_id FROM public.account_deletion_requests WHERE id = CAST(:id AS uuid)"),
            {"id": request_id})).scalar()
        if uid is None:
            return None
        await conn.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                           {"k": export_lock_key(str(uid))})
        row = (await conn.execute(text(
            "UPDATE public.account_deletion_requests SET status = 'erasing', erasing_owner = :owner, "
            "       lease_until = now() + make_interval(secs => :lease), "
            "       erasing_started_at = coalesce(erasing_started_at, now()), attempts = attempts + 1 "
            " WHERE id = CAST(:id AS uuid) "
            "   AND ((status = 'pending' AND erase_after <= now()) OR (status = 'erasing' AND lease_until < now())) "
            "RETURNING user_id"), {"id": request_id, "owner": owner, "lease": int(lease_seconds)})).first()
        if row is None:
            return None
        await conn.execute(text(
            "UPDATE public.account_data_exports SET status = 'cancelled' "
            " WHERE user_id = CAST(:uid AS uuid) AND status IN ('queued', 'building')"), {"uid": str(uid)})
    return str(uid)


async def renew(engine: Any, request_id: str, owner: str, lease_seconds: int) -> None:
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "UPDATE public.account_deletion_requests SET lease_until = now() + make_interval(secs => :lease) "
            " WHERE id = CAST(:id AS uuid) AND status = 'erasing' AND erasing_owner = :owner RETURNING id"),
            {"id": request_id, "owner": owner, "lease": int(lease_seconds)})).first()
    if row is None:
        raise LostLease(request_id)


async def revoke_entitlements(engine: Any, user_id: str) -> int:
    """Step 3 (FR-007): active entitlements → revoked, reason account_erased,
    one append-only event each. Already revoked ones are left alone."""
    async with engine.begin() as conn:
        if (await conn.execute(text("SELECT to_regclass('public.entitlements')"))).scalar() is None:
            return 0
        rows = (await conn.execute(text(
            "UPDATE public.entitlements SET status = 'revoked', revoked_at = statement_timestamp(), "
            "       revoke_reason = :reason "
            " WHERE user_id = CAST(:uid AS uuid) AND status = 'active' RETURNING id, revoked_at"),
            {"uid": user_id, "reason": ERASED_REASON})).all()
        for ent_id, revoked_at in rows:
            await conn.execute(text(
                "INSERT INTO public.entitlement_events (entitlement_id, action, actor_kind, before, after, reason) "
                "VALUES (:id, 'revoke', 'system', CAST(:before AS jsonb), CAST(:after AS jsonb), :reason)"),
                {"id": ent_id, "reason": ERASED_REASON, "before": json.dumps({"status": "active"}),
                 "after": json.dumps({"status": "revoked", "revoked_at": revoked_at.isoformat()})})
    return len(rows)


async def audio_paths(engine: Any, user_id: str) -> list[str]:
    """Recording paths the learner's rows point at outside ``<user_id>/``."""
    async with engine.connect() as conn:
        if (await conn.execute(text("SELECT to_regclass('public.responses')"))).scalar() is None:
            return []
        rows = (await conn.execute(text(
            "SELECT r.audio_storage_path FROM public.responses r JOIN public.sessions s ON s.id = r.session_id "
            " WHERE s.user_id = CAST(:uid AS uuid) AND r.audio_storage_path IS NOT NULL"), {"uid": user_id})).all()
    return [r[0] for r in rows if r[0] and not r[0].startswith(f"{user_id}/")]


async def remove_storage(storage: Any, user_id: str, extra_audio: list[str]) -> int:
    """Step 4: the learner's recordings and every export package. A missing
    object counts as removed."""
    audio = await asyncio.to_thread(storage.list_prefix, AUDIO_BUCKET, user_id)
    audio = sorted(set(audio) | set(extra_audio))
    exports = await asyncio.to_thread(storage.list_prefix, EXPORT_BUCKET, user_id)
    if audio:
        await asyncio.to_thread(storage.remove, AUDIO_BUCKET, audio)
    if exports:
        await asyncio.to_thread(storage.remove, EXPORT_BUCKET, exports)
    return len(audio) + len(exports)


async def erase_database(engine: Any, request_id: str, owner: str, plan: dict) -> dict:
    """Step 5: one transaction in ``fn_account_erase_learner`` (migration 504)."""
    async with engine.begin() as conn:
        result = (await conn.execute(text(
            "SELECT public.fn_account_erase_learner(CAST(:id AS uuid), :owner, CAST(:plan AS jsonb))"),
            {"id": request_id, "owner": owner, "plan": json.dumps(plan)})).scalar()
    return result if isinstance(result, dict) else json.loads(result)


class AuthAdapter:
    """Supabase Auth admin calls (step 6 email, step 7 soft delete)."""

    def __init__(self, client: Any = None):
        self._client = client

    def _admin(self):
        if self._client is None:
            from database import supabase_admin
            self._client = supabase_admin
        return self._client.auth.admin

    def email(self, user_id: str) -> Optional[str]:
        res = self._admin().get_user_by_id(user_id)
        user = getattr(res, "user", None)
        if user is None or getattr(user, "deleted_at", None):
            return None
        return getattr(user, "email", None)

    def soft_delete(self, user_id: str) -> None:
        self._admin().delete_user(user_id, should_soft_delete=True)


async def send_erased_notice(engine: Any, request_id: str, owner: str, auth: AuthAdapter, send: Any) -> bool:
    """Step 6: once per request; a failure is logged and does not block."""
    async with engine.connect() as conn:
        sent_at = (await conn.execute(text(
            "SELECT erased_notice_sent_at FROM public.account_deletion_requests WHERE id = CAST(:id AS uuid)"),
            {"id": request_id})).scalar()
        uid = (await conn.execute(text(
            "SELECT user_id FROM public.account_deletion_requests WHERE id = CAST(:id AS uuid)"),
            {"id": request_id})).scalar()
    if sent_at is not None:
        return True
    try:
        email = await asyncio.to_thread(auth.email, str(uid))
        if not email:
            return False
        result = await send("account_erased", email, {}, idempotency_key=f"account-erased-{request_id}")
        if not getattr(result, "ok", False):
            logger.warning("[account_erasure] erased letter not sent request=%s code=%s", request_id,
                           getattr(result, "error", None))
            return False
    except Exception as exc:
        logger.warning("[account_erasure] erased letter failed request=%s: %r", request_id, exc)
        return False
    async with engine.begin() as conn:
        await conn.execute(text(
            "UPDATE public.account_deletion_requests SET erased_notice_sent_at = now() "
            " WHERE id = CAST(:id AS uuid) AND erasing_owner = :owner AND erased_notice_sent_at IS NULL"),
            {"id": request_id, "owner": owner})
    return True


async def export_lease_active(engine: Any, user_id: str) -> bool:
    async with engine.connect() as conn:
        return (await conn.execute(text(
            "SELECT 1 FROM public.account_data_exports WHERE user_id = CAST(:uid AS uuid) "
            "   AND lease_until >= now() LIMIT 1"), {"uid": user_id})).first() is not None


async def _release(engine: Any, request_id: str, owner: str, code: str, *, count: bool,
                   max_attempts: int) -> str:
    """Record the error and release the lease. After ``max_attempts`` counted
    failures the request becomes ``failed`` (FR-009)."""
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "UPDATE public.account_deletion_requests "
            "   SET last_error_code = :code, lease_until = now(), "
            "       attempts = CASE WHEN :count THEN attempts ELSE greatest(attempts - 1, 0) END, "
            "       status = CASE WHEN :count AND attempts >= :max THEN 'failed' ELSE status END "
            " WHERE id = CAST(:id AS uuid) AND erasing_owner = :owner RETURNING status"),
            {"id": request_id, "owner": owner, "code": code[:80], "count": count,
             "max": int(max_attempts)})).first()
    return row[0] if row else "lost"


def failed_alert_email(request_id: str, code: str, attempts: int, at: datetime | None = None):
    """FR-009 owner alert. Names the request, step and error code only: no
    email, name or user id of the learner (FR-013)."""
    from services import owner_alerts

    when = (at or datetime.now(timezone.utc)).astimezone(owner_alerts.VIETNAM_TIME)
    step = code.split(":", 1)[0]
    lines = [
        "Xoá tài khoản học viên THẤT BẠI",
        "",
        f"Mã yêu cầu: {request_id}",
        f"Số lần thử: {attempts}",
        f"Bước lỗi: {step}",
        f"Mã lỗi: {code[:80]}",
        f"Thời điểm: {when.strftime('%H:%M %d/%m/%Y')} (giờ Việt Nam)",
        "",
        "Yêu cầu đã chuyển sang 'failed' và job sẽ không thử lại. Dữ liệu đã xoá ở các "
        "bước trước vẫn đã xoá. Xem log [account_erasure] theo mã yêu cầu, sửa nguyên nhân, "
        "rồi đặt lại yêu cầu về 'erasing' với attempts = 0 và lease_until đã hết hạn để job chạy lại.",
    ]
    return owner_alerts.Email(subject=f"[Aver] Xoá tài khoản thất bại: {request_id}", text="\n".join(lines))


async def send_owner_alert(request_id: str, code: str, attempts: int, *, config: Any = None,
                           sender: Any = None) -> bool:
    """Send the FR-009 alert straight through the owner-alert transport
    (Resend, ``OWNER_ALERT_EMAILS``). The ``failed`` transition happens once,
    and the idempotency key is per request, so a resend never mails twice.
    Never raises: a missing transport or a refused send is logged."""
    from services import owner_alerts

    config = config or owner_alerts.transport_config()
    if not config.ready:
        logger.error("[account_erasure] request=%s owner_alert_unconfigured missing=%s", request_id,
                     ",".join(config.missing))
        return False
    sender = sender or owner_alerts.send_via_resend
    try:
        result = await sender(failed_alert_email(request_id, code, attempts), config=config,
                              idempotency_key=f"account-erasure-failed-{request_id}")
    except Exception as exc:  # the transport promises not to raise; keep the job alive anyway
        logger.error("[account_erasure] request=%s owner_alert_error=%s", request_id, type(exc).__name__)
        return False
    if not result.ok:
        logger.error("[account_erasure] request=%s owner_alert_refused=%s", request_id, result.error)
        return False
    logger.info("[account_erasure] request=%s owner_alert_sent", request_id)
    return True


async def erase_one(engine: Any, request_id: str, *, owner: str, lease_seconds: int, max_attempts: int,
                    storage: Any, auth: AuthAdapter, send: Any = None, revoke_sessions: Any = None,
                    alert: Any = None) -> str:
    """Run plan section 5 for one request. Returns ``erased``, ``skipped``,
    ``lost``, ``waiting_export`` or ``error:<code>`` (``failed`` once
    ``max_attempts`` is reached)."""
    if send is None:
        from services.learner_email import send_direct as send
    if revoke_sessions is None:
        from services.staff_security import delete_auth_sessions as revoke_sessions
    uid = await claim(engine, request_id, owner, lease_seconds)
    if uid is None:
        return "skipped"
    step = "plan"
    try:
        plan = await build_plan(engine)
        step = "sessions"
        await renew(engine, request_id, owner, lease_seconds)
        await revoke_sessions(engine, uid)
        step = "entitlements"
        await renew(engine, request_id, owner, lease_seconds)
        await revoke_entitlements(engine, uid)
        step = "storage"
        await renew(engine, request_id, owner, lease_seconds)
        await remove_storage(storage, uid, await audio_paths(engine, uid))
        step = "database"
        await renew(engine, request_id, owner, lease_seconds)
        # FR-014 (c): step 0 cancelled the learner's exports, but a worker that
        # still holds a live lease may upload a package. Its export row is the
        # fence, so it must outlive that lease: wait before step 5 deletes it
        # (fn_account_erase_learner checks again under a row lock).
        if await export_lease_active(engine, uid) or \
                (await erase_database(engine, request_id, owner, plan)).get("waiting_export"):
            await _release(engine, request_id, owner, "export_lease_active", count=False,
                           max_attempts=max_attempts)
            return "waiting_export"
        step = "notice"
        await renew(engine, request_id, owner, lease_seconds)
        await send_erased_notice(engine, request_id, owner, auth, send)
        step = "auth"
        await renew(engine, request_id, owner, lease_seconds)
        await asyncio.to_thread(auth.soft_delete, uid)
        step = "exports"
        await renew(engine, request_id, owner, lease_seconds)
        # No export lease was live at step 5 and none can start since (claims
        # skip erasing accounts, renew needs 'building'), so sweep the prefix.
        await remove_storage(storage, uid, [])
        async with engine.begin() as conn:
            row = (await conn.execute(text(
                "UPDATE public.account_deletion_requests SET status = 'erased', erased_at = now(), "
                "       erasing_owner = NULL, lease_until = NULL, last_error_code = NULL, step_done = 'erased' "
                " WHERE id = CAST(:id AS uuid) AND status = 'erasing' AND erasing_owner = :owner RETURNING id"),
                {"id": request_id, "owner": owner})).first()
        return "erased" if row else "lost"
    except LostLease:
        return "lost"
    except Exception as exc:
        code = f"{step}:{getattr(exc, 'error_code', None) or type(exc).__name__}"
        logger.error("[account_erasure] request=%s step=%s failed: %r", request_id, step, exc)
        status = await _release(engine, request_id, owner, code, count=True, max_attempts=max_attempts)
        if status == "failed":
            logger.error("[account_erasure] account_deletion_failed request=%s attempts=%d", request_id,
                         max_attempts)
            await (alert or send_owner_alert)(request_id, code, max_attempts)
        return f"error:{code}"


async def dry_run(engine: Any) -> list[dict]:
    """FR-004 ``--dry-run``: due requests and row counts per table, no
    change."""
    plan = await build_plan(engine)
    out = []
    async with engine.connect() as conn:
        due = (await conn.execute(text(
            "SELECT id, user_id FROM public.account_deletion_requests "
            " WHERE (status = 'pending' AND erase_after <= now()) OR (status = 'erasing' AND lease_until < now())"
        ))).all()
        for req_id, uid in due:
            students = [str(r[0]) for r in (await conn.execute(text(
                "SELECT id FROM public.students WHERE user_id = CAST(:uid AS uuid)"), {"uid": str(uid)})).all()] \
                if (await conn.execute(text("SELECT to_regclass('public.students')"))).scalar() else []
            counts = {}
            for item in plan["delete"]:
                if "parent" in item:
                    continue
                ids = students if item["subject"] == "student" else [str(uid)]
                if not ids or (await conn.execute(text("SELECT to_regclass(:t)"),
                                                  {"t": f"public.{item['table']}"})).scalar() is None:
                    continue
                n = (await conn.execute(text(
                    f'SELECT count(*) FROM public."{item["table"]}" WHERE "{item["column"]}"::text = ANY(:ids)'),
                    {"ids": ids})).scalar()
                if n:
                    counts[f"{item['table']}.{item['column']}"] = int(n)
            out.append({"request_id": str(req_id), "rows": counts})
    return out
