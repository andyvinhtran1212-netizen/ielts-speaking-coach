"""Admin Library console API (LIBRARY-0061 T020 / G06-T20; plan "API admin").

* ``GET   /admin/library/writing-samples``           — list, filters, server counts.
* ``PATCH /admin/library/writing-samples/{id}``      — quick edit ``title_en`` / ``topic_slug``.
* ``POST  /admin/library/writing-samples/publish``   — publish or unpublish 1–50 sets.
* ``GET   /admin/library/speaking-samples``          — list, filters, server counts.
* ``PATCH /admin/library/speaking-samples/{id}``     — quick edit ``title_en`` / ``topic_slug``.
* ``POST  /admin/library/speaking-samples/publish``  — publish or unpublish 1–50 items.

Every route awaits ``require_admin`` first (ADMINAAL2-0032). Publishing re-checks
the publish conditions on the server for every requested row and returns the
rows it refused with their reasons; refused rows keep their ``published`` value.
Every change writes one ``governance_audit`` row (the existing admin audit).

Not here yet (deviation from plan, recorded in the PR): the slug change behind
the danger zone. It must move ``writing_sample_slug_history`` and
``library_marks.item_key`` in one transaction, which needs an RPC and so a
migration. The ``import`` tab has no route: the batch log (G09-T36) is not on
this branch, and the page says so.
"""

from __future__ import annotations

import asyncio
import json
import logging
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import _actor_id, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/library", tags=["admin-library"])

PAGE_SIZE = 50
BULK_MAX = 50
Q_MAX_LENGTH = 100
TITLE_MIN, TITLE_MAX = 3, 70  # same bounds as scripts/import_writing_samples.py and the DB CHECK
_BANDS = ("7.5", "7.0", "6.0")

_WRITING_LIST_COLUMNS = (
    "id, slug, title_en, task_type, question_type, task1_subtype, topic_slug, "
    "prompt_image_path, source_review_status, published, published_at, updated_at"
)
_WRITING_GATE_COLUMNS = _WRITING_LIST_COLUMNS + ", essays, delta_75_70, delta_70_60"
_SPEAKING_LIST_COLUMNS = (
    "id, slug, part, title_en, title_vi, topic_slug, video_source, duration_s, "
    "audio_path, published, published_at, updated_at"
)
_SPEAKING_GATE_COLUMNS = _SPEAKING_LIST_COLUMNS + ", sample_text"

MESSAGES = {
    "E_NO_TITLE": "Tiêu đề tiếng Anh thiếu, dài ngoài 3–70 ký tự, có dấu tiếng Việt hoặc trùng bài khác.",
    # Speaking titles have no length bound (import_speaking contract); same code, own wording.
    "E_NO_TITLE_SPEAKING": "Tiêu đề tiếng Anh thiếu hoặc có dấu tiếng Việt.",
    "E_TOPIC": "Chủ đề không có trong danh sách chủ đề của kệ này.",
    "E_NO_REVIEW": "Bộ bài chưa được duyệt nội dung.",
    "E_FIGURE": "Đề Task 1 chưa có hình đề.",
    "E_ESSAYS": "Thiếu một trong ba bài 7.5 / 7.0 / 6.0.",
    "E_PAIR": "Thiếu nhật ký khác biệt giữa các mức điểm.",
    "E_NO_SAMPLE": "Chưa có câu trả lời mẫu.",
    "E_NOT_FOUND": "Không tìm thấy mục này.",
}


# ── Models ───────────────────────────────────────────────────────────────────


class Blocker(BaseModel):
    code: str
    message: str


class TopicOption(BaseModel):
    slug: str
    label_vi: str


class Counts(BaseModel):
    all: int
    published: int
    draft: int


class WritingSampleRow(BaseModel):
    id: str
    slug: str
    title_en: str
    task_type: str
    question_type: Optional[str]
    task1_subtype: Optional[str]
    topic_slug: Optional[str]
    published: bool
    published_at: Optional[str]
    updated_at: Optional[str]
    blockers: list[Blocker]


class WritingSampleList(BaseModel):
    items: list[WritingSampleRow]
    total: int
    page: int
    page_size: int
    counts: Counts
    topics: list[TopicOption]


class SpeakingSampleRow(BaseModel):
    id: str
    slug: str
    part: int
    title_en: str
    title_vi: Optional[str]
    topic_slug: Optional[str]
    video_source: Optional[str]
    duration_s: Optional[int]
    has_audio: bool
    published: bool
    published_at: Optional[str]
    updated_at: Optional[str]
    blockers: list[Blocker]


class SpeakingSampleList(BaseModel):
    items: list[SpeakingSampleRow]
    total: int
    page: int
    page_size: int
    counts: Counts
    topics: list[TopicOption]


class SampleEdit(BaseModel):
    title_en: Optional[str] = Field(default=None, max_length=200)
    topic_slug: Optional[str] = Field(default=None, max_length=80)


class PublishRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=BULK_MAX)
    published: bool


class Rejected(BaseModel):
    id: str
    slug: Optional[str]
    reasons: list[Blocker]


class PublishResult(BaseModel):
    changed: list[str]
    unchanged: list[str]
    rejected: list[Rejected]
    audit_logged: bool


class EditResult(BaseModel):
    id: str
    changed: list[str]
    audit_logged: bool


# ── Helpers ──────────────────────────────────────────────────────────────────


def has_vietnamese_marks(value: str) -> bool:
    """Same rule as ``scripts/import_writing_samples.has_vietnamese_marks``."""
    if "đ" in value.lower():
        return True
    return any(unicodedata.combining(ch) for ch in unicodedata.normalize("NFD", value)
               if not ch.isascii())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _unavailable(exc: Exception) -> HTTPException:
    logger.exception("[admin_library] database call failed", exc_info=exc)
    return HTTPException(503, {"code": "library_unavailable",
                               "message": "Chưa đọc được dữ liệu Thư viện. Thử tải lại sau ít phút."})


def _blocker(code: str, message_key: Optional[str] = None) -> dict:
    return {"code": code, "message": MESSAGES[message_key or code]}


_READ_PAGE = 1000  # PostgREST max-rows; every whole-table read walks it in pages


def _paged(build) -> list[dict]:
    """All rows of ``build()`` (a fresh query each call), read 1000 at a time
    so a shelf larger than PostgREST's row cap is never silently cut."""
    rows: list[dict] = []
    start = 0
    while True:
        page = build().range(start, start + _READ_PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _READ_PAGE:
            return rows
        start += _READ_PAGE


def _is_uuid(value: Any) -> bool:
    try:
        uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return False
    return True


def _title_problem(title: Any, *, taken: set[str]) -> bool:
    if not isinstance(title, str) or not title.strip():
        return True
    if not TITLE_MIN <= len(title) <= TITLE_MAX or has_vietnamese_marks(title):
        return True
    return title.strip().casefold() in taken


def _other_titles(rows: list[dict], own_id: Any) -> set[str]:
    return {str(r.get("title_en") or "").strip().casefold()
            for r in rows if r.get("id") != own_id and r.get("title_en")}


def _topics(shelf: str) -> dict[str, dict]:
    rows = _paged(lambda: supabase_admin.table("library_topics")
                  .select("slug, label_vi, shelves, display_order").order("slug"))
    ordered = sorted((r for r in rows if shelf in (r.get("shelves") or [])),
                     key=lambda r: (r.get("display_order") or 0, r.get("slug") or ""))
    return {r["slug"]: r for r in ordered}


def _writing_blockers(row: dict, *, topics: dict, taken: set[str], full: bool) -> list[dict]:
    """Publish conditions for one Writing set. ``full`` adds the checks that
    need the heavy jsonb columns (run only on the rows being published)."""
    out = []
    if _title_problem(row.get("title_en"), taken=taken):
        out.append(_blocker("E_NO_TITLE"))
    if row.get("topic_slug") not in topics:
        out.append(_blocker("E_TOPIC"))
    if not str(row.get("source_review_status") or "").strip():
        out.append(_blocker("E_NO_REVIEW"))
    if row.get("task_type") == "task1_academic" and not row.get("prompt_image_path"):
        out.append(_blocker("E_FIGURE"))
    if full:
        essays = row.get("essays") if isinstance(row.get("essays"), dict) else {}
        if any(not isinstance(essays.get(b), dict) or not str(essays[b].get("text") or "").strip()
               for b in _BANDS):
            out.append(_blocker("E_ESSAYS"))
        if any(not isinstance(row.get(k), list) or not row.get(k) for k in ("delta_75_70", "delta_70_60")):
            out.append(_blocker("E_PAIR"))
    return out


def _speaking_blockers(row: dict, *, topics: dict, full: bool) -> list[dict]:
    out = []
    title = row.get("title_en")
    if not isinstance(title, str) or not title.strip() or has_vietnamese_marks(title):
        out.append(_blocker("E_NO_TITLE", "E_NO_TITLE_SPEAKING"))
    # topic_slug may be null ("Chủ đề khác", N2); a set value must be a speaking topic.
    if row.get("topic_slug") is not None and row.get("topic_slug") not in topics:
        out.append(_blocker("E_TOPIC"))
    if full and not str(row.get("sample_text") or "").strip():
        out.append(_blocker("E_NO_SAMPLE"))
    return out


def _counts(rows: list[dict]) -> dict:
    published = sum(1 for r in rows if r.get("published") is True)
    return {"all": len(rows), "published": published, "draft": len(rows) - published}


def _page(rows: list[dict], page: int) -> list[dict]:
    start = (page - 1) * PAGE_SIZE
    return rows[start:start + PAGE_SIZE]


def _needle(q: Optional[str]) -> Optional[str]:
    return q.strip().casefold() if q and q.strip() else None


def _audit(admin: dict, action: str, detail: dict) -> bool:
    """One governance_audit row per change. A failed write is logged and
    reported to the caller (``audit_logged: false``), never swallowed."""
    try:
        supabase_admin.table("governance_audit").insert({
            "action": action,
            "admin_id": _actor_id(admin),
            "detail": json.dumps(detail, ensure_ascii=False, sort_keys=True),
        }).execute()
        return True
    except Exception:  # noqa: BLE001
        logger.exception("[admin_library] audit write failed action=%s", action)
        return False


# ── Writing ──────────────────────────────────────────────────────────────────


@router.get("/writing-samples", response_model=WritingSampleList)
async def list_writing_samples(
    status: Literal["all", "published", "draft"] = "all",
    task: Optional[Literal["task2", "task1"]] = None,
    topic: Optional[str] = Query(default=None, max_length=80),
    q: Optional[str] = Query(default=None, max_length=Q_MAX_LENGTH),
    page: int = Query(default=1, ge=1, le=1000),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    def read():
        rows = _paged(lambda: supabase_admin.table("writing_samples")
                      .select(_WRITING_LIST_COLUMNS).order("id"))
        return rows, _topics("writing")

    try:
        rows, topics = await asyncio.to_thread(read)
    except Exception as exc:  # noqa: BLE001
        raise _unavailable(exc) from exc

    rows.sort(key=lambda r: (0 if r.get("task_type") == "task2" else 1,
                             str(r.get("title_en") or "").casefold(), r.get("slug") or ""))
    stored_task = {"task2": "task2", "task1": "task1_academic"}.get(task or "")
    needle = _needle(q)
    scoped = [r for r in rows
              if (not stored_task or r.get("task_type") == stored_task)
              and (not topic or r.get("topic_slug") == topic)
              and (not needle or needle in str(r.get("title_en") or "").casefold()
                   or needle in str(r.get("slug") or "").casefold())]
    counts = _counts(scoped)
    if status != "all":
        scoped = [r for r in scoped if (r.get("published") is True) == (status == "published")]
    items = []
    for r in _page(scoped, page):
        items.append({
            **{k: r.get(k) for k in ("id", "slug", "title_en", "task_type", "question_type",
                                     "task1_subtype", "topic_slug", "published_at", "updated_at")},
            "published": r.get("published") is True,
            "blockers": _writing_blockers(r, topics=topics, taken=_other_titles(rows, r.get("id")),
                                          full=False),
        })
    return {
        "items": items, "total": len(scoped), "page": page, "page_size": PAGE_SIZE,
        "counts": counts,
        "topics": [{"slug": s, "label_vi": t.get("label_vi") or s} for s, t in topics.items()],
    }


@router.patch("/writing-samples/{sample_id}", response_model=EditResult)
async def edit_writing_sample(
    sample_id: str, body: SampleEdit, authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    return await _edit("writing_samples", "writing", sample_id, body, admin)


@router.post("/writing-samples/publish", response_model=PublishResult)
async def publish_writing_samples(body: PublishRequest, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    return await _publish("writing_samples", "writing", body, admin)


# ── Speaking ─────────────────────────────────────────────────────────────────


@router.get("/speaking-samples", response_model=SpeakingSampleList)
async def list_speaking_samples(
    status: Literal["all", "published", "draft"] = "all",
    part: Optional[int] = Query(default=None, ge=1, le=3),
    topic: Optional[str] = Query(default=None, max_length=80),
    q: Optional[str] = Query(default=None, max_length=Q_MAX_LENGTH),
    page: int = Query(default=1, ge=1, le=1000),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    def read():
        rows = _paged(lambda: supabase_admin.table("speaking_samples")
                      .select(_SPEAKING_LIST_COLUMNS).order("id"))
        return rows, _topics("speaking")

    try:
        rows, topics = await asyncio.to_thread(read)
    except Exception as exc:  # noqa: BLE001
        raise _unavailable(exc) from exc

    rows.sort(key=lambda r: (r.get("part") or 0, str(r.get("title_en") or "").casefold(), r.get("slug") or ""))
    needle = _needle(q)
    scoped = [r for r in rows
              if (part is None or r.get("part") == part)
              and (not topic or r.get("topic_slug") == topic)
              and (not needle or needle in str(r.get("title_en") or "").casefold()
                   or needle in str(r.get("slug") or "").casefold())]
    counts = _counts(scoped)
    if status != "all":
        scoped = [r for r in scoped if (r.get("published") is True) == (status == "published")]
    items = [{
        **{k: r.get(k) for k in ("id", "slug", "part", "title_en", "title_vi", "topic_slug",
                                 "video_source", "duration_s", "published_at", "updated_at")},
        "has_audio": bool(r.get("audio_path")),
        "published": r.get("published") is True,
        "blockers": _speaking_blockers(r, topics=topics, full=False),
    } for r in _page(scoped, page)]
    return {
        "items": items, "total": len(scoped), "page": page, "page_size": PAGE_SIZE,
        "counts": counts,
        "topics": [{"slug": s, "label_vi": t.get("label_vi") or s} for s, t in topics.items()],
    }


@router.patch("/speaking-samples/{sample_id}", response_model=EditResult)
async def edit_speaking_sample(
    sample_id: str, body: SampleEdit, authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    return await _edit("speaking_samples", "speaking", sample_id, body, admin)


@router.post("/speaking-samples/publish", response_model=PublishResult)
async def publish_speaking_samples(body: PublishRequest, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    return await _publish("speaking_samples", "speaking", body, admin)


# ── Shared edit / publish ────────────────────────────────────────────────────


def _edit_error(code: str, message: str, status: int = 422) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


async def _edit(table: str, shelf: str, sample_id: str, body: SampleEdit, admin: dict) -> dict:
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise _edit_error("nothing_to_change", "Không có trường nào để lưu.")
    if "title_en" in fields:
        fields["title_en"] = (fields["title_en"] or "").strip()

    if not _is_uuid(sample_id):  # ids are uuid; anything else cannot exist
        raise _edit_error("not_found", MESSAGES["E_NOT_FOUND"], 404)

    def read():
        found = (supabase_admin.table(table).select("id, slug, title_en, topic_slug")
                 .eq("id", sample_id).limit(1).execute().data or [])
        if not found:
            return None, [], {}
        # Only a Writing title change needs every other title (uniqueness).
        titles = (_paged(lambda: supabase_admin.table(table).select("id, title_en").order("id"))
                  if shelf == "writing" and "title_en" in fields else [])
        return found[0], titles, _topics(shelf)

    try:
        current, rows, topics = await asyncio.to_thread(read)
    except Exception as exc:  # noqa: BLE001
        raise _unavailable(exc) from exc
    if current is None:
        raise _edit_error("not_found", MESSAGES["E_NOT_FOUND"], 404)

    if "title_en" in fields:
        title = fields["title_en"]
        bounded = TITLE_MIN <= len(title) <= TITLE_MAX if shelf == "writing" else bool(title)
        if not bounded or has_vietnamese_marks(title):
            raise _edit_error("invalid_title", (
                "Tiêu đề tiếng Anh dài 3–70 ký tự, không có dấu tiếng Việt." if shelf == "writing"
                else "Nhập tiêu đề tiếng Anh, không có dấu tiếng Việt."))
        if shelf == "writing" and title.casefold() in _other_titles(rows, current.get("id")):
            raise _edit_error("duplicate_title", "Tiêu đề này đã dùng cho một bộ bài khác.")
    if "topic_slug" in fields:
        slug = fields["topic_slug"]
        if (slug is None and shelf == "writing") or (slug is not None and slug not in topics):
            raise _edit_error("invalid_topic", MESSAGES["E_TOPIC"])

    changed = sorted(k for k, v in fields.items() if current.get(k) != v)
    if not changed:
        return {"id": sample_id, "changed": [], "audit_logged": True}
    update = {k: fields[k] for k in changed}
    update["updated_at"] = _now()  # plan: updated_at moves when the title or topic changes

    try:
        await asyncio.to_thread(
            lambda: supabase_admin.table(table).update(update).eq("id", current["id"]).execute())
    except Exception as exc:  # noqa: BLE001
        raise _unavailable(exc) from exc
    logged = await asyncio.to_thread(_audit, admin, "library_edit", {
        "shelf": shelf, "id": str(current["id"]), "slug": current.get("slug"),
        "before": {k: current.get(k) for k in changed}, "after": {k: fields[k] for k in changed},
    })
    return {"id": sample_id, "changed": changed, "audit_logged": logged}


async def _publish(table: str, shelf: str, body: PublishRequest, admin: dict) -> dict:
    ids = list(dict.fromkeys(body.ids))  # de-duplicate, keep order
    columns = _WRITING_GATE_COLUMNS if shelf == "writing" else _SPEAKING_GATE_COLUMNS
    # A non-uuid id cannot exist; keep it out of the query (Postgres would
    # reject the whole batch) and refuse it below as not found.
    lookup = [sid for sid in ids if _is_uuid(sid)]

    def read():
        targets = (supabase_admin.table(table).select(columns).in_("id", lookup).execute().data or []
                   if lookup else [])
        titles = (_paged(lambda: supabase_admin.table(table).select("id, title_en").order("id"))
                  if shelf == "writing" and body.published else [])
        return targets, titles, (_topics(shelf) if body.published else {})

    try:
        targets, titles, topics = await asyncio.to_thread(read)
    except Exception as exc:  # noqa: BLE001
        raise _unavailable(exc) from exc
    by_id = {str(r.get("id")): r for r in targets}

    rejected, ready, unchanged = [], [], []
    for sid in ids:
        row = by_id.get(sid)
        if row is None:
            rejected.append({"id": sid, "slug": None, "reasons": [_blocker("E_NOT_FOUND")]})
            continue
        if (row.get("published") is True) == body.published:
            unchanged.append(sid)
            continue
        if body.published:
            reasons = (_writing_blockers(row, topics=topics, taken=_other_titles(titles, row.get("id")),
                                         full=True)
                       if shelf == "writing" else _speaking_blockers(row, topics=topics, full=True))
            if reasons:
                rejected.append({"id": sid, "slug": row.get("slug"), "reasons": reasons})
                continue
        ready.append(row)

    if ready:
        update: dict[str, Any] = {"published": body.published}
        if body.published:
            update["published_at"] = _now()
        try:
            await asyncio.to_thread(
                lambda: supabase_admin.table(table).update(update)
                .in_("id", [r["id"] for r in ready]).execute())
        except Exception as exc:  # noqa: BLE001
            raise _unavailable(exc) from exc

    action = "library_publish" if body.published else "library_unpublish"
    logger.info("admin_library_publish shelf=%s action=%s requested=%d changed=%d rejected=%d",
                shelf, action, len(ids), len(ready), len(rejected))
    logged = True
    if ready:
        logged = await asyncio.to_thread(_audit, admin, action, {
            "shelf": shelf, "ids": [str(r["id"]) for r in ready], "slugs": [r.get("slug") for r in ready],
            "rejected": [{"id": r["id"], "codes": [b["code"] for b in r["reasons"]]} for r in rejected],
        })
    return {
        "changed": [str(r["id"]) for r in ready],
        "unchanged": unchanged,
        "rejected": rejected,
        "audit_logged": logged,
    }
