"""Smoke test against the live Gemini API.

Opt-in only — costs ~$0.005 per run on gemini-2.5-flash. Excluded from the
default suite via path (tests/smoke/ skipped in CI invocation).

Run manually:
    pytest tests/smoke -m smoke -s

Auto-skips if GEMINI_API_KEY is not set in env / settings.
"""

import os

import pytest

from models.writing_feedback import GraderConfig
from services.gemini_writing_grader import GeminiWritingGrader

pytestmark = pytest.mark.smoke


SAMPLE_TASK_2 = """
Some people think that all university students should study whatever
they like. Others believe that they should only be allowed to study
subjects that will be useful in the future, such as those related to
science and technology. Discuss both these views and give your own opinion.
"""

SAMPLE_ESSAY = """
University education is a topic of debate in modern society. While some
argue students should have freedom to choose any subject, others believe
focus on practical fields like science and technology is more beneficial.

I think students should pursue what interests them. Passion drives
performance, and a motivated student in literature may contribute more
than a reluctant engineer. However, society also needs skilled workers
in critical areas. STEM fields fuel economic growth and innovation.

In conclusion, the best approach is balance. Students should have
freedom but be aware of market demands. This way, both personal
fulfillment and societal needs are met.
"""


@pytest.fixture(autouse=True)
def _check_api_key():
    """Skip when API key is unavailable (CI default)."""
    if not os.getenv("GEMINI_API_KEY"):
        # Also try settings (covers .env-only setups)
        try:
            from config import settings
            if not getattr(settings, "GEMINI_API_KEY", None):
                pytest.skip("GEMINI_API_KEY not set — skipping live smoke test")
        except Exception:
            pytest.skip("GEMINI_API_KEY not set — skipping live smoke test")


@pytest.mark.asyncio
async def test_smoke_real_gemini_grading():
    """Live API: grade sample essay at Level 3 with flash to keep cost low."""
    grader = GeminiWritingGrader()

    config = GraderConfig(
        task_type="task2",
        prompt_text=SAMPLE_TASK_2,
        essay_text=SAMPLE_ESSAY,
        analysis_level=3,
        form_of_address="em",
        selected_model="gemini-2.5-flash",
    )

    result = await grader.grade_essay(config)

    # Sanity bounds
    assert 0 <= result.feedback.overallBandScore <= 9
    assert len(result.feedback.criteriaFeedback.mainCriterion.feedback) > 50
    assert len(result.feedback.improvedEssay) > 100
    assert (result.tokens_input or 0) > 0
    assert (result.tokens_output or 0) > 0
    assert result.cost_usd is not None
    assert result.cost_usd < 0.05  # Generous ceiling on flash for a 250-word essay

    print("\n=== LIVE SMOKE TEST RESULT ===")
    print(f"Band:       {result.feedback.overallBandScore}")
    print(f"Tokens:     in={result.tokens_input}, out={result.tokens_output}")
    print(f"Cost:       ${result.cost_usd:.4f}")
    print(f"Duration:   {result.grading_duration_ms} ms")
    print(f"Mistakes:   {len(result.feedback.mistakeAnalysis)}")
