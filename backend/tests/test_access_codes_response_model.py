"""Step-A pilot — AccessCodeOut response_model must NOT strip any field the
GET /admin/access-codes route assembles.

response_model serializes the return value through the model, DROPPING any key not
declared on it. If the route appends a key AccessCodeOut lacks, the admin
access-codes page silently loses that field. This test enumerates every key the
route assembles (base .select() columns + `c["…"] =` appends + the assigned_users
sub-object) and asserts AccessCodeOut (and its nested models) cover them — the
strip-footgun guard, mirroring the writing_feedback NOT-NULL schema test.
"""

from __future__ import annotations

import re
from pathlib import Path

_ADMIN = Path(__file__).parent.parent / "routers" / "admin.py"


def _route_src() -> str:
    src = _ADMIN.read_text(encoding="utf-8")
    start = src.index('@router.get("/access-codes"')
    end = src.index('@router.get("/access-codes/pool"')
    return src[start:end]


def _assembled_top_level_keys() -> set[str]:
    body = _route_src()
    keys: set[str] = set()
    # 1) base columns from the .select("…") string (the first select in the route)
    sel = re.search(r'\.select\(\s*((?:"[^"]*"\s*)+)\)', body)
    assert sel, "could not find the base .select() in list_access_codes"
    cols = re.findall(r'[a-z_]+', sel.group(1).replace('"', ' '))
    keys.update(cols)
    # 2) appended keys: c["key"] = …
    keys.update(re.findall(r'c\[\s*"([a-z_]+)"\s*\]\s*=', body))
    return keys


def test_access_code_out_covers_every_assembled_key():
    from routers.admin import AccessCodeOut
    model_fields = set(AccessCodeOut.model_fields.keys())
    assembled = _assembled_top_level_keys()
    missing = assembled - model_fields
    assert not missing, (
        f"AccessCodeOut is missing keys the route assembles → response_model would "
        f"STRIP them from the admin page: {sorted(missing)}"
    )


def test_assigned_user_subobject_fields_covered():
    """The assigned_users[] item shape (built in the route) must be covered by
    AccessCodeAssignedUser + AccessCodeQuota, else those nested fields get stripped."""
    from routers.admin import AccessCodeAssignedUser, AccessCodeQuota
    au = set(AccessCodeAssignedUser.model_fields.keys())
    assert {"user_id", "name", "email", "is_fallback_used_by", "removable", "quota"} <= au
    q = set(AccessCodeQuota.model_fields.keys())
    assert {"used", "limit", "remaining", "limit_type"} <= q


def test_happy_row_serializes_without_dropping_fields():
    """A realistic happy-path row round-trips through AccessCodeOut with
    assigned_users + cohort_name intact (not stripped)."""
    from routers.admin import AccessCodeOut
    row = {
        "id": "c1", "code": "AAAA-BBBB", "is_used": True, "is_revoked": False,
        "is_active": True, "used_by": "u1", "used_at": "2026-01-01",
        "created_at": "2026-01-01", "permissions": {"writing": True},
        "session_limit": 10, "expires_at": None, "code_type": "individual",
        "cohort_id": "co1", "notes": "n",
        "assigned_user_count": 1,
        "assigned_users": [{
            "user_id": "u1", "name": "A", "email": "a@x.io",
            "is_fallback_used_by": False, "removable": True,
            "quota": {"used": 2, "limit": 10, "remaining": 8, "limit_type": "per_user_via_code"},
        }],
        "cohort_name": "Lop A",
    }
    out = AccessCodeOut(**row).model_dump()
    assert out["assigned_users"][0]["email"] == "a@x.io"        # nested kept
    assert out["assigned_users"][0]["quota"]["remaining"] == 8
    assert out["cohort_name"] == "Lop A"
    assert out["permissions"] == {"writing": True}


def test_lookup_failed_branch_row_does_not_500():
    """The assignment-lookup-failure early return has ONLY base cols +
    association_lookup_failed (no assigned_users/cohort_name). It must validate
    (all appended fields Optional+default) — else FastAPI 500s on that branch."""
    from routers.admin import AccessCodeOut
    row = {
        "id": "c1", "code": "AAAA-BBBB", "is_used": False, "is_revoked": False,
        "is_active": True, "used_by": None, "used_at": None,
        "created_at": "2026-01-01", "permissions": None, "session_limit": None,
        "expires_at": None, "code_type": "individual", "cohort_id": None, "notes": None,
        "association_lookup_failed": True,
    }
    out = AccessCodeOut(**row).model_dump()
    assert out["association_lookup_failed"] is True
    assert out["assigned_users"] == []        # default, not required
    assert out["cohort_name"] is None
