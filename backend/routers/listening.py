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
import os
import uuid
from typing import Optional

from fastapi import (
    APIRouter, BackgroundTasks, File, Form, Header, HTTPException, Query,
    UploadFile,
)
from pydantic import BaseModel, ConfigDict, Field

from config import settings
from database import supabase_admin
from routers.admin import require_admin
from routers.auth import get_supabase_user
from services.listening_gist_grader import grade_gist_response
from services.listening_grader import grade_dictation, grade_mcq, grade_true_false
from services.listening_renderer import run_elevenlabs_render_job
from services.listening_validator import (
    has_errors as validator_has_errors,
    infer_duration_seconds,
    validate_upload as validate_upload_payload,
)
from services import listening_convert
from services import listening_fulltest_import

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
_STATUS_VALUES = {"draft", "published", "archived"}
_EXERCISE_TYPES = {"dictation", "gist", "true_false", "mcq", "mini_test"}


_TF_VALID = {"T", "F", "NG"}


def _validate_gist_payload(payload: dict) -> dict:
    """Sprint 11.4 — gist exercise payload validation.

    Required: prompt_text (non-empty), model_answer (non-empty).
    Optional: rubric_keywords (list[str], default []).
    """
    if not isinstance(payload, dict):
        raise HTTPException(422, "Gist payload must be a JSON object.")
    prompt = str(payload.get("prompt_text") or "").strip()
    model_answer = str(payload.get("model_answer") or "").strip()
    if not prompt:
        raise HTTPException(422, "Gist payload missing prompt_text.")
    if not model_answer:
        raise HTTPException(422, "Gist payload missing model_answer.")
    raw_keywords = payload.get("rubric_keywords") or []
    if not isinstance(raw_keywords, list):
        raise HTTPException(422, "rubric_keywords must be a list of strings.")
    keywords = [str(k).strip() for k in raw_keywords if str(k).strip()][:10]
    return {
        "prompt_text":     prompt,
        "model_answer":    model_answer,
        "rubric_keywords": keywords,
    }


def _validate_true_false_payload(payload: dict) -> dict:
    """Sprint 11.4 — true_false exercise payload validation.

    Required: statements[] of {idx, text, answer ∈ T/F/NG}.
      - 3 ≤ len ≤ 12 (IELTS standard range)
      - idx contiguous from 0
      - text non-empty
      - answer normalised to T / F / NG
    """
    if not isinstance(payload, dict):
        raise HTTPException(422, "true_false payload must be a JSON object.")
    raw = payload.get("statements") or []
    if not isinstance(raw, list):
        raise HTTPException(422, "true_false payload statements must be a list.")
    if not (3 <= len(raw) <= 12):
        raise HTTPException(
            422,
            f"true_false requires 3-12 statements; got {len(raw)} "
            "(IELTS standard range).",
        )
    out: list[dict] = []
    for i, raw_stmt in enumerate(raw):
        if not isinstance(raw_stmt, dict):
            raise HTTPException(422, f"Statement {i} must be a JSON object.")
        try:
            idx_v = int(raw_stmt.get("idx"))
        except (TypeError, ValueError):
            raise HTTPException(422, f"Statement {i} idx invalid.")
        if idx_v != i:
            raise HTTPException(
                422,
                f"Statement idx must be contiguous from 0 — got idx={idx_v} at position {i}.",
            )
        text = str(raw_stmt.get("text") or "").strip()
        if not text:
            raise HTTPException(422, f"Statement {i} text is empty.")
        ans = str(raw_stmt.get("answer") or "").upper().strip()
        if ans in {"TRUE"}: ans = "T"
        elif ans in {"FALSE"}: ans = "F"
        elif ans in {"NOT GIVEN", "NOTGIVEN", "N/G"}: ans = "NG"
        if ans not in _TF_VALID:
            raise HTTPException(
                422,
                f"Statement {i} answer must be T / F / NG (got '{raw_stmt.get('answer')}').",
            )
        out.append({"idx": idx_v, "text": text, "answer": ans})
    return {"statements": out}


def _validate_mcq_payload(payload: dict) -> dict:
    """Sprint 11.5 — MCQ exercise payload validation.

    Required: questions[] of {idx, stem, options[4], answer_idx}.
      - 1 ≤ len ≤ 20 (single-content MCQ exercise)
      - idx contiguous from 0
      - stem non-empty
      - options is a 4-element list of non-empty strings
      - answer_idx ∈ [0, 3]
    """
    if not isinstance(payload, dict):
        raise HTTPException(422, "mcq payload must be a JSON object.")
    raw = payload.get("questions") or []
    if not isinstance(raw, list):
        raise HTTPException(422, "mcq payload questions must be a list.")
    if not (1 <= len(raw) <= 20):
        raise HTTPException(
            422,
            f"mcq requires 1-20 questions; got {len(raw)}.",
        )
    out: list[dict] = []
    for i, raw_q in enumerate(raw):
        if not isinstance(raw_q, dict):
            raise HTTPException(422, f"Question {i} must be a JSON object.")
        try:
            idx_v = int(raw_q.get("idx"))
        except (TypeError, ValueError):
            raise HTTPException(422, f"Question {i} idx invalid.")
        if idx_v != i:
            raise HTTPException(
                422,
                f"Question idx must be contiguous from 0 — got idx={idx_v} at position {i}.",
            )
        stem = str(raw_q.get("stem") or "").strip()
        if not stem:
            raise HTTPException(422, f"Question {i} stem is empty.")
        opts_raw = raw_q.get("options") or []
        if not isinstance(opts_raw, list) or len(opts_raw) != 4:
            raise HTTPException(
                422,
                f"Question {i} requires exactly 4 options (got {len(opts_raw) if isinstance(opts_raw, list) else 'non-list'}).",
            )
        options = [str(o).strip() for o in opts_raw]
        for j, o in enumerate(options):
            if not o:
                raise HTTPException(422, f"Question {i} option {j} is empty.")
        try:
            answer_idx = int(raw_q.get("answer_idx"))
        except (TypeError, ValueError):
            raise HTTPException(422, f"Question {i} answer_idx invalid.")
        if not (0 <= answer_idx <= 3):
            raise HTTPException(
                422,
                f"Question {i} answer_idx must be 0-3 (got {answer_idx}).",
            )
        out.append({
            "idx":        idx_v,
            "stem":       stem,
            "options":    options,
            "answer_idx": answer_idx,
        })
    return {"questions": out}


def _validate_dictation_segments(
    segments: list[dict],
    *,
    audio_duration_seconds: float | int,
) -> list[dict]:
    """Sprint 11.3 — coerce + validate the segments JSONB.

    Returns a normalised copy (idx int, start/end floats, transcript
    stripped). Raises HTTPException(422) on the first violation so the
    admin editor surfaces a specific error message rather than a generic
    schema fail.
    """
    if not isinstance(segments, list) or not segments:
        raise HTTPException(422, "Dictation exercises require at least one segment.")

    out: list[dict] = []
    prev_end = -1.0
    for i, raw in enumerate(segments):
        if not isinstance(raw, dict):
            raise HTTPException(422, f"Segment {i} must be a JSON object.")
        try:
            idx_v = int(raw.get("idx"))
            start_v = float(raw.get("start_sec"))
            end_v = float(raw.get("end_sec"))
        except (TypeError, ValueError):
            raise HTTPException(
                422,
                f"Segment {i} missing/invalid idx/start_sec/end_sec.",
            )
        if idx_v != i:
            raise HTTPException(
                422,
                f"Segment idx must be contiguous from 0 — got idx={idx_v} at position {i}.",
            )
        if start_v < 0:
            raise HTTPException(422, f"Segment {i} start_sec must be ≥ 0.")
        if end_v <= start_v:
            raise HTTPException(
                422,
                f"Segment {i} end_sec ({end_v}) must be > start_sec ({start_v}).",
            )
        if end_v > float(audio_duration_seconds) + 0.5:
            # 0.5s slack tolerates the renderer's coarse duration estimate.
            raise HTTPException(
                422,
                f"Segment {i} end_sec ({end_v}) exceeds content duration "
                f"({audio_duration_seconds}s).",
            )
        if start_v < prev_end - 0.05:
            raise HTTPException(
                422,
                f"Segment {i} overlaps previous segment "
                f"(start={start_v} < prev_end={prev_end}).",
            )
        transcript = str(raw.get("transcript", "")).strip()
        if not transcript:
            raise HTTPException(422, f"Segment {i} transcript is empty.")
        out.append({
            "idx":        idx_v,
            "start_sec":  round(start_v, 3),
            "end_sec":    round(end_v, 3),
            "transcript": transcript,
        })
        prev_end = end_v
    return out


def _default_voice_for_accent(accent_tag: str) -> str | None:
    """Sprint 11.2 — return the canonical default voice for an accent,
    or None when no default is configured for that accent (AU defers to
    Phase B voice cloning; ca/other have no IELTS-friendly default).

    Used as a fallback inside admin_render_listening when the caller
    omits voice_id — keeps the POST body terse for the common case
    (Andy picks accent_tag='us_general' → Sarah; 'uk_rp' → Alice)."""
    if accent_tag == "us_general":
        return settings.LISTENING_VOICE_US_FEMALE_DEFAULT or None
    if accent_tag == "uk_rp":
        return settings.LISTENING_VOICE_UK_FEMALE_DEFAULT or None
    return None


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class ListeningRenderRequest(BaseModel):
    """Admin POST /admin/listening/render body.

    All fields validated at the router layer; the BackgroundTask helper
    trusts the caller. ElevenLabs voice_id is opaque (24-char string);
    no enum because Andy adds voices as he discovers them and a hardcoded
    list would force a code change per voice."""

    model_config = ConfigDict(extra="ignore")

    script_text: str = Field(min_length=10, max_length=5000)
    # Sprint 11.2 — voice_id became optional. Omit + set accent_tag and
    # the router resolves the locked default voice for that accent
    # (us_general → Sarah, uk_rp → Alice). Backward compat preserved:
    # callers that still pass voice_id win.
    voice_id: str | None = Field(default=None, min_length=1, max_length=64)
    model: str = Field(default="eleven_multilingual_v2")
    title: str = Field(min_length=1, max_length=200)
    accent_tag: str
    cefr_level: str | None = None
    ielts_section: int | None = None
    topic_tags: list[str] = Field(default_factory=list)
    transcript: str | None = None  # defaults to script_text if omitted


class ListeningAttemptRequest(BaseModel):
    """User POST /api/listening/attempts body.

    Sprint 11.4 dispatches by `mode`:
      - dictation:  reads `user_transcript` (+ optional `segment_idx`)
                    against `exercise.segments[idx].transcript`.
      - gist:       reads `user_transcript` against
                    `exercise.payload.model_answer` + rubric_keywords.
      - true_false: reads `answers[]` against
                    `exercise.payload.statements[i].answer`.

    Either pass `exercise_id` directly (when the page knows it from a
    prior /exercises GET) OR pass `content_id` and let the router
    resolve the canonical published exercise for that content + mode.

    Backward compat with Sprint 11.2: omit `segment_idx` AND
    `exercise_id` for dictation and the router falls back to the
    whole-content transcript.
    """

    model_config = ConfigDict(extra="ignore")

    content_id: str | None = Field(default=None, max_length=64)
    exercise_id: str | None = Field(default=None, max_length=64)
    segment_idx: int | None = Field(default=None, ge=0, le=500)
    mode: str = Field(default="dictation")
    # Sprint 11.2/11.3 — user_transcript is used by dictation + gist.
    # Sprint 11.4 — true_false uses `answers` instead.
    user_transcript: str = Field(default="", max_length=10_000)
    answers: list[str] = Field(default_factory=list)
    # Sprint 11.5 — mcq carries int indices (0-3 per question).
    mcq_answers: list[int] = Field(default_factory=list)
    # Sprint 11.5 — mini-test runner links an attempt to a session row.
    listening_session_id: str | None = Field(default=None, max_length=64)
    listen_count: int = Field(default=1, ge=1, le=200)


class ListeningContentMetadataPatchRequest(BaseModel):
    """Admin PATCH /admin/listening/content/{id} body — Sprint 13.1.

    Editable metadata fields only. Every field is optional; only the
    keys present in the request body are updated. The storage path,
    audio bytes, audio_duration_seconds, alignment_data, and source_type
    are NOT editable here — those are derived at upload/render time and
    are immutable from the admin UI per Sprint 13.1 commission.

    Validation reuses the POST /upload rules: CEFR enum, accent enum,
    ielts_section 1-4, premium+NC license combo blocked.
    """

    model_config = ConfigDict(extra="ignore")

    title: str | None = Field(default=None, max_length=200)
    transcript: str | None = Field(default=None, max_length=20_000)
    accent_tag: str | None = Field(default=None)
    cefr_level: str | None = Field(default=None)
    ielts_section: int | None = Field(default=None)
    topic_tags: list[str] | None = Field(default=None)
    is_premium: bool | None = Field(default=None)
    external_license: str | None = Field(default=None, max_length=120)
    external_source_url: str | None = Field(default=None, max_length=500)


class ListeningContentStatusPatchRequest(BaseModel):
    """Admin PATCH /admin/listening/content/{id}/status body — Sprint 13.1.

    Single-field status transition. Any-to-any direction is allowed by
    the commission (no workflow gate). Server validates that the new
    status is in `_STATUS_VALUES`.
    """

    model_config = ConfigDict(extra="ignore")

    status: str = Field(min_length=1)


class ListeningExerciseUpsertRequest(BaseModel):
    """Admin POST /admin/listening/exercises body.

    Creates or updates an exercise row for a given content. Sprint 11.3
    ships dictation segments only; gist / true_false / mcq payload
    shapes land in Sprint 11.4+. Server validates segments per the rules
    in `_validate_dictation_segments`:
      - idx contiguous from 0
      - start_sec < end_sec for every segment
      - end_sec <= parent content.audio_duration_seconds
      - non-overlapping in time (segment[i].end_sec <= segment[i+1].start_sec)
      - transcript non-empty
    """

    model_config = ConfigDict(extra="ignore")

    content_id: str = Field(min_length=1, max_length=64)
    exercise_type: str = Field(default="dictation")
    segments: list[dict] = Field(default_factory=list)
    payload: dict = Field(default_factory=dict)
    order_num: int = Field(default=1, ge=1, le=200)
    status: str = Field(default="draft")


# ── User route — single content fetch ─────────────────────────────────────────


def _fetch_published_listening_content_with_signed_url(content_id: str) -> dict:
    """Return one published listening_content row with a fresh signed audio URL."""
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


def _fetch_published_listening_exercises(
    *,
    content_id: str,
    exercise_type: str,
) -> list[dict]:
    """Return published exercises for an already published content row."""
    if exercise_type not in _EXERCISE_TYPES:
        raise HTTPException(
            422, f"exercise_type must be one of {sorted(_EXERCISE_TYPES)}",
        )

    res = (
        supabase_admin.table("listening_exercises")
        .select("*")
        .eq("content_id", content_id)
        .eq("exercise_type", exercise_type)
        .eq("status", "published")
        .order("order_num", desc=False)
        .execute()
    )
    return res.data or []


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

    return _fetch_published_listening_content_with_signed_url(content_id)


@user_router.get("/dictation/{content_id}/boot")
async def boot_listening_dictation(
    content_id: str,
    authorization: str | None = Header(default=None),
):
    """Combined dictation boot payload.

    Perf-2 collapses the previous frontend waterfall:
    GET /api/listening/content/{id} → GET /api/listening/exercises?...dictation.
    Dictation has no in-progress attempt state; attempts remain POST-only per
    segment, preserving the first-attempt rule in ``post_listening_attempt``.
    """
    user = await _require_auth(authorization)
    _ = user
    content = _fetch_published_listening_content_with_signed_url(content_id)
    exercises = _fetch_published_listening_exercises(
        content_id=content_id,
        exercise_type="dictation",
    )
    return {"content": content, "exercises": exercises}


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

    # ── Sprint 13.2 — auto-validate (fail-soft on validator bugs) ─────────────
    validation_warnings: list[dict] = []
    try:
        v = validate_upload_payload(
            file_bytes=audio_bytes,
            transcript=transcript,
            declared_duration_seconds=audio_duration_seconds,
        )
        if validator_has_errors(v):
            raise HTTPException(422, {
                "message": "Validation failed",
                "errors":   v["errors"],
                "warnings": v["warnings"],
            })
        validation_warnings = v["warnings"]
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — fail-soft per Sprint 13.2 commission
        logger.warning("[listening] validator threw, allowing upload: %s", e)

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
        "warnings":     validation_warnings,
    }


# ── Admin routes — Sprint 13.2 upload validation + bulk ───────────────────────


def _normalize_topic_tags(tags: object) -> list[str]:
    """Accept either a comma-separated string (single endpoint) or a
    list of strings (bulk manifest). Trim, drop empties.
    """
    if isinstance(tags, list):
        return [str(t).strip() for t in tags if str(t).strip()]
    if isinstance(tags, str):
        return [t.strip() for t in tags.split(",") if t.strip()]
    return []


def _enum_check(field_name: str, value: object, allowed: set[str]) -> None:
    if value not in allowed:
        raise HTTPException(422, f"{field_name} must be one of {sorted(allowed)}")


def _license_combo_check(
    *, external_license: str | None,
    external_source_url: str | None,
    is_premium: bool,
) -> None:
    if external_license and not external_source_url:
        raise HTTPException(
            422,
            "external_source_url required when external_license is set "
            "(license attribution rule)",
        )
    if is_premium and external_license and "NC" in external_license:
        raise HTTPException(
            422,
            "Cannot mark NC-licensed content as premium — non-commercial "
            "restriction incompatible with paid tier (Sprint 11.0 §4E).",
        )


@admin_router.post("/upload/validate")
async def admin_upload_validate(
    audio_file: UploadFile = File(...),
    title: str = Form(...),
    transcript: str = Form(...),
    accent_tag: str = Form(...),
    cefr_level: str = Form(...),
    ielts_section: int = Form(...),
    external_license: Optional[str] = Form(default=None),
    external_source_url: Optional[str] = Form(default=None),
    topic_tags: Optional[str] = Form(default=None),
    is_premium: bool = Form(default=False),
    authorization: str | None = Header(default=None),
):
    """Sprint 13.2 — dry-run validation. Mirrors the body shape of
    POST /upload but does NOT touch storage or the DB. Returns
    `{ok, errors, warnings, inferred: {duration_seconds, size_bytes}}`
    so the admin UI can render inline messages before final submit.
    """
    await require_admin(authorization)

    # Enum checks first (cheap + most likely to fail).
    _enum_check("accent_tag", accent_tag, _ACCENT_VALUES)
    _enum_check("cefr_level", cefr_level, _CEFR_VALUES)
    if not (1 <= ielts_section <= 4):
        raise HTTPException(422, "ielts_section must be 1-4")

    # License + premium cross-field rules. Promoted to 422 since they're
    # hard constraints, not warnings.
    _license_combo_check(
        external_license=external_license,
        external_source_url=external_source_url,
        is_premium=is_premium,
    )

    audio_bytes = await audio_file.read()
    size_bytes = len(audio_bytes)
    duration = infer_duration_seconds(audio_bytes)

    try:
        v = validate_upload_payload(
            file_bytes=audio_bytes,
            transcript=transcript,
            declared_duration_seconds=duration,
        )
    except Exception as e:  # noqa: BLE001 — fail-soft
        logger.warning("[listening] validator threw on /upload/validate: %s", e)
        v = {"errors": [], "warnings": []}

    _ = title  # title presence required by Form(...) — referenced to silence linters.

    return {
        "ok":       not validator_has_errors(v),
        "errors":   v["errors"],
        "warnings": v["warnings"],
        "inferred": {
            "duration_seconds": duration,
            "size_bytes":       size_bytes,
        },
    }


class ListeningBulkManifestItem(BaseModel):
    """Sprint 13.2 — one entry in the bulk upload manifest.

    `filename` MUST match the name of one of the files[] uploaded in
    the same request (case-insensitive). Server uses this to pair
    metadata to file bytes before validation runs.
    """

    model_config = ConfigDict(extra="ignore")

    filename:            str = Field(min_length=1, max_length=300)
    title:               str = Field(min_length=1, max_length=200)
    transcript:          str = Field(min_length=1, max_length=50_000)
    accent_tag:          str
    cefr_level:          str
    ielts_section:       int = Field(ge=1, le=4)
    topic_tags:          list[str] = Field(default_factory=list)
    is_premium:          bool = Field(default=False)
    external_license:    str | None = Field(default=None, max_length=120)
    external_source_url: str | None = Field(default=None, max_length=500)


class ListeningBulkManifest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    items: list[ListeningBulkManifestItem]


_BULK_MAX_FILES = 20


@admin_router.post("/upload/bulk")
async def admin_upload_listening_bulk(
    files: list[UploadFile] = File(...),
    manifest: str = Form(...),
    authorization: str | None = Header(default=None),
):
    """Sprint 13.2 — bulk MP3 upload. Accept 1-20 files plus a JSON
    manifest array describing per-file metadata. Partial failures do
    NOT roll back: every successful insert persists, every failed item
    surfaces in `results[]` with the original filename + error code.

    Manifest paired to files by filename (case-insensitive). Items in
    the manifest with no matching file (or extra files with no manifest
    entry) cause a 422 at the count-mismatch check.
    """
    admin_user = await require_admin(authorization)
    admin_id = admin_user["id"]

    if not files:
        raise HTTPException(422, "At least one file is required.")
    if len(files) > _BULK_MAX_FILES:
        raise HTTPException(
            422,
            f"Bulk upload capped at {_BULK_MAX_FILES} files per request "
            f"(got {len(files)}).",
        )

    try:
        parsed = ListeningBulkManifest.model_validate_json(manifest)
    except Exception as e:
        raise HTTPException(422, f"manifest JSON parse failed: {e}")

    if len(parsed.items) != len(files):
        raise HTTPException(
            422,
            f"manifest items ({len(parsed.items)}) must equal files count ({len(files)}).",
        )

    by_filename: dict[str, ListeningBulkManifestItem] = {}
    for item in parsed.items:
        key = item.filename.strip().lower()
        if key in by_filename:
            raise HTTPException(
                422, f"manifest contains duplicate filename '{item.filename}'",
            )
        by_filename[key] = item

    results: list[dict] = []
    succeeded = 0
    failed = 0

    for file in files:
        fname = (file.filename or "").strip()
        key = fname.lower()
        item = by_filename.get(key)
        if item is None:
            failed += 1
            results.append({
                "filename": fname, "ok": False,
                "errors": [{"code": "manifest_missing",
                            "message": f"No manifest entry for filename '{fname}'.",
                            "field":   "filename",
                            "severity": "error"}],
                "warnings": [],
            })
            continue

        try:
            _enum_check("accent_tag", item.accent_tag, _ACCENT_VALUES)
            _enum_check("cefr_level", item.cefr_level, _CEFR_VALUES)
            _license_combo_check(
                external_license=item.external_license,
                external_source_url=item.external_source_url,
                is_premium=item.is_premium,
            )
        except HTTPException as e:
            failed += 1
            results.append({
                "filename": fname, "ok": False,
                "errors": [{"code": "validation_failed",
                            "message": getattr(e, "detail", str(e)),
                            "field":   "manifest",
                            "severity": "error"}],
                "warnings": [],
            })
            continue

        audio_bytes = await file.read()
        if not audio_bytes:
            failed += 1
            results.append({
                "filename": fname, "ok": False,
                "errors": [{"code": "audio_empty",
                            "message": "File audio rỗng.",
                            "field":   "audio_file",
                            "severity": "error"}],
                "warnings": [],
            })
            continue

        duration = infer_duration_seconds(audio_bytes)
        try:
            v = validate_upload_payload(
                file_bytes=audio_bytes,
                transcript=item.transcript,
                declared_duration_seconds=duration,
            )
        except Exception as e:  # noqa: BLE001 — fail-soft
            logger.warning("[listening] bulk validator threw, skipping: %s", e)
            v = {"errors": [], "warnings": []}

        if validator_has_errors(v):
            failed += 1
            results.append({
                "filename": fname, "ok": False,
                "errors":   v["errors"],
                "warnings": v["warnings"],
            })
            continue

        source_type = "curated_external" if item.external_license else "upload_mp3"
        content_id = str(uuid.uuid4())
        storage_subdir = "curated" if source_type == "curated_external" else "uploads"
        storage_path = f"{storage_subdir}/{content_id}.mp3"

        try:
            supabase_admin.storage.from_(
                settings.LISTENING_AUDIO_BUCKET,
            ).upload(storage_path, audio_bytes, {"content-type": "audio/mpeg"})
        except Exception as e:
            logger.error("[listening] bulk storage upload failed: %s", e)
            failed += 1
            results.append({
                "filename": fname, "ok": False,
                "errors": [{"code": "storage_upload_failed",
                            "message": f"Audio upload failed: {e}",
                            "field":   "audio_file",
                            "severity": "error"}],
                "warnings": v["warnings"],
            })
            continue

        try:
            supabase_admin.table("listening_content").insert({
                "id":                       content_id,
                "source_type":              source_type,
                "external_license":         item.external_license,
                "external_source_url":      item.external_source_url,
                "audio_storage_path":       storage_path,
                "audio_duration_seconds":   duration,
                "audio_size_bytes":         len(audio_bytes),
                "accent_tag":               item.accent_tag,
                "topic_tags":               _normalize_topic_tags(item.topic_tags),
                "cefr_level":               item.cefr_level,
                "ielts_section":            item.ielts_section,
                "transcript":               item.transcript,
                "transcript_segments":      [],
                "status":                   "draft",
                "is_premium":               item.is_premium,
                "title":                    item.title,
                "created_by":               admin_id,
            }).execute()
        except Exception as e:
            logger.error(
                "[listening] bulk DB INSERT failed for %s (storage row left at %s): %s",
                fname, storage_path, e,
            )
            failed += 1
            results.append({
                "filename": fname, "ok": False,
                "errors": [{"code": "db_insert_failed",
                            "message": f"Database insert failed: {e}",
                            "field":   "content_id",
                            "severity": "error"}],
                "warnings": v["warnings"],
            })
            continue

        succeeded += 1
        results.append({
            "filename":     fname,
            "ok":           True,
            "content_id":   content_id,
            "storage_path": storage_path,
            "source_type":  source_type,
            "warnings":     v["warnings"],
        })

    return {
        "total":     len(files),
        "succeeded": succeeded,
        "failed":    failed,
        "results":   results,
    }


# ── Admin routes — Sprint 13.3 ElevenLabs render UI helpers ───────────────────


# Creator-plan economics: $22/mo ⇒ ~100 000 credits ⇒ $0.00022 / credit.
# Approximate — true cost lands when ElevenLabs returns a credit header
# on the actual render response. The UI rounds for display only.
_USD_PER_CREDIT = 0.00022

# Render-time heuristic: ElevenLabs synthesizes roughly chars-per-second
# of audio at ~15 chars/sec real-time-factor. For UI countdown we
# approximate render *wall-clock* as 30% of audio duration → script
# length / 50 chars/sec gives a usable estimate without an API probe.
_CHARS_PER_RENDER_SECOND = 250


def _credit_cost_for(script_text: str, model: str) -> int:
    """Mirror services/listening_renderer._estimate_credit_cost so the
    UI cost preview and the persisted `generation_cost_credits` column
    agree. Imported indirectly to keep routers free of cycle risk.
    """
    from services.listening_renderer import _estimate_credit_cost
    return _estimate_credit_cost(script_text, model)


def _estimated_render_seconds(script_text: str) -> int:
    if not script_text:
        return 1
    return max(3, round(len(script_text) / _CHARS_PER_RENDER_SECOND))


@admin_router.get("/render/feature-flag")
async def admin_render_feature_flag(
    authorization: str | None = Header(default=None),
):
    """Sprint 13.3 — small read-only endpoint the render UI hits on
    mount to decide whether to show the form or a 503 banner.

    Returns `{enabled: bool, message: str | null}`. Mirrors the gate
    inside POST /render (`LISTENING_AI_RENDER_ENABLED` env bool AND
    `ELEVENLABS_API_KEY` env str). Both must be set; either missing
    means the render path is dark.
    """
    await require_admin(authorization)
    enabled = bool(settings.LISTENING_AI_RENDER_ENABLED) and bool(settings.ELEVENLABS_API_KEY)
    if enabled:
        return {"enabled": True, "message": None}
    if not settings.LISTENING_AI_RENDER_ENABLED:
        msg = (
            "AI render đang tạm tắt. Set LISTENING_AI_RENDER_ENABLED=true "
            "sau khi provision ELEVENLABS_API_KEY."
        )
    else:
        msg = "ELEVENLABS_API_KEY chưa cấu hình trên server."
    return {"enabled": False, "message": msg}


class ListeningRenderValidateRequest(BaseModel):
    """Sprint 13.3 — dry-run validation body for the render UI.

    Mirrors the shape of POST /render but is also useful for the live
    cost preview as the admin types: the UI debounces and POSTs the
    current script + voice + model and gets back `{ok, errors,
    warnings, estimated_cost_credits, estimated_cost_usd,
    estimated_render_seconds}`. No ElevenLabs call, no DB write.
    """

    model_config = ConfigDict(extra="ignore")

    script_text:         str = Field(min_length=0, max_length=5000)
    voice_id:            str | None = Field(default=None, min_length=0, max_length=64)
    model:               str = Field(default="eleven_multilingual_v2")
    title:               str | None = Field(default=None, max_length=200)
    accent_tag:          str
    cefr_level:          str | None = None
    ielts_section:       int | None = None
    topic_tags:          list[str] = Field(default_factory=list)
    is_premium:          bool = Field(default=False)
    external_license:    str | None = Field(default=None, max_length=120)
    external_source_url: str | None = Field(default=None, max_length=500)


_RENDER_SCRIPT_MIN_CHARS = 100
_LOCKED_RENDER_VOICES: set[str] = {
    settings.LISTENING_VOICE_US_FEMALE_DEFAULT,
    settings.LISTENING_VOICE_UK_FEMALE_DEFAULT,
}


def _validate_render_payload(body: ListeningRenderValidateRequest) -> dict:
    """Sprint 13.3 — collect errors/warnings for the render UI.

    Distinct from Sprint 13.2 upload validator (that one's about audio
    bytes + transcript wpm). This one's about script length, voice +
    model enums, and the same license/premium cross-field rules. Hard
    rules (premium+NC) raise HTTPException; soft signals come back as
    warnings.
    """
    errors:   list[dict] = []
    warnings: list[dict] = []

    text = (body.script_text or "").strip()
    if not text:
        errors.append({"code": "script_empty", "message": "Script trống.",
                       "field": "script_text", "severity": "error"})
    elif len(text) < _RENDER_SCRIPT_MIN_CHARS:
        errors.append({
            "code": "script_too_short",
            "message": (
                f"Script quá ngắn ({len(text)} ký tự) — tối thiểu "
                f"{_RENDER_SCRIPT_MIN_CHARS} ký tự để chống lãng phí credit."
            ),
            "field": "script_text", "severity": "error",
        })

    if body.accent_tag not in _ACCENT_VALUES:
        errors.append({"code": "accent_invalid",
                       "message": f"accent_tag must be one of {sorted(_ACCENT_VALUES)}",
                       "field": "accent_tag", "severity": "error"})

    if body.model not in _ELEVENLABS_MODELS:
        errors.append({"code": "model_invalid",
                       "message": f"model must be one of {sorted(_ELEVENLABS_MODELS)}",
                       "field": "model", "severity": "error"})

    if body.cefr_level is not None and body.cefr_level not in _CEFR_VALUES:
        errors.append({"code": "cefr_invalid",
                       "message": f"cefr_level must be one of {sorted(_CEFR_VALUES)}",
                       "field": "cefr_level", "severity": "error"})

    if body.ielts_section is not None and not (1 <= body.ielts_section <= 4):
        errors.append({"code": "section_invalid",
                       "message": "ielts_section must be 1-4",
                       "field": "ielts_section", "severity": "error"})

    voice_id = body.voice_id or _default_voice_for_accent(body.accent_tag) or ""
    if voice_id and voice_id not in _LOCKED_RENDER_VOICES:
        # Sprint 13.3 UI ships 2 locked voices (Sarah + Alice). A
        # non-locked voice_id passed in (e.g. via direct API call from a
        # future custom voice) is allowed — surface as warning so admin
        # sees it but the upload proceeds.
        warnings.append({"code": "voice_not_locked",
                         "message": "voice_id không nằm trong danh sách locked (Sarah / Alice).",
                         "field": "voice_id", "severity": "warning"})

    if len(text) > 3000:
        warnings.append({"code": "long_script",
                         "message": (
                             f"Script {len(text)} ký tự — render lâu hơn "
                             f"({_estimated_render_seconds(text)}s) và tốn nhiều credit hơn."
                         ),
                         "field": "script_text", "severity": "warning"})

    # License + premium hard rules → HTTPException 422 (mirror upload).
    _license_combo_check(
        external_license=body.external_license,
        external_source_url=body.external_source_url,
        is_premium=body.is_premium,
    )

    credits = _credit_cost_for(text, body.model) if text else 0
    return {
        "ok":                       not errors,
        "errors":                   errors,
        "warnings":                 warnings,
        "estimated_cost_credits":   credits,
        "estimated_cost_usd":       round(credits * _USD_PER_CREDIT, 4),
        "estimated_render_seconds": _estimated_render_seconds(text),
    }


@admin_router.post("/render/validate")
async def admin_render_validate(
    body: ListeningRenderValidateRequest,
    authorization: str | None = Header(default=None),
):
    """Sprint 13.3 — dry-run validation + cost preview. No ElevenLabs
    call, no DB write. UI calls this on the "Kiểm tra trước khi render"
    button and (debounced) as the script field changes.
    """
    await require_admin(authorization)
    return _validate_render_payload(body)


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

    # ── Sprint 13.3 — apply the new render-script floor ──────────────────────
    stripped_script = (body.script_text or "").strip()
    if len(stripped_script) < _RENDER_SCRIPT_MIN_CHARS:
        raise HTTPException(
            422,
            f"script_text quá ngắn ({len(stripped_script)} ký tự) — tối thiểu "
            f"{_RENDER_SCRIPT_MIN_CHARS} ký tự (Sprint 13.3 anti-waste gate).",
        )

    # ── Sprint 11.2 — resolve voice_id fallback by accent ─────────────────────
    voice_id = body.voice_id or _default_voice_for_accent(body.accent_tag)
    if not voice_id:
        raise HTTPException(
            422,
            "voice_id required (no default voice configured for "
            f"accent_tag='{body.accent_tag}' — set body.voice_id explicitly).",
        )

    job_id = str(uuid.uuid4())

    # ── Sprint 13.3.1 hotfix — INSERT placeholder row synchronously ─────────
    # The renderer used to INSERT the row at the END of the
    # BackgroundTask (~10-30s later), which raced the frontend's
    # immediate redirect to content-detail.html?id=<id>. Now we create
    # a placeholder row up-front (audio_storage_path=NULL, duration=0,
    # size=0) and the BackgroundTask UPDATEs that row in place. The
    # frontend treats `audio_storage_path IS NULL` as the "rendering"
    # sentinel + auto-polls for the populated state.
    # Migration 064 relaxed the schema constraints to allow this shape.
    placeholder = {
        "id":                      job_id,
        "source_type":             "ai_elevenlabs",
        "elevenlabs_voice_id":     voice_id,
        "elevenlabs_model":        body.model,
        # Placeholder shape — populated by the BackgroundTask.
        "audio_storage_path":      None,
        "audio_duration_seconds":  0,
        "audio_size_bytes":        0,
        "alignment_data":          None,
        "generation_cost_credits": _credit_cost_for(body.script_text, body.model),
        # Metadata carried over from the request — readable in the
        # rendering banner so admins see what they queued.
        "accent_tag":              body.accent_tag,
        "topic_tags":              body.topic_tags or [],
        "cefr_level":              body.cefr_level,
        "ielts_section":           body.ielts_section,
        "transcript":              body.transcript or body.script_text,
        "transcript_segments":     [],
        "status":                  "draft",
        "is_premium":              False,
        "title":                   body.title,
        "created_by":              admin_user["id"],
    }
    try:
        supabase_admin.table("listening_content").insert(placeholder).execute()
    except Exception as e:
        logger.error(
            "[listening] render placeholder INSERT failed for job %s: %s",
            job_id, e,
        )
        raise HTTPException(500, f"Render placeholder insert failed: {e}")

    background_tasks.add_task(
        run_elevenlabs_render_job,
        job_id=job_id,
        script_text=body.script_text,
        voice_id=voice_id,
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
        "job_id":     job_id,
        "content_id": job_id,
        "status":     "rendering",
        "estimated_render_seconds": _estimated_render_seconds(body.script_text),
        "estimated_cost_credits":   _credit_cost_for(body.script_text, body.model),
        "note":       (
            "Placeholder row created. Poll /admin/listening/content/"
            "{content_id} — audio_storage_path becomes non-null when the "
            "render finishes (~10-30s)."
        ),
    }


# ── User route — submit dictation attempt ─────────────────────────────────────


def _ensure_dictation_exercise(content_id: str) -> str:
    """Sprint 11.2 ships the user-facing dictation surface BEFORE the
    admin exercise-curation UI lands (Sprint 11.4). Every published
    content_id is implicitly a dictation exercise: the script_text IS
    the dictation reference.

    Lazy upsert pattern: on first attempt, create the
    listening_exercises row mirroring the content (one-to-one for
    dictation mode). Returns the exercise_id.

    Sprint 11.3+ replaces this with admin-curated exercise rows
    (gist + T/F + MCQ payloads differ per type — only dictation has
    the "exercise == content" identity)."""
    existing = (
        supabase_admin.table("listening_exercises")
        .select("id")
        .eq("content_id", content_id)
        .eq("exercise_type", "dictation")
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]["id"]

    exercise_id = str(uuid.uuid4())
    supabase_admin.table("listening_exercises").insert({
        "id":            exercise_id,
        "content_id":    content_id,
        "exercise_type": "dictation",
        "payload":       {},
        "order_num":     1,
        "status":        "published",
    }).execute()
    return exercise_id


@user_router.post("/attempts")
async def post_listening_attempt(
    body: ListeningAttemptRequest,
    authorization: str | None = Header(default=None),
):
    """Submit one dictation attempt.

    Sprint 11.3 — segmented dictation. Body MAY carry:
      - segment_idx + exercise_id  → grade against exercise.segments[idx]
      - segment_idx + content_id   → resolve dictation exercise from content
      - content_id only            → Sprint 11.2 fallback: whole transcript
                                     (only used if no published dictation
                                     exercise exists for the content)

    Sprint 10.3 first-attempt rule: ALL attempts are stored, but only
    the first attempt per (user_id, exercise_id, segment_idx) sets the
    canonical score. Subsequent attempts get stored with their fresh
    score but do not overwrite — analytics treat first attempt as
    ground truth.

    Modes other than 'dictation' return 422 — Sprint 11.4+ flips
    gist / true-false / mcq.
    """
    user = await _require_auth(authorization)
    user_id = user["id"]

    if body.mode not in {"dictation", "gist", "true_false", "mcq"}:
        raise HTTPException(
            422,
            f"mode='{body.mode}' not supported — "
            "supported: dictation | gist | true_false | mcq.",
        )
    if not body.content_id and not body.exercise_id:
        raise HTTPException(422, "Either content_id or exercise_id is required.")

    # ── Resolve exercise + parent content ─────────────────────────────────────
    exercise_row, content_row = _resolve_attempt_target(body)

    # ── Dispatch by mode ──────────────────────────────────────────────────────
    if body.mode == "dictation":
        return _grade_and_save_dictation(
            user_id=user_id,
            body=body,
            exercise_row=exercise_row,
            content_row=content_row,
        )
    if body.mode == "gist":
        return _grade_and_save_gist(
            user_id=user_id, body=body, exercise_row=exercise_row,
        )
    if body.mode == "true_false":
        return _grade_and_save_true_false(
            user_id=user_id, body=body, exercise_row=exercise_row,
        )
    if body.mode == "mcq":
        return _grade_and_save_mcq(
            user_id=user_id, body=body, exercise_row=exercise_row,
        )
    # Unreachable — kept defensive.
    raise HTTPException(500, "Unhandled mode dispatch.")


# ── Attempt-handler helpers ───────────────────────────────────────────────────


def _resolve_attempt_target(
    body: ListeningAttemptRequest,
) -> tuple[dict | None, dict]:
    """Look up exercise_row (by exercise_id OR derived from content_id +
    body.mode) and the parent content row. Returns (exercise_row,
    content_row). exercise_row may be None for the Sprint 11.2 dictation
    fallback path; content_row is never None (404 if missing)."""
    exercise_row: dict | None = None
    content_id: str | None = body.content_id

    if body.exercise_id:
        res = (
            supabase_admin.table("listening_exercises")
            .select("*")
            .eq("id", body.exercise_id)
            .eq("status", "published")
            .limit(1)
            .execute()
        )
        if not res.data:
            raise HTTPException(404, "Exercise not found or not published.")
        exercise_row = res.data[0]
        content_id = exercise_row["content_id"]
        # If the body mode disagrees with the exercise type, that's a
        # client bug — surface it as 422 so it can't masquerade as a
        # silently-mis-graded attempt.
        if exercise_row["exercise_type"] != body.mode:
            raise HTTPException(
                422,
                f"mode='{body.mode}' but exercise_id resolves to "
                f"exercise_type='{exercise_row['exercise_type']}'.",
            )

    content_res = (
        supabase_admin.table("listening_content")
        .select("id,transcript,status")
        .eq("id", content_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not content_res.data:
        raise HTTPException(404, "Listening content not found or not published")
    content_row = content_res.data[0]

    if exercise_row is None and body.mode != "dictation":
        # gist + true_false + mcq require an authored exercise — no lazy upsert.
        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("*")
            .eq("content_id", content_id)
            .eq("exercise_type", body.mode)
            .eq("status", "published")
            .limit(1)
            .execute()
        )
        if not ex_res.data:
            raise HTTPException(
                404,
                f"No published {body.mode} exercise exists for this content.",
            )
        exercise_row = ex_res.data[0]

    elif exercise_row is None and body.mode == "dictation":
        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("*")
            .eq("content_id", content_id)
            .eq("exercise_type", "dictation")
            .eq("status", "published")
            .limit(1)
            .execute()
        )
        if ex_res.data:
            exercise_row = ex_res.data[0]

    return exercise_row, content_row


def _insert_attempt(
    *,
    user_id: str,
    exercise_id: str,
    segment_idx: int | None,
    user_answer: dict,
    score: float,
    is_correct: bool,
    listen_count: int,
    listening_session_id: str | None = None,
) -> str:
    attempt_id = str(uuid.uuid4())
    row: dict = {
        "id":                   attempt_id,
        "user_id":              user_id,
        "exercise_id":          exercise_id,
        "segment_idx":          segment_idx,
        "user_answer":          user_answer,
        "is_correct":           is_correct,
        "score":                score,
        "replay_count":         max(0, listen_count - 1),
        "audio_play_completed": listen_count >= 1,
    }
    if listening_session_id:
        row["listening_session_id"] = listening_session_id
    try:
        supabase_admin.table("listening_attempts").insert(row).execute()
    except Exception as e:
        logger.error("[listening] attempt INSERT failed user=%s exercise=%s: %s",
                     user_id, exercise_id, e)
        raise HTTPException(500, f"Attempt save failed: {e}")
    return attempt_id


def _check_first_attempt(
    *,
    user_id: str,
    exercise_id: str,
    segment_idx: int | None,
) -> bool:
    q = (
        supabase_admin.table("listening_attempts")
        .select("id")
        .eq("user_id", user_id)
        .eq("exercise_id", exercise_id)
    )
    if segment_idx is not None:
        q = q.eq("segment_idx", segment_idx)
    prior = q.limit(1).execute()
    return not prior.data


# ── Dictation grader (Sprint 11.2/11.3 path) ──────────────────────────────────


def _grade_and_save_dictation(
    *,
    user_id: str,
    body: ListeningAttemptRequest,
    exercise_row: dict | None,
    content_row: dict,
) -> dict:
    segments = (exercise_row or {}).get("segments") or []
    if body.segment_idx is not None:
        if not exercise_row or not segments:
            raise HTTPException(
                422,
                "segment_idx supplied but no segmented dictation exercise "
                "exists for this content.",
            )
        if body.segment_idx >= len(segments):
            raise HTTPException(
                422,
                f"segment_idx {body.segment_idx} out of range "
                f"(0..{len(segments) - 1}).",
            )
        reference_transcript = segments[body.segment_idx].get("transcript", "")
    else:
        reference_transcript = content_row["transcript"]

    graded = grade_dictation(
        reference_transcript=reference_transcript,
        user_transcript=body.user_transcript,
    )

    if exercise_row:
        exercise_id = exercise_row["id"]
    else:
        exercise_id = _ensure_dictation_exercise(content_row["id"])

    is_first_attempt = _check_first_attempt(
        user_id=user_id, exercise_id=exercise_id, segment_idx=body.segment_idx,
    )

    attempt_id = _insert_attempt(
        user_id=user_id,
        exercise_id=exercise_id,
        segment_idx=body.segment_idx,
        user_answer={"text": body.user_transcript, "diff": graded["diff"]},
        score=graded["score"],
        is_correct=graded["is_correct"],
        listen_count=body.listen_count,
        listening_session_id=body.listening_session_id,
    )
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_id,
        "segment_idx":      body.segment_idx,
        "mode":             "dictation",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],
        "correct_words":    graded["correct_words"],
        "total_words":      graded["total_words"],
        "is_correct":       graded["is_correct"],
        "diff":             graded["diff"],
    }


# ── Gist grader (Sprint 11.4) ─────────────────────────────────────────────────


def _grade_and_save_gist(
    *,
    user_id: str,
    body: ListeningAttemptRequest,
    exercise_row: dict | None,
) -> dict:
    if not exercise_row:
        raise HTTPException(404, "No gist exercise exists for this content.")
    payload = exercise_row.get("payload") or {}
    model_answer = str(payload.get("model_answer") or "").strip()
    rubric_keywords = list(payload.get("rubric_keywords") or [])
    if not model_answer:
        raise HTTPException(
            422,
            "Gist exercise payload missing model_answer — admin must "
            "author the rubric before grading.",
        )

    graded = grade_gist_response(
        user_response=body.user_transcript,
        model_answer=model_answer,
        rubric_keywords=rubric_keywords,
    )

    is_first_attempt = _check_first_attempt(
        user_id=user_id, exercise_id=exercise_row["id"], segment_idx=None,
    )
    attempt_id = _insert_attempt(
        user_id=user_id,
        exercise_id=exercise_row["id"],
        segment_idx=None,
        user_answer={
            "text":            body.user_transcript,
            "feedback":        graded["feedback"],
            "keyword_matches": graded["keyword_matches"],
            "ai_used":         graded["ai_used"],
        },
        # listening_attempts.score is NUMERIC(4,2) — gist Haiku returns
        # 0-100, store as 0-1 for consistency with dictation.
        score=round(graded["score"] / 100.0, 2),
        is_correct=graded["score"] >= 80,
        listen_count=body.listen_count,
        listening_session_id=body.listening_session_id,
    )
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_row["id"],
        "mode":             "gist",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],          # 0-100 client-facing
        "feedback":         graded["feedback"],
        "keyword_matches":  graded["keyword_matches"],
        "ai_used":          graded["ai_used"],
        "is_correct":       graded["score"] >= 80,
    }


# ── True/False grader (Sprint 11.4) ───────────────────────────────────────────


def _grade_and_save_true_false(
    *,
    user_id: str,
    body: ListeningAttemptRequest,
    exercise_row: dict | None,
) -> dict:
    if not exercise_row:
        raise HTTPException(404, "No true_false exercise exists for this content.")
    payload = exercise_row.get("payload") or {}
    statements = list(payload.get("statements") or [])
    if not statements:
        raise HTTPException(
            422,
            "true_false exercise payload missing statements.",
        )
    if not isinstance(body.answers, list) or not body.answers:
        raise HTTPException(
            422, "answers[] required for true_false mode.",
        )

    graded = grade_true_false(statements=statements, user_answers=body.answers)

    is_first_attempt = _check_first_attempt(
        user_id=user_id, exercise_id=exercise_row["id"], segment_idx=None,
    )
    attempt_id = _insert_attempt(
        user_id=user_id,
        exercise_id=exercise_row["id"],
        segment_idx=None,
        user_answer={
            "answers": [str(a) for a in body.answers],
            "details": graded["details"],
        },
        score=round(graded["score"], 2),
        is_correct=graded["is_correct"],
        listen_count=body.listen_count,
        listening_session_id=body.listening_session_id,
    )
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_row["id"],
        "mode":             "true_false",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],
        "correct":          graded["correct"],
        "total":            graded["total"],
        "is_correct":       graded["is_correct"],
        "details":          graded["details"],
    }


# ── MCQ grader (Sprint 11.5) ──────────────────────────────────────────────────


def _grade_and_save_mcq(
    *,
    user_id: str,
    body: ListeningAttemptRequest,
    exercise_row: dict | None,
) -> dict:
    if not exercise_row:
        raise HTTPException(404, "No mcq exercise exists for this content.")
    payload = exercise_row.get("payload") or {}
    questions = list(payload.get("questions") or [])
    if not questions:
        raise HTTPException(422, "mcq exercise payload missing questions.")
    if not isinstance(body.mcq_answers, list) or not body.mcq_answers:
        raise HTTPException(422, "mcq_answers[] required for mcq mode.")

    graded = grade_mcq(questions=questions, user_answers=body.mcq_answers)

    is_first_attempt = _check_first_attempt(
        user_id=user_id, exercise_id=exercise_row["id"], segment_idx=None,
    )
    # Strip canonical answers from `details` written to client so a network
    # tap of the response doesn't leak the answer key to subsequent retries.
    safe_details = [
        {
            "idx":          d["idx"],
            "actual_idx":   d["actual_idx"],
            "is_correct":   d["is_correct"],
        }
        for d in graded["details"]
    ]
    attempt_id = _insert_attempt(
        user_id=user_id,
        exercise_id=exercise_row["id"],
        segment_idx=None,
        user_answer={
            "mcq_answers": list(body.mcq_answers),
            "details":     graded["details"],  # full details persisted server-side
        },
        score=round(graded["score"], 2),
        is_correct=graded["is_correct"],
        listen_count=body.listen_count,
        listening_session_id=body.listening_session_id,
    )
    return {
        "attempt_id":       attempt_id,
        "exercise_id":      exercise_row["id"],
        "mode":             "mcq",
        "is_first_attempt": is_first_attempt,
        "score":            graded["score"],
        "correct":          graded["correct"],
        "total":            graded["total"],
        "is_correct":       graded["is_correct"],
        "details":          safe_details,
    }


# ── User route — list exercises for a content ────────────────────────────────


@user_router.get("/exercises")
async def get_listening_exercises(
    content_id: str = Query(..., min_length=1, max_length=64),
    exercise_type: str = Query(default="dictation"),
    authorization: str | None = Header(default=None),
):
    """List published exercises for a content row. Sprint 11.3 dictation
    page calls this to discover the segments JSONB it should iterate.

    Returns: `{exercises: [...]}` ordered by order_num. Empty list when
    no exercise has been authored yet — the client renders an empty
    state pointing the admin at the segment editor.
    """
    user = await _require_auth(authorization)
    _ = user

    if exercise_type not in _EXERCISE_TYPES:
        raise HTTPException(
            422, f"exercise_type must be one of {sorted(_EXERCISE_TYPES)}",
        )

    # Content must be published for the user route to surface anything.
    c = (
        supabase_admin.table("listening_content")
        .select("id,status,audio_duration_seconds")
        .eq("id", content_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not c.data:
        raise HTTPException(404, "Listening content not found or not published")

    res = (
        supabase_admin.table("listening_exercises")
        .select("*")
        .eq("content_id", content_id)
        .eq("exercise_type", exercise_type)
        .eq("status", "published")
        .order("order_num", desc=False)
        .execute()
    )
    return {"exercises": res.data or []}


# ── Admin routes — content preview + list ─────────────────────────────────────


@admin_router.get("/content/{content_id}")
async def admin_get_listening_content(
    content_id: str,
    authorization: str | None = Header(default=None),
):
    """Admin-only preview. Same shape as the user GET but no
    `status='published'` filter — admins can review drafts before
    flipping them live.

    Sprint 11.1 falsification #60: user route hard-filters published
    rows, so admin preview previously required a SQL UPDATE workaround.
    This is the proper fix.
    """
    await require_admin(authorization)

    res = (
        supabase_admin.table("listening_content")
        .select("*")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Listening content not found")
    row = res.data[0]

    try:
        signed = supabase_admin.storage.from_(
            settings.LISTENING_AUDIO_BUCKET
        ).create_signed_url(row["audio_storage_path"], 3600)
        row["audio_signed_url"] = signed.get("signedURL") or signed.get("signed_url")
    except Exception as e:
        logger.error(
            "[listening] admin signed URL failed content_id=%s: %s", content_id, e,
        )
        # Admins still see the metadata even if storage is misconfigured.
        row["audio_signed_url"] = None

    return row


@admin_router.get("/content")
async def admin_list_listening_content(
    status: str = Query(default="all"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """List listening_content rows for the admin curation UI.

    Sprint 11.1 falsification #59: the handoff doc assumed this
    existed; it didn't. This ships the proper paginated list so the
    Supabase Dashboard is no longer the canonical view.

    status defaults to 'all' (admins want to see drafts + published
    side by side). Pass status='draft' or 'published' to filter.
    """
    await require_admin(authorization)

    if status != "all" and status not in _STATUS_VALUES:
        raise HTTPException(
            422,
            f"status must be one of {sorted(_STATUS_VALUES | {'all'})}",
        )

    q = (
        supabase_admin.table("listening_content")
        .select("*", count="exact")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if status != "all":
        q = q.eq("status", status)

    res = q.execute()
    return {
        "items":  res.data or [],
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }


# ── Admin routes — content metadata + status PATCH (Sprint 13.1) ──────────────


@admin_router.patch("/content/{content_id}")
async def admin_patch_listening_content(
    content_id: str,
    body: ListeningContentMetadataPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Update editable metadata fields on a listening_content row.

    Allow-list: title, transcript, accent_tag, cefr_level, ielts_section,
    topic_tags, is_premium, external_license, external_source_url.

    Only keys present in the request body land in the UPDATE — partial
    updates are first-class. Validation reuses POST /upload rules.

    Premium + NC license combo is rejected at 422 to mirror the upload
    path (Sprint 11.0 §4E). When external_license is being SET in this
    PATCH, external_source_url must also be set (license attribution).
    """
    await require_admin(authorization)

    existing = (
        supabase_admin.table("listening_content")
        .select("*")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Listening content not found")
    current = existing.data[0]

    update: dict = {}

    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(422, "title must not be empty")
        update["title"] = title

    if body.transcript is not None:
        transcript = body.transcript
        if not transcript.strip():
            raise HTTPException(422, "transcript must not be empty")
        update["transcript"] = transcript

    if body.accent_tag is not None:
        if body.accent_tag not in _ACCENT_VALUES:
            raise HTTPException(
                422, f"accent_tag must be one of {sorted(_ACCENT_VALUES)}",
            )
        update["accent_tag"] = body.accent_tag

    if body.cefr_level is not None:
        if body.cefr_level not in _CEFR_VALUES:
            raise HTTPException(
                422, f"cefr_level must be one of {sorted(_CEFR_VALUES)}",
            )
        update["cefr_level"] = body.cefr_level

    if body.ielts_section is not None:
        if not (1 <= body.ielts_section <= 4):
            raise HTTPException(422, "ielts_section must be 1-4")
        update["ielts_section"] = body.ielts_section

    if body.topic_tags is not None:
        tags = [str(t).strip() for t in body.topic_tags if str(t).strip()]
        update["topic_tags"] = tags

    if body.is_premium is not None:
        update["is_premium"] = bool(body.is_premium)

    if body.external_license is not None:
        update["external_license"] = body.external_license or None

    if body.external_source_url is not None:
        update["external_source_url"] = body.external_source_url or None

    # Cross-field rules — evaluated against the merged shape (current row
    # + this PATCH's deltas) so partial updates can't slip past Sprint
    # 11.0 §4 / §4E by setting one half of a related pair on its own.
    merged = {**current, **update}
    if merged.get("external_license") and not merged.get("external_source_url"):
        raise HTTPException(
            422,
            "external_source_url required when external_license is set "
            "(license attribution rule)",
        )
    if (
        merged.get("is_premium")
        and merged.get("external_license")
        and "NC" in str(merged["external_license"])
    ):
        raise HTTPException(
            422,
            "Cannot mark NC-licensed content as premium — non-commercial "
            "restriction incompatible with paid tier (Sprint 11.0 §4E).",
        )

    if not update:
        # No editable keys present — return current row unchanged. Saves
        # a write but still confirms the PATCH succeeded so the admin UI
        # can refresh consistently.
        return current

    res = (
        supabase_admin.table("listening_content")
        .update(update)
        .eq("id", content_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else {**current, **update}


@admin_router.patch("/content/{content_id}/status")
async def admin_patch_listening_content_status(
    content_id: str,
    body: ListeningContentStatusPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Transition a listening_content row between draft / published /
    archived. Any-to-any direction is allowed (Sprint 13.1 commission D5
    — no workflow gate; explicit Publish/Archive buttons live on the
    admin content-detail page).
    """
    await require_admin(authorization)

    new_status = body.status.strip().lower()
    if new_status not in _STATUS_VALUES:
        raise HTTPException(
            422, f"status must be one of {sorted(_STATUS_VALUES)}",
        )

    existing = (
        supabase_admin.table("listening_content")
        .select("id,status")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Listening content not found")

    res = (
        supabase_admin.table("listening_content")
        .update({"status": new_status})
        .eq("id", content_id)
        .execute()
    )
    rows = res.data or []
    if rows:
        return rows[0]
    return {"id": content_id, "status": new_status}


# ── Admin routes — exercise CRUD (Sprint 11.3) ────────────────────────────────


@admin_router.post("/exercises")
async def admin_upsert_listening_exercise(
    body: ListeningExerciseUpsertRequest,
    authorization: str | None = Header(default=None),
):
    """Create or update a dictation exercise row + segments.

    Sprint 11.3 — segmented dictation authoring. Segments validated
    against the parent content row's audio_duration_seconds:
      - idx contiguous from 0
      - start_sec < end_sec
      - end_sec ≤ content.audio_duration_seconds (+0.5s slack)
      - non-overlapping
      - transcript non-empty

    Upsert semantics: if a row with the same (content_id, exercise_type)
    pair already exists, the row is UPDATEd in place (preserves the
    exercise_id so existing attempt rows keep referencing it). Otherwise
    a new row is INSERTed.
    """
    await require_admin(authorization)

    if body.exercise_type not in _EXERCISE_TYPES:
        raise HTTPException(
            422, f"exercise_type must be one of {sorted(_EXERCISE_TYPES)}",
        )
    if body.status not in _STATUS_VALUES:
        raise HTTPException(
            422, f"status must be one of {sorted(_STATUS_VALUES)}",
        )

    # ── Resolve parent content (we need its duration for validation) ─────────
    c = (
        supabase_admin.table("listening_content")
        .select("id,audio_duration_seconds")
        .eq("id", body.content_id)
        .limit(1)
        .execute()
    )
    if not c.data:
        raise HTTPException(404, "Listening content not found")
    duration = c.data[0]["audio_duration_seconds"]

    # ── Validate per-type payload + segments (Sprint 11.3 + 11.4) ──────────
    validated_segments: list[dict] = []
    validated_payload: dict = dict(body.payload or {})
    if body.exercise_type == "dictation":
        validated_segments = _validate_dictation_segments(
            body.segments,
            audio_duration_seconds=duration,
        )
    elif body.exercise_type == "gist":
        validated_payload = _validate_gist_payload(validated_payload)
    elif body.exercise_type == "true_false":
        validated_payload = _validate_true_false_payload(validated_payload)
    elif body.exercise_type == "mcq":
        validated_payload = _validate_mcq_payload(validated_payload)

    # ── Upsert: look up existing row by (content_id, exercise_type) ──────────
    existing = (
        supabase_admin.table("listening_exercises")
        .select("id")
        .eq("content_id", body.content_id)
        .eq("exercise_type", body.exercise_type)
        .limit(1)
        .execute()
    )

    payload = {
        "content_id":    body.content_id,
        "exercise_type": body.exercise_type,
        "payload":       validated_payload,
        "order_num":     body.order_num,
        "status":        body.status,
        "segments":      validated_segments,
    }

    if existing.data:
        exercise_id = existing.data[0]["id"]
        supabase_admin.table("listening_exercises").update(payload).eq(
            "id", exercise_id,
        ).execute()
        return {"ok": True, "exercise_id": exercise_id, "created": False}

    exercise_id = str(uuid.uuid4())
    payload["id"] = exercise_id
    supabase_admin.table("listening_exercises").insert(payload).execute()
    return {"ok": True, "exercise_id": exercise_id, "created": True}


@admin_router.get("/exercises")
async def admin_list_listening_exercises(
    content_id: str = Query(..., min_length=1, max_length=64),
    exercise_type: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """List exercises for a content row. Admin variant — sees draft +
    archived rows in addition to published. Used by the segment editor
    to load existing segments on re-edit.
    """
    await require_admin(authorization)

    if exercise_type is not None and exercise_type not in _EXERCISE_TYPES:
        raise HTTPException(
            422, f"exercise_type must be one of {sorted(_EXERCISE_TYPES)}",
        )

    q = (
        supabase_admin.table("listening_exercises")
        .select("*")
        .eq("content_id", content_id)
        .order("order_num", desc=False)
    )
    if exercise_type:
        q = q.eq("exercise_type", exercise_type)
    res = q.execute()
    return {"exercises": res.data or []}


@admin_router.delete("/exercises/{exercise_id}")
async def admin_delete_listening_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    """Soft-delete an exercise via status='archived' (Sprint 10.6 vocab
    archive pattern). Hard delete reserved for admin-only DB ops because
    listening_attempts has a FK CASCADE that would lose user history.
    """
    await require_admin(authorization)

    res = (
        supabase_admin.table("listening_exercises")
        .select("id,status")
        .eq("id", exercise_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Exercise not found")

    supabase_admin.table("listening_exercises").update({
        "status": "archived",
    }).eq("id", exercise_id).execute()

    return {"ok": True, "exercise_id": exercise_id, "status": "archived"}


# ══════════════════════════════════════════════════════════════════════════════
# Sprint 11.5 — Mini Test sessions, content browse, analytics
# ══════════════════════════════════════════════════════════════════════════════


# ── Pydantic schemas (Sprint 11.5) ────────────────────────────────────────────


class ListeningSessionUpsertRequest(BaseModel):
    """Admin POST /admin/listening/sessions body.

    Authors a mini-test composition. exercise_ids must be a non-empty
    list of published listening_exercises.id values; the router verifies
    each exists + is published before persisting. ordered_position
    parallels exercise_ids and carries scaffold metadata (section label
    1-4, optional est-time string) that the runner displays."""

    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1, max_length=200)
    exercise_ids: list[str] = Field(default_factory=list)
    ordered_position: list[dict] = Field(default_factory=list)
    status: str = Field(default="draft")


class ListeningSessionCompleteRequest(BaseModel):
    """User POST /api/listening/sessions/{id}/complete body."""
    model_config = ConfigDict(extra="ignore")


# ── Admin route — author / list / view session ────────────────────────────────


@admin_router.post("/sessions")
async def admin_create_listening_session(
    body: ListeningSessionUpsertRequest,
    authorization: str | None = Header(default=None),
):
    """Author a mini-test session (Sprint 11.5).

    `session_type` is hardcoded to 'mini_test' — admin-authored sessions
    are always mini tests. Free-practice rows are user-created (future
    sprint) and never authored via this endpoint.

    Validates that every exercise_id resolves to a published
    listening_exercises row. A draft exercise in the lineup raises 422
    so the admin can't accidentally ship a half-published test.
    """
    admin_user = await require_admin(authorization)

    if not body.exercise_ids or len(body.exercise_ids) > 50:
        raise HTTPException(
            422, "exercise_ids must contain 1-50 published exercise IDs.",
        )

    # Verify every exercise exists + is published.
    res = (
        supabase_admin.table("listening_exercises")
        .select("id,status,content_id")
        .in_("id", body.exercise_ids)
        .execute()
    )
    found_ids = {row["id"]: row for row in (res.data or [])}
    missing = [e for e in body.exercise_ids if e not in found_ids]
    if missing:
        raise HTTPException(
            422, f"exercise_ids not found: {missing}",
        )
    drafts = [
        e for e in body.exercise_ids
        if found_ids[e]["status"] != "published"
    ]
    if drafts:
        raise HTTPException(
            422,
            f"All exercises in a mini-test must be published; draft/archived: {drafts}",
        )

    # Derive section_content_ids (legacy column, NOT NULL per migration 056).
    # Use the distinct content_ids referenced by the lineup, padded with
    # nulls or duplicated to length 4 for the legacy invariant.
    content_ids: list[str] = []
    seen: set[str] = set()
    for eid in body.exercise_ids:
        cid = found_ids[eid]["content_id"]
        if cid not in seen:
            content_ids.append(cid)
            seen.add(cid)
    # Pad to at-least-4 (migration 056 NOT NULL allows empty literals;
    # storing the actual lineup is the canonical truth — section_content_ids
    # becomes a derivable view from exercise_ids).
    section_content_ids = content_ids[:4] if len(content_ids) >= 4 else (
        content_ids + [content_ids[-1]] * (4 - len(content_ids)) if content_ids else []
    )

    session_id = str(uuid.uuid4())
    try:
        supabase_admin.table("listening_sessions").insert({
            "id":                  session_id,
            "user_id":             admin_user["id"],  # authoring admin
            "session_type":        "mini_test",
            "exercise_ids":        body.exercise_ids,
            "ordered_position":    body.ordered_position or [],
            "section_content_ids": section_content_ids,
            "total_questions":     len(body.exercise_ids),
        }).execute()
    except Exception as e:
        logger.error("[listening] session INSERT failed: %s", e)
        raise HTTPException(500, f"Session save failed: {e}")
    return {"ok": True, "session_id": session_id, "created": True}


@admin_router.get("/sessions")
async def admin_list_listening_sessions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """List admin-authored mini-test sessions."""
    await require_admin(authorization)
    res = (
        supabase_admin.table("listening_sessions")
        .select("*", count="exact")
        .eq("session_type", "mini_test")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return {
        "items":  res.data or [],
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }


@user_router.get("/sessions/{session_id}")
async def get_listening_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """Fetch a mini-test session lineup for the user runner.

    Returns the session row + an `exercises` array populated with the
    full listening_exercises rows (in exercise_ids order). The runner
    walks `exercises[]` linearly, fetching content + signed URLs per
    step (already covered by /api/listening/content/{id})."""
    await _require_auth(authorization)

    res = (
        supabase_admin.table("listening_sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Listening session not found")
    session = res.data[0]
    if session.get("session_type") != "mini_test":
        raise HTTPException(404, "Listening session is not a mini test.")

    exercise_ids = session.get("exercise_ids") or []
    if not exercise_ids:
        return {**session, "exercises": []}

    ex_res = (
        supabase_admin.table("listening_exercises")
        .select("*")
        .in_("id", exercise_ids)
        .eq("status", "published")
        .execute()
    )
    by_id = {row["id"]: row for row in (ex_res.data or [])}
    ordered = [by_id[eid] for eid in exercise_ids if eid in by_id]
    return {**session, "exercises": ordered}


@user_router.post("/sessions/{session_id}/complete")
async def complete_listening_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """Mark a mini-test session complete + compute aggregate score.

    Walks listening_attempts WHERE listening_session_id=session_id AND
    user_id=auth_user. The per-attempt scores are NUMERIC(4,2) ∈ [0,1]
    — band estimate uses simple band-conversion table.
    """
    user = await _require_auth(authorization)
    user_id = user["id"]

    # Verify session exists and is a mini test.
    s_res = (
        supabase_admin.table("listening_sessions")
        .select("id,session_type,total_questions,exercise_ids")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise HTTPException(404, "Listening session not found")
    session = s_res.data[0]

    # Sum attempt scores for this user + session.
    a_res = (
        supabase_admin.table("listening_attempts")
        .select("exercise_id,segment_idx,score,is_correct,created_at")
        .eq("user_id", user_id)
        .eq("listening_session_id", session_id)
        .execute()
    )
    attempts = a_res.data or []
    total = int(session.get("total_questions") or len(session.get("exercise_ids") or []))
    if total == 0:
        raise HTTPException(422, "Session has no questions.")

    # Sprint 11.5.1 hotfix — first-attempt rule: dedupe by (exercise_id,
    # segment_idx) and use ONLY the earliest attempt per key. Retries
    # during the session no longer multiply or distort the canonical
    # band. Matches Sprint 10.3 vocab-cluster precedent.
    first_attempts = _first_attempt_only(attempts)
    correct_count = sum(1 for a in first_attempts if a.get("is_correct"))
    score_avg = (
        sum(float(a.get("score") or 0) for a in first_attempts)
        / max(len(first_attempts), 1)
    )

    # Light band heuristic (IELTS Listening band table is non-linear; this
    # is a learning-coach estimate, not an official scaled score).
    band = _band_from_correct(correct_count, total)

    # Sprint 11.5.1 hotfix Bug C — use a proper Python ISO timestamp
    # instead of the literal string "now()" (which the Supabase REST
    # API does not interpret as a SQL function call). Postgres'
    # timestamptz cast accepts ISO strings.
    from datetime import datetime, timezone
    completed_at_iso = datetime.now(timezone.utc).isoformat()

    try:
        supabase_admin.table("listening_sessions").update({
            "completed_at":   completed_at_iso,
            "correct_count":  correct_count,
            "band_estimate":  band,
        }).eq("id", session_id).execute()
    except Exception as e:
        logger.error("[listening] session complete failed: %s", e)
        raise HTTPException(500, f"Session complete failed: {e}")

    return {
        "ok":            True,
        "session_id":    session_id,
        "correct_count": correct_count,
        "total":         total,
        "score_avg":     round(score_avg, 4),
        "band_estimate": band,
    }


def _first_attempt_only(rows: list[dict]) -> list[dict]:
    """Sprint 11.5.1 hotfix — dedupe a list of listening_attempts rows
    to the canonical first attempt per (exercise_id, segment_idx).

    The first attempt is the row with the earliest `created_at` for each
    tuple. Sprint 10.3's first-attempt rule was previously enforced only
    at insert time (response field `is_first_attempt`) — analytics +
    Mini Test completion previously aggregated ALL attempts, distorting
    canonical scores when users replay. This helper restores truth.

    Rows must have `exercise_id`, `created_at`. `segment_idx` is
    optional — its absence is treated as `None` (single key per
    exercise).
    """
    first_by_key: dict[tuple, dict] = {}
    for r in rows:
        key = (r.get("exercise_id"), r.get("segment_idx"))
        prev = first_by_key.get(key)
        if prev is None or (r.get("created_at") or "") < (prev.get("created_at") or ""):
            first_by_key[key] = r
    return list(first_by_key.values())


def _band_from_correct(correct: int, total: int) -> float:
    """Map correct-count → IELTS-ish band 4-9. Conservative — analytics
    surfaces this as ~band only, not an official prediction. Buckets:
       ≥90% → 8.5, ≥80% → 7.5, ≥70% → 6.5, ≥60% → 6.0, ≥50% → 5.5,
       ≥40% → 5.0, else → 4.5.
    """
    if total <= 0:
        return 0.0
    pct = correct / total
    if pct >= 0.90: return 8.5
    if pct >= 0.80: return 7.5
    if pct >= 0.70: return 6.5
    if pct >= 0.60: return 6.0
    if pct >= 0.50: return 5.5
    if pct >= 0.40: return 5.0
    return 4.5


# ── User route — content browse (Sprint 11.5) ─────────────────────────────────


@user_router.get("/content")
async def list_listening_content(
    accent_tag: str | None = Query(default=None),
    cefr_level: str | None = Query(default=None),
    ielts_section: int | None = Query(default=None, ge=1, le=4),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """List published listening_content for the user browse page.

    Filters: accent_tag, cefr_level, ielts_section. Returns metadata
    only (no signed URL) — user clicks a card to open the dictation/gist
    /tf/mcq page with `?content_id=...`.
    """
    await _require_auth(authorization)

    if accent_tag is not None and accent_tag not in _ACCENT_VALUES:
        raise HTTPException(
            422, f"accent_tag must be one of {sorted(_ACCENT_VALUES)}",
        )
    if cefr_level is not None and cefr_level not in _CEFR_VALUES:
        raise HTTPException(
            422, f"cefr_level must be one of {sorted(_CEFR_VALUES)}",
        )

    q = (
        supabase_admin.table("listening_content")
        .select(
            "id,title,description,accent_tag,cefr_level,ielts_section,"
            "topic_tags,audio_duration_seconds,is_premium,created_at",
            count="exact",
        )
        .eq("status", "published")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if accent_tag:
        q = q.eq("accent_tag", accent_tag)
    if cefr_level:
        q = q.eq("cefr_level", cefr_level)
    if ielts_section is not None:
        q = q.eq("ielts_section", ielts_section)

    res = q.execute()
    return {
        "items":  res.data or [],
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }


# ── User route — analytics (Sprint 11.5) ──────────────────────────────────────


_ANALYTICS_RANGES = {"7d", "30d", "all"}


@user_router.get("/analytics")
async def get_listening_analytics(
    time_range: str = Query(default="30d", alias="range"),
    authorization: str | None = Header(default=None),
):
    """Per-user listening analytics.

    Range buckets (server-side filter to bound payload size + DB scan):
      - 7d:  last 7 days
      - 30d: last 30 days (default)
      - all: all-time

    Aggregations:
      - total_attempts: int
      - by_mode: { dictation, gist, true_false, mcq } → {count, avg_score, accuracy}
      - by_day: last 14 days bar chart data (count + avg_score per day)
      - recent_attempts: last 10 with exercise_type + score + created_at
      - weakest_mode: mode with lowest avg_score (≥3 attempts), else null

    Per CLAUDE.md non-misleading-feedback rule: modes with <3 attempts
    are reported as "insufficient data" rather than fabricating a band.
    """
    user = await _require_auth(authorization)
    user_id = user["id"]

    if time_range not in _ANALYTICS_RANGES:
        raise HTTPException(
            422, f"range must be one of {sorted(_ANALYTICS_RANGES)}",
        )

    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    if time_range == "7d":
        cutoff = now - timedelta(days=7)
    elif time_range == "30d":
        cutoff = now - timedelta(days=30)
    else:
        cutoff = None

    q = (
        supabase_admin.table("listening_attempts")
        .select("id,exercise_id,segment_idx,score,is_correct,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    if cutoff is not None:
        q = q.gte("created_at", cutoff.isoformat())
    res = q.execute()
    attempts_raw = res.data or []

    # Resolve exercise_type via a second query (avoids fragile relational
    # select semantics when the FK exists but PostgREST hasn't refreshed).
    type_by_eid: dict[str, str] = {}
    distinct_eids = sorted({r["exercise_id"] for r in attempts_raw if r.get("exercise_id")})
    if distinct_eids:
        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("id,exercise_type")
            .in_("id", distinct_eids)
            .execute()
        )
        type_by_eid = {
            row["id"]: row["exercise_type"]
            for row in (ex_res.data or [])
        }

    flat: list[dict] = []
    for r in attempts_raw:
        flat.append({
            "id":            r["id"],
            "exercise_id":   r["exercise_id"],
            "segment_idx":   r.get("segment_idx"),
            "score":         float(r.get("score") or 0),
            "is_correct":    bool(r.get("is_correct")),
            "created_at":    r["created_at"],
            "exercise_type": type_by_eid.get(r["exercise_id"], "unknown"),
        })

    # Sprint 11.5.1 hotfix — first-attempt rule for accuracy metrics:
    # `avg_score`, `accuracy`, and `weakest_mode` use first-attempt rows
    # only (one row per (exercise_id, segment_idx)). `total_attempts`
    # remains a count of ALL attempts (engagement signal — re-listens
    # count). `by_day` also uses all rows so the bar chart reflects
    # daily activity, not unique-exercise completion.
    flat_first = _first_attempt_only(flat)

    modes = ("dictation", "gist", "true_false", "mcq")
    by_mode: dict[str, dict] = {}
    for m in modes:
        rows_m = [r for r in flat_first if r["exercise_type"] == m]
        n = len(rows_m)
        if n == 0:
            by_mode[m] = {"count": 0, "avg_score": None, "accuracy": None}
            continue
        avg = sum(r["score"] for r in rows_m) / n
        acc = sum(1 for r in rows_m if r["is_correct"]) / n
        by_mode[m] = {
            "count":     n,
            "avg_score": round(avg, 4),
            "accuracy":  round(acc, 4),
        }

    # Weakest mode (lowest avg_score) — only count modes with ≥3 attempts
    # so we don't misrepresent thin slices as weaknesses. Uses
    # first-attempt rows only (consistent with the rest of by_mode).
    candidates = [
        (m, by_mode[m]["avg_score"])
        for m in modes
        if by_mode[m]["count"] >= 3 and by_mode[m]["avg_score"] is not None
    ]
    weakest_mode = min(candidates, key=lambda t: t[1])[0] if candidates else None

    # by_day — bin scores into last 14 calendar days (UTC).
    by_day: list[dict] = []
    for day_offset in range(14):
        day_start = (now - timedelta(days=day_offset)).replace(
            hour=0, minute=0, second=0, microsecond=0,
        )
        day_end = day_start + timedelta(days=1)
        day_start_iso = day_start.isoformat()
        day_end_iso = day_end.isoformat()
        day_rows = [
            r for r in flat
            if day_start_iso <= r["created_at"] < day_end_iso
        ]
        n = len(day_rows)
        avg = (sum(r["score"] for r in day_rows) / n) if n else None
        by_day.append({
            "date":      day_start.date().isoformat(),
            "count":     n,
            "avg_score": round(avg, 4) if avg is not None else None,
        })
    by_day.reverse()  # oldest first for chart rendering

    recent = flat[:10]

    return {
        "range":           time_range,
        "total_attempts":  len(flat),
        "by_mode":         by_mode,
        "by_day":          by_day,
        "recent_attempts": recent,
        "weakest_mode":    weakest_mode,
    }


# ── Sprint 13.4 — Cambridge IELTS test bundle (listening_tests) ──────────────


_TEST_STATUS_VALUES = {"draft", "published", "archived"}
# Sprint 13.4.2 — markdown parser ships with a tighter 1 MB cap per file
# (markdown is text-only; Pilot 01 is ~30KB so 1MB is generous).
_CONVERT_MAX_DOCX_BYTES = 1 * 1024 * 1024
_CONVERT_ALLOWED_EXTENSIONS = (".md", ".markdown")


class ListeningTestPatchRequest(BaseModel):
    """PATCH /admin/listening/tests/{id} body — Sprint 13.4.

    Allow-list (all optional, partial-update friendly):
      test_id, title, version, band_target, accent_profile, themes.
    """
    model_config = ConfigDict(extra="forbid")

    test_id:        Optional[str]              = None
    title:          Optional[str]              = None
    version:        Optional[str]              = None
    band_target:    Optional[float]            = None
    accent_profile: Optional[list[str]]        = None
    themes:         Optional[dict[str, str]]   = None


class ListeningTestStatusPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str


class ConvertCommitRequest(BaseModel):
    """POST /admin/listening/convert/commit body.

    Carries the parsed-result envelope the dry-run returned, so the admin
    can review + tweak before persisting. The server re-validates shape
    (it does NOT trust the client to send arbitrary section payloads).
    """
    model_config = ConfigDict(extra="allow")

    test_metadata: dict
    sections:      list[dict]


@admin_router.get("/tests")
async def admin_list_listening_tests(
    status: str = Query(default="all"),
    search: str = Query(default=""),
    limit: int  = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Paginated list of Cambridge test bundles for the admin browser.

    status defaults to 'all'. ``search`` is a substring match against
    ``test_id`` (case-insensitive ilike). Each row carries a synthetic
    ``audio_ready_count`` — how many of the 4 section rows already have
    audio_storage_path set (powers the "X/4 sections có audio" column).
    """
    await require_admin(authorization)

    if status != "all" and status not in _TEST_STATUS_VALUES:
        raise HTTPException(
            422,
            f"status must be one of {sorted(_TEST_STATUS_VALUES | {'all'})}",
        )

    q = (
        supabase_admin.table("listening_tests")
        .select("*", count="exact")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if status != "all":
        q = q.eq("status", status)
    if search.strip():
        q = q.ilike("test_id", f"%{search.strip()}%")

    res = q.execute()
    items = res.data or []

    # Annotate each test with audio-readiness counts. One round-trip per
    # response (admin lists are page-sized, so this is fine for now).
    test_ids = [t["id"] for t in items]
    audio_counts: dict[str, int] = {}
    section_counts: dict[str, int] = {}
    if test_ids:
        sections = (
            supabase_admin.table("listening_content")
            .select("test_id,audio_storage_path")
            .in_("test_id", test_ids)
            .execute()
        )
        for row in sections.data or []:
            tid = row.get("test_id")
            if not tid:
                continue
            section_counts[tid] = section_counts.get(tid, 0) + 1
            if row.get("audio_storage_path"):
                audio_counts[tid] = audio_counts.get(tid, 0) + 1

    for item in items:
        item["section_count"]      = section_counts.get(item["id"], 0)
        item["audio_ready_count"]  = audio_counts.get(item["id"], 0)

    return {
        "items":  items,
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }


@admin_router.get("/tests/{test_id}")
async def admin_get_listening_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Single test detail — bundles the 4 section content_ids +
    per-section exercise counts so the admin tests-detail page (Sprint
    13.5) can render without N+1 lookups.
    """
    await require_admin(authorization)

    res = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Test bundle not found")
    test = res.data[0]

    sections_res = (
        supabase_admin.table("listening_content")
        .select("id,section_num,title,status,audio_storage_path,transcript")
        .eq("test_id", test_id)
        .order("section_num")
        .execute()
    )
    sections = sections_res.data or []
    content_ids = [s["id"] for s in sections]

    exercise_counts: dict[str, int] = {}
    if content_ids:
        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("content_id")
            .in_("content_id", content_ids)
            .execute()
        )
        for row in ex_res.data or []:
            cid = row["content_id"]
            exercise_counts[cid] = exercise_counts.get(cid, 0) + 1

    for s in sections:
        s["exercise_count"] = exercise_counts.get(s["id"], 0)
        s["audio_ready"] = bool(s.get("audio_storage_path"))

    # Sprint 13.5.6 — surface plan-label exercises so the admin
    # tests-detail page can show a "Hình map" panel per exercise
    # without a second round-trip. We deliberately strip the answers
    # field at this admin surface as well — admins manage answer keys
    # through the existing convert/commit flow, not this endpoint.
    plan_label_exercises: list[dict] = []
    if content_ids:
        pl_res = (
            supabase_admin.table("listening_exercises")
            .select("id,content_id,payload")
            .in_("content_id", content_ids)
            .execute()
        )
        section_num_by_id = {s["id"]: s.get("section_num") for s in sections}
        for row in pl_res.data or []:
            payload = row.get("payload") or {}
            if payload.get("variant") != "mcq_letter_label":
                continue
            metadata = payload.get("metadata") or {}
            plan_label_exercises.append({
                "id":               row["id"],
                "content_id":       row["content_id"],
                "section_num":      section_num_by_id.get(row["content_id"]),
                "map_description":  metadata.get("map_description")
                                    or payload.get("map_description")
                                    or "",
                "letter_options":   metadata.get("letter_options")
                                    or payload.get("letter_options")
                                    or list("ABCDEFGH"),
                # Sprint 13.5.9 — surface the curated prompt (when the
                # parser found one) + the source used by the most recent
                # successful generation so the admin UI can show
                # "custom" vs "template" without a second round-trip.
                "map_image_custom_prompt": (
                    metadata.get("map_image_custom_prompt")
                    or payload.get("map_image_custom_prompt")
                    or None
                ),
                "map_image_prompt_source": payload.get("map_image_prompt_source"),
                "has_map_image":    bool(payload.get("map_image_storage_path")),
                "map_image_model":  payload.get("map_image_model"),
                "map_image_generated_at": payload.get("map_image_generated_at"),
                # Sprint 13.5.9.3 — provenance flag so the admin panel
                # can render a "Manual upload" vs "API: <model>" badge
                # without inferring from null fields.
                "map_image_source": payload.get("map_image_source")
                                    or ("api_generation" if payload.get("map_image_model") else None),
            })

    test["sections"] = sections
    test["content_ids"] = content_ids
    test["plan_label_exercises"] = plan_label_exercises
    return test


@admin_router.patch("/tests/{test_id}")
async def admin_patch_listening_test(
    test_id: str,
    body: ListeningTestPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Update editable metadata fields on a listening_tests row.

    Allow-list: test_id, title, version, band_target, accent_profile,
    themes. Only keys present in the request body land in the UPDATE.
    """
    await require_admin(authorization)

    existing = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Test bundle not found")
    current = existing.data[0]

    update: dict = {}

    if body.test_id is not None:
        new_id = body.test_id.strip()
        if not new_id:
            raise HTTPException(422, "test_id must not be empty")
        if new_id != current.get("test_id"):
            # UNIQUE — surface 422 before Supabase rejects with 23505.
            dup = (
                supabase_admin.table("listening_tests")
                .select("id")
                .eq("test_id", new_id)
                .limit(1)
                .execute()
            )
            if dup.data:
                raise HTTPException(422, f"Test ID '{new_id}' đã tồn tại.")
        update["test_id"] = new_id

    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(422, "title must not be empty")
        update["title"] = title

    if body.version is not None:
        update["version"] = body.version.strip() or "1.0"

    if body.band_target is not None:
        if not (1.0 <= body.band_target <= 9.0):
            raise HTTPException(422, "band_target must be in [1.0, 9.0]")
        update["band_target"] = body.band_target

    if body.accent_profile is not None:
        update["accent_profile"] = [
            str(a).strip() for a in body.accent_profile if str(a).strip()
        ]

    if body.themes is not None:
        update["themes"] = {
            str(k): str(v) for k, v in body.themes.items()
        }

    if not update:
        return current

    res = (
        supabase_admin.table("listening_tests")
        .update(update)
        .eq("id", test_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else {**current, **update}


@admin_router.patch("/tests/{test_id}/status")
async def admin_patch_listening_test_status(
    test_id: str,
    body: ListeningTestStatusPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Transition a listening_tests row between draft / published /
    archived.

    Sprint 13.4.3 — transitions to 'published' enforce the audio gate
    via ``listening_audio.can_publish``: at least one of
    ``full_audio_storage_path`` (mode=full_premixed) or
    ``assembled_audio_storage_path`` (mode=parts_auto_assembled) must
    be populated. Mode 'parts_only' is always blocked from publish.
    """
    from services import listening_audio                                  # local import

    await require_admin(authorization)

    new_status = body.status.strip().lower()
    if new_status not in _TEST_STATUS_VALUES:
        raise HTTPException(
            422, f"status must be one of {sorted(_TEST_STATUS_VALUES)}",
        )

    existing = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Test bundle not found")
    current = existing.data[0]

    # Sprint 13.4.3 publish gate.
    if new_status == "published":
        allowed, reason = listening_audio.can_publish(current)
        if not allowed:
            raise HTTPException(422, reason or "Không thể publish — kiểm tra audio.")

    res = (
        supabase_admin.table("listening_tests")
        .update({"status": new_status})
        .eq("id", test_id)
        .execute()
    )
    rows = res.data or []
    if rows:
        return rows[0]
    return {"id": test_id, "status": new_status}


@admin_router.delete("/tests/{test_id}")
async def admin_delete_listening_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Soft-delete a Cambridge test bundle.

    Sprint 13.4 lock: cascade — flips the test + all its section rows to
    status='archived'. ON DELETE CASCADE in migration 066 is a safety net
    for ops-level hard deletes; the endpoint itself never hard-deletes.
    """
    await require_admin(authorization)

    existing = (
        supabase_admin.table("listening_tests")
        .select("id")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Test bundle not found")

    # Archive the parent.
    (
        supabase_admin.table("listening_tests")
        .update({"status": "archived"})
        .eq("id", test_id)
        .execute()
    )
    # Cascade archive the section rows so they drop out of admin views.
    (
        supabase_admin.table("listening_content")
        .update({"status": "archived"})
        .eq("test_id", test_id)
        .execute()
    )
    return {"id": test_id, "status": "archived"}


@admin_router.delete("/tests/{test_id}/hard")
async def admin_hard_delete_listening_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.4 — permanently delete a Cambridge test bundle.

    Cascades through FK ON DELETE CASCADE chains:
      * listening_tests (the row itself)
      * listening_content (FK test_id → tests.id ON DELETE CASCADE)
      * listening_exercises (FK content_id → content.id ON DELETE CASCADE)
      * listening_test_attempts (FK test_id → tests.id ON DELETE CASCADE)

    Also performs best-effort cleanup of storage objects so audio files
    don't orphan in the bucket:
      * tests.full_audio_storage_path
      * tests.assembled_audio_storage_path
      * each section's content.audio_storage_path

    Storage failures are logged but never block the DB delete — orphans
    are a low-impact issue compared to leaving the row.

    Distinct from the soft-delete (PATCH status='archived') endpoint
    which preserves attempt history for analytics/compliance. Use the
    hard delete only when historical retention is no longer needed.
    """
    await require_admin(authorization)

    test_row = (
        supabase_admin.table("listening_tests")
        .select("id,test_id,full_audio_storage_path,assembled_audio_storage_path")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not test_row.data:
        raise HTTPException(404, "Test bundle not found")
    test = test_row.data[0]

    content_rows = (
        supabase_admin.table("listening_content")
        .select("id,audio_storage_path")
        .eq("test_id", test_id)
        .execute()
    )
    content_paths = [
        c.get("audio_storage_path")
        for c in (content_rows.data or [])
        if c.get("audio_storage_path")
    ]

    storage_paths = [
        p for p in (
            test.get("full_audio_storage_path"),
            test.get("assembled_audio_storage_path"),
            *content_paths,
        ) if p
    ]
    storage_removed = 0
    storage_failed: list[str] = []
    for path in storage_paths:
        try:
            supabase_admin.storage.from_(
                settings.LISTENING_AUDIO_BUCKET,
            ).remove([path])
            storage_removed += 1
        except Exception as exc:                                          # pragma: no cover
            logger.warning(
                "[listening] hard-delete storage cleanup failed for %s: %s",
                path, exc,
            )
            storage_failed.append(path)

    # Count cascade targets BEFORE the delete so the response is
    # auditable (after the delete the rows are gone).
    exercise_count = 0
    if content_rows.data:
        ex_count_res = (
            supabase_admin.table("listening_exercises")
            .select("id", count="exact")
            .in_("content_id", [c["id"] for c in content_rows.data])
            .execute()
        )
        exercise_count = ex_count_res.count or len(ex_count_res.data or [])
    attempt_count_res = (
        supabase_admin.table("listening_test_attempts")
        .select("id", count="exact")
        .eq("test_id", test_id)
        .execute()
    )
    attempt_count = attempt_count_res.count or len(attempt_count_res.data or [])

    (
        supabase_admin.table("listening_tests")
        .delete()
        .eq("id", test_id)
        .execute()
    )

    return {
        "deleted":          True,
        "id":               test_id,
        "test_id":          test.get("test_id"),
        "cascade_count": {
            "content":      len(content_rows.data or []),
            "exercises":    exercise_count,
            "attempts":     attempt_count,
            "storage_files_removed": storage_removed,
            "storage_files_failed":  storage_failed,
        },
    }


# ── Sprint 13.4 — Convert DOCX → test bundle ─────────────────────────────────


def _read_markdown_upload(upload: UploadFile, label: str) -> bytes:
    """Sprint 13.4.2 — accept .md/.markdown text bundles (was .docx in 13.4)."""
    name = (upload.filename or "").lower()
    if not name.endswith(_CONVERT_ALLOWED_EXTENSIONS):
        raise HTTPException(
            422,
            f"{label} phải là file .md hoặc .markdown (nhận: {upload.filename!r})",
        )
    data = upload.file.read()
    if len(data) == 0:
        raise HTTPException(422, f"{label} rỗng — không đọc được nội dung.")
    if len(data) > _CONVERT_MAX_DOCX_BYTES:
        raise HTTPException(
            422,
            f"{label} vượt 1 MB ({len(data) // 1024} KB).",
        )
    return data


# listening-fulltest-md-import (Phase A) — JSON sidecar (timings.json) reader.
_FULLTEST_MAX_TEXT_BYTES = 2 * 1024 * 1024   # Solution.md can run ~200KB+; allow headroom


def _read_json_upload(upload: UploadFile, label: str) -> dict:
    import json as _json
    name = (upload.filename or "").lower()
    if not name.endswith(".json"):
        raise HTTPException(422, f"{label} phải là file .json (nhận: {upload.filename!r})")
    data = upload.file.read()
    if not data:
        raise HTTPException(422, f"{label} rỗng — không đọc được nội dung.")
    if len(data) > _FULLTEST_MAX_TEXT_BYTES:
        raise HTTPException(422, f"{label} quá lớn ({len(data) // 1024} KB).")
    try:
        return _json.loads(data.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(422, f"{label} không phải JSON hợp lệ: {exc}") from exc


def _read_text_upload(upload: UploadFile, label: str, *, exts: tuple) -> bytes:
    """Like _read_markdown_upload but with a higher size cap (Solution.md is
    large) + caller-chosen extensions."""
    name = (upload.filename or "").lower()
    if not name.endswith(exts):
        raise HTTPException(422, f"{label} phải là file {' / '.join(exts)} (nhận: {upload.filename!r})")
    data = upload.file.read()
    if not data:
        raise HTTPException(422, f"{label} rỗng — không đọc được nội dung.")
    if len(data) > _FULLTEST_MAX_TEXT_BYTES:
        raise HTTPException(422, f"{label} quá lớn ({len(data) // 1024} KB).")
    return data


@admin_router.post("/convert")
async def admin_convert_listening_dry_run(
    question_paper:    UploadFile = File(...),
    script_answerkey:  UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Dry-run parse of a 2-file Cambridge IELTS DOCX bundle.

    Returns the structured preview (test metadata + 4 sections +
    warnings/errors). No DB writes. The admin reviews the preview, then
    POSTs the same envelope to ``/convert/commit`` to persist.
    """
    await require_admin(authorization)

    qp_bytes = _read_markdown_upload(question_paper,   "Question Paper")
    sa_bytes = _read_markdown_upload(script_answerkey, "Script+AnswerKey")

    try:
        result = listening_convert.parse_listening_test(qp_bytes, sa_bytes)
    except Exception as exc:
        logger.exception("Convert dry-run failed")
        raise HTTPException(422, f"Lỗi khi phân tích markdown: {exc}") from exc

    # Surface duplicate test_id here so the UI can switch to an "update
    # existing" flow without a second round-trip.
    # Sprint 13.5.4: only ACTIVE rows (draft / published) block a
    # re-import. Archived rows are kept for audit + attempt history
    # and are explicitly allowed to share a test_id with the new draft.
    test_id_external = (result.get("test_metadata") or {}).get("test_id")
    if test_id_external:
        dup = (
            supabase_admin.table("listening_tests")
            .select("id,status")
            .eq("test_id", test_id_external)
            .neq("status", "archived")
            .limit(1)
            .execute()
        )
        if dup.data:
            result.setdefault("warnings", []).append(
                f"Test ID '{test_id_external}' đang ACTIVE trong DB "
                f"(status={dup.data[0].get('status')}). Lựa chọn: "
                f"(1) Archive test cũ → re-import sẽ tạo version mới, "
                f"(2) Hard delete test cũ qua Vùng nguy hiểm, hoặc "
                f"(3) Đổi test_id trong markdown metadata."
            )
            result["duplicate_test_id"] = True

    return result


@admin_router.post("/import-fulltest")
async def admin_import_fulltest_dry_run(
    question_paper: UploadFile = File(...),
    solution:       UploadFile = File(...),
    timings:        UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """listening-fulltest-md-import (Phase A) — ADDITIVE dry-run parse of the
    full-test pack (Question_Paper.md + Solution.md + timings.json; the audio
    mp3 is uploaded at commit). The legacy 2-file ``/convert`` flow is
    untouched. Returns the merged 40-question preview + FAIL-LOUD validation
    (every missing answer / missing audio window / audio↔timings divergence is
    an explicit error). No DB writes — the admin reviews, then commits (A2)."""
    await require_admin(authorization)

    qp_bytes  = _read_text_upload(question_paper, "Question Paper", exts=(".md", ".markdown"))
    sol_bytes = _read_text_upload(solution,       "Solution",       exts=(".md", ".markdown"))
    timings_dict = _read_json_upload(timings, "timings.json")

    try:
        result = listening_fulltest_import.parse_fulltest(
            qp_bytes.decode("utf-8"), sol_bytes.decode("utf-8"), timings_dict,
        )
    except Exception as exc:
        logger.exception("Full-test import dry-run failed")
        raise HTTPException(422, f"Lỗi khi phân tích full-test pack: {exc}") from exc

    preview = result.as_preview()

    # Surface a duplicate ACTIVE test_id (same convention as /convert).
    test_id_external = (result.metadata or {}).get("test_id")
    if test_id_external:
        dup = (
            supabase_admin.table("listening_tests")
            .select("id,status").eq("test_id", test_id_external)
            .neq("status", "archived").limit(1).execute()
        )
        if dup.data:
            preview.setdefault("warnings", []).append(
                f"Test ID '{test_id_external}' đang ACTIVE (status={dup.data[0].get('status')}) "
                f"— archive bản cũ trước khi import lại, hoặc đổi test_id.")
            preview["duplicate_test_id"] = True

    return preview


_FULLTEST_MAX_AUDIO_BYTES = 60 * 1024 * 1024   # 60MB headroom over the ~26MB pack


@admin_router.post("/import-fulltest/commit")
async def admin_import_fulltest_commit(
    question_paper: UploadFile = File(...),
    solution:       UploadFile = File(...),
    timings:        UploadFile = File(...),
    audio:          UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """listening-fulltest-md-import (Phase A2) — persist a full-test pack +
    its premixed audio. RE-PARSES the 3 text files (authoritative, never trusts
    client-sent parsed data) → fail-loud 422 on any validation error → uploads
    the mp3 to the listening-audio bucket → writes 1 listening_tests
    (full_premixed) + 4 listening_content + block-shaped listening_exercises
    (payload enriched with per-question audio_windows + solutions). The rows are
    the SAME shape the existing player + grader + attempt flow consume, so an
    imported test is takeable / gradeable / reviewable with no other changes.
    No migration (Pattern #15). The legacy 2-file /convert flow is untouched."""
    from services import listening_audio

    await require_admin(authorization)

    qp_bytes  = _read_text_upload(question_paper, "Question Paper", exts=(".md", ".markdown"))
    sol_bytes = _read_text_upload(solution,       "Solution",       exts=(".md", ".markdown"))
    timings_dict = _read_json_upload(timings, "timings.json")

    audio_name = (audio.filename or "").lower()
    if not audio_name.endswith(".mp3"):
        raise HTTPException(422, f"Audio phải là .mp3 (nhận: {audio.filename!r})")
    audio_bytes = audio.file.read()
    if len(audio_bytes) > _FULLTEST_MAX_AUDIO_BYTES:
        raise HTTPException(422, f"Audio quá lớn ({len(audio_bytes)//(1024*1024)} MB > 60 MB).")

    # Parse + FAIL-LOUD validation (the accuracy gate).
    try:
        res = listening_fulltest_import.parse_fulltest(
            qp_bytes.decode("utf-8"), sol_bytes.decode("utf-8"), timings_dict)
    except Exception as exc:
        logger.exception("Full-test commit parse failed")
        raise HTTPException(422, f"Lỗi khi phân tích full-test pack: {exc}") from exc
    if not res.ok:
        raise HTTPException(422, {"message": "Pack không hợp lệ — sửa rồi import lại.",
                                  "errors": res.errors, "warnings": res.warnings})

    test_id_external = (res.metadata or {}).get("test_id")
    if not test_id_external:
        raise HTTPException(422, "Thiếu test_id (heading H1 của Question Paper).")

    # Validate the audio (size/duration) the same way the full-audio upload does.
    av = listening_audio.validate_full_audio(audio_bytes)
    if av["errors"]:
        raise HTTPException(422, "; ".join(av["errors"]))

    # Duplicate ACTIVE test_id guard (archived rows are fine — convert parity).
    dup = (
        supabase_admin.table("listening_tests")
        .select("id,status").eq("test_id", test_id_external)
        .neq("status", "archived").limit(1).execute()
    )
    if dup.data:
        raise HTTPException(
            422, f"Test ID '{test_id_external}' đang ACTIVE (status={dup.data[0].get('status')}) "
                 f"— archive bản cũ rồi import lại, hoặc đổi test_id.")

    test_uuid = str(uuid.uuid4())
    offsets = res.metadata.get("section_offsets") or {}

    # 1) listening_tests row (full_premixed; audio path set after upload).
    storage_path = f"tests/{test_uuid}/full.mp3"
    test_payload = {
        "id":                          test_uuid,
        "test_id":                     test_id_external,
        "title":                       res.metadata.get("title") or test_id_external,
        "version":                     res.metadata.get("format_version") or "1.0",
        "band_target":                 res.metadata.get("band_target"),
        "accent_profile":              list(res.metadata.get("accent_profile") or []),
        "themes":                      dict(res.metadata.get("topic_distribution") or {}),
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": av["duration_seconds"],
        "full_audio_size_bytes":       av["size_bytes"],
        "cue_points":                  listening_fulltest_import.build_cue_points(offsets),
        "audio_assembly_mode":         "full_premixed",
        "metadata": {
            "source_format":   "listening-fulltest-v1.1",
            "section_offsets": offsets,
            "band_conversion": res.metadata.get("band_conversion") or [],
        },
        "status":                      "draft",
    }
    try:
        supabase_admin.table("listening_tests").insert(test_payload).execute()
    except Exception as exc:
        logger.exception("INSERT listening_tests (fulltest) failed")
        raise HTTPException(422, f"Lỗi khi tạo test row: {exc}") from exc

    # 2) upload the premixed mp3 (upsert; clean 503 if bucket missing).
    try:
        _upload_audio_to_bucket(storage_path, audio_bytes)
    except HTTPException:
        # roll back the test row so a failed upload doesn't leave an orphan.
        supabase_admin.table("listening_tests").delete().eq("id", test_uuid).execute()
        raise

    # 3) per-section content + block-shaped (enriched) exercises.
    sections = listening_fulltest_import.build_section_persistence(res, qp_bytes.decode("utf-8"))
    sections_created = 0
    exercises_created = 0
    failed_sections: list[dict] = []
    failed_exercises: list[dict] = []
    for sec in sections:
        content_row = dict(sec["content_row"])
        content_row["id"] = str(uuid.uuid4())
        content_row["test_id"] = test_uuid
        try:
            supabase_admin.table("listening_content").insert(content_row).execute()
            sections_created += 1
        except Exception as exc:
            logger.exception("INSERT listening_content (fulltest) failed s=%s", sec["section_num"])
            failed_sections.append({"section_num": sec["section_num"], "error": str(exc)})
            continue
        for ex in sec["exercise_rows"]:
            try:
                supabase_admin.table("listening_exercises").insert({
                    "id":            str(uuid.uuid4()),
                    "content_id":    content_row["id"],
                    "exercise_type": ex.get("exercise_type", "dictation"),
                    "payload":       ex.get("payload", {}),
                    "order_num":     ex.get("order_num", 1),
                    "cefr_level":    content_row.get("cefr_level"),
                    "status":        "draft",
                }).execute()
                exercises_created += 1
            except Exception as exc:
                logger.exception("INSERT listening_exercises (fulltest) failed")
                failed_exercises.append({"section_num": sec["section_num"],
                                         "order_num": ex.get("order_num"), "error": str(exc)})

    return {
        "id":                test_uuid,
        "test_id":           test_id_external,
        "status":            "draft",
        "sections_created":  sections_created,
        "exercises_created": exercises_created,
        "failed_sections":   failed_sections,
        "failed_exercises":  failed_exercises,
        "audio": {"storage_path": storage_path,
                  "duration_seconds": av["duration_seconds"],
                  "size_bytes": av["size_bytes"]},
        "warnings":          res.warnings,
        "next_step":         "Mở /admin/listening/tests → kiểm tra → đặt status='published' để mở cho học sinh.",
    }


@admin_router.post("/convert/commit")
async def admin_convert_listening_commit(
    body: ConvertCommitRequest,
    authorization: str | None = Header(default=None),
):
    """Persist a parsed test bundle: 1 listening_tests row + 4
    listening_content rows + N listening_exercises rows.

    Partial-failure semantics (Sprint 13.2 pattern):
      * The listening_tests row is created first; if that fails the
        whole call returns 422.
      * Each of the 4 section INSERTs is independent — a failure on
        section 2 still commits sections 1/3/4 and returns the failure
        in ``failed_sections``.
      * Each exercise INSERT is independent — failure recorded in
        ``failed_exercises`` but the response is still 200.
    """
    await require_admin(authorization)

    metadata = body.test_metadata or {}
    test_id_external = (metadata.get("test_id") or "").strip()
    if not test_id_external:
        raise HTTPException(422, "test_metadata.test_id thiếu — không thể commit.")
    if not body.sections:
        raise HTTPException(422, "sections rỗng — không có section nào để tạo.")

    # Duplicate guard (also enforced by the partial UNIQUE index — see
    # migration 069 — surface a clean VN message instead of letting
    # postgres bubble 23505). Sprint 13.5.4: only ACTIVE rows block; an
    # archived row with the same test_id is fine and stays put.
    dup = (
        supabase_admin.table("listening_tests")
        .select("id,status")
        .eq("test_id", test_id_external)
        .neq("status", "archived")
        .limit(1)
        .execute()
    )
    if dup.data:
        raise HTTPException(
            422,
            f"Test ID '{test_id_external}' đang ACTIVE (status="
            f"{dup.data[0].get('status')}) — không thể commit. "
            f"Archive test cũ qua Vùng nguy hiểm rồi import lại, "
            f"hoặc đổi test_id.",
        )

    test_uuid = str(uuid.uuid4())
    accent_profile = metadata.get("accent_profile") or []
    themes = metadata.get("themes") or {}

    test_payload = {
        "id":                      test_uuid,
        "test_id":                 test_id_external,
        "title":                   metadata.get("title") or test_id_external,
        "version":                 (metadata.get("version") or "1.0"),
        "band_target":             metadata.get("band_target"),
        "accent_profile":          list(accent_profile),
        "themes":                  dict(themes),
        "total_transcript_words":  metadata.get("total_words"),
        "metadata":                {
            "source_format":     metadata.get("source_format") or "cambridge_ielts_docx",
            "created_at_source": metadata.get("created_at_source"),
        },
        "status":                  "draft",
    }

    try:
        (
            supabase_admin.table("listening_tests")
            .insert(test_payload)
            .execute()
        )
    except Exception as exc:
        logger.exception("INSERT listening_tests failed")
        raise HTTPException(422, f"Lỗi khi tạo test row: {exc}") from exc

    content_ids: list[str] = []
    failed_sections: list[dict] = []
    exercises_created = 0
    failed_exercises: list[dict] = []

    for section in body.sections:
        section_num = section.get("section_num")
        try:
            content_payload = listening_convert.section_to_content_payload(
                section, test_uuid, metadata,
            )
            content_payload["id"] = str(uuid.uuid4())
            (
                supabase_admin.table("listening_content")
                .insert(content_payload)
                .execute()
            )
            content_ids.append(content_payload["id"])
        except Exception as exc:                     # one section fails — others continue
            logger.exception("INSERT listening_content failed section=%s", section_num)
            failed_sections.append({
                "section_num": section_num,
                "error":       str(exc),
            })
            continue

        # Exercises (best-effort per row).
        for exercise in section.get("exercises", []):
            try:
                ex_payload = {
                    "id":            str(uuid.uuid4()),
                    "content_id":    content_payload["id"],
                    "exercise_type": exercise.get("exercise_type", "dictation"),
                    "payload":       exercise.get("payload", {}),
                    "order_num":     exercise.get("order_num", 1),
                    "cefr_level":    content_payload.get("cefr_level"),
                    "status":        "draft",
                }
                (
                    supabase_admin.table("listening_exercises")
                    .insert(ex_payload)
                    .execute()
                )
                exercises_created += 1
            except Exception as exc:
                logger.exception(
                    "INSERT listening_exercises failed section=%s order=%s",
                    section_num, exercise.get("order_num"),
                )
                failed_exercises.append({
                    "section_num": section_num,
                    "order_num":   exercise.get("order_num"),
                    "error":       str(exc),
                })

    return {
        "test_id":           test_uuid,
        "test_id_external":  test_id_external,
        "content_ids":       content_ids,
        "exercises_created": exercises_created,
        "failed_sections":   failed_sections,
        "failed_exercises":  failed_exercises,
    }


# ── Sprint 13.4.3 — test bundle audio upload + assembly ─────────────────────


_AUDIO_ASSEMBLY_MODES = {"full_premixed", "parts_auto_assembled", "parts_only"}


class TestAudioModePatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: str


class TestAudioAssembleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    narrator_voice_id: Optional[str] = None
    narrator_model:    Optional[str] = None


def _fetch_test_or_404(test_id: str) -> dict:
    res = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Test bundle not found")
    return res.data[0]


def _upload_audio_to_bucket(storage_path: str, mp3_bytes: bytes) -> None:
    """Wrapper around the Supabase Storage upload that surfaces a clean
    503 when the bucket is missing (mirrors Sprint 13.2 + 13.3 helpers).
    """
    try:
        supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).upload(
            storage_path,
            mp3_bytes,
            {"content-type": "audio/mpeg", "x-upsert": "true"},
        )
    except Exception as exc:
        msg = str(exc).lower()
        if "not found" in msg or "bucket" in msg:
            logger.error(
                "[listening] storage bucket '%s' missing on audio upload",
                settings.LISTENING_AUDIO_BUCKET,
            )
            raise HTTPException(503, "Listening audio storage not configured.")
        # Some clients return 409 / 'duplicate' on re-upload — re-raise.
        raise HTTPException(500, f"Storage upload failed: {exc}") from exc


@admin_router.post("/tests/{test_id}/audio/full")
async def admin_upload_test_full_audio(
    test_id: str,
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Upload an Andy-pre-mixed 30-min audio for a Cambridge test bundle.

    Sets ``listening_tests.full_audio_*`` columns + auto-sets
    ``audio_assembly_mode='full_premixed'`` when previously NULL.
    """
    from services import listening_audio

    await require_admin(authorization)
    test = _fetch_test_or_404(test_id)

    name = (audio.filename or "").lower()
    if not name.endswith(".mp3"):
        raise HTTPException(422, f"Audio phải là .mp3 (nhận: {audio.filename!r})")
    data = audio.file.read()

    result = listening_audio.validate_full_audio(data)
    if result["errors"]:
        raise HTTPException(422, "; ".join(result["errors"]))

    storage_path = f"tests/{test_id}/full.mp3"
    _upload_audio_to_bucket(storage_path, data)

    update: dict = {
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": result["duration_seconds"],
        "full_audio_size_bytes":       result["size_bytes"],
    }
    if not test.get("audio_assembly_mode"):
        update["audio_assembly_mode"] = "full_premixed"

    (
        supabase_admin.table("listening_tests")
        .update(update)
        .eq("id", test_id)
        .execute()
    )

    signed = None
    try:
        s = supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET) \
            .create_signed_url(storage_path, 3600)
        signed = (s or {}).get("signedURL") or (s or {}).get("signed_url")
    except Exception:                                                       # pragma: no cover
        pass

    return {
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": result["duration_seconds"],
        "full_audio_size_bytes":       result["size_bytes"],
        "audio_assembly_mode":         update.get("audio_assembly_mode")
                                       or test.get("audio_assembly_mode"),
        "signed_url":                  signed,
        "warnings":                    result["warnings"],
    }


@admin_router.post("/tests/{test_id}/audio/section/{section_num}")
async def admin_upload_test_section_audio(
    test_id: str,
    section_num: int,
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Upload a per-section MP3 (3-8 min target) to a Cambridge test.

    Updates the matching ``listening_content`` row's audio_* fields.
    Auto-sets ``listening_tests.audio_assembly_mode='parts_only'`` when
    previously NULL (Andy can promote to ``parts_auto_assembled`` later
    via the mode PATCH).
    """
    from services import listening_audio

    await require_admin(authorization)
    if not (1 <= section_num <= 4):
        raise HTTPException(422, "section_num must be 1-4")
    test = _fetch_test_or_404(test_id)

    name = (audio.filename or "").lower()
    if not name.endswith(".mp3"):
        raise HTTPException(422, f"Audio phải là .mp3 (nhận: {audio.filename!r})")
    data = audio.file.read()

    result = listening_audio.validate_section_audio(data)
    if result["errors"]:
        raise HTTPException(422, "; ".join(result["errors"]))

    # Locate the section content row.
    sec_res = (
        supabase_admin.table("listening_content")
        .select("id")
        .eq("test_id", test_id)
        .eq("section_num", section_num)
        .limit(1)
        .execute()
    )
    if not sec_res.data:
        raise HTTPException(
            404,
            f"Section {section_num} row missing — convert flow may not have "
            f"created it. Re-run convert/commit before uploading.",
        )
    content_id = sec_res.data[0]["id"]

    storage_path = f"tests/{test_id}/section-{section_num}.mp3"
    _upload_audio_to_bucket(storage_path, data)

    (
        supabase_admin.table("listening_content")
        .update({
            "audio_storage_path":     storage_path,
            "audio_duration_seconds": result["duration_seconds"],
            "audio_size_bytes":       result["size_bytes"],
        })
        .eq("id", content_id)
        .execute()
    )

    tests_update: dict = {}
    if not test.get("audio_assembly_mode"):
        tests_update["audio_assembly_mode"] = "parts_only"
    # Any section change invalidates the cached assembled audio. We
    # don't delete the file (preserve history) but null the path so the
    # assemble endpoint re-renders on next click.
    if test.get("assembled_audio_storage_path"):
        tests_update["assembled_audio_storage_path"] = None
        tests_update["assembled_audio_generated_at"] = None

    if tests_update:
        (
            supabase_admin.table("listening_tests")
            .update(tests_update)
            .eq("id", test_id)
            .execute()
        )

    return {
        "content_id":             content_id,
        "section_num":            section_num,
        "audio_storage_path":     storage_path,
        "audio_duration_seconds": result["duration_seconds"],
        "audio_size_bytes":       result["size_bytes"],
        "warnings":               result["warnings"],
    }


@admin_router.post("/tests/{test_id}/audio/assemble")
async def admin_assemble_test_audio(
    test_id: str,
    body: TestAudioAssembleRequest = TestAudioAssembleRequest(),
    authorization: str | None = Header(default=None),
):
    """Render narrator intros via ElevenLabs + concatenate the 4 section
    audios + pauses into a single assembled-test MP3.

    Requires:
      * audio_assembly_mode in (NULL, 'parts_only', 'parts_auto_assembled')
      * 4 listening_content rows with audio_storage_path populated
      * ELEVENLABS_API_KEY configured (otherwise 503)
      * ffmpeg installed in the runtime env (otherwise 500)
    """
    from services import listening_audio

    await require_admin(authorization)
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(
            503,
            "Assembly cần ELEVENLABS_API_KEY để render narrator. "
            "Liên hệ ops để cấu hình.",
        )

    test = _fetch_test_or_404(test_id)

    sections_res = (
        supabase_admin.table("listening_content")
        .select("id,section_num,audio_storage_path,metadata,updated_at")
        .eq("test_id", test_id)
        .order("section_num")
        .execute()
    )
    rows = sections_res.data or []
    by_section = {r["section_num"]: r for r in rows}
    missing = [n for n in (1, 2, 3, 4) if not by_section.get(n)
               or not by_section[n].get("audio_storage_path")]
    if missing:
        raise HTTPException(
            422,
            f"Section(s) {missing} chưa có audio — upload tất cả 4 parts "
            f"trước khi assemble.",
        )

    # Idempotency: if assembled is fresher than every section update, skip.
    last_generated = test.get("assembled_audio_generated_at")
    if last_generated and test.get("assembled_audio_storage_path"):
        try:
            max_section_updated = max(r.get("updated_at") or "" for r in rows)
            if max_section_updated and max_section_updated <= last_generated:
                return {
                    "assembled_audio_storage_path": test["assembled_audio_storage_path"],
                    "duration_seconds":             None,
                    "cue_points":                   test.get("cue_points") or [],
                    "narrator_credit_estimate":     0,
                    "cached":                       True,
                }
        except Exception:                                                   # pragma: no cover
            pass

    # Download the 4 section audios from storage.
    section_audios: list[bytes] = []
    narrator_intros: list[Any] = []
    for n in (1, 2, 3, 4):
        row = by_section[n]
        try:
            audio_bytes = supabase_admin.storage \
                .from_(settings.LISTENING_AUDIO_BUCKET) \
                .download(row["audio_storage_path"])
        except Exception as exc:
            raise HTTPException(
                500,
                f"Không tải được section {n} audio: {exc}",
            ) from exc
        section_audios.append(audio_bytes)
        narrator_intros.append((row.get("metadata") or {}).get("narrator_intro"))

    voice_id = (body.narrator_voice_id or listening_audio.DEFAULT_NARRATOR_VOICE).strip()
    model    = (body.narrator_model or listening_audio.DEFAULT_NARRATOR_MODEL).strip()

    try:
        assembly = listening_audio.assemble_test_audio(
            section_audios, narrator_intros,
            narrator_voice_id=voice_id, narrator_model=model,
        )
    except Exception as exc:
        logger.exception("Assembly failed for test %s", test_id)
        raise HTTPException(
            500,
            f"Assembly thất bại: {exc}. Kiểm tra ffmpeg + ElevenLabs quota.",
        ) from exc

    storage_path = f"tests/{test_id}/assembled.mp3"
    _upload_audio_to_bucket(storage_path, assembly.mp3_bytes)

    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()

    (
        supabase_admin.table("listening_tests")
        .update({
            "assembled_audio_storage_path": storage_path,
            "assembled_audio_generated_at": now_iso,
            "cue_points":                   assembly.cue_points,
            "audio_assembly_mode":          "parts_auto_assembled",
        })
        .eq("id", test_id)
        .execute()
    )

    return {
        "assembled_audio_storage_path": storage_path,
        "duration_seconds":             assembly.duration_seconds,
        "cue_points":                   assembly.cue_points,
        "narrator_credit_estimate":     assembly.narrator_credit_estimate,
        "cached":                       False,
    }


@admin_router.patch("/tests/{test_id}/audio/mode")
async def admin_patch_test_audio_mode(
    test_id: str,
    body: TestAudioModePatchRequest,
    authorization: str | None = Header(default=None),
):
    """Switch the audio assembly mode on a Cambridge test bundle.

    Sprint 13.4.3.1 — soft validation. The mode toggle is treated as
    exploratory state during the setup flow; admins may pick a mode
    *before* uploading audio so the corresponding upload UI appears.
    Audio readiness is enforced at publish time via
    ``services.listening_audio.can_publish`` (Sprint 13.4.3).

    Validation here is limited to the enum allow-list. Mode value must
    be one of {full_premixed, parts_auto_assembled, parts_only}.
    """
    await require_admin(authorization)
    mode = (body.mode or "").strip().lower()
    if mode not in _AUDIO_ASSEMBLY_MODES:
        raise HTTPException(
            422, f"mode must be one of {sorted(_AUDIO_ASSEMBLY_MODES)}",
        )

    _fetch_test_or_404(test_id)

    (
        supabase_admin.table("listening_tests")
        .update({"audio_assembly_mode": mode})
        .eq("id", test_id)
        .execute()
    )
    return {"id": test_id, "audio_assembly_mode": mode}


@admin_router.get("/tests/{test_id}/audio/signed-urls")
async def admin_get_test_audio_signed_urls(
    test_id: str,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    authorization: str | None = Header(default=None),
):
    """Sprint 13.4.3.2 — bundle signed URLs for admin preview of a test
    bundle's audio assets.

    Returns ``{full, assembled, sections: [{section_num, signed_url}, ...]}``
    with ``signed_url=None`` for any asset that doesn't exist yet. One
    round-trip per page render — the previous design forced N+1 fetches
    (one per asset) which slowed the tests-detail page on cold load.

    ``expires_in`` is in seconds (default 1h, max 24h).
    """
    await require_admin(authorization)
    test = _fetch_test_or_404(test_id)

    bucket = supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET)

    def _sign(path: str | None) -> str | None:
        if not path:
            return None
        try:
            res = bucket.create_signed_url(path, expires_in)
        except Exception as exc:                                            # pragma: no cover
            logger.warning("[listening] signed URL mint failed for %s: %s", path, exc)
            return None
        return (res or {}).get("signedURL") or (res or {}).get("signed_url")

    sections_res = (
        supabase_admin.table("listening_content")
        .select("section_num,audio_storage_path")
        .eq("test_id", test_id)
        .order("section_num")
        .execute()
    )
    section_signed = []
    for n in (1, 2, 3, 4):
        row = next(
            (r for r in (sections_res.data or []) if r.get("section_num") == n),
            None,
        )
        section_signed.append({
            "section_num":         n,
            "audio_storage_path":  (row or {}).get("audio_storage_path"),
            "signed_url":          _sign((row or {}).get("audio_storage_path")),
        })

    return {
        "full": {
            "audio_storage_path": test.get("full_audio_storage_path"),
            "signed_url":         _sign(test.get("full_audio_storage_path")),
            "duration_seconds":   test.get("full_audio_duration_seconds"),
            "size_bytes":         test.get("full_audio_size_bytes"),
        },
        "assembled": {
            "audio_storage_path": test.get("assembled_audio_storage_path"),
            "signed_url":         _sign(test.get("assembled_audio_storage_path")),
            "generated_at":       test.get("assembled_audio_generated_at"),
        },
        "sections":   section_signed,
        "expires_in": expires_in,
    }


# ── Sprint 13.5.6 — map image generation for plan-label exercises ─────────


class GenerateMapImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Optional override — defaults to settings.LISTENING_MAP_IMAGE_MODEL.
    model: str | None = None
    # Sprint 13.5.9.1 — admin-reviewed (possibly edited) prompt. When
    # supplied + non-empty, this overrides the parser-extracted
    # ``metadata.map_image_custom_prompt`` and the Cambridge template.
    # The override is session-only: it is NOT persisted back to the
    # markdown source, so re-converting the markdown resets the
    # textarea to whatever the parser extracts.
    custom_prompt_override: str | None = None


def _fetch_exercise_or_404(exercise_id: str) -> dict:
    res = (
        supabase_admin.table("listening_exercises")
        .select("*")
        .eq("id", exercise_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Exercise not found")
    return res.data[0]


def _sign_map_image_url(storage_path: str | None, expires_in: int = 3600) -> str | None:
    """Best-effort signed URL for a map image. Returns None on any failure."""
    if not storage_path:
        return None
    try:
        signed = supabase_admin.storage.from_(
            settings.LISTENING_IMAGES_BUCKET
        ).create_signed_url(storage_path, expires_in)
    except Exception as exc:                                                  # pragma: no cover
        logger.warning("[map_image] signed URL mint failed: %s", exc)
        return None
    return (signed or {}).get("signedURL") or (signed or {}).get("signed_url")


@admin_router.post("/exercises/{exercise_id}/generate-map-image")
async def admin_generate_map_image(
    exercise_id: str,
    body: GenerateMapImageRequest | None = None,
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.6 — generate a Cambridge-style floor-plan image for
    a plan-label exercise via Imagen 4 / Gemini 2.5 Flash Image, upload
    to Supabase Storage, and merge the metadata into the exercise's
    payload. Returns a 1h signed URL so the admin UI can preview the
    output without a follow-up round-trip.
    """
    from services import listening_map_image

    await require_admin(authorization)
    exercise = _fetch_exercise_or_404(exercise_id)

    payload = dict(exercise.get("payload") or {})
    variant = payload.get("variant") or exercise.get("variant")
    template_kind = payload.get("template_kind")
    if variant != "mcq_letter_label" and template_kind != "plan_label":
        raise HTTPException(
            422,
            "Map image generation is only available for plan-label "
            "exercises (variant=mcq_letter_label).",
        )

    metadata = payload.get("metadata") or {}
    map_description = metadata.get("map_description") or payload.get("map_description") or ""
    letter_options = metadata.get("letter_options") or payload.get("letter_options")
    # Sprint 13.5.9 — pick up Andy's curated prompt off either the
    # metadata block (where the parser puts it) or the payload root
    # (defensive in case a future writer flattens the schema).
    parsed_prompt = (
        metadata.get("map_image_custom_prompt")
        or payload.get("map_image_custom_prompt")
        or None
    )
    # Sprint 13.5.9.1 — precedence:
    #   1. ``body.custom_prompt_override`` — admin reviewed/edited it
    #      in the UI and clicked Generate. Use this verbatim.
    #   2. ``parsed_prompt`` — the parser extracted it from a
    #      `<details>` block in the markdown source.
    #   3. ``None`` — the image service falls back to the template.
    override = (body.custom_prompt_override if body else None) or None
    if override and override.strip():
        custom_prompt = override
        prompt_origin = "admin_override"
    elif parsed_prompt:
        custom_prompt = parsed_prompt
        prompt_origin = "custom"
    else:
        custom_prompt = None
        prompt_origin = "template"
    logger.info(
        "[map_image] generate exercise=%s origin=%s prompt_chars=%d",
        exercise_id, prompt_origin,
        len(custom_prompt) if custom_prompt else 0,
    )

    api_key = settings.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "GEMINI_API_KEY not configured on the server.")

    # Resolve parent test_id for storage pathing.
    content_id = exercise.get("content_id")
    content_res = (
        supabase_admin.table("listening_content")
        .select("test_id")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    test_id = (content_res.data or [{}])[0].get("test_id")
    if not test_id:
        raise HTTPException(500, "Exercise has no parent test bundle.")

    try:
        result = listening_map_image.generate_and_upload(
            map_description=map_description,
            letter_options=letter_options,
            test_id=test_id,
            exercise_id=exercise_id,
            supabase=supabase_admin,
            api_key=api_key,
            model=(body.model if body else None),
            custom_prompt=custom_prompt,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        logger.error("[map_image] generation failed: %s", exc)
        raise HTTPException(500, f"Image generation failed: {exc}")

    # Sprint 13.5.9.1 — when the admin reviewed/edited the prompt in
    # the UI, override the service's "custom"/"template" tag with the
    # finer-grained "admin_override" so the panel can show what
    # actually drove the generation. The service has no way to know
    # whether the prompt it received came from markdown or a textarea.
    if prompt_origin == "admin_override":
        result["map_image_prompt_source"] = "admin_override"

    # Merge image metadata into the exercise payload.
    payload.update(result)
    (
        supabase_admin.table("listening_exercises")
        .update({"payload": payload})
        .eq("id", exercise_id)
        .execute()
    )

    return {
        "exercise_id":            exercise_id,
        "map_image_storage_path": result["map_image_storage_path"],
        "map_image_model":        result["map_image_model"],
        "map_image_size_bytes":   result["map_image_size_bytes"],
        "map_image_generated_at": result["map_image_generated_at"],
        "map_image_prompt":       result["map_image_prompt"],
        "map_image_prompt_source": result["map_image_prompt_source"],
        "signed_url":             _sign_map_image_url(result["map_image_storage_path"]),
        "cost_estimate_usd":      listening_map_image.estimate_cost(result["map_image_model"]),
    }


# ── Sprint 13.5.9.3 — manual upload escape hatch ──────────────────────────


# Magic-byte signatures for the formats we accept. Dependency-free
# alternative to PIL: every byte sequence below is unique to its
# format header, so a 16-byte prefix check is enough to reject GIFs,
# BMPs, SVGs, PDFs, and corrupted files.
_IMAGE_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n",            "png"),
    (b"\xff\xd8\xff",                 "jpg"),
    # WebP carries an 8-byte ``RIFF????`` prefix then ``WEBP``. We
    # match the prefix + WEBP marker manually below since the length
    # bytes between them are variable.
)

_MANUAL_UPLOAD_MAX_BYTES = 5 * 1024 * 1024   # 5 MB hard cap
_MANUAL_UPLOAD_MIN_BYTES = 100               # sanity floor — anything
                                             # smaller is empty / corrupt


def _detect_image_format(data: bytes) -> str | None:
    """Return ``"png" / "jpg" / "webp"`` based on the magic-byte
    prefix, or ``None`` for any other format. Used as the only image
    validation in the manual-upload path — there's no Pillow / Magic
    dependency in this codebase, so byte signatures are the cheap +
    reliable check.
    """
    if not data or len(data) < 12:
        return None
    for sig, fmt in _IMAGE_SIGNATURES:
        if data.startswith(sig):
            return fmt
    # WebP: ``RIFF\x??\x??\x??\x??WEBP``.
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


@admin_router.post("/exercises/{exercise_id}/upload-map-image")
async def admin_upload_map_image(
    exercise_id: str,
    image_file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.9.3 — manual upload escape hatch.

    Andy's authoring loop sometimes produces a higher-quality map
    image via an external tool (e.g. the standalone Gemini Banana
    web app) than any of the six in-app API models. This endpoint
    persists that pre-generated image into the same Supabase Storage
    bucket / payload schema as the API path, so the student player
    treats both sources identically.

    Validation chain (all return 4xx before any storage call):
      * variant guard       — plan-label exercises only (422)
      * size                — 100 B floor / 5 MB cap (400 / 413)
      * format              — PNG / JPG / WebP via magic-byte sniff (415)

    The payload tags ``map_image_source = "manual_upload"`` and
    nulls out ``map_image_model`` + ``map_image_prompt_source`` so
    the admin panel can render the right source badge without any
    follow-up round-trip.
    """
    import time
    from datetime import datetime, timezone

    admin_user = await require_admin(authorization)
    exercise = _fetch_exercise_or_404(exercise_id)

    payload = dict(exercise.get("payload") or {})
    variant = payload.get("variant") or exercise.get("variant")
    template_kind = payload.get("template_kind")
    if variant != "mcq_letter_label" and template_kind != "plan_label":
        raise HTTPException(
            422,
            "Map image upload is only available for plan-label exercises "
            "(variant=mcq_letter_label).",
        )

    contents = await image_file.read()
    if len(contents) < _MANUAL_UPLOAD_MIN_BYTES:
        raise HTTPException(
            400,
            f"Image file too small ({len(contents)} bytes) — likely "
            "empty or corrupted.",
        )
    if len(contents) > _MANUAL_UPLOAD_MAX_BYTES:
        raise HTTPException(
            413,
            f"Image file too large ({len(contents) / 1024 / 1024:.2f} MB) — "
            "the manual upload limit is 5 MB.",
        )

    fmt = _detect_image_format(contents)
    if fmt is None:
        raise HTTPException(
            415,
            "Unsupported image format. Accepted: PNG, JPG, WebP.",
        )

    # Resolve parent test_id for storage pathing (mirrors the API
    # path's resolution so both sources share one bucket prefix).
    content_id = exercise.get("content_id")
    content_res = (
        supabase_admin.table("listening_content")
        .select("test_id")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    test_id = (content_res.data or [{}])[0].get("test_id")
    if not test_id:
        raise HTTPException(500, "Exercise has no parent test bundle.")

    # Storage path — lives alongside API-generated images under
    # ``tests/<test_uuid>/maps/`` so the existing delete endpoint
    # cleans it up the same way.
    timestamp = int(time.time())
    storage_path = (
        f"tests/{test_id}/maps/{exercise_id}-manual-{timestamp}.{fmt}"
    )
    resolved_bucket = settings.LISTENING_IMAGES_BUCKET

    content_type = "image/jpeg" if fmt == "jpg" else f"image/{fmt}"
    try:
        supabase_admin.storage.from_(resolved_bucket).upload(
            storage_path,
            contents,
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception as exc:                                              # pragma: no cover
        logger.error("[map_image] manual upload to storage failed: %s", exc)
        raise HTTPException(500, f"Storage upload failed: {exc}")

    # Sprint 13.5.6 left these fields on the payload root; the admin
    # panel reads them from there. Manual uploads use the same shape
    # but null out the API-only fields + tag the new source.
    now_iso = datetime.now(timezone.utc).isoformat()
    payload.update({
        "map_image_storage_path":  storage_path,
        "map_image_size_bytes":    len(contents),
        "map_image_source":        "manual_upload",
        "map_image_model":         None,
        "map_image_prompt":        None,
        "map_image_prompt_source": None,
        "map_image_generated_at":  now_iso,
        "map_image_uploaded_at":   now_iso,
        "map_image_uploaded_by":   admin_user.get("id"),
    })
    (
        supabase_admin.table("listening_exercises")
        .update({"payload": payload})
        .eq("id", exercise_id)
        .execute()
    )

    logger.info(
        "[map_image] manual upload exercise=%s size=%d fmt=%s by=%s",
        exercise_id, len(contents), fmt, admin_user.get("id"),
    )

    return {
        "exercise_id":            exercise_id,
        "map_image_storage_path": storage_path,
        "map_image_size_bytes":   len(contents),
        "map_image_format":       fmt,
        "map_image_source":       "manual_upload",
        "map_image_uploaded_at":  now_iso,
        "signed_url":             _sign_map_image_url(storage_path),
    }


@admin_router.delete("/exercises/{exercise_id}/map-image")
async def admin_delete_map_image(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.6 — remove the generated map image so the admin can
    regenerate with a different model or a refined description. Both
    the Storage object and the payload metadata are cleared.
    """
    await require_admin(authorization)
    exercise = _fetch_exercise_or_404(exercise_id)
    payload = dict(exercise.get("payload") or {})
    storage_path = payload.get("map_image_storage_path")

    if storage_path:
        try:
            supabase_admin.storage.from_(
                settings.LISTENING_IMAGES_BUCKET
            ).remove([storage_path])
        except Exception as exc:                                              # pragma: no cover
            logger.warning("[map_image] storage delete failed for %s: %s", storage_path, exc)

    cleared = False
    # Sprint 13.5.9.3 — clear the new manual-upload tags too so a
    # delete followed by a fresh API generate doesn't carry stale
    # provenance metadata.
    for key in (
        "map_image_storage_path",
        "map_image_size_bytes",
        "map_image_model",
        "map_image_prompt",
        "map_image_prompt_source",
        "map_image_generated_at",
        "map_image_source",
        "map_image_uploaded_at",
        "map_image_uploaded_by",
    ):
        if key in payload:
            payload.pop(key, None)
            cleared = True

    if cleared:
        (
            supabase_admin.table("listening_exercises")
            .update({"payload": payload})
            .eq("id", exercise_id)
            .execute()
        )

    return {"deleted": True, "had_image": bool(storage_path)}


@admin_router.get("/exercises/{exercise_id}/map-image/signed-url")
async def admin_get_map_image_signed_url(
    exercise_id: str,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.6 — fresh signed URL for an admin preview (the URL
    expires; the page calls this on refresh).
    """
    await require_admin(authorization)
    exercise = _fetch_exercise_or_404(exercise_id)
    payload = exercise.get("payload") or {}
    storage_path = payload.get("map_image_storage_path")
    if not storage_path:
        raise HTTPException(404, "No map image generated for this exercise.")
    url = _sign_map_image_url(storage_path, expires_in)
    if not url:
        raise HTTPException(500, "Signed URL could not be minted.")
    return {
        "exercise_id":            exercise_id,
        "signed_url":             url,
        "expires_in":             expires_in,
        "map_image_model":        payload.get("map_image_model"),
        "map_image_generated_at": payload.get("map_image_generated_at"),
    }


# ── Sprint 13.6 — audio cutter (full pre-mixed → N segments) ──────────────


class DetectSilenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    silence_threshold_db: float | None = None
    min_silence_duration: float | None = None
    target_section_count: int = 4


class CutSegmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=80)
    start: float = Field(ge=0)
    end:   float = Field(gt=0)


class CutAudioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segments: list[CutSegmentInput] = Field(min_length=1, max_length=10)


def _download_full_audio_to_tmp(test_id: str, source_path: str) -> str:
    """Pull the source MP3 from Supabase Storage into a /tmp file
    so ffmpeg can open it. Returns the temp path; caller is
    responsible for ``os.unlink`` cleanup.

    Falsifications guarded:
      * Storage returns None / bytes-like / wrapper → we coerce to
        bytes() and raise if the result is empty (502).
    """
    import tempfile

    try:
        raw = supabase_admin.storage.from_(
            settings.LISTENING_AUDIO_BUCKET
        ).download(source_path)
    except Exception as exc:                                              # pragma: no cover
        raise HTTPException(502, f"Storage download failed: {exc}")
    audio_bytes = bytes(raw) if raw is not None else b""
    if not audio_bytes:
        raise HTTPException(502, "Source audio is empty in storage.")
    tmp = tempfile.NamedTemporaryFile(
        prefix=f"cutter_src_{test_id}_", suffix=".mp3", delete=False,
    )
    try:
        tmp.write(audio_bytes)
    finally:
        tmp.close()
    return tmp.name


@admin_router.post("/tests/{test_id}/detect-silence")
async def admin_detect_silence_boundaries(
    test_id: str,
    body: DetectSilenceRequest | None = None,
    authorization: str | None = Header(default=None),
):
    """Sprint 13.6 — propose ``target_section_count`` audio boundaries
    by running ``ffmpeg silencedetect`` against the test's
    ``full_audio_storage_path``. Returns ``[{start, end}, ...]``
    ranges suitable for pre-filling regions in the admin cutter UI.

    Requirements:
      * test must carry ``audio_assembly_mode == "full_premixed"``
      * test must have ``full_audio_storage_path`` set

    The threshold + min-duration defaults
    (``-40 dB`` / ``2.0 s``) suit IELTS Listening section gaps. Both
    are tunable per request for noisy / quiet source audio.
    """
    import os
    from services import listening_audio_cutter as cutter

    await require_admin(authorization)
    test = _fetch_test_or_404(test_id)

    if test.get("audio_assembly_mode") != "full_premixed":
        raise HTTPException(
            422,
            "Silence detection is only available when the test's "
            "audio_assembly_mode = 'full_premixed'.",
        )
    source_path = test.get("full_audio_storage_path")
    if not source_path:
        raise HTTPException(
            422,
            "Test has no full pre-mixed audio uploaded yet.",
        )

    tmp_path = _download_full_audio_to_tmp(test_id, source_path)
    try:
        threshold = (
            body.silence_threshold_db if body and body.silence_threshold_db is not None
            else cutter.DEFAULT_SILENCE_THRESHOLD_DB
        )
        min_dur = (
            body.min_silence_duration if body and body.min_silence_duration is not None
            else cutter.DEFAULT_MIN_SILENCE_DURATION
        )
        target = (body.target_section_count if body else 4) or 4
        try:
            gaps, duration = cutter.detect_silence(
                tmp_path,
                silence_threshold_db=threshold,
                min_silence_duration=min_dur,
            )
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))
        if duration is None:
            # Fall back to the DB-stored duration when ffmpeg's banner
            # didn't carry the Duration line (some streamed files).
            duration = float(test.get("full_audio_duration_seconds") or 0)
        boundaries = cutter.propose_section_boundaries(
            gaps, audio_duration=duration, target_section_count=target,
        )
        return {
            "test_id":                test["id"],
            "audio_duration_seconds": duration,
            "silence_gaps_detected":  len(gaps),
            "boundaries": [
                {"start": b.start, "end": b.end} for b in boundaries
            ],
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:                                                   # pragma: no cover
            pass


@admin_router.post("/tests/{test_id}/cut-audio")
async def admin_cut_audio_segments(
    test_id: str,
    body: CutAudioRequest,
    authorization: str | None = Header(default=None),
):
    """Sprint 13.6 — carve the test's full pre-mixed audio into N
    segments via ffmpeg stream-copy (no re-encoding). Each segment
    becomes a new ``listening_content`` row tied to the same test
    with ``parent_content_id`` left NULL (the source is the test's
    full audio, not a content row) and ``segment_label`` +
    ``segment_start_seconds`` / ``segment_end_seconds`` populated.

    The source full audio is preserved — segments are additive. The
    admin can re-cut at any time; previously cut rows stay around
    until explicitly archived.

    Returns the inserted segment metadata so the admin panel can
    re-render without a follow-up fetch.
    """
    import os, tempfile
    from datetime import datetime, timezone
    from services import listening_audio_cutter as cutter

    admin_user = await require_admin(authorization)
    test = _fetch_test_or_404(test_id)

    if test.get("audio_assembly_mode") != "full_premixed":
        raise HTTPException(
            422,
            "Audio cutting is only available for full_premixed tests.",
        )
    source_path = test.get("full_audio_storage_path")
    if not source_path:
        raise HTTPException(
            422,
            "Test has no full pre-mixed audio uploaded yet.",
        )

    # Filter out segments below the minimum-duration floor so we don't
    # burn storage on stray drags. Skipped count is reported back.
    requested = [
        cutter.Segment(label=s.label, start=s.start, end=s.end)
        for s in body.segments
    ]
    keep = cutter.validate_segments(requested)
    skipped = len(requested) - len(keep)
    if not keep:
        raise HTTPException(
            400,
            f"All {len(requested)} segments are shorter than "
            f"{cutter.MIN_SEGMENT_DURATION_SECONDS}s — nothing to cut.",
        )

    # Sprint 13.6.3 (Codex audit F2) — pre-fetch the existing active cut
    # fingerprints for this test so the cut loop can short-circuit to
    # "reuse" semantics without burning a fresh ffmpeg pass + storage
    # upload + DB insert on every re-click of Export. Active here means
    # ``status != 'archived'`` (matches the partial unique index added in
    # migration 072).
    existing_rows = (
        supabase_admin.table("listening_content")
        .select(
            "id,test_id,segment_label,segment_start_seconds,"
            "segment_end_seconds,audio_storage_path,audio_size_bytes,"
            "audio_duration_seconds,status"
        )
        .eq("test_id", test["id"])
        .execute()
    )

    def _fingerprint(label, start, end):
        # Round to 3 decimals so float jitter doesn't defeat the lookup.
        return (str(label), round(float(start), 3), round(float(end), 3))

    existing_by_fp: dict[tuple, dict] = {}
    for row in (existing_rows.data or []):
        if (row.get("segment_label") is None
                or row.get("segment_start_seconds") is None
                or row.get("segment_end_seconds") is None):
            continue
        if (row.get("status") or "draft") == "archived":
            continue
        fp = _fingerprint(
            row["segment_label"],
            row["segment_start_seconds"],
            row["segment_end_seconds"],
        )
        existing_by_fp[fp] = row

    tmp_source = None
    created: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    reused_count = 0
    new_count = 0
    try:
        for index, seg in enumerate(keep, start=1):
            duration = seg.end - seg.start
            fp = _fingerprint(seg.label, seg.start, seg.end)

            # F2 fast path — fingerprint already exists on an active row.
            # Skip ffmpeg + storage + insert entirely. The frontend uses
            # ``reused`` to split the success-banner count.
            if fp in existing_by_fp:
                row = existing_by_fp[fp]
                reused_count += 1
                created.append({
                    "id":                       row["id"],
                    "title":                    seg.label,
                    "segment_label":            seg.label,
                    "segment_start_seconds":    seg.start,
                    "segment_end_seconds":      seg.end,
                    "audio_storage_path":       row.get("audio_storage_path"),
                    "audio_size_bytes":         row.get("audio_size_bytes"),
                    "audio_duration_seconds":   row.get("audio_duration_seconds"),
                    "reused":                   True,
                })
                continue

            # New cut — download the source on demand the first time we
            # actually need it. Saves bandwidth + tmp-disk on the all-reused
            # path (Andy re-clicks Export with no changes).
            if tmp_source is None:
                tmp_source = _download_full_audio_to_tmp(test_id, source_path)

            out_path = tempfile.NamedTemporaryFile(
                prefix=f"cutter_out_{test_id}_{index}_",
                suffix=".mp3", delete=False,
            )
            out_path.close()
            try:
                try:
                    cutter.cut_segment_to_path(
                        source_path=tmp_source,
                        output_path=out_path.name,
                        start_seconds=seg.start,
                        duration_seconds=duration,
                    )
                except RuntimeError as exc:
                    raise HTTPException(500, str(exc))
                with open(out_path.name, "rb") as fh:
                    cut_bytes = fh.read()
            finally:
                try:
                    os.unlink(out_path.name)
                except OSError:                                           # pragma: no cover
                    pass

            storage_path = cutter.build_storage_path(
                test_id=test["id"],
                content_id=test["id"],   # cuts live under tests/<test>/
                index=index,
                label=seg.label,
            )
            _upload_audio_to_bucket(storage_path, cut_bytes)

            content_id = str(uuid.uuid4())
            new_row = {
                "id":                       content_id,
                # Sprint 13.6.4 (production F9 fix) — listening_content
                # has been NOT NULL on ``source_type`` since migration
                # 056 (Sprint 11.0). Migration 066 added the canonical
                # ``exercise_snippet`` value for the audio-cutter
                # specifically ("Sprint 13.6 audio cutter" per the
                # migration comment). Sprint 13.6's cut route shipped
                # without it — every Export hit 23502 in production.
                "source_type":              "exercise_snippet",
                # Sprint 13.6.4 — other NOT NULL fields the cut route
                # also missed. ``accent_tag`` defaults to ``other``
                # because listening_tests doesn't store accent; the
                # caller can re-tag from the admin panel. ``transcript``
                # is empty because a cut's transcript is implicit in the
                # parent test's transcript (sliced by the segment offset
                # — a Phase B refinement).
                "accent_tag":               "other",
                "transcript":               "",
                "test_id":                  test["id"],
                "title":                    seg.label,
                "audio_storage_path":       storage_path,
                "audio_size_bytes":         len(cut_bytes),
                "audio_duration_seconds":   max(1, int(round(duration))),
                "segment_label":            seg.label,
                # Round to 3 decimals so the partial-unique fingerprint
                # index matches the read-side fingerprinting helper
                # exactly (no float-equality jitter on round-tripped
                # values).
                "segment_start_seconds":    round(float(seg.start), 3),
                "segment_end_seconds":      round(float(seg.end), 3),
                # Sprint 13.6.3 (Codex audit F1) — truthful provenance.
                # ``parent_content_id`` deliberately omitted: full_premixed
                # audio lives on listening_tests, not listening_content.
                "source_test_id":           test["id"],
                "source_audio_kind":        "test_full_premixed",
                "created_at":               now_iso,
            }
            try:
                supabase_admin.table("listening_content").insert(new_row).execute()
            except Exception as exc:                                      # pragma: no cover
                logger.error("[audio_cutter] insert failed for %s: %s", storage_path, exc)
                raise HTTPException(500, f"DB insert failed: {exc}")

            new_count += 1
            created.append({
                "id":                       content_id,
                "title":                    seg.label,
                # Sprint 13.6.4 — surface source_type to the frontend so
                # the admin UI can filter the audio-cutter list by
                # ``source_type === 'exercise_snippet'`` (the canonical
                # filter) without an extra round-trip.
                "source_type":              "exercise_snippet",
                "segment_label":            seg.label,
                "segment_start_seconds":    round(float(seg.start), 3),
                "segment_end_seconds":      round(float(seg.end), 3),
                "audio_storage_path":       storage_path,
                "audio_size_bytes":         len(cut_bytes),
                "audio_duration_seconds":   max(1, int(round(duration))),
                "source_test_id":           test["id"],
                "source_audio_kind":        "test_full_premixed",
                "reused":                   False,
            })
    finally:
        if tmp_source is not None:
            try:
                os.unlink(tmp_source)
            except OSError:                                               # pragma: no cover
                pass

    logger.info(
        "[audio_cutter] cut test=%s segments=%d new=%d reused=%d skipped=%d admin=%s",
        test_id, len(created), new_count, reused_count, skipped,
        admin_user.get("id"),
    )

    return {
        "test_id":             test["id"],
        "segments_created":    len(created),
        "segments_new":        new_count,
        "segments_reused":     reused_count,
        "segments_skipped":    skipped,
        "min_segment_seconds": cutter.MIN_SEGMENT_DURATION_SECONDS,
        "segments":            created,
    }


# ── Sprint 13.5 — student full-test layer ──────────────────────────────────


class TestAttemptAnswerPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q_num:       int
    user_answer: str


def _student_audio_url_for_test(test_row: dict) -> tuple[str | None, str | None, int | None]:
    """Pick the right audio for a student player.

    Preference: ``assembled_audio_storage_path`` (mode=parts_auto_assembled)
    over ``full_audio_storage_path`` (mode=full_premixed). Returns
    ``(signed_url, storage_path, duration_seconds)``. ``signed_url=None``
    if the test has no audio yet.
    """
    storage_path = (
        test_row.get("assembled_audio_storage_path")
        or test_row.get("full_audio_storage_path")
    )
    duration = test_row.get("full_audio_duration_seconds")
    if not storage_path:
        return None, None, None
    try:
        signed = supabase_admin.storage.from_(
            settings.LISTENING_AUDIO_BUCKET
        ).create_signed_url(storage_path, 7200)                              # 2h for test session
    except Exception as exc:                                                 # pragma: no cover
        logger.warning("[listening] student signed URL mint failed: %s", exc)
        return None, storage_path, duration
    url = (signed or {}).get("signedURL") or (signed or {}).get("signed_url")
    return url, storage_path, duration


@user_router.get("/tests")
async def list_published_listening_tests(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Student-facing list of published Cambridge IELTS test bundles.

    Hard-filters ``status='published'`` AND audio satisfied (full or
    assembled present). Each row carries the calling user's best score
    + attempt count so the tests list can render "Bắt đầu" vs "Làm lại"
    CTAs without a follow-up round-trip.
    """
    user = await _require_auth(authorization)

    res = (
        supabase_admin.table("listening_tests")
        .select("*", count="exact")
        .eq("status", "published")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    raw_rows = res.data or []
    # Filter to rows with audio satisfied (full OR assembled).
    rows = [
        r for r in raw_rows
        if r.get("full_audio_storage_path") or r.get("assembled_audio_storage_path")
    ]

    # Per-user stats — single round trip across all visible test IDs.
    test_ids = [r["id"] for r in rows]
    user_best:  dict[str, int] = {}
    user_count: dict[str, int] = {}
    if test_ids:
        try:
            att_res = (
                supabase_admin.table("listening_test_attempts")
                .select("test_id,score,status")
                .eq("user_id", user["id"])
                .in_("test_id", test_ids)
                .execute()
            )
            for att in att_res.data or []:
                tid = att.get("test_id")
                if not tid:
                    continue
                user_count[tid] = user_count.get(tid, 0) + 1
                if att.get("status") == "submitted" and att.get("score") is not None:
                    prev = user_best.get(tid)
                    if prev is None or att["score"] > prev:
                        user_best[tid] = att["score"]
        except Exception as exc:                                             # pragma: no cover
            logger.warning("[listening] attempts lookup failed: %s", exc)

    out_items: list[dict] = []
    for r in rows:
        out_items.append({
            "id":                   r["id"],
            "test_id":              r.get("test_id"),
            "title":                r.get("title"),
            "band_target":          r.get("band_target"),
            "themes":               r.get("themes") or {},
            "accent_profile":       r.get("accent_profile") or [],
            "audio_assembly_mode":  r.get("audio_assembly_mode"),
            "user_best_score":      user_best.get(r["id"]),
            "user_attempt_count":   user_count.get(r["id"], 0),
        })

    return {
        "items":  out_items,
        "total":  len(out_items),
        "limit":  limit,
        "offset": offset,
    }


@user_router.get("/tests/{test_id}")
async def get_published_listening_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Fetch a published test bundle for the student player.

    Includes a signed audio URL (2h TTL — covers test duration with
    buffer), 4 section rows with narrator intros, and the test's
    exercises **with answer keys stripped** (security: students must
    never see the answer key on this endpoint).
    """
    from services import listening_test_grader as grader

    _user = await _require_auth(authorization)

    res = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Test bundle not found or not published")
    test = res.data[0]

    audio_url, audio_path, audio_duration = _student_audio_url_for_test(test)
    if not audio_url:
        raise HTTPException(
            422,
            "Test chưa có audio sẵn sàng — vui lòng quay lại sau.",
        )

    sec_res = (
        supabase_admin.table("listening_content")
        .select("id,section_num,title,transcript,metadata")
        .eq("test_id", test_id)
        .order("section_num")
        .execute()
    )
    section_rows = sec_res.data or []
    section_ids = [s["id"] for s in section_rows]

    ex_res = (
        supabase_admin.table("listening_exercises")
        .select("id,content_id,exercise_type,payload,order_num")
        .in_("content_id", section_ids)
        .order("order_num")
        .execute() if section_ids else None
    )
    exercises_raw = (ex_res.data if ex_res else []) or []
    # Sprint 13.5 security guard — strip answer keys.
    exercises_safe = grader.strip_answer_keys(exercises_raw)
    # Sprint 13.5.6 — inject a fresh 2h signed URL for any plan-label
    # exercise that has a generated map image. The student endpoint is
    # the only place that mints this URL; the admin preview path mints
    # via /exercises/{id}/map-image/signed-url. Keeps the payload
    # otherwise unchanged so the renderer sees the same shape.
    # Sprint 13.5.8 — also strip `map_description` from the student
    # response (and from `payload.metadata`) for every plan-label
    # exercise. The description is admin-only metadata (AI image
    # prompt input); leaking it gives the student the answer key in
    # prose. Defense-in-depth: the frontend renderer also ignores it.
    for ex in exercises_safe:
        payload = ex.get("payload") or {}
        variant = payload.get("variant")
        template_kind = payload.get("template_kind")
        is_plan_label = (
            variant == "mcq_letter_label"
            or template_kind == "plan_label"
        )
        storage_path = payload.get("map_image_storage_path")
        signed_url = (
            _sign_map_image_url(storage_path, expires_in=7200)
            if storage_path else None
        )
        if is_plan_label or signed_url:
            payload = dict(payload)
            if signed_url:
                payload["map_image_url"] = signed_url
            if is_plan_label:
                payload.pop("map_description", None)
                # Sprint 13.5.9 — also strip the curated AI prompt; it
                # describes the answer layout explicitly (letter
                # positions, room semantics) and would hand the student
                # the answer key in prose if leaked.
                payload.pop("map_image_custom_prompt", None)
                if isinstance(payload.get("metadata"), dict):
                    payload["metadata"] = dict(payload["metadata"])
                    payload["metadata"].pop("map_description", None)
                    payload["metadata"].pop("map_image_custom_prompt", None)
            ex["payload"] = payload
    by_content: dict[str, list[dict]] = {}
    for ex in exercises_safe:
        by_content.setdefault(ex["content_id"], []).append(ex)

    sections_out: list[dict] = []
    for s in section_rows:
        meta = s.get("metadata") or {}
        sections_out.append({
            "section_num":    s.get("section_num"),
            "title":          s.get("title"),
            "narrator_intro": meta.get("narrator_intro"),
            "context":        meta.get("context"),
            "exercises":      by_content.get(s["id"], []),
        })

    return {
        "id":                     test["id"],
        "test_id":                test.get("test_id"),
        "title":                  test.get("title"),
        "themes":                 test.get("themes") or {},
        "audio_url":              audio_url,
        "audio_storage_path":     audio_path,
        "audio_duration_seconds": audio_duration,
        "cue_points":             test.get("cue_points") or [],
        "sections":               sections_out,
    }


@user_router.post("/tests/{test_id}/attempts")
async def start_listening_test_attempt(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Open a new student attempt session. Marks any previously open
    in-progress attempt for the same (user, test) as abandoned so the
    1-active-attempt invariant holds.
    """
    user = await _require_auth(authorization)

    # Verify the test is published + has audio.
    test_res = (
        supabase_admin.table("listening_tests")
        .select("id,status,full_audio_storage_path,assembled_audio_storage_path")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not test_res.data or test_res.data[0].get("status") != "published":
        raise HTTPException(404, "Test bundle not found or not published")
    test_row = test_res.data[0]
    if not (test_row.get("full_audio_storage_path")
            or test_row.get("assembled_audio_storage_path")):
        raise HTTPException(422, "Test chưa có audio sẵn sàng.")

    # Abandon any open attempts for this (user, test).
    (
        supabase_admin.table("listening_test_attempts")
        .update({"status": "abandoned"})
        .eq("user_id", user["id"])
        .eq("test_id", test_id)
        .eq("status", "in_progress")
        .execute()
    )

    attempt_id = str(uuid.uuid4())
    payload = {
        "id":      attempt_id,
        "test_id": test_id,
        "user_id": user["id"],
        "status":  "in_progress",
        "answers": [],
    }
    (
        supabase_admin.table("listening_test_attempts")
        .insert(payload)
        .execute()
    )
    return {"attempt_id": attempt_id, "status": "in_progress"}


def _fetch_attempt_or_404(attempt_id: str, user_id: str) -> dict:
    res = (
        supabase_admin.table("listening_test_attempts")
        .select("*")
        .eq("id", attempt_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Attempt not found")
    row = res.data[0]
    if row.get("user_id") != user_id:
        raise HTTPException(403, "Attempt belongs to another user")
    return row


@user_router.patch("/tests/attempts/{attempt_id}/answers")
async def patch_listening_test_attempt_answer(
    attempt_id: str,
    body: TestAttemptAnswerPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Incrementally save a single answer. The frontend debounces ~2s
    per gap; the backend treats this as an upsert keyed by ``q_num``.
    """
    from datetime import datetime, timezone

    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể edit.")
    if not (1 <= body.q_num <= 40):
        raise HTTPException(422, "q_num must be in 1..40")

    answers = attempt.get("answers") or []
    answers = [a for a in answers if a.get("q_num") != body.q_num]
    answers.append({
        "q_num":       body.q_num,
        "user_answer": body.user_answer,
        "answered_at": datetime.now(timezone.utc).isoformat(),
    })
    answers.sort(key=lambda a: a.get("q_num") or 0)

    (
        supabase_admin.table("listening_test_attempts")
        .update({"answers": answers})
        .eq("id", attempt_id)
        .execute()
    )
    return {"attempt_id": attempt_id, "answer_count": len(answers)}


@user_router.post("/tests/attempts/{attempt_id}/submit")
async def submit_listening_test_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    """Finalize a student attempt: load the test's answer key, grade
    each user answer, roll up trap analytics, write the grading
    payload back to the attempt row, and return the result.
    """
    from datetime import datetime, timezone

    from services import listening_test_grader as grader

    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    if attempt.get("status") == "submitted":
        raise HTTPException(422, "Attempt đã submit rồi — không thể submit lại.")
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt status không hợp lệ.")

    # Pull the test's exercises + extract the answer key.
    test_id = attempt["test_id"]
    sec_res = (
        supabase_admin.table("listening_content")
        .select("id")
        .eq("test_id", test_id)
        .execute()
    )
    section_ids = [r["id"] for r in (sec_res.data or [])]
    if not section_ids:
        raise HTTPException(500, "Test bundle thiếu section rows.")

    ex_res = (
        supabase_admin.table("listening_exercises")
        .select("payload")
        .in_("content_id", section_ids)
        .execute()
    )
    answer_key = grader.collect_answer_key(ex_res.data or [])

    result = grader.grade_attempt(attempt.get("answers") or [], answer_key)
    now_iso = datetime.now(timezone.utc).isoformat()

    (
        supabase_admin.table("listening_test_attempts")
        .update({
            "status":          "submitted",
            "score":           result["score"],
            "grading_details": result["per_question"],
            "trap_analytics":  result["trap_analytics"],
            "band_estimate":   result["band_estimate"],
            "submitted_at":    now_iso,
        })
        .eq("id", attempt_id)
        .execute()
    )

    return {
        "attempt_id":        attempt_id,
        "score":             result["score"],
        "max_score":         result["max_score"],
        "band_estimate":     result["band_estimate"],
        "section_breakdown": result["section_breakdown"],
        "trap_analytics":    result["trap_analytics"],
        "per_question":      result["per_question"],
    }


@user_router.get("/tests/attempts/{attempt_id}")
async def get_listening_test_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    """Fetch a past attempt's grading. Owner-only (admin bypass not
    wired here — admins use ``/admin/listening/tests/{id}`` for the
    bundle view; per-attempt admin surfaces land in a future sprint).
    """
    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    return {
        "attempt_id":      attempt["id"],
        "test_id":         attempt["test_id"],
        "status":          attempt["status"],
        "score":           attempt.get("score"),
        "band_estimate":   attempt.get("band_estimate"),
        "answers":         attempt.get("answers") or [],
        "grading_details": attempt.get("grading_details") or [],
        "trap_analytics":  attempt.get("trap_analytics") or {},
        "started_at":      attempt.get("started_at"),
        "submitted_at":    attempt.get("submitted_at"),
    }
