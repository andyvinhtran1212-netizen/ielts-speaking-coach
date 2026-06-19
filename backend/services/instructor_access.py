"""services/instructor_access.py — W-3 owner-bound accessor (SECURITY SPINE).

Writing endpoints use the service-role client (`supabase_admin`), which BYPASSES
RLS — so multi-tenant scoping MUST live in code. This module is the ONE
sanctioned way an instructor-role request touches an owner-scoped table: the
accessor wraps the service-role client and auto-injects `.eq(owner_col, me)` on
every read/write (and stamps `owner_col = me` on insert), so the owner filter
can never be forgotten.

  instructor_db(me).table("students").select("*").execute()   # → .eq("instructor_id", me)
  instructor_db(me).table("writing_prompts").insert({...})     # → stamps created_by = me

Design invariants:
  • `me` is ONE injected value (the constructor arg) — never `current_user.id`
    sprinkled inline. W-8 (admin impersonation `?as_instructor`) overrides it in
    exactly one place.
  • FAIL-CLOSED: a table with no registered owner column → PermissionError. A
    derived-owner table (writing_essays) → PermissionError pointing at the
    dedicated path (`instructor_essays`).
  • Cross-tenant leak is OWASP #1 here; every primitive defaults to "deny".

Admin (admin ⊃ instructor) does NOT go through this accessor — admin uses the
`/admin/*` see-all paths. This accessor is exclusively for `/instructor/*` (W-4).

NOTE for W-4 (not built here): PermissionError must map → HTTP 403 (not 500);
the claim-time essay-owner check + the claimable-queue (status='queued',
claimed_by IS NULL) essay-ownership scoping live in W-4/W-6.
"""

from __future__ import annotations

from typing import Any

from database import supabase_admin


# table → owner column. The ONLY tables an instructor may touch by column-owner.
_OWNER_COLUMNS: dict[str, str] = {
    "students":            "instructor_id",   # mig 106
    "writing_prompts":     "created_by",      # mig 035
    "writing_assignments": "assigned_by",     # mig 036
    "cohorts":             "created_by",       # mig 060
    "access_codes":        "issued_by",        # mig 106
    "instructor_reviews":  "claimed_by",       # mig 047 (scopes "reviews I claimed";
                                               # the claimable QUEUE is essay-owner
                                               # scoped — W-4/W-6, not here)
}

# Tables whose ownership is DERIVED (no owner column) — must use a dedicated path.
_DERIVED_OWNER: dict[str, str] = {
    "writing_essays": "instructor_essays(me)",
}

# Fail-closed sentinel: an id that matches nothing, so an empty owned-set yields
# an empty result set instead of an unscoped query.
_IMPOSSIBLE_ID = "00000000-0000-0000-0000-000000000000"


def _require_me(me: Any) -> str:
    if not me:
        raise PermissionError("instructor accessor requires a non-empty owner id (me)")
    return str(me)


class _ScopedTable:
    """A single owner-scoped table. Reads/updates/deletes auto-filter on the owner
    column; inserts stamp it. Returns the underlying PostgREST builder so callers
    chain extra `.eq/.in_/.order/.range(...).execute()` as usual."""

    def __init__(self, table_name: str, owner_col: str, me: str):
        self._table = table_name
        self._owner = owner_col
        self._me = me

    def select(self, *cols: str, **kw: Any):
        sel = cols if cols else ("*",)
        return supabase_admin.table(self._table).select(*sel, **kw).eq(self._owner, self._me)

    def update(self, payload: dict):
        return supabase_admin.table(self._table).update(payload).eq(self._owner, self._me)

    def delete(self):
        return supabase_admin.table(self._table).delete().eq(self._owner, self._me)

    def insert(self, payload):
        # Stamp the owner onto EVERY row so an instructor can't insert a row owned
        # by someone else. Copy (never mutate the caller's dict).
        if isinstance(payload, list):
            stamped = [{**r, self._owner: self._me} for r in payload]
        else:
            stamped = {**payload, self._owner: self._me}
        return supabase_admin.table(self._table).insert(stamped)


class InstructorDB:
    """`instructor_db(me)` — owner-bound view of the service-role client."""

    def __init__(self, me: Any):
        self._me = _require_me(me)

    def table(self, name: str) -> _ScopedTable:
        if name in _DERIVED_OWNER:
            raise PermissionError(
                f"instructor_db: {name!r} is derived-owner — use {_DERIVED_OWNER[name]}"
            )
        owner_col = _OWNER_COLUMNS.get(name)
        if owner_col is None:
            raise PermissionError(
                f"instructor_db: table {name!r} has no registered owner column "
                f"(fail-closed — refusing to touch it)"
            )
        return _ScopedTable(name, owner_col, self._me)


def instructor_db(me: Any) -> InstructorDB:
    return InstructorDB(me)


# ── Essay derived-owner (seam-defect #1) — 2-branch ownership ────────────────

def instructor_owned_essay_ids(me: Any) -> list[str]:
    """The essay ids an instructor owns, via TWO branches (union):

      1. assignment branch — essays linked to assignments I made
         (writing_assignments.assigned_by = me → .essay_id).
      2. student   branch — essays by my students
         (writing_essays.student_id ∈ students where instructor_id = me).

    Both are required: branch 1 alone misses on-behalf essays with no assignment;
    branch 2 alone misses essays assigned by me to a student not pointed at me.
    """
    me = _require_me(me)
    owned: set[str] = set()

    a = (
        supabase_admin.table("writing_assignments")
        .select("essay_id").eq("assigned_by", me).execute()
    )
    owned |= {r["essay_id"] for r in (a.data or []) if r.get("essay_id")}

    s = (
        supabase_admin.table("students")
        .select("id").eq("instructor_id", me).execute()
    )
    student_ids = [r["id"] for r in (s.data or []) if r.get("id")]
    if student_ids:
        e = (
            supabase_admin.table("writing_essays")
            .select("id").in_("student_id", student_ids).execute()
        )
        owned |= {r["id"] for r in (e.data or []) if r.get("id")}

    return sorted(owned)


class _EssayScoped:
    """writing_essays scoped to the instructor's owned ids. `.select()` returns the
    builder pre-filtered with `.in_("id", owned)` so callers chain the rest."""

    def __init__(self, owned_ids: list[str]):
        # fail-closed: empty owned-set → an impossible id → no rows (never unscoped)
        self._owned = owned_ids or [_IMPOSSIBLE_ID]

    def select(self, *cols: str, **kw: Any):
        sel = cols if cols else ("*",)
        return supabase_admin.table("writing_essays").select(*sel, **kw).in_("id", self._owned)


def instructor_essays(me: Any) -> _EssayScoped:
    """Owner-bound writing_essays accessor (derived-owner, 2-branch)."""
    return _EssayScoped(instructor_owned_essay_ids(_require_me(me)))


def _essay_owned_by(me: str, essay_id: Any) -> bool:
    """Fix-3 (D3) — EXISTS-style membership check: is `essay_id` owned by `me`
    via EITHER branch, WITHOUT materialising the full owned-set.

    `instructor_owned_essay_ids` builds a whole set (two unbounded scans + a
    set union) just to test ONE essay — wasteful on every single-essay route,
    and at scale the materialised set feeds a `.in_()` URL that can truncate.
    This does at most three narrow, indexed lookups instead.

    Semantics are IDENTICAL to instructor_owned_essay_ids (2-branch union,
    NEITHER branch filters soft-deleted — membership must mirror the accessor):
      1. assignment branch — a writing_assignment assigned_by=me linked to it;
      2. student   branch — its student_id ∈ my students (instructor_id=me).
    """
    eid = str(essay_id)
    # branch 1 — narrow the (assigned_by) scan to this essay; 0/1 row back.
    a = (
        supabase_admin.table("writing_assignments")
        .select("essay_id").eq("assigned_by", me).eq("essay_id", eid)
        .limit(1).execute()
    )
    if a.data:
        return True
    # branch 2 — the essay's student must be one of mine.
    e = (
        supabase_admin.table("writing_essays")
        .select("student_id").eq("id", eid).limit(1).execute()
    )
    sid = (e.data or [{}])[0].get("student_id")
    if not sid:
        return False
    s = (
        supabase_admin.table("students")
        .select("id").eq("id", sid).eq("instructor_id", me)
        .limit(1).execute()
    )
    return bool(s.data)


def assert_essay_owned(me: Any, essay_id: Any) -> None:
    """Raise PermissionError unless `essay_id` is in the instructor's owned set
    (2-branch). Used by every single-essay /instructor endpoint BEFORE acting.

    Membership-based on purpose: a non-owned-existing essay AND a non-existent
    essay both fail the same way → no existence leak (403 is uniform).

    Fix-3 (D3): backed by `_essay_owned_by` (EXISTS) — same 2-branch semantics
    as instructor_owned_essay_ids, without building the full owned-set."""
    me = _require_me(me)
    if not _essay_owned_by(me, essay_id):
        raise PermissionError("essay not owned by this instructor")


# ── Thin can't-forget wrappers — the ONLY entry points /instructor/* routes use ─
#
# The raw service fns keep an OPTIONAL owner_id (None = admin/legacy, unchanged).
# These wrappers ALWAYS inject `me` and refuse None, so an instructor route can't
# accidentally call the unscoped path. W-4 routes call ONLY these wrappers.

def instructor_fan_out(me: Any, db=None, **kwargs):
    """fan_out_assignment scoped to `me` — verifies prompt/cohort/student ownership
    (raises PermissionError on any cross-owner target). Ignores any caller-supplied
    assigned_by/owner_id (owner is auth-derived)."""
    me = _require_me(me)
    from services.cohort_assignment_service import fan_out_assignment
    kwargs.pop("assigned_by", None)
    kwargs.pop("owner_id", None)
    client = db if db is not None else supabase_admin
    return fan_out_assignment(client, assigned_by=me, owner_id=me, **kwargs)


def instructor_list_essays(me: Any, **kwargs):
    """list_essays scoped to `me` — owned-essay (2-branch) result + ownership checks
    on any student_id/cohort_id filter. Ignores any caller-supplied owner_id."""
    me = _require_me(me)
    from services.essay_service import list_essays
    kwargs.pop("owner_id", None)
    return list_essays(owner_id=me, **kwargs)
