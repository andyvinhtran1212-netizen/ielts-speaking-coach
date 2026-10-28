"""BL-18 — POST /admin/writing/assignments/duplicates-preview.

The admin give is ALLOW + WARN: the response's `duplicates_warning` names the
students who already held a prompt, but only AFTER the rows exist. The preview
answers the same question before the give, so the UI can ask for confirmation.
These tests pin that it (a) writes nothing, (b) reports exactly what the give
itself reports, and (c) never turns a failed read into "no overlap".
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

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


class _FakeSB:
    def __init__(self, store, fail_tables=()):
        self.store, self.fail_tables = store, set(fail_tables)

    def table(self, name):
        return _Q(name, self.store, self.fail_tables)


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
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_writing_assignments.supabase_admin", _FakeSB(store)):
        given = TestClient(app).post("/admin/writing/assignments/fan-out",
                                     json={"prompt_ids": [P1, P2], "cohort_id": C1}, headers=_AUTH)
    assert given.status_code == 201, given.text
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
