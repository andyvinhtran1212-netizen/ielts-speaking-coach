from datetime import date

from services.ai_pricing import effective_logged_cost, estimate_token_cost, estimate_unit_cost


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
