"""W-3 — owner-bound accessor + service-scope (security spine) unit tests.

Primitive-level only (route wiring + cross-tenant route-matrix = W-4). Verifies:
  • accessor fail-closed (unregistered/derived/None) + auto .eq + insert stamp;
  • instructor_owned_essay_ids 2-branch union (both leak directions);
  • fan_out_assignment / list_essays raise PermissionError on cross-owner
    (prompt / cohort / student), admin path (owner_id=None) unchanged;
  • thin wrappers always inject `me` and refuse None.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest


# ── recording fake supabase ──────────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _Rec:
    def __init__(self, table, store):
        self.table = table
        self.store = store
        self.kind = "select"
        self.payload = None

    def select(self, *cols, **kw):
        self.kind = "select"; return self

    def insert(self, payload):
        self.kind = "insert"; self.payload = payload
        self.store.inserts.append((self.table, payload)); return self

    def update(self, payload):
        self.kind = "update"; self.payload = payload
        self.store.updates.append((self.table, payload)); return self

    def delete(self):
        self.kind = "delete"; return self

    def eq(self, col, val):
        self.store.eqs.append((self.table, col, val)); return self

    def in_(self, col, vals):
        self.store.ins.append((self.table, col, list(vals))); return self

    def limit(self, *a, **k): return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self
    def is_(self, *a, **k): return self

    def execute(self):
        if self.kind == "insert":
            p = self.payload
            rows = p if isinstance(p, list) else [p]
            return _Result([{**r, "id": f"new{i}"} for i, r in enumerate(rows)])
        if self.kind in ("update", "delete"):
            return _Result([{}])
        return _Result(list(self.store.data.get(self.table, [])))


class _FakeSB:
    def __init__(self, data=None):
        self.data = data or {}
        self.eqs: list = []
        self.ins: list = []
        self.inserts: list = []
        self.updates: list = []

    def table(self, name):
        return _Rec(name, self)


def _patch_ia(fake):
    return patch("services.instructor_access.supabase_admin", fake)


# ── accessor: fail-closed + scope-injection + insert stamp ───────────────────

def test_accessor_requires_me():
    from services.instructor_access import instructor_db
    for bad in (None, "", 0):
        with pytest.raises(PermissionError):
            instructor_db(bad)


def test_accessor_rejects_unregistered_table():
    from services.instructor_access import instructor_db
    with _patch_ia(_FakeSB()):
        with pytest.raises(PermissionError):
            instructor_db("u1").table("sessions")        # not in registry


def test_accessor_rejects_derived_owner_essays():
    from services.instructor_access import instructor_db
    with _patch_ia(_FakeSB()):
        with pytest.raises(PermissionError) as ei:
            instructor_db("u1").table("writing_essays")  # derived → must use instructor_essays
    assert "instructor_essays" in str(ei.value)


def test_accessor_injects_owner_eq_on_select():
    from services.instructor_access import instructor_db
    fake = _FakeSB()
    with _patch_ia(fake):
        instructor_db("u1").table("students").select("*").execute()
        instructor_db("u1").table("cohorts").select("id").execute()
    assert ("students", "instructor_id", "u1") in fake.eqs
    assert ("cohorts", "created_by", "u1") in fake.eqs


def test_accessor_injects_owner_eq_on_update_and_delete():
    from services.instructor_access import instructor_db
    fake = _FakeSB()
    with _patch_ia(fake):
        instructor_db("u1").table("writing_prompts").update({"title": "x"}).execute()
        instructor_db("u1").table("writing_prompts").delete().execute()
    assert fake.eqs.count(("writing_prompts", "created_by", "u1")) == 2


def test_accessor_insert_stamps_owner_dict_and_list():
    from services.instructor_access import instructor_db
    fake = _FakeSB()
    with _patch_ia(fake):
        instructor_db("u1").table("writing_prompts").insert({"title": "a"}).execute()
        instructor_db("u1").table("writing_prompts").insert([{"title": "b"}, {"title": "c"}]).execute()
    one = fake.inserts[0][1]
    assert one["created_by"] == "u1"
    many = fake.inserts[1][1]
    assert all(r["created_by"] == "u1" for r in many)


def test_accessor_insert_does_not_mutate_caller_payload():
    from services.instructor_access import instructor_db
    fake = _FakeSB()
    original = {"title": "a"}
    with _patch_ia(fake):
        instructor_db("u1").table("writing_prompts").insert(original).execute()
    assert "created_by" not in original   # owner stamped on a copy, not the caller's dict


# ── essay derived-owner: 2-branch union (both leak directions) ───────────────

def _owned(*, assignments=None, students=None, essays=None):
    fake = _FakeSB({
        "writing_assignments": assignments or [],
        "students":            students or [],
        "writing_essays":      essays or [],
    })
    from services.instructor_access import instructor_owned_essay_ids
    with _patch_ia(fake):
        return instructor_owned_essay_ids("me")


def test_owned_essays_assignment_branch_only():
    # essay reachable ONLY via an assignment I made (student is NOT mine).
    owned = _owned(assignments=[{"essay_id": "eA"}], students=[], essays=[])
    assert owned == ["eA"]


def test_owned_essays_student_branch_only():
    # essay reachable ONLY via my student (no assignment row points to it).
    owned = _owned(assignments=[], students=[{"id": "s1"}], essays=[{"id": "eB"}])
    assert owned == ["eB"]


def test_owned_essays_union_both_branches_no_dup():
    owned = _owned(
        assignments=[{"essay_id": "eA"}, {"essay_id": "eShared"}],
        students=[{"id": "s1"}],
        essays=[{"id": "eB"}, {"id": "eShared"}],
    )
    assert owned == ["eA", "eB", "eShared"]   # sorted union, de-duped


def test_owned_essays_ignores_null_essay_id_links():
    owned = _owned(assignments=[{"essay_id": None}, {"essay_id": "eA"}], students=[])
    assert owned == ["eA"]


def test_instructor_essays_empty_owned_is_failclosed():
    from services.instructor_access import instructor_essays, _IMPOSSIBLE_ID
    fake = _FakeSB({"writing_assignments": [], "students": []})
    with _patch_ia(fake):
        scoped = instructor_essays("me")
        scoped.select("id").execute()
    # empty owned-set → impossible id filter → never an unscoped query
    assert ("writing_essays", "id", [_IMPOSSIBLE_ID]) in fake.ins


# ── fan_out_assignment ownership gate ────────────────────────────────────────

def _fan(db_data, *, owner_id="me", prompts=("p1",), cohort="c1"):
    from services.cohort_assignment_service import fan_out_assignment
    return fan_out_assignment(
        _FakeSB(db_data), prompt_ids=list(prompts), cohort_id=cohort,
        assigned_by="me", owner_id=owner_id,
    )


def test_fan_out_rejects_cohort_not_owned():
    with pytest.raises(PermissionError) as ei:
        _fan({"cohorts": [{"id": "c1", "created_by": "other"}],
              "writing_prompts": [{"id": "p1", "created_by": "me"}]})
    assert "cohort" in str(ei.value)


def test_fan_out_rejects_prompt_not_owned():
    with pytest.raises(PermissionError) as ei:
        _fan({"cohorts": [{"id": "c1", "created_by": "me"}],
              "writing_prompts": [{"id": "p1", "created_by": "other"}]})
    assert "prompt" in str(ei.value)


def test_fan_out_rejects_prompt_missing():
    with pytest.raises(PermissionError) as ei:
        _fan({"cohorts": [{"id": "c1", "created_by": "me"}],
              "writing_prompts": []})           # p1 absent
    assert "không tồn tại" in str(ei.value)


def test_fan_out_rejects_foreign_student_in_cohort():
    with pytest.raises(PermissionError) as ei:
        _fan({
            "cohorts": [{"id": "c1", "created_by": "me"}],
            "writing_prompts": [{"id": "p1", "created_by": "me"}],
            "students": [{"id": "s1", "instructor_id": "other"}],   # owned by another GV
        })
    assert "instructor khác" in str(ei.value)


def test_fan_out_allows_owned_cohort_with_null_and_self_students():
    res = _fan({
        "cohorts": [{"id": "c1", "created_by": "me"}],
        "writing_prompts": [{"id": "p1", "created_by": "me"}],
        "students": [{"id": "s1", "instructor_id": None},      # unowned in MY cohort → allowed
                     {"id": "s2", "instructor_id": "me"}],     # mine → allowed
        "writing_assignments": [],                              # no overlap
    })
    assert res["student_count"] == 2
    assert res["created_count"] == 2          # 2 students × 1 prompt


def test_fan_out_admin_path_skips_ownership_checks():
    """owner_id=None (admin/legacy) → no ownership verification (admin fans any)."""
    from services.cohort_assignment_service import fan_out_assignment
    res = fan_out_assignment(
        _FakeSB({
            "cohorts": [{"id": "c1", "created_by": "someone_else"}],
            "writing_prompts": [{"id": "p1", "created_by": "someone_else"}],
            "students": [{"id": "s1", "instructor_id": "another"}],
            "writing_assignments": [],
        }),
        prompt_ids=["p1"], cohort_id="c1", assigned_by="admin",  # no owner_id
    )
    assert res["created_count"] == 1     # admin path unaffected


# ── list_essays ownership gate ───────────────────────────────────────────────

def _patch_essay(fake):
    # list_essays uses essay_service.supabase_admin; owned-ids uses instructor_access's.
    return patch("services.essay_service.supabase_admin", fake), _patch_ia(fake)


def test_list_essays_rejects_unowned_student_filter():
    from services.essay_service import list_essays
    fake = _FakeSB({"students": [{"id": "sX", "instructor_id": "other"}]})
    p1, p2 = _patch_essay(fake)
    with p1, p2, pytest.raises(PermissionError):
        list_essays(owner_id="me", student_id="sX")


def test_list_essays_rejects_unowned_cohort_filter():
    from services.essay_service import list_essays
    fake = _FakeSB({"cohorts": [{"id": "cX", "created_by": "other"}]})
    p1, p2 = _patch_essay(fake)
    with p1, p2, pytest.raises(PermissionError):
        list_essays(owner_id="me", cohort_id="cX")


def test_list_essays_empty_owned_returns_empty_failclosed():
    from services.essay_service import list_essays
    fake = _FakeSB({"writing_assignments": [], "students": []})  # owns nothing
    p1, p2 = _patch_essay(fake)
    with p1, p2:
        assert list_essays(owner_id="me") == []


def test_list_essays_admin_path_no_ownership_gate():
    """owner_id=None → admin see-all: an arbitrary student_id is NOT ownership-checked."""
    from services.essay_service import list_essays
    fake = _FakeSB({"writing_essays": []})   # empty result, but NO PermissionError
    p1, p2 = _patch_essay(fake)
    with p1, p2:
        assert list_essays(student_id="anything") == []


# ── thin wrappers: always inject me, refuse None ─────────────────────────────

def test_wrappers_refuse_none_me():
    from services.instructor_access import instructor_fan_out, instructor_list_essays
    with pytest.raises(PermissionError):
        instructor_fan_out(None, _FakeSB({}), prompt_ids=["p1"], cohort_id="c1")
    with pytest.raises(PermissionError):
        instructor_list_essays(None)


def test_instructor_fan_out_injects_me_ignoring_caller_owner():
    """Wrapper forces assigned_by=owner_id=me even if a caller tries to override."""
    captured = {}

    def _spy(db, **kw):
        captured.update(kw); return {"ok": True}

    from services import instructor_access
    with patch("services.cohort_assignment_service.fan_out_assignment", _spy):
        instructor_access.instructor_fan_out(
            "me", _FakeSB({}),
            prompt_ids=["p1"], cohort_id="c1",
            assigned_by="EVIL", owner_id="EVIL",      # must be ignored
        )
    assert captured["assigned_by"] == "me"
    assert captured["owner_id"] == "me"


def test_instructor_list_essays_injects_me():
    captured = {}

    def _spy(**kw):
        captured.update(kw); return []

    from services import instructor_access
    with patch("services.essay_service.list_essays", _spy):
        instructor_access.instructor_list_essays("me", status="graded", owner_id="EVIL")
    assert captured["owner_id"] == "me"
    assert captured["status"] == "graded"
