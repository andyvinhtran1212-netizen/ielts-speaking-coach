"""ACCOUNTDATA-0100: learner data export (FR-010…FR-012).

The request side (T004): read the latest job, queue a new one, and resolve a
download. Building the package, its lease and the periodic cleanup (T006,
plan section 6) follow below.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text

from services import account_data_inventory as inventory
from services.account_erasure import AccountDataError, _iso, export_lock_key

logger = logging.getLogger(__name__)

_COLUMNS = "id, user_id, status, requested_at, ready_at, expires_at, size_bytes, object_path"


@dataclass(frozen=True)
class ExportJob:
    id: str
    user_id: str
    status: str
    requested_at: datetime
    ready_at: Optional[datetime]
    expires_at: Optional[datetime]
    size_bytes: Optional[int]
    object_path: Optional[str]

    def visible_status(self, now: datetime) -> str:
        """A ``ready`` job past ``expires_at`` reads as ``expired`` before the
        sweep moves it."""
        if self.status == "ready" and self.expires_at is not None and self.expires_at <= now:
            return "expired"
        return self.status


def _job(row: Any) -> ExportJob:
    m = row._mapping
    return ExportJob(id=str(m["id"]), user_id=str(m["user_id"]), status=m["status"],
                     requested_at=m["requested_at"], ready_at=m["ready_at"], expires_at=m["expires_at"],
                     size_bytes=m["size_bytes"], object_path=m["object_path"])


def body(job: Optional[ExportJob], now: datetime) -> dict:
    """``GET /api/account/data-export`` shape (plan section 4)."""
    if job is None:
        return {"status": "none"}
    return {
        "status": job.visible_status(now),
        "export_id": job.id,
        "requested_at": _iso(job.requested_at),
        "ready_at": _iso(job.ready_at),
        "expires_at": _iso(job.expires_at),
        "size_bytes": job.size_bytes,
    }


async def latest(engine: Any, user_id: str) -> Optional[ExportJob]:
    async with engine.connect() as conn:
        row = (await conn.execute(text(
            f"SELECT {_COLUMNS} FROM public.account_data_exports WHERE user_id = CAST(:uid AS uuid) "
            "ORDER BY requested_at DESC, id DESC LIMIT 1"
        ), {"uid": user_id})).first()
    return _job(row) if row else None


async def _erasing(conn: Any, user_id: str) -> bool:
    return (await conn.execute(text(
        "SELECT 1 FROM public.account_deletion_requests WHERE user_id = CAST(:uid AS uuid) "
        "AND status IN ('erasing', 'erased') LIMIT 1"
    ), {"uid": user_id})).first() is not None


async def request_export(engine: Any, user_id: str, *, cooldown_hours: int,
                         now: Optional[datetime] = None) -> tuple[ExportJob, bool]:
    """FR-010. Returns ``(job, created)``. A running job is returned as is;
    a ``ready`` job younger than the cooldown is 429; ``erasing`` is 409."""
    now = now or datetime.now(timezone.utc)
    async with engine.begin() as conn:
        # Serialise this learner's export requests with each other and with
        # the erasure claim (which takes the same lock before it cancels the
        # learner's exports): no job can be queued behind a claim that
        # already cancelled the others, and two POSTs never both pass the
        # cooldown check.
        await conn.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                           {"k": export_lock_key(user_id)})
        if await _erasing(conn, user_id):
            raise AccountDataError(409, "account_erasing", "Tài khoản đang được xoá, không tạo gói tải được nữa.")
        running = (await conn.execute(text(
            f"SELECT {_COLUMNS} FROM public.account_data_exports WHERE user_id = CAST(:uid AS uuid) "
            "AND status IN ('queued', 'building') LIMIT 1"
        ), {"uid": user_id})).first()
        if running is not None:
            return _job(running), False
        recent = (await conn.execute(text(
            "SELECT ready_at FROM public.account_data_exports WHERE user_id = CAST(:uid AS uuid) "
            "AND status = 'ready' AND ready_at > :since ORDER BY ready_at DESC LIMIT 1"
        ), {"uid": user_id, "since": now - timedelta(hours=cooldown_hours)})).first()
        if recent is not None:
            retry = recent._mapping["ready_at"] + timedelta(hours=cooldown_hours)
            err = AccountDataError(429, "export_recently_requested",
                                   "Bạn vừa có một gói tải dữ liệu. Bạn yêu cầu gói mới sau ít giờ nữa nhé.")
            err.retry_after = max(1, int((retry - now).total_seconds()))  # type: ignore[attr-defined]
            raise err
        row = (await conn.execute(text(
            "INSERT INTO public.account_data_exports (user_id) VALUES (CAST(:uid AS uuid)) "
            f"RETURNING {_COLUMNS}"
        ), {"uid": user_id})).first()
    return _job(row), True


async def resolve_download(engine: Any, user_id: str, export_id: str,
                           now: Optional[datetime] = None) -> str:
    """FR-012: the object path to sign, or the refusal."""
    now = now or datetime.now(timezone.utc)
    not_found = AccountDataError(404, "export_not_found", "Không tìm thấy gói tải dữ liệu này.")
    async with engine.connect() as conn:
        if await _erasing(conn, user_id):
            raise not_found
        row = (await conn.execute(text(
            f"SELECT {_COLUMNS} FROM public.account_data_exports "
            "WHERE id = CAST(:eid AS uuid) AND user_id = CAST(:uid AS uuid)"
        ), {"eid": export_id, "uid": user_id})).first()
    if row is None:
        raise not_found
    job = _job(row)
    status = job.visible_status(now)
    if status in ("expired", "purged"):
        raise AccountDataError(410, "export_expired", "Gói tải dữ liệu đã hết hạn. Bạn yêu cầu gói mới nhé.")
    if status != "ready" or not job.object_path:
        raise AccountDataError(409, "export_not_ready", "Gói tải dữ liệu chưa sẵn sàng.")
    return job.object_path


# ── Package builder (T006, plan section 6) ───────────────────────────────────


EXPORT_BUCKET = "account-exports"
AUDIO_BUCKET = "audio-responses"
ERROR_CODE_MAX = 80


class StorageAdapter:
    """The Storage calls the jobs need. Production wraps
    ``supabase_admin.storage``; tests pass an in-memory fake."""

    def __init__(self, client: Any = None):
        self._client = client

    def _bucket(self, bucket: str):
        if self._client is None:
            from database import supabase_admin
            self._client = supabase_admin
        return self._client.storage.from_(bucket)

    def list_prefix(self, bucket: str, prefix: str) -> list[str]:
        """Every object path under ``prefix`` (recursive, paged)."""
        out: list[str] = []
        stack = [prefix.rstrip("/")]
        while stack:
            folder = stack.pop()
            offset = 0
            while True:
                items = self._bucket(bucket).list(folder, {"limit": 1000, "offset": offset}) or []
                for item in items:
                    name = item.get("name")
                    if not name:
                        continue
                    path = f"{folder}/{name}" if folder else name
                    if item.get("id") is None:  # a folder
                        stack.append(path)
                    else:
                        out.append(path)
                if len(items) < 1000:
                    break
                offset += 1000
        return out

    def download(self, bucket: str, path: str) -> bytes:
        return self._bucket(bucket).download(path)

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self._bucket(bucket).upload(path, data, {"content-type": content_type, "x-upsert": "false"})

    def remove(self, bucket: str, paths: list[str]) -> None:
        for i in range(0, len(paths), 100):
            self._bucket(bucket).remove(paths[i:i + 100])


def export_path(user_id: str, export_id: str, claim_token: str) -> str:
    return f"{user_id}/{export_id}/{claim_token}.zip"


@dataclass(frozen=True)
class Claim:
    id: str
    user_id: str
    claim_token: str
    owner: str

    @property
    def path(self) -> str:
        return export_path(self.user_id, self.id, self.claim_token)


async def claim_next(engine: Any, owner: str, lease_seconds: int) -> Optional[Claim]:
    """Take one ``queued`` job (or a ``building`` one whose lease ran out)
    with a fresh ``claim_token``. Jobs of accounts that are erasing or erased
    are skipped (the erasure claim cancels them)."""
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "WITH next AS ("
            "  SELECT e.id FROM public.account_data_exports e "
            "   WHERE (e.status = 'queued' OR (e.status = 'building' AND e.lease_until < now())) "
            "     AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests d "
            "                      WHERE d.user_id = e.user_id AND d.status IN ('erasing', 'erased')) "
            "   ORDER BY e.requested_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "UPDATE public.account_data_exports x SET status = 'building', export_owner = :owner, "
            "       claim_token = gen_random_uuid(), lease_until = now() + make_interval(secs => :lease), "
            "       started_at = coalesce(x.started_at, now()) "
            "  FROM next WHERE x.id = next.id "
            "RETURNING x.id, x.user_id, x.claim_token"
        ), {"owner": owner, "lease": int(lease_seconds)})).first()
    if row is None:
        return None
    m = row._mapping
    return Claim(id=str(m["id"]), user_id=str(m["user_id"]), claim_token=str(m["claim_token"]), owner=owner)


async def renew(engine: Any, claim: Claim, lease_seconds: int) -> bool:
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "UPDATE public.account_data_exports SET lease_until = now() + make_interval(secs => :lease) "
            "WHERE id = CAST(:id AS uuid) AND status = 'building' AND export_owner = :owner "
            "  AND claim_token = CAST(:token AS uuid) AND lease_until >= now() RETURNING id"
        ), {"id": claim.id, "owner": claim.owner, "token": claim.claim_token,
            "lease": int(lease_seconds)})).first()
    return row is not None


async def complete(engine: Any, claim: Claim, size_bytes: int, link_days: int) -> Optional[datetime]:
    """Conditional ``ready`` (plan section 6): only this claim, lease still
    held, and the account not erasing. Returns ``expires_at`` or None."""
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "UPDATE public.account_data_exports SET status = 'ready', ready_at = now(), "
            "       expires_at = now() + make_interval(days => :days), object_path = :path, "
            "       size_bytes = :size, manifest_version = :version, lease_until = NULL, last_error_code = NULL "
            "WHERE id = CAST(:id AS uuid) AND status = 'building' AND export_owner = :owner "
            "  AND claim_token = CAST(:token AS uuid) AND lease_until >= now() "
            "  AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests "
            "                   WHERE user_id = CAST(:uid AS uuid) AND status IN ('erasing', 'erased')) "
            "RETURNING expires_at"
        ), {"id": claim.id, "owner": claim.owner, "token": claim.claim_token, "uid": claim.user_id,
            "path": claim.path, "size": int(size_bytes), "days": int(link_days),
            "version": inventory.INVENTORY_VERSION})).first()
    return row._mapping["expires_at"] if row else None


async def fail(engine: Any, claim: Claim, code: str, *, keep_lease: bool = False) -> None:
    """``failed``; the learner may ask again at once. ``keep_lease`` leaves
    ``lease_until`` as it is when an upload may still be in flight."""
    async with engine.begin() as conn:
        await conn.execute(text(
            "UPDATE public.account_data_exports SET status = 'failed', "
            "       lease_until = CASE WHEN :keep THEN lease_until ELSE NULL END, "
            "       last_error_code = :code "
            "WHERE id = CAST(:id AS uuid) AND status = 'building' AND export_owner = :owner "
            "  AND claim_token = CAST(:token AS uuid)"
        ), {"id": claim.id, "owner": claim.owner, "token": claim.claim_token, "code": code[:ERROR_CODE_MAX],
            "keep": keep_lease})


# ── Package content ─────────────────────────────────────────────────────────


def _subject_column(column: str) -> str:
    """``student_id`` columns hold ``students.id``; every other learner
    column (``user_id``, ``learner_id``, ``used_by``, ``*_user_id``) holds
    the user id."""
    return "student" if column == "student_id" else "user"


async def _student_ids(conn: Any, user_id: str) -> list[str]:
    rows = (await conn.execute(text(
        "SELECT id FROM public.students WHERE user_id = CAST(:uid AS uuid)"), {"uid": user_id})).all()
    return [str(r[0]) for r in rows]


async def _existing_tables(conn: Any, names: set[str]) -> set[str]:
    rows = (await conn.execute(text(
        "SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace "
        "AND c.relkind IN ('r', 'p') AND c.relname = ANY(:names)"), {"names": sorted(names)})).all()
    return {r[0] for r in rows}


def export_entries() -> list[inventory.Entry]:
    return [e for e in inventory.INVENTORY if e.export and e.action in ("delete", "anonymize", "keep")]


async def collect_rows(engine: Any, user_id: str) -> tuple[dict[str, list[dict]], list[dict]]:
    """``{"table.column": rows}`` for every exported entry, plus the child
    tables of exported parents, read in one REPEATABLE READ snapshot.
    Returns ``(data, skipped)``; a table not present here is listed in
    ``skipped`` with the reason (FR-011 manifest)."""
    data: dict[str, list[dict]] = {}
    skipped: list[dict] = []
    entries = export_entries()
    async with engine.connect() as conn:
        await conn.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
        present = await _existing_tables(conn, {e.table for e in entries} | set(inventory.CHILD_TABLES))
        students = await _student_ids(conn, user_id)
        parent_ids: dict[str, list[str]] = {}
        for e in entries:
            if e.table not in present:
                skipped.append({"table": e.table, "reason": "table_not_present"})
                continue
            ids = students if _subject_column(e.column) == "student" else [user_id]
            if e.table == "users" and e.column == "id":
                sql = "SELECT * FROM public.users WHERE id = CAST(:uid AS uuid)"
                rows = (await conn.execute(text(sql), {"uid": user_id})).mappings().all()
            else:
                if not ids:
                    continue
                sql = f'SELECT * FROM public."{e.table}" WHERE "{e.column}"::text = ANY(:ids)'
                rows = (await conn.execute(text(sql), {"ids": ids})).mappings().all()
            data[f"{e.table}.{e.column}"] = [dict(r) for r in rows]
            parent_ids.setdefault(e.table, []).extend(str(r["id"]) for r in rows if "id" in r)
        for child, parent in inventory.CHILD_TABLES.items():
            ids = parent_ids.get(parent)
            if child not in present or not ids:
                continue
            fk = (await conn.execute(text(
                "SELECT a.attname FROM pg_constraint c "
                "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] "
                "WHERE c.contype = 'f' AND c.conrelid = CAST(:child AS regclass) "
                "  AND c.confrelid = CAST(:parent AS regclass) LIMIT 1"
            ), {"child": f"public.{child}", "parent": f"public.{parent}"})).scalar()
            if not fk:
                skipped.append({"table": child, "reason": "no_foreign_key_to_parent"})
                continue
            rows = (await conn.execute(text(
                f'SELECT * FROM public."{child}" WHERE "{fk}"::text = ANY(:ids)'), {"ids": ids})).mappings().all()
            data[f"{child}.{fk}"] = [dict(r) for r in rows]
    return data, skipped


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return None
    return str(value)


def build_zip(data: dict[str, list[dict]], pdfs: dict[str, bytes], audio: dict[str, bytes],
              skipped: list[dict], *, now: datetime, max_bytes: int) -> bytes:
    """FR-011: JSON per table, PDF sheets, recordings while under the cap.
    Over ``max_bytes`` the recordings are left out and the manifest says so."""

    def write(include_audio: bool) -> bytes:
        buf = io.BytesIO()
        files: list[str] = []
        left_out = list(skipped)
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for key, rows in sorted(data.items()):
                name = f"data/{key}.json"
                zf.writestr(name, json.dumps(rows, ensure_ascii=False, indent=1, default=_json_default))
                files.append(name)
            for session_id, pdf in sorted(pdfs.items()):
                name = f"speaking/{session_id}.pdf"
                zf.writestr(name, pdf)
                files.append(name)
            if include_audio:
                for path, blob in sorted(audio.items()):
                    name = f"recordings/{path}"
                    zf.writestr(name, blob)
                    files.append(name)
            elif audio:
                left_out.append({"part": "recordings", "count": len(audio), "reason": "package_over_size_limit"})
            zf.writestr("manifest.json", json.dumps({
                "generated_at": now.isoformat(), "inventory_version": inventory.INVENTORY_VERSION,
                "files": files, "left_out": left_out}, ensure_ascii=False, indent=1))
        return buf.getvalue()

    blob = write(True)
    if len(blob) > max_bytes and audio:
        blob = write(False)
    return blob


async def speaking_pdfs(data: dict[str, list[dict]], render: Any = None) -> tuple[dict[str, bytes], list[dict]]:
    """A PDF sheet per completed Speaking session (``services.pdf_generator``)."""
    if render is None:
        from services.pdf_generator import generate_session_pdf as render
    out: dict[str, bytes] = {}
    failed: list[dict] = []
    for row in data.get("sessions.user_id", []):
        if row.get("status") != "completed":
            continue
        sid = str(row["id"])
        try:
            out[sid] = await render(sid)
        except Exception as exc:  # one bad sheet never fails the package
            logger.warning("[account_export] pdf failed session=%s: %r", sid, exc)
            failed.append({"part": f"speaking/{sid}.pdf", "reason": "pdf_failed"})
    return out, failed


async def run_one(engine: Any, *, owner: str, storage: StorageAdapter, lease_seconds: int, max_bytes: int,
                  link_days: int, send: Any = None, render_pdf: Any = None,
                  now: Optional[datetime] = None) -> Optional[str]:
    """Claim and build one package. Returns the job's final state for the
    sweep log (``ready``, ``failed:<code>``, ``lost``) or None when idle."""
    claim = await claim_next(engine, owner, lease_seconds)
    if claim is None:
        return None
    now = now or datetime.now(timezone.utc)
    uploading = False
    try:
        data, skipped = await collect_rows(engine, claim.user_id)
        pdfs, pdf_skipped = await speaking_pdfs(data, render_pdf)
        audio: dict[str, bytes] = {}
        for path in await asyncio.to_thread(storage.list_prefix, AUDIO_BUCKET, claim.user_id):
            audio[path] = await asyncio.to_thread(storage.download, AUDIO_BUCKET, path)
        blob = build_zip(data, pdfs, audio, skipped + pdf_skipped, now=now, max_bytes=max_bytes)
        if len(blob) > max_bytes:
            await fail(engine, claim, "package_too_large")
            return "failed:package_too_large"
        # Renew just before the upload; the upload must end inside the lease
        # (CR/SA R3), so its timeout is half the lease.
        if not await renew(engine, claim, lease_seconds):
            return "lost"
        uploading = True
        await asyncio.wait_for(
            asyncio.to_thread(storage.upload, EXPORT_BUCKET, claim.path, blob, "application/zip"),
            timeout=max(1, lease_seconds // 2))
        expires_at = await complete(engine, claim, len(blob), link_days)
        if expires_at is None:
            # Cancelled or taken over while uploading: remove only our path.
            await asyncio.to_thread(storage.remove, EXPORT_BUCKET, [claim.path])
            return "lost"
    except Exception as exc:
        code = getattr(exc, "error_code", None) or type(exc).__name__
        logger.warning("[account_export] build failed export=%s code=%s: %r", claim.id, code, exc)
        # A timed-out upload may still be running in its thread: keep the
        # lease, which the erasure waits out (FR-014 c), instead of clearing it.
        await fail(engine, claim, f"build_failed:{code}", keep_lease=uploading)
        return f"failed:{code}"
    await _send_ready_letter(engine, claim, expires_at, send)
    return "ready"


async def _send_ready_letter(engine: Any, claim: Claim, expires_at: datetime, send: Any) -> None:
    """FR-012: the letter links to the account page only."""
    if send is None:
        from services.learner_email import send_direct as send
    try:
        async with engine.connect() as conn:
            row = (await conn.execute(text(
                "SELECT email, display_name FROM public.users WHERE id = CAST(:uid AS uuid)"
            ), {"uid": claim.user_id})).first()
        email = (row._mapping["email"] if row else "") or ""
        if not email.strip():
            return
        result = await send("account_export_ready", email.strip(),
                            {"expires_at": expires_at, "display_name": row._mapping["display_name"]},
                            idempotency_key=f"account-export-ready-{claim.id}")
        if not getattr(result, "ok", False):
            logger.warning("[account_export] ready letter not sent export=%s code=%s", claim.id,
                           getattr(result, "error", None))
    except Exception as exc:
        logger.warning("[account_export] ready letter failed export=%s: %r", claim.id, exc)


async def cleanup(engine: Any, storage: StorageAdapter, now: Optional[datetime] = None) -> dict:
    """Plan section 6 periodic cleanup. Lists the bucket FIRST, then reads the
    DB (CR/SA R3): an object uploaded after the listing is not seen, so it
    cannot be removed by mistake; one uploaded before the DB read is kept
    only if the DB then says it is live."""
    now = now or datetime.now(timezone.utc)
    listed = await asyncio.to_thread(storage.list_prefix, EXPORT_BUCKET, "")
    async with engine.begin() as conn:
        expired = (await conn.execute(text(
            "UPDATE public.account_data_exports SET status = 'expired' "
            "WHERE status = 'ready' AND expires_at <= :now RETURNING object_path"), {"now": now})).all()
        live = (await conn.execute(text(
            "SELECT object_path AS path FROM public.account_data_exports "
            " WHERE status = 'ready' AND expires_at > :now AND object_path IS NOT NULL "
            "UNION ALL "
            "SELECT user_id::text || '/' || id::text || '/' || claim_token::text || '.zip' "
            "  FROM public.account_data_exports "
            " WHERE status = 'building' AND lease_until >= :now AND claim_token IS NOT NULL"), {"now": now})).all()
    keep = {r[0] for r in live}
    stray = [p for p in listed if p not in keep]
    if stray:
        await asyncio.to_thread(storage.remove, EXPORT_BUCKET, stray)
    return {"expired": len(expired), "removed": len(stray)}
