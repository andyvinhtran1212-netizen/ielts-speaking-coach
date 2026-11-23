"""COURSEACCESS-0055 plan 5.14 / FR-048 — how long a learner's content stays
visible, from their course access.

``content_window(user_id)`` answers one learner (read time);
``content_windows(user_ids)`` answers a sweep batch. The rule, behind the
runtime flag ``retention_by_entitlement`` (off → ``default`` for everyone,
exactly today's 60 days by session age):

1. any access that is live right now (an active ``entitlements`` row that
   has started and not ended, a class membership, a live legacy code)
   → ``open``: no cut-off. Checked first, so a learner on an old code is
   never cut off for having no ``entitlements`` row;
2. never had an ``entitlements`` row → ``default``;
3. otherwise ``until``: ``E + RETENTION_CONTENT_DAYS_AFTER_EXPIRY`` days,
   where ``E`` is the latest end over all their rows (``expires_at``, or
   ``revoked_at`` when that is earlier).

Audio is not decided here: it always follows ``RETENTION_AUDIO_DAYS``.

Failure: read time falls back to ``default`` (can only hide sooner, deletes
nothing); the sweep gets ``None`` for that learner and skips them.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from config import settings
from database import supabase_admin
from services import entitlements as ent
from services import runtime_flags
from services.retention import DEFAULT_WINDOW, OPEN_WINDOW, ContentWindow

logger = logging.getLogger(__name__)

FLAG = "retention_by_entitlement"
_CHUNK = 100
_PAGE = 1000


def after_expiry_days() -> int:
    return int(settings.RETENTION_CONTENT_DAYS_AFTER_EXPIRY)


def enabled() -> bool:
    """The flag, read strictly: a lookup failure raises
    ``runtime_flags.FlagLookupError`` and is never read as "off"."""
    return runtime_flags.is_enabled_strict(FLAG, default=False)


# ── Pure rule ─────────────────────────────────────────────────────────────


def _end(item: ent.AccessItem) -> Optional[datetime]:
    ends = [d for d in (item.expires_at, item.revoked_at if item.status == "revoked" else None) if d]
    return min(ends) if ends else None


def window_from_access(items: Iterable[ent.AccessItem], now: datetime,
                       days_after: Optional[int] = None, *,
                       member_course_ids: Iterable = ()) -> ContentWindow:
    """``member_course_ids``: the learner's active class courses, read
    separately because ``build_access`` drops a membership for a course that
    also has an ``entitlements`` row (plan 5.18, display only). A live class
    keeps content open even when that row has expired."""
    items = list(items)
    days_after = after_expiry_days() if days_after is None else days_after
    if any(True for _ in member_course_ids):
        return OPEN_WINDOW
    if any(i.status == "active" and (i.starts_at is None or i.starts_at <= now) for i in items):
        return OPEN_WINDOW
    rows = [i for i in items if i.is_entitlement]
    if not rows:
        return DEFAULT_WINDOW
    ends = []
    for item in rows:
        end = _end(item)
        if end is None:
            if item.status == "active":   # starts later and never ends: will be live
                return OPEN_WINDOW
            continue                       # revoked without a date: cannot anchor on it
        ends.append(end)
    if not ends:
        return DEFAULT_WINDOW
    return ContentWindow("until", max(ends) + timedelta(days=days_after))


# ── One learner (read time) ───────────────────────────────────────────────


def content_window(user_id, now: Optional[datetime] = None) -> ContentWindow:
    now = now or datetime.now(timezone.utc)
    try:
        if not enabled():
            return DEFAULT_WINDOW
        window = window_from_access(ent.list_access(str(user_id)), now)
        if window.mode != "open" and ent.fetch_membership_course_ids(str(user_id)):
            return OPEN_WINDOW
        return window
    except Exception as exc:  # noqa: BLE001 — read time degrades to today's rule
        logger.warning("[retention] window lookup failed user=%s: %s", user_id, type(exc).__name__)
        return DEFAULT_WINDOW


def window_view(items: Iterable[ent.AccessItem], now: datetime,
                user_id=None) -> tuple[Optional[str], Optional[int]]:
    """``(content_visible_until, content_days_after_expiry)`` for
    ``GET /api/me/courses`` from the items that route already read (class
    memberships are re-read for ``user_id`` only when there would be a
    cut-off). Both are null while the flag is off or a lookup fails; the date
    is null unless the learner has a cut-off (``until``)."""
    try:
        if not enabled():
            return None, None
        window = window_from_access(items, now)
        if window.mode != "open" and user_id is not None and ent.fetch_membership_course_ids(str(user_id)):
            window = OPEN_WINDOW
    except Exception as exc:  # noqa: BLE001
        logger.warning("[retention] window view failed: %s", type(exc).__name__)
        return None, None
    until = window.visible_until if window.mode == "until" else None
    return (until.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if until else None,
            after_expiry_days())


def window_closed(window: ContentWindow, now: Optional[datetime] = None) -> bool:
    """True once an ``until`` window has passed (content hidden, FR-048)."""
    now = now or datetime.now(timezone.utc)
    return window.mode == "until" and window.visible_until is not None and now >= window.visible_until


# ── A sweep batch ─────────────────────────────────────────────────────────


def _chunks(values: list[str]):
    for i in range(0, len(values), _CHUNK):
        yield values[i:i + _CHUNK]


def _paged(build) -> list[dict]:
    """Every row of ``build()`` (a query ordered by a unique key), read in
    ``_PAGE``-row pages: PostgREST caps one response at 1000 rows and cuts
    silently, and a cut list here would purge a learner whose live rows were
    left out."""
    out: list[dict] = []
    start = 0
    while True:
        page = build().range(start, start + _PAGE - 1).execute().data or []
        out.extend(page)
        if len(page) < _PAGE:
            return out
        start += _PAGE


def _flag_from(db) -> bool:
    """The flag read straight through ``db`` (the sweep's own client), no
    cache: one read per sweep run. An error raises; unset is off."""
    rows = db.table("runtime_flags").select("enabled").eq("key", FLAG).execute().data or []
    return bool(rows[0].get("enabled")) if rows else False


def _rows_in(db, table: str, columns: str, column: str, values: list[str], *,
             order: str = "id", is_null: Optional[str] = None, **eq) -> list[dict]:
    out: list[dict] = []
    for chunk in _chunks(values):
        def build(chunk=chunk):
            query = db.table(table).select(columns).in_(column, chunk)
            for key, value in eq.items():
                query = query.eq(key, value)
            if is_null:
                query = query.is_(is_null, "null")
            return query.order(order)
        out.extend(_paged(build))
    return out


def _members(db, user_ids: list[str]) -> dict[str, list[str]]:
    """user_id → courses of their active, unarchived cohorts (same reads as
    ``entitlements.fetch_membership_course_ids``, batched)."""
    students = _rows_in(db, "students", "id, user_id", "user_id", user_ids)
    owner = {str(r["id"]): str(r["user_id"]) for r in students if r.get("id") and r.get("user_id")}
    if not owner:
        return {}
    memberships = _rows_in(db, "student_cohort_memberships", "id, student_id, cohort_id", "student_id",
                           sorted(owner), is_active=True)
    cohort_ids = sorted({str(r["cohort_id"]) for r in memberships if r.get("cohort_id")})
    cohorts = _rows_in(db, "cohorts", "id, course_id, archived_at", "id", cohort_ids, is_null="archived_at")
    course_of = {str(r["id"]): str(r["course_id"]) for r in cohorts if r.get("course_id")}
    out: dict[str, set] = {}
    for m in memberships:
        course = course_of.get(str(m.get("cohort_id")))
        user = owner.get(str(m.get("student_id")))
        if course and user:
            out.setdefault(user, set()).add(course)
    return {u: sorted(c) for u, c in out.items()}


def content_windows(user_ids: Iterable, now: Optional[datetime] = None, *,
                    db=None) -> dict[str, Optional[ContentWindow]]:
    """Windows for a sweep batch. Flag, entitlements, products and class rows
    are read through ``db`` (default: this module's client), every list paged;
    live legacy codes are read per learner by ``entitlements`` with its own
    client (same ``supabase_admin``). ``None`` means "could not tell": the
    sweep must not purge that learner's content."""
    now = now or datetime.now(timezone.utc)
    db = db if db is not None else supabase_admin
    ids = sorted({str(u) for u in user_ids if u})
    if not ids:
        return {}
    try:
        if not _flag_from(db):
            return {u: DEFAULT_WINDOW for u in ids}
    except Exception as exc:  # noqa: BLE001 — unknown flag: purge nobody's content
        logger.warning("[retention] flag lookup failed, content sweep skips %d users: %s",
                       len(ids), type(exc).__name__)
        return {u: None for u in ids}
    try:
        rows = _rows_in(db, "entitlements", ent._ENTITLEMENT_COLUMNS, "user_id", ids)
        product_ids = sorted({str(r["product_id"]) for r in rows if r.get("product_id")})
        products = {str(p["id"]): p for p in
                    _rows_in(db, "course_products", ent._PRODUCT_COLUMNS, "id", product_ids)}
        members = _members(db, ids)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[retention] batch lookup failed, content sweep skips %d users: %s",
                       len(ids), type(exc).__name__)
        return {u: None for u in ids}
    by_user: dict[str, list[dict]] = {}
    for row in rows:
        by_user.setdefault(str(row.get("user_id")), []).append(row)
    out: dict[str, Optional[ContentWindow]] = {}
    for uid in ids:
        items = ent.build_access(by_user.get(uid, []), products, members.get(uid, []), [], now)
        window = window_from_access(items, now, member_course_ids=members.get(uid, []))
        if window.mode != "open":
            # Only now is a live legacy code worth a read (rule 1 comes first).
            try:
                legacy = ent.fetch_legacy_code_rows(uid)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[retention] legacy code lookup failed user=%s: %s", uid, type(exc).__name__)
                out[uid] = None
                continue
            if legacy:
                window = window_from_access(
                    ent.build_access(by_user.get(uid, []), products, members.get(uid, []), legacy, now), now,
                    member_course_ids=members.get(uid, []))
        out[uid] = window
    return out
