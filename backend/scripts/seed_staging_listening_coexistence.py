#!/usr/bin/env python3
"""Idempotently seed the canonical Listening fixtures used by Gate E.

This operations script is intentionally STAGING-only. It refuses every
Supabase project except the known staging project before writing database or
storage state. Deterministic ids and storage paths make repeated runs converge,
while three separate tests keep each coexistence phase from replacing the
previous phase's in-progress attempt.

Run from the repository root (``STAGING_ENV_FILE`` is only needed from a git
worktree whose ignored env file lives in the primary checkout):

    backend/venv/bin/python backend/scripts/seed_staging_listening_coexistence.py
    STAGING_ENV_FILE=/path/to/backend/.env.staging backend/venv/bin/python ...
"""

from __future__ import annotations

import io
import os
import sys
import wave
from pathlib import Path
from urllib.parse import urlparse


BACKEND = Path(__file__).resolve().parent.parent
STAGING_REF = "zjphffoujxkpltixsbzj"
PRODUCTION_REF = "huwsmtubwulikhlmcirx"
AUDIO_BUCKET = "listening-audio"
AUDIO_PATH = "gate-e/listening-coexistence/silence.wav"

FIXTURES = (
    {
        "test_id": "GATE-E-LISTENING-COEXISTENCE-1",
        "test_uuid": "ee300001-0000-4000-8000-000000000001",
        "content_uuid": "ee400001-0000-4000-8000-000000000001",
        "exercise_uuid": "ee500001-0000-4000-8000-000000000001",
    },
    {
        "test_id": "GATE-E-LISTENING-COEXISTENCE-2",
        "test_uuid": "ee300002-0000-4000-8000-000000000002",
        "content_uuid": "ee400002-0000-4000-8000-000000000002",
        "exercise_uuid": "ee500002-0000-4000-8000-000000000002",
    },
    {
        "test_id": "GATE-E-LISTENING-COEXISTENCE-3",
        "test_uuid": "ee300003-0000-4000-8000-000000000003",
        "content_uuid": "ee400003-0000-4000-8000-000000000003",
        "exercise_uuid": "ee500003-0000-4000-8000-000000000003",
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


def _silent_wav() -> bytes:
    """Return a deterministic two-second PCM WAV that every browser can load."""
    sample_rate = 8_000
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(b"\x00\x00" * sample_rate * 2)
    return output.getvalue()


def seed() -> None:
    sb = _staging_client()
    audio = _silent_wav()
    sb.storage.from_(AUDIO_BUCKET).upload(
        AUDIO_PATH,
        audio,
        {"content-type": "audio/wav", "x-upsert": "true"},
    )
    print(f"= {AUDIO_BUCKET}/{AUDIO_PATH} ({len(audio)} bytes) uploaded")

    for index, fixture in enumerate(FIXTURES, start=1):
        test_id = fixture["test_id"]
        test_uuid = fixture["test_uuid"]
        content_uuid = fixture["content_uuid"]
        exercise_uuid = fixture["exercise_uuid"]

        _assert_identity(sb, "listening_tests", {"test_id": test_id}, test_uuid)
        _assert_identity(
            sb,
            "listening_content",
            {"test_id": test_uuid, "section_num": 1},
            content_uuid,
        )
        _assert_identity(
            sb,
            "listening_exercises",
            {"content_id": content_uuid, "order_num": 1},
            exercise_uuid,
        )

        sb.table("listening_tests").upsert(
            {
                "id": test_uuid,
                "test_id": test_id,
                "title": f"[STAGING] Gate E Listening Coexistence {index}",
                "version": "1.0",
                "band_target": 5.0,
                "accent_profile": ["neutral"],
                "themes": {"s1": "renderer affinity"},
                "metadata": {"fixture": "gate-e-listening-coexistence", "ordinal": index},
                "status": "published",
                "full_audio_storage_path": AUDIO_PATH,
                "full_audio_duration_seconds": 2,
                "full_audio_size_bytes": len(audio),
                "cue_points": [{"type": "section", "section_num": 1, "timestamp_seconds": 0}],
                "audio_assembly_mode": "full_premixed",
                "test_type": "full",
                "exam_only": False,
            },
            on_conflict="id",
        ).execute()
        sb.table("listening_content").upsert(
            {
                "id": content_uuid,
                "source_type": "test_section",
                "audio_storage_path": None,
                "audio_duration_seconds": 0,
                "audio_size_bytes": 0,
                "accent_tag": "uk_rp",
                "topic_tags": ["gate-e", "coexistence"],
                "cefr_level": "B1",
                "ielts_section": 1,
                "transcript": "Renderer affinity keeps an attempt on its canonical player.",
                "status": "published",
                "is_premium": False,
                "title": f"{test_id} — Section 1",
                "test_id": test_uuid,
                "section_num": 1,
                "metadata": {"fixture": "gate-e-listening-coexistence"},
            },
            on_conflict="id",
        ).execute()
        sb.table("listening_exercises").upsert(
            {
                "id": exercise_uuid,
                "content_id": content_uuid,
                "exercise_type": "dictation",
                "payload": {
                    "variant": "form_completion",
                    "template_kind": "form_completion",
                    "instruction": "Write ONE WORD for the answer.",
                    "questions": [{"q_num": 1, "prompt": "Canonical ____"}],
                    "answers": [{"q_num": 1, "answer": "player", "alternatives": []}],
                    "template": {
                        "heading": "Renderer affinity",
                        "rows": [{"label": "Attempt stays on", "q_num": 1, "prefix": "canonical"}],
                    },
                },
                "segments": [],
                "order_num": 1,
                "cefr_level": "B1",
                "status": "published",
            },
            on_conflict="id",
        ).execute()
        print(f"= {test_id} ({test_uuid}) published")

    count = (
        sb.table("listening_tests")
        .select("id", count="exact")
        .eq("status", "published")
        .eq("test_type", "full")
        .eq("exam_only", False)
        .execute()
    )
    if (count.count or 0) < len(FIXTURES):
        sys.exit("FAILED: published Listening fixture verification count is too small")
    print(f"OK: staging exposes {count.count} published full Listening tests")


if __name__ == "__main__":
    seed()
