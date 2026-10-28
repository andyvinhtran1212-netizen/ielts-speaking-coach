from datetime import date

import pytest

from services.ai_pricing import (
    TOKEN_RATES,
    effective_logged_cost,
    estimate_token_cost,
    estimate_unit_cost,
    image_input_tokens_bound,
    token_rate,
)


def test_haiku55_release_and_short_context_cache_rates():
    assert estimate_token_cost("anthropic", "claude-haiku-5-5", input_tokens=10,
                               at=date(2026, 10, 6)) == (None, None)
    cost, version = estimate_token_cost(
        "anthropic", "claude-haiku-5-5", input_tokens=1000, output_tokens=1000,
        cache_read_tokens=1000, cache_write_tokens=1000, at=date(2026, 10, 7),
    )
    assert cost == 0.000735
    assert ":2026-10-07:" in version


def test_haiku55_long_context_includes_cached_prompt_tokens_and_all_output():
    cost, _ = estimate_token_cost(
        "anthropic", "claude-haiku-5-5", input_tokens=1,
        cache_read_tokens=99000, cache_write_tokens=1000, output_tokens=1000,
        at=date(2026, 10, 12),
    )
    assert cost == round((0.1 + 99000 * 0.01 + 1000 * 0.125 + 1000 * 0.5) * 5 / 1_000_000, 8)
    boundary, _ = estimate_token_cost(
        "anthropic", "claude-haiku-5-5", input_tokens=100000, output_tokens=1000,
        at=date(2026, 10, 12),
    )
    assert boundary == 0.0105


def test_gemini_38_promo_and_2027_rates_are_effective_dated():
    promo, promo_version = estimate_token_cost(
        "google", "gemini-3.8-flash",
        input_tokens=1_000_000, output_tokens=1_000_000,
        at=date(2026, 12, 31),
    )
    regular, regular_version = estimate_token_cost(
        "google", "gemini-3.8-flash",
        input_tokens=1_000_000, output_tokens=1_000_000,
        at=date(2027, 1, 1),
    )
    assert promo == 4.50
    assert regular == 9.00
    assert promo_version != regular_version


def test_gemini_catalog_uses_official_release_dates():
    assert estimate_token_cost(
        "google", "gemini-3.8-flash", input_tokens=1,
        at=date(2026, 9, 1),
    ) == (None, None)
    cost, version = estimate_token_cost(
        "google", "gemini-3.8-flash", input_tokens=1_000_000,
        at=date(2026, 9, 2),
    )
    assert cost == 0.75
    assert ":2026-09-02:" in version


def test_gemini_thinking_tokens_are_billed_as_output():
    cost, _ = estimate_token_cost(
        "google", "gemini-3.5-flash",
        input_tokens=100, output_tokens=200, thinking_tokens=300,
        at=date(2026, 9, 18),
    )
    assert cost == round((100 * 1.5 + 500 * 9.0) / 1_000_000, 8)


def test_claude_price_is_model_aware_including_cache():
    haiku, _ = estimate_token_cost(
        "anthropic", "claude-haiku-4-5-20251001",
        input_tokens=1_000_000, output_tokens=1_000_000,
        cache_read_tokens=1_000_000, cache_write_tokens=1_000_000,
        at=date(2026, 9, 18),
    )
    sonnet, _ = estimate_token_cost(
        "anthropic", "claude-sonnet-4-6",
        input_tokens=1_000_000, output_tokens=1_000_000,
        cache_read_tokens=1_000_000, cache_write_tokens=1_000_000,
        at=date(2026, 9, 18),
    )
    assert haiku == 7.35
    assert sonnet == 22.05


def test_unknown_model_is_explicitly_unpriced():
    assert estimate_token_cost("google", "gemini-future", input_tokens=1) == (None, None)


def test_audio_rates_cover_current_and_candidate_stt():
    whisper, _ = estimate_unit_cost(
        "openai", "whisper-1", "audio_second", 60,
        at=date(2026, 9, 18),
    )
    transcribe, _ = estimate_unit_cost(
        "openai", "gpt-transcribe", "audio_second", 60,
        at=date(2026, 9, 18),
    )
    assert whisper == 0.006
    assert transcribe == 0.0045


def test_elevenlabs_public_api_character_rates_are_catalogued():
    multilingual, _ = estimate_unit_cost(
        "elevenlabs", "eleven_multilingual_v2", "text_character", 1_000,
        at=date(2026, 9, 18),
    )
    flash, _ = estimate_unit_cost(
        "elevenlabs", "eleven_flash_v2_5", "text_character", 1_000,
        at=date(2026, 9, 18),
    )
    assert multilingual == 0.10
    assert flash == 0.05


def test_elevenlabs_october_rates_do_not_reprice_earlier_usage():
    for model, old, new in (("eleven_multilingual_v2", 0.10, 0.08), ("eleven_flash_v2_5", 0.05, 0.04)):
        before, _ = estimate_unit_cost("elevenlabs", model, "text_character", 1000, at=date(2026, 10, 11))
        after, _ = estimate_unit_cost("elevenlabs", model, "text_character", 1000, at=date(2026, 10, 12))
        assert before == old
        assert after == new


def test_legacy_log_is_repriced_but_versioned_row_is_not_rewritten():
    legacy, version = effective_logged_cost({
        "service": "gemini",
        "model": "gemini-3.5-flash",
        "input_tokens": 1_000_000,
        "output_tokens": 1_000_000,
        "created_at": "2026-09-18T00:00:00+00:00",
        "cost_usd_est": 0.75,
        "pricing_version": None,
    })
    assert legacy == 10.5
    assert version.startswith("google:gemini-3.5-flash:")

    stored, stored_version = effective_logged_cost({
        "service": "gemini",
        "model": "gemini-3.5-flash",
        "cost_usd_est": 1.23,
        "pricing_version": "locked-version",
    })
    assert stored == 1.23
    assert stored_version == "locked-version"


def test_legacy_unknown_model_keeps_stored_estimate_instead_of_becoming_zero():
    cost, version = effective_logged_cost({
        "service": "gemini",
        "model": "gemini-retired",
        "input_tokens": 100,
        "output_tokens": 50,
        "cost_usd_est": 0.01,
        "created_at": "2025-01-01T00:00:00Z",
    })
    assert cost == 0.01
    assert version == "legacy_stored"


def test_explicitly_unpriced_failure_is_not_repriced_as_zero():
    assert effective_logged_cost({
        "service": "gemini",
        "model": "gemini-2.5-flash",
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_source": "unpriced",
        "status": "error",
    }) == (None, None)


# --- AIBUDGET-0033 T001: Azure Speech S0 row and image-token rules (FR-004, FR-023) ---

def test_azure_s0_pronunciation_is_priced_per_audio_second_from_t001_date():
    assert estimate_unit_cost(
        "azure", "pronunciation-assessment", "audio_second", 60, at=date(2026, 10, 28),
    ) == (None, None)
    one_minute, version = estimate_unit_cost(
        "azure", "pronunciation-assessment", "audio_second", 60, at=date(2026, 10, 29),
    )
    # $1.00/h real-time STT + $0.30/h Pronunciation Assessment add-on.
    assert one_minute == round(60 * 1.30 / 3600, 8)
    assert version == "azure:pronunciation-assessment:s0:2026-10-29:open"
    # The largest Speaking line (300 s + 1 s, FR-004) stays near $0.11.
    largest, _ = estimate_unit_cost(
        "azure", "pronunciation-assessment", "audio_second", 301, at=date(2026, 10, 29),
    )
    assert 0.10 < largest < 0.12


def test_unit_rate_version_without_tier_is_unchanged():
    _, version = estimate_unit_cost("openai", "whisper-1", "audio_second", 1, at=date(2026, 10, 29))
    assert version == "openai:whisper-1:2023-03-01:open"


def test_every_token_model_has_a_dated_image_rule():
    for rate in TOKEN_RATES:
        rule = rate.image_rule
        assert rule is not None, rate.model
        assert rule.source_url.startswith("https://")
        assert rule.source_checked == date(2026, 10, 29)


@pytest.mark.parametrize("model,cap", [
    ("claude-haiku-4-5-20251001", 1568),
    ("claude-sonnet-4-6", 1568),
    ("claude-sonnet-5", 4784),
    ("claude-sonnet-5-5", 4784),
    ("claude-haiku-5-5", 4784),
])
def test_claude_image_bound_is_patches_capped_at_tier_budget(model, cap):
    at = date(2026, 10, 29)
    assert image_input_tokens_bound("anthropic", model, 200, 200, at=at) == 64
    assert image_input_tokens_bound("anthropic", model, 1000, 1000, at=at) == 1296
    # Documented examples: 1920x1080 is 1,560 after the standard downscale and
    # 2,691 unresized on the high-resolution tier; 4K is capped.
    assert image_input_tokens_bound("anthropic", model, 1920, 1080, at=at) == min(2691, cap)
    assert image_input_tokens_bound("anthropic", model, 3840, 2160, at=at) == cap
    assert 1560 <= image_input_tokens_bound("anthropic", model, 1920, 1080, at=at)


def test_gemini_25_image_bound_uses_crop_unit_tiles():
    at = date(2026, 10, 29)
    for model in ("gemini-2.5-pro", "gemini-2.5-flash"):
        assert image_input_tokens_bound("google", model, 384, 384, at=at) == 258
        # Documented example: 960x540 → crop unit 360 → 3 × 2 tiles.
        assert image_input_tokens_bound("google", model, 960, 540, at=at) == 6 * 258
        assert image_input_tokens_bound("google", model, 1600, 1200, at=at) == 2 * 2 * 258


def test_gemini_3_image_bound_is_the_default_media_resolution_count():
    at = date(2026, 10, 29)
    for model in ("gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite",
                  "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"):
        assert image_input_tokens_bound("google", model, 4000, 3000, at=at) == 1120
    assert token_rate("google", "gemini-3.8-flash", at=date(2027, 1, 1)).image_rule.per_image_tokens == 1120


@pytest.mark.parametrize("width,height", [(0, 100), (100, 0), (-1, 5), (None, 5), (1.5, 5), (True, 5)])
def test_unreadable_dimensions_have_no_bound(width, height):
    assert image_input_tokens_bound("anthropic", "claude-sonnet-5-5", width, height) is None


def test_unpriced_model_has_no_image_bound():
    assert image_input_tokens_bound("google", "gemini-future", 100, 100) is None
    assert image_input_tokens_bound("anthropic", "claude-sonnet-5-5", 100, 100,
                                    at=date(2026, 9, 1)) is None
