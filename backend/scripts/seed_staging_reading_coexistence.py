#!/usr/bin/env python3
"""Idempotently seed the canonical Reading fixtures used by the Gate E drill.

This is an operations script for STAGING only.  It reads ``backend/.env.staging``
and refuses every Supabase project except the known staging project before it
creates or updates any row.  Deterministic ids make repeated runs converge and
let the three drill phases use separate tests without replacing a prior phase's
in-progress attempt.

Run from the repository root (``STAGING_ENV_FILE`` is only needed from a
git worktree whose ignored env file lives in the primary checkout):

    backend/venv/bin/python backend/scripts/seed_staging_reading_coexistence.py
    STAGING_ENV_FILE=/path/to/backend/.env.staging backend/venv/bin/python ...
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlparse


BACKEND = Path(__file__).resolve().parent.parent
STAGING_REF = "zjphffoujxkpltixsbzj"
PRODUCTION_REF = "huwsmtubwulikhlmcirx"

FIXTURES = (
    {
        "test_id": "GATE-E-READING-COEXISTENCE-1",
        "test_uuid": "ee000001-0000-4000-8000-000000000001",
        "passage_uuid": "ee100001-0000-4000-8000-000000000001",
        "question_uuid": "ee200001-0000-4000-8000-000000000001",
    },
    {
        "test_id": "GATE-E-READING-COEXISTENCE-2",
        "test_uuid": "ee000002-0000-4000-8000-000000000002",
        "passage_uuid": "ee100002-0000-4000-8000-000000000002",
        "question_uuid": "ee200002-0000-4000-8000-000000000002",
    },
    {
        "test_id": "GATE-E-READING-COEXISTENCE-3",
        "test_uuid": "ee000003-0000-4000-8000-000000000003",
        "passage_uuid": "ee100003-0000-4000-8000-000000000003",
        "question_uuid": "ee200003-0000-4000-8000-000000000003",
    },
)


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


def _assert_identity(sb, table: str, lookup: dict[str, object], expected_id: str) -> None:
    query = sb.table(table).select("id")
    for column, value in lookup.items():
        query = query.eq(column, value)
    rows = query.limit(1).execute().data or []
    if rows and rows[0]["id"] != expected_id:
        filters = ", ".join(f"{key}={value}" for key, value in lookup.items())
        sys.exit(
            f"REFUSED: {table} fixture identity collision ({filters}); "
            f"expected {expected_id}, found {rows[0]['id']}"
        )

    # Check the reverse direction as well.  Without this half, a deterministic
    # fixture UUID that already belonged to an unrelated row would be updated
    # in place even though the natural key lookup above returned nothing.
    columns = ",".join(("id", *lookup.keys()))
    rows_by_id = (
        sb.table(table).select(columns).eq("id", expected_id).limit(1).execute().data
        or []
    )
    if rows_by_id and any(rows_by_id[0].get(key) != value for key, value in lookup.items()):
        actual = ", ".join(f"{key}={rows_by_id[0].get(key)}" for key in lookup)
        sys.exit(
            f"REFUSED: {table} fixture UUID collision ({expected_id}); "
            f"expected {lookup}, found {actual}"
        )


def seed() -> None:
    sb = _staging_client()
    for index, fixture in enumerate(FIXTURES, start=1):
        test_id = fixture["test_id"]
        test_uuid = fixture["test_uuid"]
        passage_uuid = fixture["passage_uuid"]
        question_uuid = fixture["question_uuid"]
        slug = f"gate-e-reading-coexistence-{index}"

        _assert_identity(sb, "reading_tests", {"test_id": test_id}, test_uuid)
        _assert_identity(sb, "reading_passages", {"slug": slug}, passage_uuid)
        _assert_identity(
            sb,
            "reading_questions",
            {"passage_id": passage_uuid, "q_num": 1},
            question_uuid,
        )

        sb.table("reading_tests").upsert(
            {
                "id": test_uuid,
                "test_id": test_id,
                "title": f"[STAGING] Gate E Reading Coexistence {index}",
                "version": "1.0",
                "module": "academic",
                "time_limit_minutes": 60,
                "passage_count": 1,
                "total_questions": 1,
                "metadata": {"fixture": "gate-e-reading-coexistence", "ordinal": index},
                "status": "published",
                "test_type": "full",
                "exam_only": False,
            },
            on_conflict="id",
        ).execute()
        sb.table("reading_passages").upsert(
            {
                "id": passage_uuid,
                "library": "l3_test",
                "slug": slug,
                "title": f"Canonical renderer affinity {index}",
                "body_markdown": (
                    "Renderer affinity keeps an in-progress Reading attempt on "
                    "the player that claimed it, including after reloads and copied URLs."
                ),
                "difficulty_level": "foundation",
                "topic_tags": ["gate-e", "coexistence"],
                "test_id": test_uuid,
                "passage_order": 1,
                "word_count": 18,
                "estimated_minutes": 1,
                "metadata": {"fixture": "gate-e-reading-coexistence"},
                "status": "published",
            },
            on_conflict="id",
        ).execute()
        sb.table("reading_questions").upsert(
            {
                "id": question_uuid,
                "passage_id": passage_uuid,
                "q_num": 1,
                "question_type": "short_answer",
                "prompt": "What keeps an attempt on the player that claimed it?",
                "payload": {"word_limit": "TWO WORDS"},
                "answer": {"answer": "renderer affinity", "alternatives": []},
                "skill_tag": "detail",
                "sub_skill": "canonical attempt routing",
                "explanation": "The passage names renderer affinity as the mechanism.",
                "order_num": 1,
            },
            on_conflict="id",
        ).execute()
        print(f"= {test_id} ({test_uuid}) published")

    count = (
        sb.table("reading_tests")
        .select("id", count="exact")
        .eq("status", "published")
        .eq("test_type", "full")
        .eq("exam_only", False)
        .execute()
    )
    if (count.count or 0) < len(FIXTURES):
        sys.exit("FAILED: published Reading fixture verification count is too small")
    print(f"OK: staging exposes {count.count} published full Reading tests")


if __name__ == "__main__":
    seed()
