"""ADMINAAL2-0032 lot 03 (T004) — route inventory for the admin AAL2 rule.

1. Only ``GET /admin/mfa/status`` may accept an AAL1 admin under enforcement
   (FR-004). The allow-list is pinned, ``allow_aal1=`` may appear only in that
   route's handler, and EVERY staff route of the real app (``/admin``,
   ``/api/admin``, ``/instructor``) is called directly with an AAL1 admin and
   ``ADMIN_AAL2_ENFORCE=true``: each must raise 403 ``mfa_required``.
2. Every staff route awaits its guard before any other database or service
   call (AST check), so no domain data is read before the 403 (FR-002).
3. Every route of the app is classified: staff, one of the known soft admin
   checks (research.md §1.4 + the quota bypass), or free of admin checks. A
   new admin check outside the staff prefixes fails here until it is reviewed.
4. Step-up (Amendment 1, FR-020): the routes that call ``require_recent_mfa``
   are exactly ``STEP_UP_ROUTES``, each calls it as the statement right after
   its guard, and each refuses a 16-minute-old TOTP under
   ``ADMIN_STEP_UP_ENFORCE=true`` with no database call.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import textwrap
from pathlib import Path

import pytest
from fastapi import HTTPException, Request
from fastapi.routing import APIRoute

import main
import routers.admin as admin_module
import routers.auth as auth_module
from config import settings
from services import activation_gate, staff_guard
from services.activation_gate import is_staff_path

from tests.test_staff_guard import (  # shared fakes
    TOKENS,
    VERIFIED,
    _AuthClient,
    _DB,
    aal1_claims,
    aal2_claims,
    accept,
    is_mfa_required,
)

ROUTERS_DIR = Path(__file__).resolve().parent.parent / "routers"

# Direct guards, and the router-local wrappers whose first statement awaits one.
GUARD_NAMES = frozenset({
    "require_admin",
    "require_instructor",
    "_me",                       # instructor.py: require_instructor, then impersonation
    "_require_curated_admin",    # vocab_units.py
    "_require_private_admin",    # admin_core_attempt_evidence.py
})
ADMIN_CHECK_NAMES = GUARD_NAMES | {"_is_admin", "holds_admin_privilege", "resolve_staff"}

# Admin checks outside the staff prefixes. Each is a SOFT check: an admin who
# fails the AAL2 rule is treated as a non-admin (tests/test_staff_guard.py).
SOFT_ADMIN_ROUTES = {
    ("GET", "/health/ready"): "unredacted diagnostics",
    ("GET", "/health/runtime"): "unredacted diagnostics",
    ("GET", "/api/listening/tests/attempts/{attempt_id}/review"): "other user's sealed attempt",
    ("GET", "/api/reading/test/attempts/{attempt_id}/review"): "other user's sealed attempt",
    ("POST", "/sessions"): "admin daily-quota bypass",
}


def _routes():
    for route in main.app.routes:
        if isinstance(route, APIRoute):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                yield method, route.path, route


ROUTES = list(_routes())
STAFF_ROUTES = [(m, p, r) for m, p, r in ROUTES if is_staff_path(p)]


def _call_name(call: ast.Call) -> str | None:
    f = call.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def _fn_ast(fn) -> ast.AST:
    return ast.parse(textwrap.dedent(inspect.getsource(inspect.unwrap(fn)))).body[0]


def _called_names(fn) -> set[str]:
    return {_call_name(n) for n in ast.walk(_fn_ast(fn)) if isinstance(n, ast.Call)}


# ── 1. The AAL1 allow-list ───────────────────────────────────────────────────

def test_aal1_allow_list_is_only_mfa_status():
    assert staff_guard.AAL1_ALLOWED_ADMIN_ROUTES == frozenset({("GET", "/admin/mfa/status")})


def test_allow_aal1_keyword_appears_only_in_the_mfa_status_handler():
    allowed_handlers = {
        (r.endpoint.__module__, r.endpoint.__name__)
        for m, p, r in ROUTES if (m, p) in staff_guard.AAL1_ALLOWED_ADMIN_ROUTES
    }
    offenders = []
    for path in sorted(ROUTERS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text())
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            uses = any(
                isinstance(n, ast.Call) and any(k.arg == "allow_aal1" for k in n.keywords)
                for n in ast.walk(fn)
            )
            if uses and fn.name != "require_admin" and (f"routers.{path.stem}", fn.name) not in allowed_handlers:
                offenders.append(f"{path.name}:{fn.lineno} {fn.name}")
    assert not offenders, f"allow_aal1 used outside GET /admin/mfa/status: {offenders}"


@pytest.fixture
def aal1_admin(live_activation_gate, monkeypatch):
    TOKENS.clear()
    db = _DB()
    for module in (admin_module, activation_gate):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient([]))
    monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", True)
    token = accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED)
    yield f"Bearer {token}", db
    TOKENS.clear()


def _auth_param(route: APIRoute) -> str | None:
    for param in route.dependant.header_params:
        if (param.alias or param.name).lower() == "authorization":
            return param.name
    return None


def _fake_request(method: str, path: str) -> Request:
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "query_string": b"", "headers": [], "path_params": {},
    })


def _call_endpoint(route: APIRoute, method: str, bearer: str):
    """Call the handler directly with the bearer and inert placeholders: the
    guard is awaited first (section 2), so nothing else is ever used."""
    kwargs = {}
    auth_name = _auth_param(route)
    for name, param in inspect.signature(route.endpoint).parameters.items():
        if name == auth_name:
            kwargs[name] = bearer
        elif param.annotation is Request or param.annotation == "Request":
            kwargs[name] = _fake_request(method, route.path)
        else:
            kwargs[name] = None

    async def go():
        ctx = staff_guard.begin_request({"method": method, "path": route.path})
        try:
            result = route.endpoint(**kwargs)
            if inspect.isawaitable(result):
                result = await result
            return result
        finally:
            staff_guard.reset_request(ctx)

    return asyncio.run(go())


def test_every_staff_route_takes_the_bearer():
    missing = [f"{m} {p}" for m, p, r in STAFF_ROUTES if _auth_param(r) is None]
    assert not missing, f"staff routes without an Authorization header param: {missing}"


def test_every_staff_route_refuses_an_aal1_admin_under_enforcement(aal1_admin):
    bearer, db = aal1_admin
    offenders = []
    for method, path, route in STAFF_ROUTES:
        if (method, path) in staff_guard.AAL1_ALLOWED_ADMIN_ROUTES:
            continue
        try:
            _call_endpoint(route, method, bearer)
        except HTTPException as exc:
            if exc.status_code == 403 and is_mfa_required(exc):
                continue
            offenders.append(f"{method} {path}: HTTP {exc.status_code} {exc.detail!r}"[:200])
        except Exception as exc:  # reached handler code with placeholders
            offenders.append(f"{method} {path}: {type(exc).__name__}: {exc}"[:200])
        else:
            offenders.append(f"{method} {path}: returned without the guard refusing")
    assert len(STAFF_ROUTES) > 300  # sanity: the whole app was walked
    assert not offenders, "staff routes that do not answer 403 mfa_required to an AAL1 admin:\n  " + "\n  ".join(offenders)
    assert db.touched == [] and db.inserts == []


def test_allow_listed_routes_that_exist_admit_an_aal1_admin(aal1_admin):
    bearer, _db = aal1_admin
    for method, path, route in STAFF_ROUTES:
        if (method, path) not in staff_guard.AAL1_ALLOWED_ADMIN_ROUTES:
            continue
        try:
            _call_endpoint(route, method, bearer)
        except HTTPException as exc:
            assert not is_mfa_required(exc), f"{method} {path} must accept AAL1 (FR-004)"
        except Exception:
            pass  # past the guard; placeholders broke the handler


# ── 2. The guard runs before anything else ───────────────────────────────────

def _module_functions(module_name: str) -> dict[str, ast.AST]:
    import importlib

    source = inspect.getsource(importlib.import_module(module_name))
    return {
        n.name: n for n in ast.parse(source).body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _first_statement(fn: ast.AST):
    body = list(fn.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
        body = body[1:]  # docstring
    while body and isinstance(body[0], (ast.Import, ast.ImportFrom)):
        body = body[1:]  # local imports run no query
    return body[0] if body else None


def _awaited_call(stmt) -> ast.Call | None:
    """The call in ``await f(...)``, ``x = await f(...)``, ``return await f(...)``
    or ``x = (await f(...))[key]``."""
    value = getattr(stmt, "value", None)
    if isinstance(value, ast.Subscript):  # caller = (await guard(...))["id"]
        value = value.value
    if isinstance(value, ast.Await) and isinstance(value.value, ast.Call):
        return value.value
    return None


def _guards_first(fn: ast.AST, functions: dict[str, ast.AST], seen: frozenset = frozenset()) -> bool:
    call = _awaited_call(_first_statement(fn))
    if call is None:
        return False
    name = _call_name(call)
    if name in GUARD_NAMES:
        return True
    # A same-module helper that is itself guard-first (e.g. publish wrappers),
    # provided the bearer is passed straight through.
    passes_bearer = any(
        isinstance(a, ast.Name) and a.id == "authorization" for a in call.args
    ) or any(k.arg == "authorization" for k in call.keywords)
    helper = functions.get(name)
    return bool(helper is not None and passes_bearer and name not in seen
                and _guards_first(helper, functions, seen | {name}))


def test_guard_wrappers_await_the_shared_guard_first():
    for module_name, wrapper in [
        ("routers.instructor", "_me"),
        ("routers.vocab_units", "_require_curated_admin"),
    ]:
        fn = _module_functions(module_name)[wrapper]
        call = _awaited_call(_first_statement(fn))
        assert call is not None and _call_name(call) in {"require_admin", "require_instructor"}, wrapper
    evidence = _module_functions("routers.admin_core_attempt_evidence")["_require_private_admin"]
    assert "require_admin" in {_call_name(n) for n in ast.walk(evidence.body[1].body[0]) if isinstance(n, ast.Call)}


def test_every_staff_route_awaits_its_guard_before_any_other_call():
    cache: dict[str, dict] = {}
    offenders = []
    for method, path, route in STAFF_ROUTES:
        module = route.endpoint.__module__
        functions = cache.setdefault(module, _module_functions(module))
        fn = functions.get(route.endpoint.__name__) or _fn_ast(route.endpoint)
        if not _guards_first(fn, functions):
            first = _first_statement(fn)
            offenders.append(f"{method} {path} ({module}.{route.endpoint.__name__}): "
                             f"{ast.unparse(first)[:100] if first else '<empty>'}")
    assert not offenders, (
        "staff routes whose first statement is not `await <guard>(...)` — the guard "
        "must run before any database or service call:\n  " + "\n  ".join(offenders)
    )


# ── 3. Every route is classified ─────────────────────────────────────────────

def test_admin_checks_outside_staff_paths_are_the_known_soft_checks():
    found = {
        (m, p) for m, p, r in ROUTES
        if not is_staff_path(p) and _called_names(r.endpoint) & ADMIN_CHECK_NAMES
    }
    assert found == set(SOFT_ADMIN_ROUTES), (
        "admin checks outside /admin, /api/admin and /instructor changed. Review "
        "the AAL2 rule for it and update SOFT_ADMIN_ROUTES:\n"
        f"  new: {sorted(found - set(SOFT_ADMIN_ROUTES))}\n"
        f"  gone: {sorted(set(SOFT_ADMIN_ROUTES) - found)}"
    )


def test_soft_checks_go_through_the_staff_guard():
    # The soft helpers call require_admin (inherit the rule) and the quota
    # bypass calls holds_admin_privilege; none reads users.role itself.
    for module_name in ("routers.health", "routers.listening", "routers.reading_student"):
        assert "require_admin" in {
            _call_name(n) for n in ast.walk(_module_functions(module_name)["_is_admin"])
            if isinstance(n, ast.Call)
        }, module_name
    create_session = next(r for m, p, r in ROUTES if (m, p) == ("POST", "/sessions")).endpoint
    src = inspect.getsource(create_session)
    assert "holds_admin_privilege" in src and '.select("role")' not in src


# ── 4. Step-up routes (Amendment 1, FR-020) ──────────────────────────────────

# Every route that depends on require_recent_mfa. The AIBUDGET-0033 raise /
# end-raise routes join this list when they land (PC-J138).
STEP_UP_ROUTES = frozenset({
    ("PATCH", "/admin/users/{user_id}/role"),
    ("PATCH", "/admin/users/{user_id}/active"),
    ("POST", "/admin/users/{user_id}/revoke-sessions"),
})


def _route_fn(route: APIRoute, cache: dict) -> ast.AST:
    module = route.endpoint.__module__
    functions = cache.setdefault(module, _module_functions(module))
    return functions.get(route.endpoint.__name__) or _fn_ast(route.endpoint)


def test_routes_that_use_require_recent_mfa_are_exactly_the_step_up_routes():
    found = {(m, p) for m, p, r in ROUTES if "require_recent_mfa" in _called_names(r.endpoint)}
    assert found == STEP_UP_ROUTES, (
        f"new: {sorted(found - STEP_UP_ROUTES)}  missing: {sorted(STEP_UP_ROUTES - found)}"
    )
    # Nothing outside the route handlers calls it (a helper would hide which
    # routes are covered).
    callers = []
    for path in sorted(ROUTERS_DIR.glob("*.py")):
        for fn in ast.walk(ast.parse(path.read_text())):
            if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(
                isinstance(n, ast.Call) and _call_name(n) == "require_recent_mfa" for n in ast.walk(fn)
            ):
                callers.append((f"routers.{path.stem}", fn.name))
    handlers = {(r.endpoint.__module__, r.endpoint.__name__) for m, p, r in ROUTES if (m, p) in STEP_UP_ROUTES}
    assert set(callers) == handlers and len(callers) == len(STEP_UP_ROUTES)


def test_step_up_is_the_statement_right_after_the_guard():
    cache: dict = {}
    offenders = []
    for method, path, route in ROUTES:
        if (method, path) not in STEP_UP_ROUTES:
            continue
        fn = _route_fn(route, cache)
        body = list(fn.body)
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
            body = body[1:]
        guard, step_up = body[0], body[1] if len(body) > 1 else None
        call = _awaited_call(guard)
        ok = (
            call is not None and _call_name(call) == "require_admin"
            and isinstance(guard, ast.Assign) and isinstance(guard.targets[0], ast.Name)
            and isinstance(step_up, ast.Expr) and isinstance(step_up.value, ast.Call)
            and _call_name(step_up.value) == "require_recent_mfa"
            and [ast.unparse(a) for a in step_up.value.args] == [guard.targets[0].id, "authorization"]
        )
        if not ok:
            offenders.append(f"{method} {path}: {ast.unparse(guard)[:80]} / "
                             f"{ast.unparse(step_up)[:80] if step_up else '<none>'}")
    assert not offenders, "step-up must directly follow `x = await require_admin(authorization)`:\n  " + \
        "\n  ".join(offenders)


def test_every_step_up_route_refuses_a_stale_totp_before_any_db_call(live_activation_gate, monkeypatch):
    TOKENS.clear()
    db = _DB()
    for module in (admin_module, activation_gate):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient([]))
    monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", True)
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", True)
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_MINUTES", 15)
    # AAL2 is valid for FR-001 (well inside 12 h), but older than 15 minutes.
    token = accept("admin-active", aal2_claims("admin-active", totp_age=16 * 60), factors=VERIFIED)
    engine_calls: list = []

    class _NoEngine:
        def __getattr__(self, name):
            engine_calls.append(name)
            raise AssertionError(f"engine.{name} reached")

    monkeypatch.setattr(admin_module, "_db_engine", _NoEngine())
    try:
        refused = []
        for method, path, route in ROUTES:
            if (method, path) not in STEP_UP_ROUTES:
                continue
            with pytest.raises(HTTPException) as ei:
                _call_endpoint(route, method, f"Bearer {token}")
            assert ei.value.status_code == 403, (method, path, ei.value.detail)
            assert ei.value.detail["code"] == "step_up_required", (method, path)
            refused.append((method, path))
        assert set(refused) == STEP_UP_ROUTES
        assert db.touched == [] and db.inserts == [] and engine_calls == []
    finally:
        TOKENS.clear()
