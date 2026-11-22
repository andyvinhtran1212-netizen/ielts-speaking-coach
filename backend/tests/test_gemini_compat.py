from services.gemini_compat import generation_config_kwargs


def test_gemini_38_omits_rejected_sampling_controls():
    config = generation_config_kwargs(
        "gemini-3.8-flash",
        response_mime_type="application/json",
        max_output_tokens=4096,
        temperature=0.2,
    )
    assert config == {
        "response_mime_type": "application/json",
        "max_output_tokens": 4096,
    }


def test_older_gemini_models_keep_calibrated_temperature():
    from datetime import date

    config = generation_config_kwargs(
        "gemini-2.5-pro",
        response_mime_type="application/json",
        max_output_tokens=32768,
        temperature=0.3,
        at=date(2026, 11, 22),
    )
    assert config["temperature"] == 0.3


def test_gemini_25_pro_follows_38_rules_once_google_reroutes_it():
    from datetime import date

    before = generation_config_kwargs(
        "gemini-2.5-pro", response_mime_type="application/json",
        max_output_tokens=32768, temperature=0.3, at=date(2026, 11, 30),
    )
    after = generation_config_kwargs(
        "gemini-2.5-pro", response_mime_type="application/json",
        max_output_tokens=32768, temperature=0.3, at=date(2026, 12, 1),
    )
    assert before["temperature"] == 0.3
    assert "temperature" not in after


def test_gemini_25_flash_keeps_temperature_after_its_reroute():
    from datetime import date

    config = generation_config_kwargs(
        "gemini-2.5-flash", response_mime_type="application/json",
        max_output_tokens=4096, temperature=0.2, at=date(2026, 12, 2),
    )
    assert config["temperature"] == 0.2
