"""Reconcile class-enrollment roster + late-joiner gives (bugs E6 + E1).

Students who redeemed a class/cohort enrollment code BEFORE the fix in
`routers/auth.py` can be in either broken state:

  E6 — enrolled into the cohort (students.cohort_id + the mig-227 membership
       trigger) but with students.instructor_id = NULL, so they never appear on
       the owning instructor's roster / submission-matrix / individual-assign
       surfaces (all scoped by students.instructor_id). This happens when the
       enrollment code was NOT issued by an instructor-role account (e.g. an
       admin minted it on the instructor's behalf) — the old enroll chain only
       stamped the owner from the code issuer, never from the cohort owner.

  E1 — joined a class AFTER a "Cả lớp" (whole-class) writing give was fanned
       out, so they have no writing_assignments row for it and see "Chưa có bài
       giao nào" while classmates have the homework. The fan-out snapshots the
       roster at give-time.

This script fixes both for existing data. The code path now does this inline on
redemption; this is the one-off catch-up for students who already redeemed.

Run after deploying the code fix (no schema migration is required):

    cd backend && python -m scripts.backfill_class_enrollment_roster          # dry-run
    cd backend && python -m scripts.backfill_class_enrollment_roster --apply  # write

Idempotent:
  • E6 stamps instructor_id only when it is currently NULL and the cohort has an
    owner; re-running is a no-op.
  • E1 reuses backfill_cohort_writing_assignments() (skip-existing), so re-running
    creates nothing new.
  • E1 logs "E1 skipped archived" and continues when migration 331 refuses a
    learner archived after the roster read (GIVEARCHIVE-0031).

Output: a per-phase summary. Exit code 0 unless the initial fetch fails.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("backfill_class_enrollment_roster")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true",
        help="Perform writes. Without it the script only reports what it would do.",
    )
    args = parser.parse_args()
    dry = not args.apply

    from fastapi import HTTPException

    from database import supabase_admin
    from services.class_membership_service import (
        active_cohort_ids_for_student,
        active_student_ids_for_cohort,
    )
    from services.cohort_assignment_service import backfill_cohort_writing_assignments

    logger.info("Class-enrollment reconcile — mode=%s", "DRY-RUN" if dry else "APPLY")

    # ── Phase E6: stamp instructor_id from the cohort owner ─────────────────
    # Every student that belongs to a cohort but has no instructor_id. We take
    # the student's active cohorts (membership-first, legacy-pointer fallback),
    # pick the FIRST cohort that has an owner, and stamp it. A student in two
    # owned cohorts keeps a single primary owner (first wins) — matching the
    # single-valued students.instructor_id contract; the roster of every cohort
    # they belong to still lists them via membership, not instructor_id.
    students = (
        supabase_admin.table("students")
        .select("id, instructor_id, cohort_id")
        .is_("instructor_id", "null")
        .execute()
    ).data or []

    cohort_owner: dict[str, str | None] = {}

    def _owner_of(cohort_id: str) -> str | None:
        if cohort_id not in cohort_owner:
            row = (
                supabase_admin.table("cohorts").select("created_by")
                .eq("id", cohort_id).limit(1).execute().data or [None]
            )[0]
            cohort_owner[cohort_id] = (row or {}).get("created_by")
        return cohort_owner[cohort_id]

    e6_stamped = 0
    e6_orphan_no_owner = 0
    for student in students:
        sid = student["id"]
        cohort_ids = active_cohort_ids_for_student(supabase_admin, student)
        owner = next((o for cid in cohort_ids if (o := _owner_of(str(cid)))), None)
        if not owner:
            if cohort_ids:
                e6_orphan_no_owner += 1
            continue
        logger.info("E6 stamp student=%s instructor_id<-%s (cohorts=%s)",
                    sid, owner, cohort_ids)
        if not dry:
            supabase_admin.table("students").update(
                {"instructor_id": owner}
            ).eq("id", sid).is_("instructor_id", "null").execute()
        e6_stamped += 1

    # ── Phase E1: backfill open cohort gives for every active member ────────
    # Walk every cohort that has at least one fanned-out writing give and ensure
    # each active member holds the open ones. Idempotent per student.
    give_cohorts = (
        supabase_admin.table("writing_assignments")
        .select("cohort_id")
        .not_.is_("cohort_id", "null")
        .execute()
    ).data or []
    cohort_set = {str(r["cohort_id"]) for r in give_cohorts if r.get("cohort_id")}

    e1_students = 0
    e1_created = 0
    e1_skipped_archived = 0
    for cohort_id in sorted(cohort_set):
        for sid in active_student_ids_for_cohort(supabase_admin, cohort_id):
            if dry:
                # Dry-run still computes via the service, then the apply path
                # would insert; to avoid writing we only report the intent.
                logger.info("E1 would backfill student=%s cohort=%s", sid, cohort_id)
                e1_students += 1
                continue
            try:
                res = backfill_cohort_writing_assignments(
                    supabase_admin, student_id=sid, cohort_id=cohort_id)
            except HTTPException as exc:
                # GIVEARCHIVE-0031: archived after the roster read (331
                # trigger) — nothing was created for them; keep going.
                if not (isinstance(exc.detail, dict)
                        and exc.detail.get("code") == "student_archived"):
                    raise
                e1_skipped_archived += 1
                logger.warning("E1 skipped archived student=%s cohort=%s", sid, cohort_id)
                continue
            if res["created_count"]:
                e1_students += 1
                e1_created += res["created_count"]
                logger.info("E1 backfilled student=%s cohort=%s rows=%d",
                            sid, cohort_id, res["created_count"])

    logger.info(
        "DONE (%s): E6 stamped=%d orphan_no_owner=%d | E1 students=%d rows=%d skipped_archived=%d",
        "DRY-RUN" if dry else "APPLIED",
        e6_stamped, e6_orphan_no_owner, e1_students, e1_created, e1_skipped_archived,
    )
    if dry:
        logger.info("Dry-run only — re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
