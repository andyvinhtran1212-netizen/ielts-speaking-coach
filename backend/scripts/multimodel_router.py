"""Offline 2-pass routing prototype for the multi-model plan (P1-B, Mức 1).

EXPERIMENTAL / MEASUREMENT ONLY — lives in scripts/, calls the existing grader's
methods, and changes NO production code path. It exists so the calibration
harness can measure whether routing holds band quality at L4 before any live
rollout.

The route splits one grading into two model calls:
  - JUDGMENT pass (strong model, e.g. gemini-2.5-pro): band + criteria +
    keyTakeaways + coherence/idea/counterargument. Token-light (no rewrite,
    no mistake list) → cheap on the dear model.
  - MECHANICAL pass (cheap model, e.g. gemini-2.5-flash): mistakeAnalysis,
    lexical, sentence-structure, improvedEssay, aiContent — given the
    judgment pass's band as an anchor so it can't contradict the score.
Each pass appends a directive telling the model which sections to fill and
which to leave as cheap placeholders; `merge_passes()` then assembles the real
fields from each into one valid WritingFeedback.

Savings come from the strong (dear) model NOT generating the token-heavy
rewrite + mistake list — those run on the cheap model. Quality of the band
stays on the strong model. Whether that trade holds at L4 is what the harness
measures (`--routed`).
"""

from __future__ import annotations

import time
from typing import Optional

from models.writing_feedback import GraderConfig, GradingResult, WritingFeedback

# Fields each pass OWNS in the merge.
_JUDGMENT_FIELDS = (
    "overallBandScore", "overallBandScoreSummary", "keyTakeaways",
    "criteriaFeedback", "coherenceAnalysis", "ideaDevelopmentAnalysis",
    "counterargumentAnalysis",
)
_MECHANICAL_FIELDS = (
    "mistakeAnalysis", "lexicalAnalysis", "sentenceStructureAnalysis",
    "improvedEssay", "aiContentAnalysis",
)
# History-aware fields ride with the judgment pass (band-trajectory etc.).
_PASSTHROUGH_JUDGMENT = ("bandTrajectoryAnalysis", "recurringPatterns")

_JUDGMENT_DIRECTIVE = """

## MULTI-PASS ROUTING — JUDGMENT/REASONING PASS (token-saving)
You are the JUDGMENT pass. Produce complete, accurate values for: overallBandScore,
overallBandScoreSummary, keyTakeaways, criteriaFeedback, and (per the level rules
above) coherenceAnalysis / ideaDevelopmentAnalysis / counterargumentAnalysis.
A SEPARATE pass writes the mechanical sections — to save tokens, return ONLY these
placeholders for them: mistakeAnalysis: [], lexicalAnalysis: null,
sentenceStructureAnalysis: null, improvedEssay: "",
aiContentAnalysis: {"likelihood": 0, "explanation": ""}.
Do NOT spend tokens on the improved-essay rewrite or the mistake list.
"""

_MECHANICAL_DIRECTIVE = """

## MULTI-PASS ROUTING — MECHANICAL PASS (band already decided)
The band was already decided by the judgment pass: overall band = {band}.
Produce complete, accurate values for: mistakeAnalysis, improvedEssay,
aiContentAnalysis, and (per the level rules above) lexicalAnalysis /
sentenceStructureAnalysis. Write the improved essay and corrections consistent
with band {band} — do NOT contradict that score.
For the judgment sections, return ONLY these placeholders (they are replaced):
overallBandScore: {band}, overallBandScoreSummary: "-",
keyTakeaways: {{"strengths": ["-"], "areasForImprovement": ["-"]}},
criteriaFeedback: all four criteria with bandScore {band_int}, explanation "-",
feedback "-"; coherenceAnalysis: null, ideaDevelopmentAnalysis: null,
counterargumentAnalysis: null.
"""


def merge_passes(judgment: WritingFeedback, mechanical: WritingFeedback) -> WritingFeedback:
    """Assemble one WritingFeedback from the two passes — judgment fields from
    the strong pass, mechanical fields from the cheap pass. Pure (no IO)."""
    data = {}
    for f in _JUDGMENT_FIELDS + _PASSTHROUGH_JUDGMENT:
        data[f] = getattr(judgment, f)
    for f in _MECHANICAL_FIELDS:
        data[f] = getattr(mechanical, f)
    return WritingFeedback(**data)


async def _grade_pass(grader, loader, config: GraderConfig, directive: str,
                      *, image) -> tuple[WritingFeedback, dict, str, int]:
    """Run one pass: base system prompt + directive, reusing the grader's call
    + parse path. Returns (feedback, usage, model, duration_ms)."""
    start = time.time()
    system_prompt = loader.load(
        level=config.analysis_level, form_of_address=config.form_of_address,
    ) + directive
    user_prompt = grader._build_user_prompt(config)
    extra = {"image": image} if image is not None else {}
    response_text, usage = await grader._call_with_retry(
        model_name=config.selected_model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        parse_schema=WritingFeedback,
        **extra,
    )
    feedback = grader._parse_response(response_text, schema=WritingFeedback)
    return feedback, usage, config.selected_model, int((time.time() - start) * 1000)


async def routed_grade_essay(essay: dict, *, strong_model: str, cheap_model: str,
                             level: int) -> GradingResult:
    """2-pass routed grading of one essay. Reuses the production grader's
    methods but assembles a routed result. Cost = sum of both passes; latency =
    sum (the cheap pass needs the judgment band, so they run sequentially)."""
    from services.gemini_writing_grader import get_grader, get_prompt_loader
    grader = get_grader()
    loader = get_prompt_loader()

    def _cfg(model: str) -> GraderConfig:
        return GraderConfig(
            task_type=essay["task_type"], prompt_text=essay["prompt_text"],
            essay_text=essay["essay_text"], analysis_level=level,
            selected_model=model, prompt_image_url=essay.get("prompt_image_url"),
        )

    strong_cfg, cheap_cfg = _cfg(strong_model), _cfg(cheap_model)
    image = await grader._maybe_fetch_prompt_image(strong_cfg)

    j_fb, j_usage, _, j_ms = await _grade_pass(
        grader, loader, strong_cfg, _JUDGMENT_DIRECTIVE, image=image)

    band = j_fb.overallBandScore
    mech_directive = _MECHANICAL_DIRECTIVE.format(band=band, band_int=int(round(band)))
    m_fb, m_usage, _, m_ms = await _grade_pass(
        grader, loader, cheap_cfg, mech_directive, image=image)

    merged = merge_passes(j_fb, m_fb)

    def _cost(model, usage):
        return grader._calculate_cost(model, usage.get("input_tokens"), usage.get("output_tokens"))
    c_strong = _cost(strong_model, j_usage)
    c_cheap = _cost(cheap_model, m_usage)
    total_cost = None if c_strong is None or c_cheap is None else round(c_strong + c_cheap, 6)

    return GradingResult(
        feedback=merged,
        model_used=f"routed:{strong_model}+{cheap_model}",
        tokens_input=(j_usage.get("input_tokens") or 0) + (m_usage.get("input_tokens") or 0),
        tokens_output=(j_usage.get("output_tokens") or 0) + (m_usage.get("output_tokens") or 0),
        cost_usd=total_cost,
        grading_duration_ms=j_ms + m_ms,
        prompt_version=f"{loader.PROMPT_VERSION}-routed",
    )
