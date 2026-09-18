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
    config = generation_config_kwargs(
        "gemini-2.5-pro",
        response_mime_type="application/json",
        max_output_tokens=32768,
        temperature=0.3,
    )
    assert config["temperature"] == 0.3
