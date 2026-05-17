"""
routers/listening.py — Sprint 11.1 (DEBT-LISTENING-MODULE foundation 1/5).

First implementation router for the Listening module — the 5th skill.
Sprint 11.0 discovery shipped the data model + sprint plan; this file
lands:

  - 1 user-facing GET (/api/listening/content/{id})  — signed URL fetch
  - 2 admin routes (POST /admin/listening/upload, /admin/listening/render)

User-facing exercise routes (attempt POST, list-by-mode GET, mini-test
flow) are intentionally deferred to Sprint 11.2+. This sprint proves
the storage + render pipeline; user-surface flips begin with dictation
in Sprint 11.2 per Andy Q6 lock.

Storage bucket: `listening-audio` (private, signed URLs only — Sprint
11.0 §2A.L2). Bucket creation is a manual operator step; see migration
056 header for instructions.

ElevenLabs render: gated behind `LISTENING_AI_RENDER_ENABLED=false` by
default (defense in depth — Andy hasn't provisioned the Creator plan
yet as of Sprint 11.1 ship). The MP3 upload path stays fully usable
without an API key so admins can dogfood the schema + curation flow
independently.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import (
    APIRouter, BackgroundTasks, File, Form, Header, HTTPException, UploadFile,
)
from pydantic import BaseModel, ConfigDict, Field

from config import settings
from database import supabase_admin
from routers.admin import require_admin
from routers.auth import get_supabase_user
from services.listening_renderer import run_elevenlabs_render_job

logger = logging.getLogger(__name__)


user_router = APIRouter(prefix="/api/listening", tags=["listening"])
admin_router = APIRouter(prefix="/admin/listening", tags=["listening-admin"])


# ── Helpers ───────────────────────────────────────────────────────────────────


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Invalid Authorization header")
    return parts[1]


async def _require_auth(authorization: str | None) -> dict:
    return await get_supabase_user(authorization)


_ACCENT_VALUES = {"us_general", "uk_rp", "au", "ca", "other"}
_CEFR_VALUES = {"A2", "B1", "B2", "C1", "C2"}
_ELEVENLABS_MODELS = {"eleven_multilingual_v2", "eleven_flash_v2_5"}


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class ListeningRenderRequest(BaseModel):
    """Admin POST /admin/listening/render body.

    All fields validated at the router layer; the BackgroundTask helper
    trusts the caller. ElevenLabs voice_id is opaque (24-char string);
    no enum because Andy adds voices as he discovers them and a hardcoded
    list would force a code change per voice."""

    model_config = ConfigDict(extra="ignore")

    script_text: str = Field(min_length=10, max_length=5000)
    voice_id: str = Field(min_length=1, max_length=64)
    model: str = Field(default="eleven_multilingual_v2")
    title: str = Field(min_length=1, max_length=200)
    accent_tag: str
    cefr_level: str | None = None
    ielts_section: int | None = None
    topic_tags: list[str] = Field(default_factory=list)
    transcript: str | None = None  # defaults to script_text if omitted


# ── User route — single content fetch ─────────────────────────────────────────


@user_router.get("/content/{content_id}")
async def get_listening_content(
    content_id: str,
    authorization: str | None = Header(default=None),
):
    """Fetch one published listening_content row + a fresh signed URL
    to the audio. Used by Sprint 11.2's audio player to load both
    metadata and the playable URL in one round-trip.

    Draft + archived rows return 404 so admins can stage content
    without exposing it. The Sprint 10.6 vocab pattern (return shape
    field always present, derived per request) applies here: the
    `audio_signed_url` is computed on each GET, never stored.
    """
    user = await _require_auth(authorization)  # 401 on missing/bad token
    # `user` reserved for future per-user gating (e.g. premium tier);
    # Sprint 11.1 doesn't use it but the auth check still gates the route.
    _ = user

    res = (
        supabase_admin.table("listening_content")
        .select("*")
        .eq("id", content_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Listening content not found or not published")

    row = res.data[0]

    # Sign the audio URL with the Supabase admin client (private bucket
    # → only the server can mint URLs). 3600s TTL = Supabase default.
    try:
        signed = supabase_admin.storage.from_(
            settings.LISTENING_AUDIO_BUCKET
        ).create_signed_url(row["audio_storage_path"], 3600)
        # Supabase Python SDK returns dict with 'signedURL' (snake_case
        # 'signed_url' historically — handle both for forward-compat).
        row["audio_signed_url"] = signed.get("signedURL") or signed.get("signed_url")
    except Exception as e:
        # Bucket-not-found path mirrors grading.py:240-250 pattern.
        logger.error(
            "[listening] signed URL failed for content_id=%s path=%s: %s",
            content_id, row.get("audio_storage_path"), e,
        )
        raise HTTPException(
            503,
            "Listening audio storage not configured. See migration 056 header.",
        )

    return row


# ── Admin route — MP3 upload ──────────────────────────────────────────────────


@admin_router.post("/upload")
async def admin_upload_listening(
    audio_file: UploadFile = File(...),
    title: str = Form(...),
    transcript: str = Form(...),
    accent_tag: str = Form(...),
    cefr_level: str = Form(...),
    ielts_section: int = Form(...),
    external_license: Optional[str] = Form(default=None),
    external_source_url: Optional[str] = Form(default=None),
    topic_tags: Optional[str] = Form(default=None),  # comma-separated
    is_premium: bool = Form(default=False),
    authorization: str | None = Header(default=None),
):
    """Admin uploads an MP3 + transcript + metadata.

    `source_type` is derived from whether `external_license` is set:
      - external_license set → source_type='curated_external' (BBC, TED,
        LibriVox, etc.). external_source_url MUST also be set per the
        license-attribution requirement (Sprint 11.0 §4).
      - external_license absent → source_type='upload_mp3' (admin-
        authored original content).

    Premium gate (Sprint 11.0 §4E): is_premium=true + NC license → 422.
    The CC BY-NC-ND family is non-commercial only; flagging such
    content as premium violates the license.

    Status defaults to 'draft' so admins can preview before publish.
    """
    admin_user = await require_admin(authorization)
    admin_id = admin_user["id"]

    # ── Validate enum-ish fields up front ─────────────────────────────────────
    if accent_tag not in _ACCENT_VALUES:
        raise HTTPException(422, f"accent_tag must be one of {sorted(_ACCENT_VALUES)}")
    if cefr_level not in _CEFR_VALUES:
        raise HTTPException(422, f"cefr_level must be one of {sorted(_CEFR_VALUES)}")
    if not (1 <= ielts_section <= 4):
        raise HTTPException(422, "ielts_section must be 1-4")

    # ── License compliance (Sprint 11.0 §4 + §4E) ────────────────────────────
    if external_license and not external_source_url:
        raise HTTPException(
            422,
            "external_source_url required when external_license is set "
            "(license attribution rule)",
        )
    source_type = "curated_external" if external_license else "upload_mp3"

    if is_premium and external_license and "NC" in external_license:
        raise HTTPException(
            422,
            "Cannot mark NC-licensed content as premium — non-commercial "
            "restriction incompatible with paid tier (Sprint 11.0 §4E).",
        )

    # ── Parse topic_tags ──────────────────────────────────────────────────────
    tag_list: list[str] = []
    if topic_tags:
        tag_list = [t.strip() for t in topic_tags.split(",") if t.strip()]

    # ── Read upload bytes ─────────────────────────────────────────────────────
    audio_bytes = await audio_file.read()
    if not audio_bytes:
        raise HTTPException(422, "Empty audio file")

    # Coarse duration estimate from MP3 size (mirrors listening_renderer.py).
    # Operators serving long-form curated content can update the row post-
    # upload via a follow-up SQL if precise duration matters.
    audio_size_bytes = len(audio_bytes)
    audio_duration_seconds = max(1, round(audio_size_bytes / 16_000))

    # ── Upload to bucket ──────────────────────────────────────────────────────
    content_id = str(uuid.uuid4())
    storage_subdir = "curated" if source_type == "curated_external" else "uploads"
    storage_path = f"{storage_subdir}/{content_id}.mp3"

    try:
        supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).upload(
            storage_path,
            audio_bytes,
            {"content-type": "audio/mpeg"},
        )
    except Exception as e:
        msg = str(e).lower()
        if "not found" in msg or "bucket" in msg:
            logger.error(
                "[listening] Supabase Storage bucket '%s' not found. "
                "Create it in the Supabase dashboard (Storage → New bucket, "
                "Private) and add a SELECT policy for authenticated users.",
                settings.LISTENING_AUDIO_BUCKET,
            )
            raise HTTPException(
                503, "Listening audio storage not configured.",
            )
        logger.error("[listening] upload to bucket failed: %s", e)
        raise HTTPException(500, f"Audio upload failed: {e}")

    # ── INSERT row ────────────────────────────────────────────────────────────
    try:
        supabase_admin.table("listening_content").insert({
            "id":                       content_id,
            "source_type":              source_type,
            "external_license":         external_license,
            "external_source_url":      external_source_url,
            "audio_storage_path":       storage_path,
            "audio_duration_seconds":   audio_duration_seconds,
            "audio_size_bytes":         audio_size_bytes,
            "accent_tag":               accent_tag,
            "topic_tags":               tag_list,
            "cefr_level":               cefr_level,
            "ielts_section":            ielts_section,
            "transcript":               transcript,
            "transcript_segments":      [],
            "status":                   "draft",
            "is_premium":               is_premium,
            "title":                    title,
            "created_by":               admin_id,
        }).execute()
    except Exception as e:
        logger.error(
            "[listening] DB INSERT failed (audio uploaded but no row); "
            "manual reconciliation needed at path %s: %s",
            storage_path, e,
        )
        raise HTTPException(500, f"Database insert failed: {e}")

    return {
        "ok":           True,
        "content_id":   content_id,
        "source_type":  source_type,
        "status":       "draft",
        "storage_path": storage_path,
    }


# ── Admin route — ElevenLabs render (feature-flag gated) ──────────────────────


@admin_router.post("/render")
async def admin_render_listening(
    body: ListeningRenderRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Schedule a BackgroundTask that renders the script via ElevenLabs,
    uploads the MP3, and INSERTs the listening_content row with
    status='draft'. Returns immediately with a job_id; the admin polls
    the content list to see the draft land.

    Feature-flag gated: returns 503 if LISTENING_AI_RENDER_ENABLED=false
    OR ELEVENLABS_API_KEY is empty. Both checks fire so an accidental
    key set without the flag still gates safely (defense in depth).
    """
    admin_user = await require_admin(authorization)

    if not settings.LISTENING_AI_RENDER_ENABLED:
        raise HTTPException(
            503,
            "ElevenLabs render endpoint not yet enabled. Set "
            "LISTENING_AI_RENDER_ENABLED=true after provisioning "
            "ELEVENLABS_API_KEY.",
        )
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(503, "ELEVENLABS_API_KEY not configured.")

    # ── Validate enum-ish fields ──────────────────────────────────────────────
    if body.accent_tag not in _ACCENT_VALUES:
        raise HTTPException(422, f"accent_tag must be one of {sorted(_ACCENT_VALUES)}")
    if body.model not in _ELEVENLABS_MODELS:
        raise HTTPException(422, f"model must be one of {sorted(_ELEVENLABS_MODELS)}")
    if body.cefr_level is not None and body.cefr_level not in _CEFR_VALUES:
        raise HTTPException(422, f"cefr_level must be one of {sorted(_CEFR_VALUES)}")
    if body.ielts_section is not None and not (1 <= body.ielts_section <= 4):
        raise HTTPException(422, "ielts_section must be 1-4")

    job_id = str(uuid.uuid4())
    background_tasks.add_task(
        run_elevenlabs_render_job,
        job_id=job_id,
        script_text=body.script_text,
        voice_id=body.voice_id,
        model=body.model,
        title=body.title,
        accent_tag=body.accent_tag,
        cefr_level=body.cefr_level,
        ielts_section=body.ielts_section,
        topic_tags=body.topic_tags,
        transcript=body.transcript,
        created_by_user_id=admin_user["id"],
    )

    return {
        "job_id": job_id,
        "status": "queued",
        "note":   "Poll /api/listening/content/{job_id} after ~10-30s to see the draft row.",
    }
