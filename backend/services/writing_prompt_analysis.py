"""services/writing_prompt_analysis.py — Task 1 chart → verified answer key.

One-time vision extraction of a Task 1 Academic prompt image into static facts
(`PromptImageAnalysis`) that an admin reviews and that later anchor Task
Achievement grading. See docs/WRITING_TASK1_ANALYSIS_SPEC.md.

Reuses the writing grader's Gemini call/parse machinery (`_call_with_retry` +
`_parse_response`) so the retry / JSON-repair behaviour matches grading exactly —
no second copy of that logic to keep in sync.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from config import settings
from models.writing_feedback import PromptImageAnalysis
from services.gemini_writing_grader import get_grader
from services.writing_prompt_image import detect_format


logger = logging.getLogger(__name__)

_FETCH_TIMEOUT_S = 20.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

_SYSTEM_PROMPT = (
    "You are an IELTS Academic Writing Task 1 examiner. Read the prompt IMAGE and "
    "extract the answer key: the OBJECTIVE facts a band-9 response must report. "
    "First decide the visual type (chart_type), then apply the matching rules "
    "below.\n\n"
    "== Language ==\n"
    "Write EVERY value in English (overview, key_features, notable_data labels and "
    "units, axes_or_categories, grading_note), even if the prompt text or these "
    "instructions contain another language. Copy labels from the image verbatim.\n\n"
    "== Time frame and tense ==\n"
    "- Take the time frame ONLY from the image and the prompt text. The user "
    "message states today's date; a year up to the current year is past data.\n"
    "- Never call a figure projected, forecast, predicted or estimated because "
    "its year seems late to you. Use those words, or future forms, only when the "
    "image or prompt marks the figures that way (e.g. 'projected', 'forecast', "
    "'(est.)', 'planned', 'proposed', a legend for a projection).\n"
    "- Describe past data in past tense. In grading_note, state the time frame "
    "and the tense a response should use (e.g. 'all figures are past (2015–2025): "
    "past tenses').\n\n"
    "== DATA CHARTS (line/bar/pie/table) ==\n"
    "- overview: the overall trends / biggest differences (1–2 sentences).\n"
    "- key_features: 3–6 trends / comparisons / extremes a response must cover.\n"
    "- notable_data: the checkable figures ({label, value, unit}). For a TABLE, "
    "and for any chart that prints its values, include EVERY printed value: one "
    "entry per cell or data label, labelled '<row> <column>' (e.g. 'Zoo 2015'), "
    "with no row or column skipped. A blank or '–' cell is not a value: leave it "
    "out and say so in grading_note. For values read off an axis, give the "
    "closest reading and prefix it with 'about'. Above 40 values, keep the "
    "start/end points and extremes of every series.\n"
    "- axes_or_categories: axes / units / categories (all rows and columns of a "
    "table).\n\n"
    "== MAPS (usually before/after, or two sites) ==\n"
    "- overview: the OVERALL change + the time frame (e.g. 'the area became more "
    "residential and commercial between 1990 and 2010').\n"
    "- key_features: every discrete change, ONE change per line, in the form "
    "'<location>: <feature> added/removed/moved/extended/reduced/converted "
    "into/unchanged'. Do not merge changes. Cover every change you can see.\n"
    "- Report only features that are labelled or clearly drawn in the image, using "
    "their labels. Take compass directions from the map's north arrow (top = north "
    "if there is none) and describe locations relative to labelled features. If a "
    "location is unclear, leave it out rather than guess. Never add a feature, "
    "name, number or direction that is not in the image.\n"
    "- notable_data: only numbers printed on the map (e.g. 'Car park (120 "
    "spaces)'); otherwise empty.\n"
    "- axes_or_categories: the panels / time frame, or empty.\n\n"
    "== PROCESS DIAGRAMS ==\n"
    "- overview: the NUMBER of stages + whether the process is LINEAR or CYCLICAL "
    "+ where it starts and ends.\n"
    "- key_features: EVERY stage IN ORDER, each line starting 'Stage N:' with the "
    "input→output where shown. The ORDER is mandatory.\n"
    "- notable_data: only numbers printed in the diagram (durations, "
    "quantities); otherwise empty.\n"
    "- axes_or_categories: empty.\n\n"
    "== General ==\n"
    "- chart_type: one of line|bar|pie|table|map|process|mixed.\n"
    "- grading_note: a short note for the grader (time frame and tense, missing "
    "cells, anything that is easy to misread).\n"
    "Describe ONLY what is in the image. NEVER invent figures. Return JSON only."
)


def prompt_analysis_usage_context(
    prompt_id: str,
    *,
    requested_by: Optional[str],
    trigger: str,
) -> dict:
    """ai_usage_logs context for one extraction: the prompt it ran on and the
    admin whose create/PATCH/reanalyze started it (None for the backfill
    script, which has no requesting user)."""
    return {
        "user_id": requested_by,
        "session_id": None,
        "feature": "writing_prompt_analysis",
        "operation": "extract_answer_key",
        "resource_type": "writing_prompt",
        "resource_id": prompt_id,
        "metadata": {"prompt_id": prompt_id, "trigger": trigger},
    }


async def analyze_prompt_image(
    *,
    image_url: str,
    prompt_text: Optional[str] = None,
    model: Optional[str] = None,
    usage_context: Optional[dict] = None,
) -> tuple[PromptImageAnalysis, str]:
    """Download the prompt chart and extract its verified answer key.

    Returns ``(analysis, model_used)``. Raises on fetch / non-image / parse
    failure — the caller (the BG trigger) catches and records status='failed'
    so the admin UI can offer a re-analyze. This function does NOT touch the DB
    (the grader call writes its ai_usage_logs rows with ``usage_context``).
    """
    resolved_model = model or settings.WRITING_ANALYSIS_MODEL

    # `image_url` is the stored ref; a private-bucket path is signed for this
    # fetch only (services/writing_image_access.py).
    from services.writing_image_access import fetchable_image_url
    fetch_url = await asyncio.to_thread(fetchable_image_url, image_url)
    if not fetch_url:
        raise RuntimeError("prompt image is not fetchable (signing unavailable)")
    async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT_S) as client:
        resp = await client.get(fetch_url)
    if resp.status_code != 200 or not resp.content:
        raise RuntimeError(f"prompt image fetch failed: HTTP {resp.status_code}")

    fmt = detect_format(resp.content)
    if fmt is None:
        raise RuntimeError("prompt image is not a supported PNG/JPG/WebP payload")
    mime = "image/jpeg" if fmt == "jpg" else f"image/{fmt}"

    grader = get_grader()
    # Today's date anchors the tense rule: without it the model reads a recent
    # past year (e.g. 2025) as "projected" data.
    user_prompt = (
        f"Today's date: {datetime.now(timezone.utc).date().isoformat()}\n\n"
        f"## Prompt text\n{prompt_text or '(no prompt text)'}\n\n"
        "Extract the answer key from the attached IMAGE. Write it in English."
    )
    text, _usage = await grader._call_with_retry(
        model_name=resolved_model,
        system_prompt=_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        image=(resp.content, mime),
        parse_schema=PromptImageAnalysis,
        usage_context=usage_context,
    )
    analysis = grader._parse_response(text, schema=PromptImageAnalysis)
    return analysis, resolved_model


# ── DB-aware orchestration (trigger + BG task) ────────────────────────


def image_needs_analysis(prompt: dict) -> bool:
    """True when a task1_academic prompt has an image whose public_id differs
    from the one the current analysis was derived from — i.e. the chart is new
    or was replaced, so the answer key is missing or stale."""
    if prompt.get("task_type") != "task1_academic" or not prompt.get("prompt_image_url"):
        return False
    return prompt.get("prompt_image_public_id") != prompt.get("prompt_image_analysis_public_id")


def mark_analysis_pending(
    prompt_id: str,
    expected_image_public_id: str,
) -> str | None:
    """Flip the prompt into 'pending' (and un-review) so the UI shows work in
    flight the instant a create/PATCH/reanalyze is accepted, before the BG task
    runs. Un-reviewing here is intentional: a new image must be re-approved."""
    from database import supabase_admin
    pending_token = _now_iso()
    result = supabase_admin.table("writing_prompts").update({
        "prompt_image_analysis_status":   "pending",
        "prompt_image_analysis_reviewed": False,
        "prompt_image_analysis_error":    None,
        # Also serves as the revision token for this extraction request. A
        # slower older task cannot overwrite a later reanalysis of the same
        # storage object.
        "prompt_image_analysis_at":       pending_token,
    }).eq("id", prompt_id).eq(
        "task_type", "task1_academic"
    ).eq(
        "prompt_image_public_id", expected_image_public_id
    ).execute()
    return pending_token if result.data else None


async def run_and_store_analysis(
    prompt_id: str,
    expected_pending_at: str | None = None,
    *,
    requested_by: str | None = None,
    trigger: str = "backfill",
) -> None:
    """BG task: (re)extract the answer key for one prompt and persist it.

    NEVER raises — a failure records status='failed' + the error so the admin UI
    can offer a re-analyze. Stamps `analysis_public_id` with the image it ran on
    so `image_needs_analysis` won't re-trigger until the chart changes again. The
    result lands `reviewed=False` — an admin must approve before it grades."""
    from database import supabase_admin
    try:
        rows = (
            supabase_admin.table("writing_prompts")
            .select(
                "id, task_type, prompt_text, prompt_image_url, "
                "prompt_image_public_id, prompt_image_analysis_at"
            )
            .eq("id", prompt_id).limit(1).execute()
        ).data
        if not rows:
            return
        p = rows[0]
        if p.get("task_type") != "task1_academic" or not p.get("prompt_image_url"):
            return
        if (
            expected_pending_at is not None
            and p.get("prompt_image_analysis_at") != expected_pending_at
        ):
            logger.info("[prompt-analysis] stale request skipped prompt=%s", prompt_id)
            return

        analysis, model = await analyze_prompt_image(
            image_url=p["prompt_image_url"], prompt_text=p.get("prompt_text"),
            usage_context=prompt_analysis_usage_context(
                prompt_id, requested_by=requested_by, trigger=trigger,
            ),
        )
        # Compare-and-set on the storage fingerprint. The chart can be replaced
        # while the model is running; an old result must never become the answer
        # key for the new image.
        ready_query = supabase_admin.table("writing_prompts").update({
            "prompt_image_analysis":           analysis.model_dump(),
            "prompt_image_analysis_status":    "ready",
            "prompt_image_analysis_reviewed":  False,
            "prompt_image_analysis_model":     model,
            "prompt_image_analysis_public_id": p.get("prompt_image_public_id"),
            "prompt_image_analysis_error":     None,
            "prompt_image_analysis_at":        _now_iso(),
        }).eq("id", prompt_id).eq(
            "prompt_image_public_id", p.get("prompt_image_public_id")
        )
        if expected_pending_at is not None:
            ready_query = ready_query.eq(
                "prompt_image_analysis_at", expected_pending_at
            )
        result = ready_query.execute()
        if not result.data:
            logger.info("[prompt-analysis] stale result discarded prompt=%s", prompt_id)
            return
        logger.info("[prompt-analysis] ready prompt=%s model=%s", prompt_id, model)
    except Exception as exc:  # noqa: BLE001 — BG task, must not surface
        logger.warning("[prompt-analysis] failed prompt=%s: %s", prompt_id, exc)
        try:
            failure_query = supabase_admin.table("writing_prompts").update({
                "prompt_image_analysis_status": "failed",
                "prompt_image_analysis_error":  str(exc)[:500],
                "prompt_image_analysis_at":     _now_iso(),
            }).eq("id", prompt_id)
            # `p` is available after the canonical row read. If the failure
            # happened before that read completed, do not risk marking an
            # unrelated/current image failed.
            if "p" in locals():
                failure_query = failure_query.eq(
                    "prompt_image_public_id", p.get("prompt_image_public_id")
                )
                if expected_pending_at is not None:
                    failure_query = failure_query.eq(
                        "prompt_image_analysis_at", expected_pending_at
                    )
                failure_query.execute()
        except Exception:  # noqa: BLE001 — best effort
            pass
