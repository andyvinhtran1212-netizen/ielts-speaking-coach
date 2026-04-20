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
from pydantic import BaseModel

import math

from database import supabase_admin
from routers.auth import get_supabase_user
from routers.sessions import update_session_bands
from services import azure_pronunciation
from services.pronunciation_sampling import (
    SelectedSample,
    extract_audio_segment,
    select_part1_sample,
    select_part2_sample,
    select_part3_sample,
)


class FullPronRequest(BaseModel):
    extra_session_ids: list[str] = []

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


# ── Multi-signal score_confidence helper ──────────────────────────────────────

def _compute_multi_signal_confidence(
    reliability_label: str,
    duration_sec: float,
    pronunciation_score: Optional[float],
) -> str:
    """
    Compute score_confidence using all available signals post-grading:
      transcript reliability, speaking duration, and Azure pronunciation score.

    Called after pronunciation assessment completes; overwrites the
    reliability+duration-only value stored at initial grading time.

      "low"    — unreliable transcript OR too short OR pronunciation_score < 35
      "high"   — reliability=high AND normal duration AND pronunciation_score >= 65
      "medium" — everything else
    """
    if reliability_label == "low" or duration_sec < 10.0:
        return "low"
    if pronunciation_score is not None and pronunciation_score < 35:
        return "low"
    if (
        reliability_label == "high"
        and 20.0 <= duration_sec <= 180.0
        and (pronunciation_score is None or pronunciation_score >= 65)
    ):
        return "high"
    return "medium"


# ── Band adjustment helpers ───────────────────────────────────────────────────

def _round_band(value: float) -> float:
    """Round to nearest 0.5, clamp to [1.0, 9.0]. Mirrors sessions.py logic."""
    rounded = math.floor(value * 2 + 0.5) / 2
    return max(1.0, min(9.0, rounded))


def _compute_adjusted_band_p(
    band_p_original: float,
    pronunciation_score: float,
    fluency_score: Optional[float],
    reliability_label: str,
) -> float:
    """
    Post-hoc adjust the P criterion band using Azure pronunciation signals.

    Strategy: 40% dampened delta with cap based on transcript reliability.
      - Scale Azure 0–100 scores to IELTS 1–9 band scale.
      - Blend pronunciation + fluency equally when both are available.
      - Apply only 40% of the raw delta (dampening factor to prevent score shock).
      - Cap the total adjustment: ±0.5 (low) | ±0.75 (medium) | ±1.0 (high).
    """
    # Azure 0-100 → IELTS 1-9 linear scaling
    pron_band = 1.0 + (pronunciation_score / 100.0) * 8.0
    if fluency_score is not None:
        fluency_band = 1.0 + (fluency_score / 100.0) * 8.0
        pron_band = 0.5 * pron_band + 0.5 * fluency_band

    delta = pron_band - band_p_original

    # Max adjustment grows with transcript reliability
    max_delta = {"low": 0.5, "medium": 0.75}.get(reliability_label, 1.0)

    # 40% dampening — only partially trust the pronunciation signal
    adjustment = max(-max_delta, min(max_delta, delta * 0.4))

    return _round_band(band_p_original + adjustment)


def _compute_final_overall_band(
    band_fc: float,
    band_lr: float,
    band_gra: float,
    final_band_p: float,
) -> float:
    """Recompute overall band as a simple average of all 4 criteria."""
    return _round_band((band_fc + band_lr + band_gra + final_band_p) / 4.0)


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

    # ── 6. Load response metadata + feedback for post-hoc adjustment ─────────
    updated_confidence: Optional[str] = None
    final_band_p:       Optional[float] = None
    final_overall_band: Optional[float] = None

    try:
        meta_res = (
            supabase_admin.table("responses")
            .select("transcript_reliability, duration_seconds, feedback, overall_band")
            .eq("id", response_id)
            .limit(1)
            .execute()
        )
        meta = (meta_res.data or [{}])[0]
        reliability_label = meta.get("transcript_reliability") or "high"
        duration_sec_meta = float(meta.get("duration_seconds") or 0.0)
        pron_score        = result.get("pronunciation_score")
        fluency_score_raw = result.get("fluency_score")

        # Update multi-signal score_confidence
        updated_confidence = _compute_multi_signal_confidence(
            reliability_label, duration_sec_meta, pron_score
        )

        # Attempt to compute final_band_p and final_overall_band
        # Requires: pronunciation_score available + feedback JSON with band_p (test mode only)
        confidence_update: dict = {"score_confidence": updated_confidence}

        if pron_score is not None:
            raw_feedback = meta.get("feedback")
            if raw_feedback:
                try:
                    feedback_obj = _json.loads(raw_feedback) if isinstance(raw_feedback, str) else raw_feedback
                    band_p_orig = feedback_obj.get("band_p")
                    if band_p_orig is not None:
                        # Test mode: adjust P criterion band
                        final_band_p = _compute_adjusted_band_p(
                            float(band_p_orig),
                            pron_score,
                            fluency_score_raw,
                            reliability_label,
                        )
                        band_fc  = feedback_obj.get("band_fc")
                        band_lr  = feedback_obj.get("band_lr")
                        band_gra = feedback_obj.get("band_gra")
                        if band_fc is not None and band_lr is not None and band_gra is not None:
                            final_overall_band = _compute_final_overall_band(
                                float(band_fc), float(band_lr), float(band_gra), final_band_p
                            )
                        confidence_update["final_band_p"] = final_band_p
                        if final_overall_band is not None:
                            confidence_update["final_overall_band"] = final_overall_band
                        logger.info(
                            "[pronunciation] band_p %s → %s  overall %s → %s  response=%s",
                            band_p_orig, final_band_p,
                            feedback_obj.get("overall_band"), final_overall_band,
                            response_id,
                        )
                    else:
                        # Practice mode: no band_p; apply a proportional tweak to overall_band
                        overall_orig = meta.get("overall_band")
                        if overall_orig is not None:
                            pron_band_equiv = 1.0 + (pron_score / 100.0) * 8.0
                            if fluency_score_raw is not None:
                                pron_band_equiv = 0.5 * pron_band_equiv + 0.5 * (1.0 + (fluency_score_raw / 100.0) * 8.0)
                            # P criterion ≈ 25% weight; apply 40% of that delta → 10% net effect
                            delta = (pron_band_equiv - float(overall_orig)) * 0.25 * 0.4
                            max_delta = {"low": 0.25, "medium": 0.375}.get(reliability_label, 0.5)
                            adjustment = max(-max_delta, min(max_delta, delta))
                            final_overall_band = _round_band(float(overall_orig) + adjustment)
                            confidence_update["final_overall_band"] = final_overall_band
                            logger.info(
                                "[pronunciation] practice overall %s → %s  response=%s",
                                overall_orig, final_overall_band, response_id,
                            )
                except Exception as fe:
                    logger.warning("[pronunciation] feedback parse for band adjustment failed (non-fatal): %s", fe)

        supabase_admin.table("responses").update(confidence_update).eq("id", response_id).execute()
        logger.info(
            "[pronunciation] score_confidence → %r  response=%s",
            updated_confidence, response_id,
        )

        # Propagate adjusted scores into the session aggregate immediately so
        # dashboard / history read pronunciation-adjusted bands, not the stale raw AI grade.
        # Use OR: practice mode sets final_overall_band only (no band_p criterion in practice feedback);
        # test mode sets final_band_p.  Either signal means a re-aggregate is needed.
        if final_band_p is not None or final_overall_band is not None:
            try:
                s_check = (
                    supabase_admin.table("sessions")
                    .select("status")
                    .eq("id", session_id)
                    .limit(1)
                    .execute()
                )
                if (s_check.data or [{}])[0].get("status") == "completed":
                    update_session_bands(session_id)
            except Exception as _se:
                logger.warning("[pronunciation] session re-aggregate failed (non-fatal): %s", _se)

    except Exception as e:
        logger.warning("[pronunciation] post-hoc update failed (non-fatal): %s", e)

    # ── 7. Return normalized result ──────────────────────────────────────────
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
        "score_confidence":      updated_confidence,
        "final_band_p":          final_band_p,
        "final_overall_band":    final_overall_band,
    }


# ── POST /sessions/{session_id}/pronunciation/full ────────────────────────────

@router.post("/sessions/{session_id}/pronunciation/full")
async def assess_full_test_pronunciation(
    session_id: str,
    body: FullPronRequest = FullPronRequest(),
    authorization: str | None = Header(default=None),
):
    """
    Assess pronunciation for a full-test session by selecting one representative
    sample from each of Parts 1, 2, and 3.

    Full-test mode spreads responses across 3 separate sessions (one per part).
    Pass the other session IDs via the JSON body as extra_session_ids.

    Selection rules:
      - Part 1: prefer duration >= 12s; random among qualifiers; longest fallback
      - Part 2: longest response; segment [10s–45s] / middle-third / full with flag
      - Part 3: prefer duration >= 15s; random among qualifiers; longest fallback

    Returns:
        session_id, overall_pron_score (average of available samples),
        samples: {part1, part2, part3} — each with scores + metadata
    """
    # ── 1. Auth + ownership for ALL sessions ─────────────────────────────────
    auth_user = await get_supabase_user(authorization)
    user_id   = auth_user["id"]

    all_session_ids = list({session_id} | set(body.extra_session_ids))

    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id")
            .in_("id", all_session_ids)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải session: {e}")

    found_ids = {r["id"] for r in (s_res.data or [])}
    if session_id not in found_ids:
        raise HTTPException(404, "Session không tồn tại hoặc không có quyền truy cập")

    # ── 2. Load responses from ALL sessions + questions (join in Python) ──────
    try:
        resp_res = (
            supabase_admin.table("responses")
            .select("id, question_id, audio_storage_path, audio_url, duration_seconds")
            .in_("session_id", list(found_ids))
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
        f"[PRON/full] sessions={all_session_ids}  "
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

    # Aggregate confidence from overall pronunciation score
    overall_confidence: Optional[str] = None
    if overall is not None:
        if overall < 35:
            overall_confidence = "low"
        elif overall >= 65:
            overall_confidence = "high"
        else:
            overall_confidence = "medium"

    # ── 5b. Compute aggregate final_band_p across all sampled responses ──────
    # Load band_p and reliability from each sampled response's feedback JSON.
    # Apply the same dampened-delta logic; average the final_band_p values.
    agg_final_band_p:       Optional[float] = None
    agg_final_overall_band: Optional[float] = None

    if overall is not None:
        sampled_response_ids = [
            r["response_id"] for r in results.values()
            if r is not None and r.get("response_id")
        ]
        if sampled_response_ids:
            try:
                fb_res = (
                    supabase_admin.table("responses")
                    .select("id, feedback, overall_band, transcript_reliability, duration_seconds")
                    .in_("id", sampled_response_ids)
                    .execute()
                )
                fb_rows = {row["id"]: row for row in (fb_res.data or [])}

                adjusted_p_values: list[float] = []
                fc_vals, lr_vals, gra_vals = [], [], []

                for part_key, r in results.items():
                    if r is None:
                        continue
                    rid = r.get("response_id")
                    if not rid or rid not in fb_rows:
                        continue
                    row      = fb_rows[rid]
                    rel      = row.get("transcript_reliability") or "high"
                    pron_s   = r.get("pronunciation_score")
                    flu_s    = r.get("fluency_score")

                    raw_fb = row.get("feedback")
                    if raw_fb and pron_s is not None:
                        try:
                            fb_obj = _json.loads(raw_fb) if isinstance(raw_fb, str) else raw_fb
                            bp = fb_obj.get("band_p")
                            if bp is not None:
                                adj = _compute_adjusted_band_p(float(bp), pron_s, flu_s, rel)
                                adjusted_p_values.append(adj)
                                # Persist final_band_p to this response row so session
                                # re-aggregate can use the canonical field.
                                try:
                                    supabase_admin.table("responses").update(
                                        {"final_band_p": adj}
                                    ).eq("id", rid).execute()
                                except Exception as _we:
                                    logger.warning(
                                        "[pronunciation/full] write final_band_p failed response=%s: %s",
                                        rid, _we,
                                    )
                                if fb_obj.get("band_fc") is not None:
                                    fc_vals.append(float(fb_obj["band_fc"]))
                                if fb_obj.get("band_lr") is not None:
                                    lr_vals.append(float(fb_obj["band_lr"]))
                                if fb_obj.get("band_gra") is not None:
                                    gra_vals.append(float(fb_obj["band_gra"]))
                        except Exception:
                            pass

                if adjusted_p_values:
                    agg_final_band_p = _round_band(sum(adjusted_p_values) / len(adjusted_p_values))
                    if fc_vals and lr_vals and gra_vals:
                        avg_fc  = sum(fc_vals)  / len(fc_vals)
                        avg_lr  = sum(lr_vals)  / len(lr_vals)
                        avg_gra = sum(gra_vals) / len(gra_vals)
                        agg_final_overall_band = _compute_final_overall_band(
                            avg_fc, avg_lr, avg_gra, agg_final_band_p
                        )
                    logger.info(
                        "[pronunciation/full] agg_final_band_p=%.1f  agg_final_overall=%.1f",
                        agg_final_band_p or 0,
                        agg_final_overall_band or 0,
                    )

                    # Re-aggregate each session in the full-test group so session-level bands
                    # reflect pronunciation-adjusted scores on the dashboard and history.
                    all_session_ids = [session_id] + body.extra_session_ids
                    for _sid in all_session_ids:
                        try:
                            _s_check = (
                                supabase_admin.table("sessions")
                                .select("status")
                                .eq("id", _sid)
                                .limit(1)
                                .execute()
                            )
                            if (_s_check.data or [{}])[0].get("status") == "completed":
                                update_session_bands(_sid)
                        except Exception as _se:
                            logger.warning(
                                "[pronunciation/full] session re-aggregate failed session=%s (non-fatal): %s",
                                _sid, _se,
                            )

            except Exception as e:
                logger.warning("[pronunciation/full] aggregate band adjustment failed (non-fatal): %s", e)

    # Read back the canonical session-level overall_band now that update_session_bands
    # has written it.  This is the authoritative value; agg_final_overall_band is an
    # intermediate per-response artifact and must not be presented as session truth.
    session_overall_band: Optional[float] = None
    try:
        _s_row = (
            supabase_admin.table("sessions")
            .select("overall_band")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        _val = (_s_row.data or [{}])[0].get("overall_band")
        if _val is not None:
            session_overall_band = float(_val)
    except Exception as _re:
        logger.warning("[pronunciation/full] failed to read back session overall_band (non-fatal): %s", _re)

    print(
        f"[PRON/full] done  session={session_id}  "
        f"overall={overall}  confidence={overall_confidence}  samples_assessed={len(pron_scores)}/3  "
        f"final_band_p={agg_final_band_p}  session_overall_band={session_overall_band}",
        flush=True,
    )

    return {
        "session_id":              session_id,
        "overall_pron_score":      overall,
        "overall_confidence":      overall_confidence,
        "samples_assessed":        len(pron_scores),
        "provider":                "azure",
        "locale":                  "en-US",
        "final_band_p":            agg_final_band_p,
        # Canonical session-level truth: sourced from sessions.overall_band after
        # update_session_bands() has run.  final_overall_band (per-response intermediate)
        # is intentionally not returned here to avoid ambiguity at session scope.
        "overall_band":            session_overall_band,
        "samples": {
            "part1": results.get("part1"),
            "part2": results.get("part2"),
            "part3": results.get("part3"),
        },
    }
