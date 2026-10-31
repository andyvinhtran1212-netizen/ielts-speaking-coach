"""Python stand-in for migration 360's `fn_create_instructor_writing_give_idempotent`.

Route tests run on table()-based fakes (no PostgreSQL). This emulates the
RPC's observable contract over any fake that offers `table(name)` with
select/eq/in_/insert/execute: ledger replay, owner and payload checks, the
in-transaction ownership re-check, the roster, the allow + warn overlap and
the insert (whose fake-side errors, e.g. a 331 `student_archived`, propagate
with nothing written to the ledger). The SQL itself, including concurrency,
is proven on PostgreSQL by test_migration_360_instructor_give_idempotency.py.

The roster mirrors the route pre-check (`active_students_for_cohort`, which
keeps the legacy `students.cohort_id` fallback these fakes are seeded with);
the SQL uses active memberships only.
"""

from __future__ import annotations

from uuid import uuid4

from services.class_membership_service import active_students_for_cohort
from services.instructor_give_service import LEDGER, RPC


class FakeRpcError(Exception):
    """The PostgREST error text the service maps (the message is the RAISE)."""


def emulate_instructor_give(db, params: dict) -> dict:
    kind = params["p_give_kind"]
    owner = str(params["p_owner"])
    request_id = str(params["p_request_id"])
    payload = params["p_request_payload"]
    prompt_ids = [str(p) for p in params["p_prompt_ids"]]

    existing = db.table(LEDGER).select("*").eq("id", request_id).execute().data or []
    if existing:
        row = existing[0]
        if str(row.get("assigned_by")) != owner:
            raise FakeRpcError("instructor_give_request_owned_by_other")
        if row.get("give_kind") != kind or row.get("request_payload") != payload:
            raise FakeRpcError("instructor_give_request_payload_mismatch")
        return {**row["receipt"], "replayed": True}

    prompts = db.table("writing_prompts").select("id, created_by").in_("id", prompt_ids).execute().data or []
    if len({p["id"] for p in prompts if str(p.get("created_by")) == owner}) != len(prompt_ids):
        raise FakeRpcError("instructor_give_not_owned")

    group_id = None
    cohort_id = params.get("p_cohort_id")
    if kind == "individual":
        student_id = str(params["p_student_id"])
        mine = (db.table("students").select("id, instructor_id").eq("id", student_id)
                .execute().data or [])
        if not [s for s in mine if str(s.get("instructor_id")) == owner]:
            raise FakeRpcError("instructor_give_not_owned")
        student_ids = [student_id]
        if params.get("p_name"):
            group_id = str(uuid4())
    else:
        cohorts = db.table("cohorts").select("id, created_by").eq("id", str(cohort_id)).execute().data or []
        if not [c for c in cohorts if str(c.get("created_by")) == owner]:
            raise FakeRpcError("instructor_give_not_owned")
        roster = active_students_for_cohort(db, str(cohort_id), "id, instructor_id")
        if not roster:
            raise FakeRpcError("instructor_give_roster_empty")
        if any(s.get("instructor_id") not in (None, owner) for s in roster):
            raise FakeRpcError("instructor_give_not_owned")
        student_ids = sorted({str(s["id"]) for s in roster})
        group_id = str(uuid4())

    held = (db.table("writing_assignments").select("student_id").in_("prompt_id", prompt_ids)
            .in_("student_id", student_ids).execute().data or [])
    duplicates = sorted({str(r["student_id"]) for r in held if r.get("student_id")})

    rows = [{
        "id": str(uuid4()), "prompt_id": pid, "student_id": sid, "cohort_id": cohort_id,
        "assignment_group_id": group_id, "name": params.get("p_name"),
        "allow_soft_check": bool(params.get("p_allow_soft_check")), "assigned_by": owner,
        "deadline": params.get("p_deadline"), "instructions": params.get("p_instructions"),
        "analysis_level": params.get("p_analysis_level"), "grading_tier": params.get("p_grading_tier"),
        "status": "pending",
    } for sid in student_ids for pid in prompt_ids]
    created = db.table("writing_assignments").insert(rows).execute().data or []

    if kind == "individual":
        receipt = {"assignment": created[0]}
    else:
        receipt = {"student_count": len(student_ids), "created_count": len(created),
                   "group_id": group_id, "duplicates_warning": duplicates,
                   "assignment_ids": [r["id"] for r in created]}
    db.table(LEDGER).insert({"id": request_id, "assigned_by": owner, "give_kind": kind,
                             "request_payload": payload, "receipt": receipt}).execute()
    return {**receipt, "replayed": False}


class _Result:
    def __init__(self, data):
        self.data = data


class _Call:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        assert self.name == RPC, self.name
        return _Result(emulate_instructor_give(self.db, self.params))


def rpc(db, name, params) -> _Call:
    """`db.rpc(name, params)` for fakes that have no rpc of their own."""
    return _Call(db, name, params)
