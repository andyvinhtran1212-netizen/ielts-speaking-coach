"""COURSEACCESS-0055 plan 5.4 — who may use which course, and from what.

Three sources make up a learner's access:
  (a) ``entitlements`` rows (enrollment order, access code with a product,
      admin grant, class conversion);
  (b) derived from active ``student_cohort_memberships`` of a cohort that has a
      course and is not archived → ``source='class_membership'``, no expiry;
  (c) derived from live access codes WITHOUT a product → one
      ``source='legacy_access_code'`` item, no course, features from the
      code permissions.

Every read here raises on failure. Callers decide what an error means
(503 ``access_unavailable`` on ``/api/me/courses``, ``CreditUnavailable`` in
``services/credits.py``); nothing here quietly answers "no access".

The data access is a handful of module-level functions so tests replace them
without a fake PostgREST client.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import UUID

from database import supabase_admin
from services import access_code_permissions as acp

_PRODUCT_COLUMNS = (
    "id, course_id, slug, kind, title, short_title, features, review_mode, status, is_public, archived_at"
)
_ENTITLEMENT_COLUMNS = (
    "id, user_id, product_id, course_id, source, status, starts_at, expires_at, credits_expire_at, "
    "credits_closed_at, review_mode, created_at"
)
# Same filter as the request-time gates, plus product_id: a code that carries a
# product grants through its entitlements row, never as a legacy code.
_LEGACY_CODE_COLUMNS = "id, permissions, session_limit, is_revoked, is_active, expires_at, product_id"


@dataclass(frozen=True)
class AccessItem:
    course_id: Optional[str]
    product_id: Optional[str]
    kind: Optional[str]            # 'online' | 'class' | 'repractice' | None
    source: str
    starts_at: Optional[datetime]
    expires_at: Optional[datetime]
    status: str                    # 'active' | 'expired' | 'revoked'
    review_mode: Optional[str]
    features: tuple[str, ...] = ()
    credits_usable_until: Optional[datetime] = None
    entitlement_id: Optional[str] = None
    product: Optional[dict] = field(default=None, compare=False)

    @property
    def is_entitlement(self) -> bool:
        return self.entitlement_id is not None


def parse_ts(value) -> Optional[datetime]:
    return acp._parse_expires_at(value)


def entitlement_state(row: dict, now: datetime) -> str:
    """'revoked' | 'expired' | 'active'. Expiry is derived, never stored."""
    if row.get("status") == "revoked":
        return "revoked"
    expires = parse_ts(row.get("expires_at"))
    if expires is not None and expires <= now:
        return "expired"
    return "active"


def _credits_usable_until(row: dict) -> Optional[datetime]:
    dates = [d for d in (parse_ts(row.get("credits_expire_at")), parse_ts(row.get("expires_at"))) if d]
    return min(dates) if dates else None


# ── Data access (raise on failure) ─────────────────────────────────────────


def fetch_entitlement_rows(user_id: str) -> list[dict]:
    res = (
        supabase_admin.table("entitlements").select(_ENTITLEMENT_COLUMNS)
        .eq("user_id", user_id).order("created_at").execute()
    )
    return list(res.data or [])


def fetch_products(product_ids: Iterable[str]) -> dict[str, dict]:
    ids = sorted({str(i) for i in product_ids if i})
    if not ids:
        return {}
    res = supabase_admin.table("course_products").select(_PRODUCT_COLUMNS).in_("id", ids).execute()
    return {str(r["id"]): r for r in (res.data or [])}


def fetch_membership_course_ids(user_id: str) -> list[str]:
    """Courses of the active, unarchived cohorts the user is a member of."""
    students = supabase_admin.table("students").select("id").eq("user_id", user_id).execute()
    student_ids = [r["id"] for r in (students.data or []) if r.get("id")]
    if not student_ids:
        return []
    memberships = (
        supabase_admin.table("student_cohort_memberships").select("cohort_id")
        .in_("student_id", student_ids).eq("is_active", True).execute()
    )
    cohort_ids = sorted({r["cohort_id"] for r in (memberships.data or []) if r.get("cohort_id")})
    if not cohort_ids:
        return []
    cohorts = (
        supabase_admin.table("cohorts").select("id, course_id, archived_at")
        .in_("id", cohort_ids).is_("archived_at", "null").execute()
    )
    return sorted({str(r["course_id"]) for r in (cohorts.data or []) if r.get("course_id")})


def fetch_legacy_code_rows(user_id: str) -> list[dict]:
    """Live access codes without a product, sourced exactly like
    ``access_code_permissions._active_code_rows`` (modern assignments, then
    ``used_by`` for codes with no assignment row) — but a failed read raises
    instead of degrading to "no codes"."""
    now = datetime.now(timezone.utc)
    assigned: set = set()
    rows_by_id: dict[str, dict] = {}
    assignments = acp._assignments_query(user_id)(supabase_admin).execute()
    code_ids = acp._split_assignments(assignments.data, assigned)
    if code_ids:
        codes = supabase_admin.table("access_codes").select(_LEGACY_CODE_COLUMNS).in_("id", code_ids).execute()
        acp._keep_live_codes(codes.data, now, rows_by_id)
    legacy = supabase_admin.table("access_codes").select(_LEGACY_CODE_COLUMNS).eq("used_by", user_id).execute()
    acp._add_legacy_codes(legacy.data, assigned, now, rows_by_id)
    return [r for r in rows_by_id.values() if not r.get("product_id")]


# ── Pure assembly ─────────────────────────────────────────────────────────


def legacy_code_features(permissions: Iterable[str]) -> tuple[str, ...]:
    perms = list(permissions or [])
    features = []
    if acp.has_permission(perms, "practice_single") or acp.has_permission(perms, "practice_part") \
            or acp.has_permission(perms, "practice_full"):
        features.append("speaking")
    if acp.has_writing_permission(perms):
        features.append("writing")
    return tuple(features)


def _legacy_code_item(rows: list[dict]) -> Optional[AccessItem]:
    features = legacy_code_features(acp._permission_union(rows))
    if not features:
        return None
    expiries = [parse_ts(r.get("expires_at")) for r in rows]
    expires_at = None if any(e is None for e in expiries) else max(expiries)
    return AccessItem(course_id=None, product_id=None, kind=None, source="legacy_access_code",
                      starts_at=None, expires_at=expires_at, status="active", review_mode=None,
                      features=features)


def build_access(entitlement_rows: list[dict], products: dict[str, dict], membership_course_ids: list[str],
                 legacy_code_rows: list[dict], now: datetime) -> list[AccessItem]:
    items: list[AccessItem] = []
    entitled_courses = set()
    for row in entitlement_rows:
        product = products.get(str(row.get("product_id"))) or {}
        entitled_courses.add(str(row.get("course_id")))
        items.append(AccessItem(
            course_id=str(row.get("course_id")), product_id=str(row.get("product_id")),
            kind=product.get("kind"), source=row.get("source"),
            starts_at=parse_ts(row.get("starts_at")), expires_at=parse_ts(row.get("expires_at")),
            status=entitlement_state(row, now),
            review_mode=row.get("review_mode") or product.get("review_mode"),
            features=tuple(product.get("features") or ()),
            credits_usable_until=_credits_usable_until(row),
            entitlement_id=str(row.get("id")), product=product or None,
        ))
    # Plan 5.18: a course the user already holds an entitlements row for is not
    # listed again as a derived class membership.
    for course_id in membership_course_ids:
        if course_id in entitled_courses:
            continue
        items.append(AccessItem(course_id=course_id, product_id=None, kind=None, source="class_membership",
                                starts_at=None, expires_at=None, status="active", review_mode=None))
    legacy = _legacy_code_item(legacy_code_rows)
    if legacy is not None:
        items.append(legacy)
    return items


# ── Public API (plan 5.4) ─────────────────────────────────────────────────


def list_access(user_id: UUID | str) -> list[AccessItem]:
    uid = str(user_id)
    rows = fetch_entitlement_rows(uid)
    products = fetch_products(r.get("product_id") for r in rows)
    return build_access(rows, products, fetch_membership_course_ids(uid), fetch_legacy_code_rows(uid),
                        datetime.now(timezone.utc))


def _started(item: AccessItem, now: datetime) -> bool:
    return item.starts_at is None or item.starts_at <= now


def has_course_access(user_id: UUID | str, course_id: UUID | str) -> bool:
    """Any current access to the course, derived class membership included.
    Used to open course content."""
    now = datetime.now(timezone.utc)
    return any(item.course_id == str(course_id) and item.status == "active" and _started(item, now)
               for item in list_access(user_id))


def has_course_entitlement(user_id: UUID | str, course_id: UUID | str,
                           kinds: Optional[Iterable[str]] = None) -> bool:
    """Only ``entitlements`` rows that are active and not expired (FR-009,
    plan 5.18): a member of a legacy-code class has access but no
    entitlement."""
    now = datetime.now(timezone.utc)
    rows = [r for r in fetch_entitlement_rows(str(user_id))
            if str(r.get("course_id")) == str(course_id) and entitlement_state(r, now) == "active"]
    if not rows:
        return False
    if kinds is None:
        return True
    wanted = set(kinds)
    products = fetch_products(r.get("product_id") for r in rows)
    return any((products.get(str(r.get("product_id"))) or {}).get("kind") in wanted for r in rows)


def has_ever_had_online_course(user_id: UUID | str) -> bool:
    """FR-042: any entitlements row on an online product, whatever its status
    or expiry. A read error raises; the caller decides (fail-closed)."""
    rows = fetch_entitlement_rows(str(user_id))
    products = fetch_products(r.get("product_id") for r in rows)
    return any(p.get("kind") == "online" for p in products.values())


def _credit_usable(row: dict, now: datetime) -> bool:
    if entitlement_state(row, now) != "active" or row.get("credits_closed_at"):
        return False
    starts = parse_ts(row.get("starts_at"))
    if starts is not None and starts > now:
        return False
    credits_expire = parse_ts(row.get("credits_expire_at"))
    return credits_expire is None or credits_expire > now


def resolve_review_mode(user_id: UUID | str, *, context: Optional[dict] = None,
                        entitlement_id: Optional[str] = None) -> str:
    """Writing only. 'legacy' for class/assigned work (the existing review
    flow); otherwise the review mode of the entitlement that pays — the row's
    override, then its product's. ``entitlement_id`` is the reserved hold's
    entitlement when known; without it the usable Writing entitlement whose
    credits lapse first is used (the same order as ``fn_credit_reserve``).
    No usable Writing entitlement → 'legacy' (behaviour of today)."""
    ctx = context or {}
    if ctx.get("writing_assignment_id") or ctx.get("class_assignment_item_id"):
        return "legacy"
    now = datetime.now(timezone.utc)
    rows = fetch_entitlement_rows(str(user_id))
    products = fetch_products(r.get("product_id") for r in rows)
    if entitlement_id is not None:
        rows = [r for r in rows if str(r.get("id")) == str(entitlement_id)]
    else:
        rows = [r for r in rows if _credit_usable(r, now)
                and "writing" in ((products.get(str(r.get("product_id"))) or {}).get("features") or ())]
        far = datetime.max.replace(tzinfo=timezone.utc)
        rows.sort(key=lambda r: (_credits_usable_until(r) or far, parse_ts(r.get("starts_at")) or now))
    if not rows:
        return "legacy"
    row = rows[0]
    product = products.get(str(row.get("product_id"))) or {}
    return row.get("review_mode") or product.get("review_mode") or "ai_instant"


# ── Shared by /api/courses* and /api/me/courses ──────────────────────────

OPEN_ORDER_STATUSES = ("awaiting_transfer", "transfer_reported", "needs_info")


def fetch_open_orders(user_id: str) -> dict[str, str]:
    """product_id → order_code of the user's open enrollment order."""
    res = (
        supabase_admin.table("enrollment_orders").select("order_code, product_id, status")
        .eq("user_id", user_id).in_("status", list(OPEN_ORDER_STATUSES)).execute()
    )
    return {str(r["product_id"]): r["order_code"] for r in (res.data or []) if r.get("product_id")}


def days_left(expires_at: Optional[datetime], now: datetime) -> Optional[int]:
    """Whole days left, rounded up; 0 once expired; None without an expiry."""
    if expires_at is None:
        return None
    seconds = (expires_at - now).total_seconds()
    if seconds <= 0:
        return 0
    return int(-(-seconds // 86400))


def can_renew(*, product: Optional[dict], state: str, expires_at: Optional[datetime], has_open_order: bool,
              window_days: int, now: datetime) -> bool:
    """Plan 5.9: an online course that has expired, or ends within the renew
    window; no open order for the product; the product is open."""
    if not product or product.get("kind") != "online" or product.get("status") != "open":
        return False
    if product.get("archived_at") or has_open_order:
        return False
    if state == "expired":
        return True
    if state != "active" or expires_at is None:
        return False
    return (expires_at - now).total_seconds() <= window_days * 86400
