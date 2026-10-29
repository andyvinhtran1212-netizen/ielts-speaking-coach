"""BL-18 — POST /admin/writing/assignments/duplicates-preview.

The admin give is ALLOW + WARN: the response's `duplicates_warning` names the
students who already held a prompt, but only AFTER the rows exist. The preview
answers the same question before the give, so the UI can ask for confirmation.
These tests pin that it (a) writes nothing, (b) reports exactly what the give
itself reports, and (c) never turns a failed read into "no overlap".
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
P1 = "00000000-0000-0000-0000-000000000011"
P2 = "00000000-0000-0000-0000-000000000012"
C1 = "00000000-0000-0000-0000-000000000031"
S1 = "00000000-0000-0000-0000-000000000041"
S2 = "00000000-0000-0000-0000-000000000042"
S3 = "00000000-0000-0000-0000-000000000043"   # not in C1
PATH = "/admin/writing/assignments/duplicates-preview"


class _Result:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, table, store, fail_tables):
        self.table, self.store, self.fail_tables = table, store, fail_tables
        self._filters: list = []
        self._op, self._payload = "select", None

    def select(self, *a, **k): self._op = "select"; return self
    def insert(self, p): self._op = "insert"; self._payload = p; return self
    def eq(self, c, v): self._filters.append(("eq", c, v)); return self
    def in_(self, c, v): self._filters.append(("in", c, [str(x) for x in v])); return self
    def is_(self, c, v): self._filters.append(("is", c, v)); return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self
    def limit(self, *a, **k): return self

    def _match(self, row):
        for op, c, v in self._filters:
            rv = row.get(c)
            if op == "eq" and str(rv) != str(v): return False
            if op == "in" and str(rv) not in v: return False
            if op == "is" and v == "null" and rv is not None: return False
        return True

    def execute(self):
        if self.table in self.fail_tables:
            raise RuntimeError(f"fixture read failure on {self.table}")
        rows = self.store.setdefault(self.table, [])
        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            created = [{"id": f"new-{len(rows) + i}", **it} for i, it in enumerate(items)]
            rows.extend(created)
            return _Result(created)
        return _Result([dict(r) for r in rows if self._match(r)])


class _Rpc:
    def __init__(self, result):
        self.result = result

    def execute(self):
        return _Result(self.result)


class _FakeSB:
    def __init__(self, store, fail_tables=()):
        self.store, self.fail_tables = store, set(fail_tables)
        self.rpcs: list = []

    def table(self, name):
        return _Q(name, self.store, self.fail_tables)

    def rpc(self, name, params):
        """fn_create_writing_assignments_idempotent's receipt counts, as
        migration 228 computes them: `student_count` is the roster passed in,
        `duplicates_warning` every rostered student already holding a prompt."""
        assert name == "fn_create_writing_assignments_idempotent"
        self.rpcs.append(params)
        prompts, students = set(params["p_prompt_ids"]), params["p_student_ids"]
        held = {r["student_id"] for r in self.store.get("writing_assignments", [])
                if r["prompt_id"] in prompts and r["student_id"] in students}
        return _Rpc({"created": [], "assignment_ids": [], "created_count": 0,
                     "student_count": len(students), "group_id": "g-new",
                     "duplicates_warning": sorted(held), "replayed": False})


def _seed():
    return {
        "student_cohort_memberships": [
            {"id": "m1", "student_id": S1, "cohort_id": C1, "is_active": True},
            {"id": "m2", "student_id": S2, "cohort_id": C1, "is_active": True},
            {"id": "m3", "student_id": S3, "cohort_id": C1, "is_active": False},  # left the class
        ],
        "students": [
            {"id": S1, "instructor_id": None, "archived_at": None},
            {"id": S2, "instructor_id": None, "archived_at": None},
            {"id": S3, "instructor_id": None, "archived_at": None},
        ],
        "writing_assignments": [
            # S1 got P1 individually (no cohort stamp) — still an overlap.
            {"id": "a1", "student_id": S1, "prompt_id": P1, "cohort_id": None, "status": "delivered"},
            # S3 holds P1 but is no longer an active member of C1.
            {"id": "a3", "student_id": S3, "prompt_id": P1, "cohort_id": C1, "status": "pending"},
            {"id": "a4", "student_id": S2, "prompt_id": P2, "cohort_id": None, "status": "pending"},
        ],
    }


def _post(store, body, fail_tables=()):
    from main import app
    fake = _FakeSB(store, fail_tables)
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_writing_assignments.supabase_admin", fake):
        return TestClient(app, raise_server_exceptions=False).post(PATH, json=body, headers=_AUTH)


def test_requires_auth_header():
    from main import app
    r = TestClient(app).post(PATH, json={"prompt_ids": [P1], "cohort_id": C1})
    assert r.status_code == 401


def test_requires_exactly_one_target():
    assert _post(_seed(), {"prompt_ids": [P1]}).status_code == 422
    assert _post(_seed(), {"prompt_ids": [P1], "cohort_id": C1, "student_ids": [S1]}).status_code == 422
    assert _post(_seed(), {"prompt_ids": [], "cohort_id": C1}).status_code == 422


def test_cohort_preview_names_active_members_who_already_hold_a_prompt():
    store = _seed()
    before = [dict(r) for r in store["writing_assignments"]]
    r = _post(store, {"prompt_ids": [P1], "cohort_id": C1})
    assert r.status_code == 200, r.text
    # S1 holds P1; S3 holds it too but left the class, so it is not a recipient.
    assert r.json() == {"student_count": 2, "duplicate_student_ids": [S1]}
    assert store["writing_assignments"] == before        # read-only


def test_cohort_preview_covers_every_selected_prompt():
    r = _post(_seed(), {"prompt_ids": [P1, P2], "cohort_id": C1})
    assert r.status_code == 200, r.text
    assert r.json()["duplicate_student_ids"] == [S1, S2]


def test_individual_preview_uses_the_selected_students():
    r = _post(_seed(), {"prompt_ids": [P2], "student_ids": [S1, S2, S2]})
    assert r.status_code == 200, r.text
    assert r.json() == {"student_count": 2, "duplicate_student_ids": [S2]}


def test_preview_matches_the_fan_out_duplicates_warning():
    store = _seed()
    preview = _post(store, {"prompt_ids": [P1, P2], "cohort_id": C1}).json()
    from main import app
    fake = _FakeSB(store)
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_writing_assignments.supabase_admin", fake):
        given = TestClient(app).post("/admin/writing/assignments/fan-out",
                                     json={"request_id": "00000000-0000-4000-8000-000000000123",
                                           "prompt_ids": [P1, P2], "cohort_id": C1}, headers=_AUTH)
    assert given.status_code == 201, given.text
    # The give reads the same active roster the preview counted.
    assert sorted(fake.rpcs[0]["p_student_ids"]) == [S1, S2]
    assert preview["duplicate_student_ids"] == given.json()["duplicates_warning"]
    assert preview["student_count"] == given.json()["student_count"]


def test_failed_overlap_read_is_an_error_not_an_empty_list():
    r = _post(_seed(), {"prompt_ids": [P1], "cohort_id": C1}, fail_tables={"writing_assignments"})
    assert r.status_code == 500


def test_both_previews_publish_the_concrete_response_model():
    from fastapi.routing import APIRoute
    from main import app
    from models.writing_give_preview import DuplicatesPreviewOut
    routes = {
        item.path: item for item in app.routes
        if isinstance(item, APIRoute) and "POST" in item.methods and item.path.endswith("duplicates-preview")
    }
    assert set(routes) == {PATH, "/instructor/assignments/duplicates-preview"}
    assert all(route.response_model is DuplicatesPreviewOut for route in routes.values())


# ── PC-J75 F4 — a signed-in non-admin is refused by the REAL admin guard ─────
#
# The tests above stub require_admin. These run services/staff_guard through
# routers.admin's own seams (get_supabase_user, supabase_admin for the role
# read) and pin that the refusal comes before any read of the overlap data.

CALLER = "00000000-0000-0000-0000-00000000c001"


class _RecordingSB(_FakeSB):
    """_FakeSB that records every table and RPC the route touches."""

    def __init__(self, store, fail_tables=()):
        super().__init__(store, fail_tables)
        self.touched: list = []

    def table(self, name):
        self.touched.append(name)
        return super().table(name)

    def rpc(self, name, params):
        self.touched.append(f"rpc:{name}")
        return super().rpc(name, params)


def _post_as(role, body):
    """POST as a signed-in caller whose users.role is ``role``. Returns the
    response, the guard's DB, the route's DB and the overlap-service calls."""
    from main import app
    from config import settings
    guard_db = _RecordingSB({"users": [{"id": CALLER, "role": role}]})
    route_db = _RecordingSB(_seed())
    with patch("routers.admin.get_supabase_user",
               new=AsyncMock(return_value={"id": CALLER, "email": f"{role}@x"})), \
         patch("routers.admin.supabase_admin", guard_db), \
         patch.object(settings, "ADMIN_AAL2_ENFORCE", False), \
         patch("routers.admin_writing_assignments.supabase_admin", route_db), \
         patch("routers.admin_writing_assignments.preview_fan_out_overlap",
               return_value={"student_count": 0, "duplicate_student_ids": []}) as fan_out, \
         patch("routers.admin_writing_assignments.existing_give_student_ids",
               return_value=set()) as individual:
        r = TestClient(app, raise_server_exceptions=False).post(PATH, json=body, headers=_AUTH)
    return r, guard_db, route_db, fan_out.call_count + individual.call_count


_BODIES = [
    {"prompt_ids": [P1], "cohort_id": C1},
    {"prompt_ids": [P1], "student_ids": [S1, S2]},
]


@pytest.mark.parametrize("role", ["user", "instructor"])
@pytest.mark.parametrize("body", _BODIES, ids=["cohort", "individual"])
def test_non_admin_is_refused_before_any_overlap_read(role, body):
    from services import staff_guard
    r, guard_db, route_db, service_calls = _post_as(role, body)
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == staff_guard.ADMIN_ROLE_DENIED
    assert guard_db.touched == ["users"]          # the guard's own role read only
    assert route_db.touched == []                 # no roster / assignment read
    assert service_calls == 0


@pytest.mark.parametrize("body", _BODIES, ids=["cohort", "individual"])
def test_admin_control_reaches_the_overlap_service(body):
    # Same harness, role=admin: proves the "never reached" asserts above can fail.
    r, _guard_db, _route_db, service_calls = _post_as("admin", body)
    assert r.status_code == 200, r.text
    assert service_calls == 1
