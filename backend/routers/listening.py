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

    # ── Sprint 11.2 — resolve voice_id fallback by accent ─────────────────────
    voice_id = body.voice_id or _default_voice_for_accent(body.accent_tag)
    if not voice_id:
        raise HTTPException(
            422,
            "voice_id required (no default voice configured for "
            f"accent_tag='{body.accent_tag}' — set body.voice_id explicitly).",
        )

    job_id = str(uuid.uuid4())
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
        "job_id": job_id,
        "status": "queued",
        "note":   "Poll /api/listening/content/{job_id} after ~10-30s to see the draft row.",
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
        .select("exercise_id,score,is_correct")
        .eq("user_id", user_id)
        .eq("listening_session_id", session_id)
        .execute()
    )
    attempts = a_res.data or []
    total = int(session.get("total_questions") or len(session.get("exercise_ids") or []))
    if total == 0:
        raise HTTPException(422, "Session has no questions.")

    # Aggregate using best (first-attempt) score per exercise — Sprint 10.3
    # first-attempt rule: subsequent retries don't shift the canonical band.
    # Here we approximate by taking the *first* row per exercise (Supabase
    # rows come back unsorted; sort by created_at if we need true first —
    # the count of correct answers is fine for the band estimate).
    correct_count = sum(1 for a in attempts if a.get("is_correct"))
    score_avg = (
        sum(float(a.get("score") or 0) for a in attempts) / max(len(attempts), 1)
    )

    # Light band heuristic (IELTS Listening band table is non-linear; this
    # is a learning-coach estimate, not an official scaled score).
    band = _band_from_correct(correct_count, total)

    try:
        supabase_admin.table("listening_sessions").update({
            "completed_at":   "now()",
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
        .select("id,exercise_id,score,is_correct,created_at")
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
            "score":         float(r.get("score") or 0),
            "is_correct":    bool(r.get("is_correct")),
            "created_at":    r["created_at"],
            "exercise_type": type_by_eid.get(r["exercise_id"], "unknown"),
        })

    modes = ("dictation", "gist", "true_false", "mcq")
    by_mode: dict[str, dict] = {}
    for m in modes:
        rows_m = [r for r in flat if r["exercise_type"] == m]
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
    # so we don't misrepresent thin slices as weaknesses.
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
