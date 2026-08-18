#!/usr/bin/env python3
"""Idempotently seed the staging-only Writing Gate E fixture anchor.

The live drill creates a fresh assignment through the canonical admin API on
every run, so retries never need to clear an immutable renderer claim. This
script only guarantees one prompt/assignment anchor from which the drill can
discover the synthetic student and prompt ids. Existing assignment state is
never reset.

Run from the repository root. ``STAGING_ENV_FILE`` is useful from a worktree
whose ignored env file lives in the primary checkout::

    STAGING_ENV_FILE=/path/to/backend/.env.staging \
      backend/venv/bin/python backend/scripts/seed_staging_writing_coexistence.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlparse


BACKEND = Path(__file__).resolve().parent.parent
STAGING_REF = "zjphffoujxkpltixsbzj"
PRODUCTION_REF = "huwsmtubwulikhlmcirx"
STUDENT_EMAIL = "e2e-student-smoke@staging-e2e.averlearning.com"
STUDENT_ID = "ee800001-0000-4000-8000-000000000001"
STUDENT_CODE = "GATE-E-WRITING"
STUDENT_NAME = "[STAGING] Gate E Writing Student"
PROMPT_ID = "ee700001-0000-4000-8000-000000000001"
ASSIGNMENT_ID = "ee600001-0000-4000-8000-000000000001"
PROMPT_TITLE = "[STAGING] Gate E Writing Coexistence"
ANCHOR_NAME = "[STAGING] Gate E Writing Fixture Anchor"


def _load_staging_env() -> dict[str, str]:
    path = Path(os.environ.get("STAGING_ENV_FILE", BACKEND / ".env.staging"))
    if not path.is_file():
        sys.exit(f"REFUSED: missing {path}")
    env: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def _staging_client():
    env = _load_staging_env()
    url = env.get("SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_KEY", "")
    hostname = (urlparse(url).hostname or "").lower()
    expected = f"{STAGING_REF}.supabase.co"
    if PRODUCTION_REF in hostname:
        sys.exit(f"REFUSED: .env.staging points at production ({PRODUCTION_REF})")
    if hostname != expected:
        sys.exit(f"REFUSED: expected staging host {expected}, got {hostname or '<empty>'}")
    if not key:
        sys.exit("REFUSED: SUPABASE_SERVICE_KEY missing in backend/.env.staging")
    from supabase import create_client

    return create_client(url, key)


def _single(rows: list[dict], label: str) -> dict:
    if len(rows) != 1:
        sys.exit(f"REFUSED: expected exactly one {label}, found {len(rows)}")
    return rows[0]


def seed() -> None:
    sb = _staging_client()
    user = _single(
        sb.table("users").select("id,email").eq("email", STUDENT_EMAIL).execute().data or [],
        f"synthetic user {STUDENT_EMAIL}",
    )
    student_by_user = (
        sb.table("students")
        .select("id,user_id,student_code,full_name")
        .eq("user_id", user["id"])
        .execute().data or []
    )
    if len(student_by_user) > 1:
        sys.exit(f"REFUSED: synthetic user {STUDENT_EMAIL} has multiple student profiles")
    if student_by_user and student_by_user[0].get("id") != STUDENT_ID:
        sys.exit("REFUSED: synthetic user belongs to another student profile")
    student_by_code = (
        sb.table("students")
        .select("id,user_id,student_code,full_name")
        .eq("student_code", STUDENT_CODE)
        .execute().data or []
    )
    if student_by_code and any(row.get("id") != STUDENT_ID for row in student_by_code):
        sys.exit("REFUSED: Writing fixture student code belongs to another profile")
    student_by_id = (
        sb.table("students")
        .select("id,user_id,student_code,full_name")
        .eq("id", STUDENT_ID)
        .limit(1)
        .execute().data or []
    )
    if student_by_id:
        student = student_by_id[0]
        expected_student = {
            "user_id": user["id"],
            "student_code": STUDENT_CODE,
            "full_name": STUDENT_NAME,
        }
        if any(student.get(key) != value for key, value in expected_student.items()):
            sys.exit("REFUSED: Writing fixture student UUID belongs to unrelated state")
        print(f"= Writing synthetic student exists ({STUDENT_ID})")
    else:
        inserted = sb.table("students").insert(
            {
                "id": STUDENT_ID,
                "user_id": user["id"],
                "student_code": STUDENT_CODE,
                "full_name": STUDENT_NAME,
            }
        ).execute().data or []
        student = _single(inserted, "inserted Writing synthetic student")
        print(f"+ Writing synthetic student created ({STUDENT_ID})")

    title_rows = (
        sb.table("writing_prompts").select("id,title").eq("title", PROMPT_TITLE).execute().data or []
    )
    if title_rows and any(row["id"] != PROMPT_ID for row in title_rows):
        sys.exit("REFUSED: Writing fixture title belongs to another prompt")
    prompt_by_id = (
        sb.table("writing_prompts").select("id,title").eq("id", PROMPT_ID).limit(1).execute().data or []
    )
    if prompt_by_id and prompt_by_id[0].get("title") != PROMPT_TITLE:
        sys.exit("REFUSED: Writing fixture prompt UUID belongs to unrelated content")
    sb.table("writing_prompts").upsert(
        {
            "id": PROMPT_ID,
            "task_type": "task2",
            "prompt_text": (
                "Some people believe software migrations should prioritise speed, while others "
                "believe correctness and rollback safety matter more. Discuss both views and give "
                "your own opinion."
            ),
            "title": PROMPT_TITLE,
            "difficulty": "intermediate",
            "tags": ["gate-e", "coexistence"],
            "is_active": True,
            "exam_only": False,
        },
        on_conflict="id",
    ).execute()

    natural = (
        sb.table("writing_assignments")
        .select("id,student_id,prompt_id,name,status,renderer_affinity")
        .eq("student_id", student["id"])
        .eq("name", ANCHOR_NAME)
        .execute().data or []
    )
    if natural and any(row["id"] != ASSIGNMENT_ID for row in natural):
        sys.exit("REFUSED: Writing fixture anchor name belongs to another assignment")
    by_id = (
        sb.table("writing_assignments")
        .select("id,student_id,prompt_id,name,status,renderer_affinity")
        .eq("id", ASSIGNMENT_ID).limit(1).execute().data or []
    )
    if by_id:
        row = by_id[0]
        expected = {
            "student_id": student["id"],
            "prompt_id": PROMPT_ID,
            "name": ANCHOR_NAME,
        }
        if any(row.get(key) != value for key, value in expected.items()):
            sys.exit("REFUSED: Writing fixture assignment UUID belongs to unrelated state")
        if row.get("status") not in ("pending", "in_progress"):
            sys.exit("REFUSED: Writing fixture anchor is terminal; create a new fixture version")
        print(
            f"= Writing anchor exists ({ASSIGNMENT_ID}); preserved "
            f"status={row.get('status')} affinity={row.get('renderer_affinity')}"
        )
    else:
        sb.table("writing_assignments").insert(
            {
                "id": ASSIGNMENT_ID,
                "prompt_id": PROMPT_ID,
                "student_id": student["id"],
                "status": "pending",
                "name": ANCHOR_NAME,
                "instructions": "Synthetic Gate E fixture. Do not use for learner content.",
                "allow_soft_check": False,
                "is_timed": False,
                "analysis_level": 3,
            }
        ).execute()
        print(f"+ Writing anchor created ({ASSIGNMENT_ID})")

    verified = (
        sb.table("writing_assignments").select("id", count="exact")
        .eq("id", ASSIGNMENT_ID).execute()
    )
    if verified.count != 1:
        sys.exit("FAILED: Writing fixture anchor verification did not return exactly one row")
    print("OK: staging Writing coexistence anchor is ready")


if __name__ == "__main__":
    seed()
