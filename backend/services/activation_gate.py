"""W-03 — the learner activation gate (``users.is_active``).

Activation used to be enforced only by the /login page and by seven Speaking
handlers, so an account that never redeemed a code could call every other
learner endpoint — including AI-graded ones (Listening gist, Writing, course
writing/pronunciation, advanced-vocab rewrite) — straight from the API.

``require_active_learner`` is the single backend gate. ``main.py`` attaches it
to every learner router (``include_router(..., dependencies=[...])``) and to
the learner routes declared on the app itself. It:

  * skips staff paths (``/admin``, ``/api/admin``, ``/instructor``): those
    routes carry their own role guards and a mixed router may hold a few.
    ``routers.admin.require_admin`` / ``require_instructor`` call
    ``ensure_account_active`` themselves (Q-13), so a staff role never stands
    in for activation;
  * skips the routes listed in ``ACTIVATION_EXEMPT_ROUTES`` — the ONE place
    that says which learner-facing routes an inactive account may reach;
  * does nothing without an ``Authorization`` header: no account means no
    activation state, and the handler's own auth already answers 401 (or
    serves its anonymous mode);
  * otherwise verifies the bearer token and answers 403 unless the account's
    ``users.is_active`` is true.

``tests/test_activation_gate_inventory.py`` walks the real app and fails when
a learner route is neither gated nor exempt, so a new learner endpoint is
gated by default and an exemption is always a deliberate, reviewed edit here.

Cost: the gate's token verification is remembered for the request and reused
by ``routers.auth.get_supabase_user`` (no second Supabase Auth round-trip), and
the ``is_active`` result is remembered for the request so the folded checks in
``sessions._require_permission`` / ``writing_student.require_writing_permission``
add no query. Nothing is cached ACROSS requests.

PC-J05 (D1a): the gate itself runs the ``a*`` variants below. With
``USE_ASYNC_DB`` off they run the sync functions (same query, same client,
same test seams) in a worker thread (ASYNCAUTH-0036 Revision 3); with it on
the ``is_active`` read awaits the async client. Either way the event loop is
not blocked for one Supabase round-trip per request.
"""

from __future__ import annotations

import asyncio
import logging
from contextvars import ContextVar
from typing import Optional

from fastapi import HTTPException, Request

from config import settings
from database import supabase_admin
from services.db_async import aexecute

logger = logging.getLogger(__name__)

INACTIVE_DETAIL = "Tài khoản chưa được kích hoạt"

# Routes under these prefixes are staff surfaces guarded by require_admin /
# require_instructor, which enforce activation after the role check (Q-13).
STAFF_PATH_PREFIXES: tuple[str, ...] = ("/admin", "/api/admin", "/instructor")

# (METHOD, route path template) → why an INACTIVE account may call it.
# Keep each reason to one line; the PR that adds an entry must justify it.
ACTIVATION_EXEMPT_ROUTES: dict[tuple[str, str], str] = {
    # ── Activation / login bootstrap ─────────────────────────────────────
    ("GET", "/auth/me"): "login bootstrap: upserts the users row and returns is_active so /login can open activation",
    ("GET", "/auth/check-active"): "the activation-status probe itself (AuthProvider, login)",
    ("POST", "/auth/activate"): "redeeming an access code is how an inactive account becomes active",
    ("GET", "/auth/profile"): "caller's own profile read (no learner content, no paid work); read by the G2 authed probe",
    # LEARNERCORE-0063 FR-094 (G07-T26): an inactive account with learner_v2 on
    # may open Today and finish "Lần đầu vào". Both handlers re-check the caller
    # through ``aopen_learner_status`` (503 on a failed read, 403 when suspended,
    # the gate's own 403 when the flag is off), so the exemption only has an
    # effect while learner_v2 is on.
    ("GET", "/api/student/today"): "FR-094: inactive learner_v2 Today; handler re-checks activation, drops work blocks when inactive",
    ("PATCH", "/auth/profile"): "FR-094: inactive learner_v2 onboarding; handler re-checks activation, inactive may set only onboarding_completed/target_band/exam_date",
    # ── One session per learner (COURSEACCESS-0055 T009) ─────────────────
    # These run the session gate's own state read, so a not-yet-claimed
    # session can see screen 8a/8b, claim, or sign out everywhere.
    ("GET", "/api/account/session/status"): "single-session state probe; no learner content, no paid work",
    ("POST", "/api/account/session/claim"): "single-session claim (\"Tiếp tục ở đây\"); refuses while timed work runs",
    ("POST", "/api/account/sessions/revoke-all"): "sign out of every device; keeps a session in timed work until it ends",
    ("GET", "/api/account/login-events"): "recent sign-ins of the caller's own current session (G04-T16); no learner content",
    # ── Unauthenticated infrastructure ───────────────────────────────────
    ("GET", "/api/public-stats"): "public marketing counter, no auth",
    ("GET", "/health"): "uptime probe, no auth",
    ("GET", "/health/ready"): "readiness probe, no auth (admin-only detail is role-gated inside)",
    ("GET", "/health/runtime"): "runtime probe, no auth (admin-only detail is role-gated inside)",
    ("GET", "/health/async-db"): "async-DB probe, no auth (admin-only saturation detail is role-gated inside)",
    ("GET", "/health/grammar-check"): "grammar-checker probe, no auth",
    ("GET", "/health/quiz-write"): "quiz-write probe, no auth",
    ("GET", "/sitemap-grammar.xml"): "public SEO sitemap",
    ("GET", "/api/public/site-info"): "public contact block and public feature flags, no auth (PUBLICSITE-0059 FR-026)",
    ("POST", "/api/error-logs"): "client error ingestion; accepts anonymous reports by design",
    ("POST", "/api/analytics/events"): "page-view/analytics beacons; anonymous by design, user only attributed",
    # ── Course access (COURSEACCESS-0055 plan 5.9) ───────────────────────
    # An online enrollee stays inactive until an admin confirms the order.
    ("GET", "/api/courses"): "public course catalogue; a token only adds the caller's own enrollment state",
    ("GET", "/api/courses/{slug}"): "public course page; a token only adds the caller's own enrollment state",
    ("GET", "/api/me/courses"): "caller's own courses and credits, read before activation (pending online enrollment)",
    ("GET", "/api/me/credits"): "caller's own credit history (read-only), visible before activation",
    ("POST", "/api/enrollment-orders"): "an online enrollee creates the order that, once confirmed, activates them",
    ("GET", "/api/enrollment-orders/me"): "caller's own enrollment orders, read before the confirm that activates",
    ("GET", "/api/enrollment-orders/{order_code}"): "caller's own order page with the transfer details",
    ("POST", "/api/enrollment-orders/{order_code}/report-transfer"): "caller reports paying their own order",
    ("POST", "/api/enrollment-orders/{order_code}/supplement"): "caller answers an admin's needs_info on their order",
    ("POST", "/api/enrollment-orders/{order_code}/cancel"): "caller cancels their own open order",
    # ── Public content (Grammar Wiki, Vocabulary library, prompt bank) ───
    ("GET", "/api/grammar/home"): "public Grammar Wiki",
    ("GET", "/api/grammar/categories"): "public Grammar Wiki",
    ("GET", "/api/grammar/category/{slug}"): "public Grammar Wiki",
    ("GET", "/api/grammar/article/{category}/{slug}"): "public Grammar Wiki",
    ("GET", "/api/grammar/roadmap/{slug}"): "public Grammar Wiki",
    ("GET", "/api/grammar/compare/{slug}"): "public Grammar Wiki",
    ("GET", "/api/grammar/search"): "public Grammar Wiki",
    ("GET", "/api/grammar/groups"): "public Grammar Wiki",
    ("GET", "/api/grammar/exercises"): "public Grammar Wiki exercises (no auth)",
    ("GET", "/api/grammar/article/{category}/{slug}/exercise"): "public Grammar Wiki exercises (no auth)",
    ("GET", "/api/vocabulary/categories"): "public Vocabulary library",
    ("GET", "/api/vocabulary/directory"): "public Vocabulary library",
    ("GET", "/api/vocabulary/categories/{category}/cards"): "public Vocabulary library",
    ("GET", "/api/vocabulary/articles"): "public Vocabulary library",
    ("GET", "/api/vocabulary/articles/{category}/{slug}"): "public Vocabulary library",
    ("GET", "/api/vocabulary/exam"): "public Vocabulary library",
    ("GET", "/api/vocabulary/exam/{list_slug}/cards"): "public Vocabulary library",
    ("GET", "/api/vocabulary/search"): "public Vocabulary library",
    ("GET", "/api/vocabulary/units"): "public curated-unit catalogue (no auth; runtime-flag gated)",
    ("GET", "/api/vocabulary/units/{unit_slug}"): "public curated-unit catalogue (no auth; runtime-flag gated)",
    ("GET", "/api/vocabulary/pathways"): "public curated-unit catalogue (no auth; runtime-flag gated)",
    ("GET", "/api/writing/prompt-bank"): "public Writing prompt library (no auth)",
    ("GET", "/api/library/summary"): "public Library",
    ("GET", "/api/library/writing-samples"): "public Library",
    ("GET", "/api/library/writing-samples/index"): "public Library",
    ("GET", "/api/library/writing-samples/{slug}"): "public Library",
    ("GET", "/api/library/media/{shelf}/{key}/{asset}"): "public Library",
    ("GET", "/api/library/writing-guides"): "public Library",
    ("GET", "/api/library/writing-guides/index"): "public Library",
    ("GET", "/api/library/writing-guides/{slug}"): "public Library",
    ("GET", "/api/library/speaking"): "public Library",
    ("GET", "/api/library/speaking/index"): "public Library",
    ("GET", "/api/library/speaking/{slug}"): "public Library",
    ("GET", "/api/library/me/marks"): "own library marks; no paid work (LIBRARY-0061 FR-061)",
    ("PATCH", "/api/library/me/marks/{shelf}/{kind}"): "own library marks; no paid work (LIBRARY-0061 FR-061)",
    ("DELETE", "/api/library/me/marks/{shelf}/{kind}"): "own library marks; no paid work (LIBRARY-0061 FR-061)",
    ("POST", "/api/feedback"): "content-error reports; anonymous Reading/Vocabulary reports allowed by design",
    # ── Reading share links (anonymous capability, X-Reading-Anon) ───────
    # These accept an anonymous share-link attempt OR the caller's own attempt.
    # An inactive account cannot create an owned attempt (start is gated), so
    # exempting them only keeps share links working while signed in.
    ("GET", "/api/reading/test/share/{share_token}/boot"): "public share-link boot (anonymous)",
    ("POST", "/api/reading/test/share/{share_token}/attempts"): "public share-link start (anonymous attempt)",
    ("POST", "/api/reading/test/attempts/{attempt_id}/renderer-affinity"): "share-link attempt (anon capability or own attempt)",
    ("PATCH", "/api/reading/test/attempts/{attempt_id}/answers"): "share-link attempt (anon capability or own attempt)",
    ("POST", "/api/reading/test/attempts/{attempt_id}/submit"): "share-link attempt (anon capability or own attempt; deterministic grading)",
    ("GET", "/api/reading/test/attempts/{attempt_id}/review"): "share-link attempt review (anon capability, own attempt or admin console)",
    ("GET", "/api/reading/test/attempts/{attempt_id}/review-flags"): "share-link attempt (anon capability or own attempt)",
    ("PATCH", "/api/reading/test/attempts/{attempt_id}/review-flags"): "share-link attempt (anon capability or own attempt)",
}


def is_staff_path(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in STAFF_PATH_PREFIXES)


def is_exempt(method: str, path: str) -> bool:
    return (method.upper(), path) in ACTIVATION_EXEMPT_ROUTES


# ── Per-request memo ─────────────────────────────────────────────────────────
# Set/reset by the per-request middleware in main.py (same lifetime as the
# access-permission memo). Holds the verified bearer token → auth user and the
# user ids already confirmed active IN THIS REQUEST. Without an active memo
# (background tasks, direct unit calls) nothing is cached.
_memo: ContextVar[Optional[dict]] = ContextVar("activation_gate_memo", default=None)


def begin_request_memo() -> object:
    return _memo.set({"token": None, "user": None, "active": set()})


def reset_request_memo(token: object) -> None:
    _memo.reset(token)


def remembered_user(token: str) -> Optional[dict]:
    """The auth user the gate already verified for this exact bearer token."""
    memo = _memo.get()
    if memo and memo.get("token") == token and memo.get("user") is not None:
        return memo["user"]
    return None


def remember_user(token: str, user: dict) -> None:
    memo = _memo.get()
    if memo is not None:
        memo["token"], memo["user"] = token, user


def _is_active_query(user_id: str):
    return lambda db: (
        db.table("users").select("is_active").eq("id", str(user_id)).limit(1)
    )


def _lookup_failed(user_id: str, exc: Exception) -> HTTPException:
    logger.warning("[activation_gate] is_active lookup failed user=%s: %s", user_id, exc)
    return HTTPException(
        status_code=503,
        detail="Không kiểm tra được trạng thái tài khoản. Vui lòng thử lại.",
    )


def lookup_is_active(user_id: str) -> bool:
    """Canonical ``users.is_active`` read. A missing row is inactive (matches
    /auth/check-active). A DB failure fails CLOSED with 503 — a transient
    lookup error must not open paid endpoints."""
    try:
        rows = _is_active_query(user_id)(supabase_admin).execute().data or []
    except Exception as exc:
        raise _lookup_failed(user_id, exc)
    return bool(rows and rows[0].get("is_active"))


async def alookup_is_active(user_id: str) -> bool:
    """:func:`lookup_is_active` for async callers: identical result and 503
    fail-closed contract; awaits the async client when ``USE_ASYNC_DB`` is on,
    else runs the sync read in a worker thread (Revision 3)."""
    if not settings.USE_ASYNC_DB:
        return await asyncio.to_thread(lookup_is_active, user_id)
    try:
        rows = (await aexecute(_is_active_query(user_id))).data or []
    except Exception as exc:
        raise _lookup_failed(user_id, exc)
    return bool(rows and rows[0].get("is_active"))


def confirmed_active(user_id: str) -> bool:
    """True when this request already proved ``user_id`` active."""
    memo = _memo.get()
    return memo is not None and str(user_id) in memo["active"]


def account_is_active(user_id: str) -> bool:
    """``users.is_active`` for ``user_id``, reusing a confirmation made earlier
    in the same request (the router gate) instead of re-querying."""
    key = str(user_id)
    if confirmed_active(key):
        return True
    if not lookup_is_active(key):
        return False
    memo = _memo.get()
    if memo is not None:
        memo["active"].add(key)
    return True


def ensure_account_active(user_id: str) -> None:
    """Raise 403 unless the account is active."""
    if not account_is_active(user_id):
        raise HTTPException(status_code=403, detail=INACTIVE_DETAIL)


async def aaccount_is_active(user_id: str) -> bool:
    """Async :func:`account_is_active` (same per-request memo)."""
    key = str(user_id)
    if confirmed_active(key):
        return True
    if not await alookup_is_active(key):
        return False
    memo = _memo.get()
    if memo is not None:
        memo["active"].add(key)
    return True


async def aensure_account_active(user_id: str) -> None:
    """Async :func:`ensure_account_active`."""
    if not await aaccount_is_active(user_id):
        raise HTTPException(status_code=403, detail=INACTIVE_DETAIL)


async def _enforce(request: Request) -> None:
    route = request.scope.get("route")
    path = getattr(route, "path", None) or request.url.path
    if is_staff_path(path) or is_exempt(request.method, path):
        return
    authorization = request.headers.get("authorization")
    if not authorization:
        return  # anonymous: the handler's own auth answers (401 or public mode)
    from routers.auth import get_supabase_user  # local — routers.auth imports this module
    user = await get_supabase_user(authorization)
    await aensure_account_active(user["id"])
    # COURSEACCESS-0055 T009: one current session per learner account (no-op
    # while runtime flag single_session_learners is off).
    from services import session_gate  # local — session_gate imports this module
    await session_gate.ensure_current(user["id"], authorization, request.headers.get("user-agent"))


async def require_active_learner(request: Request) -> None:
    """Router-level dependency: authenticated learner routes need an ACTIVE
    account. See the module docstring for the skip rules."""
    await _enforce(request)


# ── LEARNERCORE-0063 FR-094: the two inactive-open routes ────────────────────

OPEN_ACTIVE = "active"
OPEN_INACTIVE = "inactive_open"


def _open_status_query(user_id: str):
    # "*" like /auth/check-active: works before migration 332 adds suspended_at
    # (absent column = not suspended).
    return lambda db: db.table("users").select("*").eq("id", str(user_id)).limit(1)


async def alearner_v2_on(user_id: str, opted_in: bool) -> bool:
    """FR-072 flag for the caller; any failure reading it is "off"."""
    from services import feature_flags  # local: keeps this module's imports light

    try:
        if settings.USE_ASYNC_DB:
            return await feature_flags.ais_learner_v2_enabled(
                user_id, run=aexecute, per_user=opted_in)
        return await asyncio.to_thread(
            feature_flags.is_learner_v2_enabled, user_id, per_user=opted_in)
    except Exception as exc:  # noqa: BLE001 - deny on any flag failure
        logger.warning("[activation_gate] learner_v2 read failed user=%s: %s",
                       user_id, exc.__class__.__name__)
        return False


async def aopen_learner_status(user_id: str) -> str:
    """Activation check for the routes ``ACTIVATION_EXEMPT_ROUTES`` opens to an
    inactive account under FR-094 (the router gate skips them, so no memo is
    set and none is trusted here).

    Returns ``"active"`` or ``"inactive_open"``. Raises 503 when the users row
    cannot be read (fail closed, like the gate), 403 ``account_suspended``
    when the account is suspended (before anything else), and the gate's own
    403 ``INACTIVE_DETAIL`` for an inactive account without learner_v2.
    """
    key = str(user_id)
    try:
        if settings.USE_ASYNC_DB:
            rows = (await aexecute(_open_status_query(key))).data or []
        else:
            rows = await asyncio.to_thread(
                lambda: _open_status_query(key)(supabase_admin).execute().data or [])
    except Exception as exc:
        raise _lookup_failed(key, exc)
    row = rows[0] if rows else {}
    if row.get("suspended_at"):
        from services.staff_security import account_suspended_exception
        raise account_suspended_exception(403)
    if row.get("is_active") is True:
        memo = _memo.get()
        if memo is not None:
            memo["active"].add(key)
        return OPEN_ACTIVE
    flags = row.get("feature_flags") if isinstance(row.get("feature_flags"), dict) else {}
    if not await alearner_v2_on(key, flags.get("learner_v2") is True):
        raise HTTPException(status_code=403, detail=INACTIVE_DETAIL)
    return OPEN_INACTIVE
