"""W-03 — the learner activation gate (``users.is_active``).

Activation used to be enforced only by the /login page and by seven Speaking
handlers, so an account that never redeemed a code could call every other
learner endpoint — including AI-graded ones (Listening gist, Writing, course
writing/pronunciation, advanced-vocab rewrite) — straight from the API.

``require_active_learner`` is the single backend gate. ``main.py`` attaches it
to every learner router (``include_router(..., dependencies=[...])``) and to
the learner routes declared on the app itself. It:

  * skips staff paths (``/admin``, ``/api/admin``, ``/instructor``): those
    routes carry their own role guards and a mixed router may hold a few;
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
"""

from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Optional

from fastapi import HTTPException, Request

from database import supabase_admin

logger = logging.getLogger(__name__)

INACTIVE_DETAIL = "Tài khoản chưa được kích hoạt"

# Routes under these prefixes are staff surfaces guarded by require_admin /
# instructor checks, never by learner activation.
STAFF_PATH_PREFIXES: tuple[str, ...] = ("/admin", "/api/admin", "/instructor")

# (METHOD, route path template) → why an INACTIVE account may call it.
# Keep each reason to one line; the PR that adds an entry must justify it.
ACTIVATION_EXEMPT_ROUTES: dict[tuple[str, str], str] = {
    # ── Activation / login bootstrap ─────────────────────────────────────
    ("GET", "/auth/me"): "login bootstrap: upserts the users row and returns is_active so /login can open activation",
    ("GET", "/auth/check-active"): "the activation-status probe itself (AuthProvider, login)",
    ("POST", "/auth/activate"): "redeeming an access code is how an inactive account becomes active",
    ("GET", "/auth/profile"): "caller's own profile read (no learner content, no paid work); read by the G2 authed probe",
    # ── Unauthenticated infrastructure ───────────────────────────────────
    ("GET", "/api/public-stats"): "public marketing counter, no auth",
    ("GET", "/health"): "uptime probe, no auth",
    ("GET", "/health/ready"): "readiness probe, no auth (admin-only detail is role-gated inside)",
    ("GET", "/health/runtime"): "runtime probe, no auth (admin-only detail is role-gated inside)",
    ("GET", "/health/async-db"): "async-DB probe, no auth",
    ("GET", "/health/grammar-check"): "grammar-checker probe, no auth",
    ("GET", "/health/quiz-write"): "quiz-write probe, no auth",
    ("GET", "/sitemap-grammar.xml"): "public SEO sitemap",
    ("POST", "/api/error-logs"): "client error ingestion; accepts anonymous reports by design",
    ("POST", "/api/analytics/events"): "page-view/analytics beacons; anonymous by design, user only attributed",
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


def lookup_is_active(user_id: str) -> bool:
    """Canonical ``users.is_active`` read. A missing row is inactive (matches
    /auth/check-active). A DB failure fails CLOSED with 503 — a transient
    lookup error must not open paid endpoints."""
    try:
        rows = (
            supabase_admin.table("users")
            .select("is_active")
            .eq("id", str(user_id))
            .limit(1)
            .execute()
        ).data or []
    except Exception as exc:
        logger.warning("[activation_gate] is_active lookup failed user=%s: %s", user_id, exc)
        raise HTTPException(
            status_code=503,
            detail="Không kiểm tra được trạng thái tài khoản. Vui lòng thử lại.",
        )
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
    ensure_account_active(user["id"])


async def require_active_learner(request: Request) -> None:
    """Router-level dependency: authenticated learner routes need an ACTIVE
    account. See the module docstring for the skip rules."""
    await _enforce(request)
