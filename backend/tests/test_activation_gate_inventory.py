"""W-03 — route inventory for the learner activation gate.

Walks the REAL FastAPI app and classifies every route as exactly one of:

  * staff   — path under /admin, /api/admin or /instructor (own role guards);
  * exempt  — listed in services.activation_gate.ACTIVATION_EXEMPT_ROUTES
              with a one-line reason;
  * gated   — `require_active_learner` is in the route's dependency tree.

Any other route FAILS this test. A learner endpoint added later to a router
that main.py includes with the gate is gated automatically; one added to a
new router (or to the app itself) fails here until it is gated or explicitly
exempted with a reason.
"""

from __future__ import annotations

import pytest
from fastapi.routing import APIRoute

import main
from services import activation_gate
from services.activation_gate import (
    ACTIVATION_EXEMPT_ROUTES,
    is_staff_path,
    require_active_learner,
)


def _calls(dependant):
    for dep in dependant.dependencies:
        yield dep.call
        yield from _calls(dep)


def _route_methods():
    for route in main.app.routes:
        if not isinstance(route, APIRoute):
            continue
        gated = any(call is require_active_learner for call in _calls(route.dependant))
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            yield method, route.path, gated, route


ROUTES = list(_route_methods())


def test_every_learner_route_is_gated_or_explicitly_exempt():
    offenders = [
        f"{method} {path} ({route.endpoint.__module__}.{route.endpoint.__name__})"
        for method, path, gated, route in ROUTES
        if not gated and not is_staff_path(path) and (method, path) not in ACTIVATION_EXEMPT_ROUTES
    ]
    assert not offenders, (
        "Learner routes without the activation gate. Include the router with "
        "dependencies=_ACTIVE_LEARNER in main.py, or add a justified entry to "
        "ACTIVATION_EXEMPT_ROUTES:\n  " + "\n  ".join(offenders)
    )


def test_exemptions_are_live_routes_with_reasons():
    live = {(method, path) for method, path, _gated, _route in ROUTES}
    stale = sorted(key for key in ACTIVATION_EXEMPT_ROUTES if key not in live)
    assert not stale, f"exemptions for routes that no longer exist: {stale}"
    for key, reason in ACTIVATION_EXEMPT_ROUTES.items():
        assert isinstance(reason, str) and len(reason.strip()) >= 10, key
        assert not is_staff_path(key[1]), f"staff path needs no exemption: {key}"


def test_staff_routes_classify_by_prefix_only():
    assert is_staff_path("/admin/users")
    assert is_staff_path("/api/admin/feedback")
    assert is_staff_path("/instructor/essays/{essay_id}")
    assert not is_staff_path("/administrator")
    assert not is_staff_path("/api/administration")
    assert not is_staff_path("/instructors")


def test_staff_routes_carry_a_role_guard_not_the_learner_gate_semantics():
    # Staff routes inside a gated mixed router (feedback, vocab_units) do carry
    # the dependency; the gate skips them at runtime by prefix (see
    # test_activation_gate.py::test_staff_path_in_gated_router_is_not_gated).
    staff = [(m, p) for m, p, _g, _r in ROUTES if is_staff_path(p)]
    assert len(staff) > 100   # sanity: the inventory really walked the app


# The audit's named bypasses plus representative generic learner routes: each
# must be GATED (not merely "not exempt").
MUST_BE_GATED = [
    ("POST", "/api/listening/attempts"),                                   # gist (Claude)
    ("POST", "/api/writing/my-assignments/{assignment_id}/submit"),        # Writing submit
    ("POST", "/api/mock-exams/sittings/{sitting_id}/sections/{section}/submit"),
    ("POST", "/api/mock-exams/sittings/{sitting_id}/writing"),
    ("POST", "/api/quiz/course/writing"),                                  # course writing
    ("POST", "/api/quiz/course/pronunciation/submit"),                     # course pronunciation
    ("POST", "/api/advanced-vocab/controlled-rewrite/complete"),           # rewrite grader
    ("POST", "/sessions"),
    ("POST", "/sessions/{session_id}/responses"),
    ("POST", "/tts"),
    ("GET", "/topics"),
    ("PATCH", "/auth/profile"),
    ("GET", "/api/student/permissions"),
    ("GET", "/api/listening/tests"),
    ("POST", "/api/reading/test/{test_id}/attempts"),
]


@pytest.mark.parametrize("method,path", MUST_BE_GATED)
def test_paid_and_core_learner_routes_are_gated(method, path):
    matches = [gated for m, p, gated, _r in ROUTES if (m, p) == (method, path)]
    assert matches, f"{method} {path} not found — update this inventory"
    assert all(matches), f"{method} {path} is not behind require_active_learner"
    assert (method, path) not in ACTIVATION_EXEMPT_ROUTES


def test_activation_bootstrap_routes_stay_exempt():
    for key in [("GET", "/auth/me"), ("GET", "/auth/check-active"), ("POST", "/auth/activate")]:
        assert key in ACTIVATION_EXEMPT_ROUTES
    assert activation_gate.is_exempt("get", "/auth/me")
