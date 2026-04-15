"""
routers/pronunciation.py — On-demand Azure Pronunciation Assessment

Single-response endpoint:
  POST /sessions/{session_id}/responses/{response_id}/pronunciation

Full-test endpoint (selects 3 representative samples across all 3 parts):
  POST /sessions/{session_id}/pronunciation/full

Pipeline (single-response):
  1. Auth + session ownership validation
  2. Load response → audio_storage_path (preferred) or audio_url (fallback)
  3. Download audio bytes (signed URL → public URL → error)
  4. Call azure_pronunciation.assess_pronunciation()
  5. Upsert pronunciation columns on responses row
  6. Return normalized result

Pipeline (full-test):
  1. Auth + session ownership validation
  2. Load all responses + questions for the session (join on question_id in Python)
  3. Group responses by part; select 1 sample per part via pronunciation_sampling
  4. For each sample: download audio, extract Part 2 segment if needed, assess
  5. Upsert pronunciation columns on each sampled response row
  6. Return combined result with per-sample metadata
"""

import json as _json
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException

from database import supabase_admin
from routers.auth import get_supabase_user
from services import azure_pronunciation
from services.pronunciation_sampling import (
    SelectedSample,
    extract_audio_segment,
    select_part1_sample,
    select_part2_sample,
    select_part3_sample,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pronunciation"])

_AUDIO_BUCKET   = "audio-responses"
_SIGNED_URL_TTL = 120   # 2 minutes — just long enough for download + assessment


# ── Shared audio download helper ───────────────────────────────────────────────

async def _download_audio_bytes(
    storage_path: Optional[str],
    public_url:   Optional[str],
    response_id:  str,
) -> tuple[bytes, str]:
    """
    Download audio for a response.

    Returns (audio_bytes, content_type).
    Raises HTTPException(502) if neither source yields audio.
    """
    content_type = "audio/webm"

    # Infer content-type from storage path extension
    if storage_path:
        ext_map = {
            ".mp3":  "audio/mpeg",
            ".wav":  "audio/wav",
            ".webm": "audio/webm; codecs=opus",
            ".ogg":  "audio/ogg; codecs=opus",
            ".m4a":  "audio/mp4",
            ".flac": "audio/flac",
        }
        for ext, mime in ext_map.items():
            if storage_path.lower().endswith(ext):
                content_type = mime
                break

        # Try signed URL first
        try:
            signed_resp = supabase_admin.storage.from_(_AUDIO_BUCKET).create_signed_url(
                storage_path, _SIGNED_URL_TTL
            )
            if hasattr(signed_resp, "data") and signed_resp.data:
                signed_url = signed_resp.data.get("signedUrl") or signed_resp.data.get("signedURL")
            elif isinstance(signed_resp, dict):
                signed_url = signed_resp.get("signedUrl") or signed_resp.get("signedURL")
            else:
                signed_url = None

            if signed_url:
                async with httpx.AsyncClient(timeout=60) as client:
                    dl = await client.get(signed_url)
                if dl.status_code == 200:
                    audio_bytes = dl.content
                    print(
                        f"[PRON] downloaded {len(audio_bytes)}B via signed URL "
                        f"response={response_id}  content_type={content_type}",
                        flush=True,
                    )
                    return audio_bytes, content_type
                else:
                    logger.warning("[pronunciation] signed URL download returned HTTP %d", dl.status_code)
        except Exception as e:
            logger.warning("[pronunciation] signed URL download failed: %s", e)

    # Fallback to public URL
    if public_url:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                dl = await client.get(public_url)
            if dl.status_code == 200:
                audio_bytes = dl.content
                print(
                    f"[PRON] downloaded {len(audio_bytes)}B via public URL "
                    f"response={response_id}  content_type={content_type}",
                    flush=True,
                )
                return audio_bytes, content_type
        except Exception as e:
            logger.warning("[pronunciation] public URL download failed: %s", e)

    raise HTTPException(502, f"Không thể tải file audio cho response {response_id}.")


# ── Shared DB upsert helper ────────────────────────────────────────────────────

def _upsert_pronunciation(response_id: str, result: dict, extra: Optional[dict] = None) -> None:
    """Write pronunciation scores to the responses row. Non-fatal on failure."""
    payload = {
        "pronunciation_score":        result.get("pronunciation_score"),
        "pronunciation_fluency":      result.get("fluency_score"),
        "pronunciation_accuracy":     result.get("accuracy_score"),
        "pronunciation_completeness": result.get("completeness_score"),
        "pronunciation_status":       "completed",
        "pronunciation_provider":     "azure",
        "pronunciation_locale":       "en-US",
        "pronunciation_payload":      _json.dumps(
            {**(result.get("raw_payload") or {}), **(extra or {})},
            ensure_ascii=False,
        ),
    }
    try:
        supabase_admin.table("responses").update(payload).eq("id", response_id).execute()
        logger.info("[pronunciation] DB updated for response=%s", response_id)
    except Exception as e:
        logger.warning("[pronunciation] DB update failed (non-fatal): %s", e)


# ── POST /sessions/{session_id}/responses/{response_id}/pronunciation ──────────

@router.post("/sessions/{session_id}/responses/{response_id}/pronunciation")
async def assess_response_pronunciation(
    session_id:  str,
    response_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Trigger Azure Pronunciation Assessment for a previously recorded response.
    Safe to call multiple times — result is upserted, not duplicated.

    Returns:
        pronunciation_score, fluency_score, accuracy_score, completeness_score,
        short_summary, words (word-level), provider, locale
    """
    # ── 1. Auth + session ownership ──────────────────────────────────────────
    auth_user = await get_supabase_user(authorization)
    user_id   = auth_user["id"]

    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải session: {e}")

    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại hoặc không có quyền truy cập")

    # ── 2. Load response ─────────────────────────────────────────────────────
    try:
        r_res = (
            supabase_admin.table("responses")
            .select("id, audio_storage_path, audio_url, pronunciation_status")
            .eq("id", response_id)
            .eq("session_id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải response: {e}")

    if not r_res.data:
        raise HTTPException(404, "Response không tồn tại trong session này")

    response = r_res.data[0]
    storage_path: str | None = response.get("audio_storage_path")
    public_url:   str | None = response.get("audio_url")

    print(
        f"[PRON] response={response_id}  storage_path={storage_path!r}  "
        f"public_url={bool(public_url)}  existing_status={response.get('pronunciation_status')!r}",
        flush=True,
    )

    if not storage_path and not public_url:
        raise HTTPException(422, "Response này chưa có file audio. Hãy ghi âm trước.")

    # ── 3. Download audio bytes ───────────────────────────────────────────────
    audio_bytes, content_type = await _download_audio_bytes(storage_path, public_url, response_id)

    # ── 4. Azure Pronunciation Assessment ────────────────────────────────────
    print(f"[PRON] audio downloaded: {len(audio_bytes)}B  inferred_type={content_type}", flush=True)
    try:
        result = await azure_pronunciation.assess_pronunciation(
            audio_bytes=audio_bytes,
            content_type=content_type,
            locale="en-US",
            reference_text="",
        )
    except ValueError as e:
        logger.error("[pronunciation] Azure config error: %s", e)
        raise HTTPException(503, f"Dịch vụ đánh giá phát âm chưa được cấu hình: {e}")
    except RuntimeError as e:
        logger.error("[pronunciation] Azure API error: %s", e)
        raise HTTPException(502, f"Lỗi Azure Speech API: {e}")

    # ── 5. Persist to DB ─────────────────────────────────────────────────────
    _upsert_pronunciation(response_id, result)

    # ── 6. Return normalized result ──────────────────────────────────────────
    return {
        "response_id":           response_id,
        "pronunciation_score":   result.get("pronunciation_score"),
        "fluency_score":         result.get("fluency_score"),
        "accuracy_score":        result.get("accuracy_score"),
        "completeness_score":    result.get("completeness_score"),
        "prosody_score":         result.get("prosody_score"),
        "short_summary":         result.get("short_summary", []),
        "words":                 result.get("words", []),
        "provider":              "azure",
        "locale":                "en-US",
    }


# ── POST /sessions/{session_id}/pronunciation/full ────────────────────────────

@router.post("/sessions/{session_id}/pronunciation/full")
async def assess_full_test_pronunciation(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Assess pronunciation for a full-test session by selecting one representative
    sample from each of Parts 1, 2, and 3.

    Selection rules:
      - Part 1: prefer duration >= 12s; random among qualifiers; longest fallback
      - Part 2: longest response; segment [10s–45s] / middle-third / full with flag
      - Part 3: prefer duration >= 15s; random among qualifiers; longest fallback

    Returns:
        session_id, overall_pron_score (average of available samples),
        samples: {part1, part2, part3} — each with scores + metadata
    """
    # ── 1. Auth + session ownership ──────────────────────────────────────────
    auth_user = await get_supabase_user(authorization)
    user_id   = auth_user["id"]

    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải session: {e}")

    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại hoặc không có quyền truy cập")

    # ── 2. Load responses + questions (join in Python) ────────────────────────
    try:
        resp_res = (
            supabase_admin.table("responses")
            .select("id, question_id, audio_storage_path, audio_url, duration_seconds")
            .eq("session_id", session_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải responses: {e}")

    all_responses = resp_res.data or []

    # Fetch questions to get part numbers
    question_ids = list({r["question_id"] for r in all_responses if r.get("question_id")})
    part_by_qid: dict[str, int] = {}

    if question_ids:
        try:
            q_res = (
                supabase_admin.table("questions")
                .select("id, part")
                .in_("id", question_ids)
                .execute()
            )
            part_by_qid = {q["id"]: q["part"] for q in (q_res.data or [])}
        except Exception as e:
            logger.warning("[pronunciation/full] Failed to load questions: %s", e)

    # Group responses by part, keep only those with audio
    by_part: dict[int, list[dict]] = {1: [], 2: [], 3: []}
    for r in all_responses:
        if not r.get("audio_storage_path") and not r.get("audio_url"):
            continue
        part = part_by_qid.get(r.get("question_id", ""), 0)
        if part in by_part:
            by_part[part].append(r)

    print(
        f"[PRON/full] session={session_id}  "
        f"part1={len(by_part[1])} part2={len(by_part[2])} part3={len(by_part[3])}",
        flush=True,
    )

    if not any(by_part.values()):
        raise HTTPException(422, "Session này chưa có câu trả lời nào có audio để đánh giá.")

    # ── 3. Select samples ────────────────────────────────────────────────────
    samples: dict[str, Optional[SelectedSample]] = {
        "part1": select_part1_sample(by_part[1]),
        "part2": select_part2_sample(by_part[2]),
        "part3": select_part3_sample(by_part[3]),
    }

    # ── 4. Assess each sample ────────────────────────────────────────────────
    results: dict[str, dict] = {}

    for part_key, sample in samples.items():
        if sample is None:
            print(f"[PRON/full] {part_key}: no responses available — skipping", flush=True)
            results[part_key] = None
            continue

        print(
            f"[PRON/full] {part_key}: response={sample.response_id}  "
            f"dur={sample.duration_seconds}s  start={sample.audio_start_s}  end={sample.audio_end_s}  "
            f"reason={sample.selection_reason!r}",
            flush=True,
        )

        # Find the response dict
        resp = next(
            (r for r in all_responses if r["id"] == sample.response_id), None
        )
        if resp is None:
            results[part_key] = None
            continue

        # Download audio
        try:
            audio_bytes, content_type = await _download_audio_bytes(
                resp.get("audio_storage_path"),
                resp.get("audio_url"),
                sample.response_id,
            )
        except HTTPException as e:
            logger.warning("[pronunciation/full] %s download failed: %s", part_key, e.detail)
            results[part_key] = None
            continue

        # Extract segment for Part 2 (also converts to WAV)
        if sample.audio_start_s is not None or sample.audio_end_s is not None:
            audio_bytes = extract_audio_segment(audio_bytes, sample.audio_start_s, sample.audio_end_s)
            content_type = "audio/wav"
        elif sample.part == 2:
            # Full Part 2 audio — still extract (converts to WAV for consistency)
            audio_bytes = extract_audio_segment(audio_bytes, None, None)
            content_type = "audio/wav"

        # Azure assessment
        try:
            result = await azure_pronunciation.assess_pronunciation(
                audio_bytes=audio_bytes,
                content_type=content_type,
                locale="en-US",
                reference_text="",
            )
        except (ValueError, RuntimeError) as e:
            logger.warning("[pronunciation/full] %s Azure error: %s", part_key, e)
            results[part_key] = None
            continue

        # Persist with sample metadata
        sample_meta = {
            "full_test_sample":    True,
            "part":                sample.part,
            "selection_reason":    sample.selection_reason,
            "audio_start_s":       sample.audio_start_s,
            "audio_end_s":         sample.audio_end_s,
            "low_confidence_sample": sample.low_confidence_sample,
        }
        _upsert_pronunciation(sample.response_id, result, extra={"sample_meta": sample_meta})

        results[part_key] = {
            "response_id":         sample.response_id,
            "pronunciation_score": result.get("pronunciation_score"),
            "fluency_score":       result.get("fluency_score"),
            "accuracy_score":      result.get("accuracy_score"),
            "completeness_score":  result.get("completeness_score"),
            "prosody_score":       result.get("prosody_score"),
            "short_summary":       result.get("short_summary", []),
            "words":               result.get("words", []),
            "selection_reason":    sample.selection_reason,
            "duration_seconds":    sample.duration_seconds,
            "audio_start_s":       sample.audio_start_s,
            "audio_end_s":         sample.audio_end_s,
            "low_confidence_sample": sample.low_confidence_sample,
        }

    # ── 5. Compute overall score (average of available pron scores) ──────────
    pron_scores = [
        r["pronunciation_score"]
        for r in results.values()
        if r is not None and r.get("pronunciation_score") is not None
    ]
    overall = round(sum(pron_scores) / len(pron_scores), 1) if pron_scores else None

    print(
        f"[PRON/full] done  session={session_id}  "
        f"overall={overall}  samples_assessed={len(pron_scores)}/3",
        flush=True,
    )

    return {
        "session_id":        session_id,
        "overall_pron_score": overall,
        "samples_assessed":  len(pron_scores),
        "provider":          "azure",
        "locale":            "en-US",
        "samples": {
            "part1": results.get("part1"),
            "part2": results.get("part2"),
            "part3": results.get("part3"),
        },
    }
