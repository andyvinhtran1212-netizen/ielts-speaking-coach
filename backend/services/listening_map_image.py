"""services/listening_map_image.py — Sprint 13.5.6.

Generate a Cambridge-IELTS-style floor-plan image for a plan-label
exercise (S2 Q16-20 standard format) via Google Imagen / Gemini.

Design choices:

* **Admin-initiated only.** The convert/commit pipeline never auto-
  generates — Andy picks the model + clicks "Generate" per exercise so
  cost stays under their control.
* **HTTP boundary, not SDK.** We call the public REST endpoint directly
  with the existing `requests` dependency (same shape as
  ``listening_renderer.py``). Tests patch ``call_image_model`` at the
  module boundary so no network or SDK install is required.
* **Model fallback.** ``LISTENING_MAP_IMAGE_MODEL`` (default
  ``imagen-4.0-fast-generate-001``) is tried first; on failure the
  service falls back to ``gemini-2.5-flash-image``. Both responses are
  normalised to raw PNG bytes.
* **Storage.** Generated PNGs land in the Supabase Storage bucket
  named by ``settings.LISTENING_IMAGES_BUCKET`` under
  ``tests/<test_uuid>/maps/<exercise_uuid>.png``. The bucket is
  private; the student endpoint mints a 2h signed URL per fetch.
* **Pure-function prompt builder.** ``build_map_image_prompt`` is
  exported so admin UI can preview the prompt + so tests can pin the
  Cambridge style invariants.

Public API:

  build_map_image_prompt(map_description, letter_options) -> str
  call_image_model(model, prompt, *, api_key) -> bytes   # HTTP boundary
  generate_and_upload(...) -> dict
  estimate_cost(model) -> float
"""

from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)


# ── Pricing (USD per single image, standard mode) ──────────────────────────


_PRICING_USD: dict[str, float] = {
    "imagen-4.0-fast-generate-001":     0.02,
    "imagen-4.0-generate-001":          0.04,
    "imagen-4.0-ultra-generate-001":    0.06,
    "gemini-2.5-flash-image":           0.039,
}


def estimate_cost(model: str) -> float:
    """Best-effort USD-per-image estimate; defaults to the priciest
    tier if the model is unknown so the UI never under-quotes Andy.
    """
    return _PRICING_USD.get(model, max(_PRICING_USD.values()))


# ── Prompt template ────────────────────────────────────────────────────────


_PROMPT_TEMPLATE = """Top-down architectural floor plan in Cambridge IELTS test paper style.
Black line art on white background, simple geometric shapes for rooms.
Each room is labeled with a single capital letter from: {letters}.
Layout described as: {description}

Requirements:
- Clear room boundaries (walls drawn as thick black lines).
- Each labeled room shows ONLY its capital letter (large, centered, bold).
- A clear North arrow at the top of the plan.
- "ENTRANCE" labeled where mentioned in the description.
- No furniture, no decoration, no people, no color shading.
- Pure architectural drawing: black, white, and grey only.
- Aspect ratio: square (1024 x 1024).
"""


def build_map_image_prompt(
    map_description: str,
    letter_options: list[str] | None = None,
) -> str:
    """Render the canonical Cambridge-style prompt. Sprint 13.5.6 keeps
    the template fixed so admin UI doesn't need a custom prompt editor
    — Andy regenerates with a different model or refines the source
    map_description if the output is off.
    """
    letters = ", ".join(letter_options or list("ABCDEFGH"))
    return _PROMPT_TEMPLATE.format(
        letters=letters,
        description=(map_description or "").strip(),
    )


# ── HTTP boundary (mocked in tests) ────────────────────────────────────────


_IMAGEN_PREDICT_URL = (
    "https://generativelanguage.googleapis.com/v1beta/"
    "models/{model}:predict"
)
_GEMINI_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/"
    "models/{model}:generateContent"
)


def _imagen_payload(prompt: str) -> dict[str, Any]:
    """Imagen 4 generate endpoint takes ``instances[{prompt}]`` +
    a parameters block. Returns ``predictions[*].bytesBase64Encoded``.
    """
    return {
        "instances": [{"prompt": prompt}],
        "parameters": {
            "sampleCount": 1,
            "aspectRatio": "1:1",
        },
    }


def _gemini_image_payload(prompt: str) -> dict[str, Any]:
    """Gemini 2.5 Flash Image generateContent endpoint. Image bytes
    return as ``candidates[0].content.parts[*].inlineData.data``.
    """
    return {
        "contents": [{
            "role": "user",
            "parts": [{"text": prompt}],
        }],
    }


def _decode_imagen_response(body: dict[str, Any]) -> bytes:
    preds = body.get("predictions") or []
    if not preds:
        raise RuntimeError("Imagen response carried no predictions")
    b64 = preds[0].get("bytesBase64Encoded")
    if not b64:
        raise RuntimeError("Imagen response missing bytesBase64Encoded")
    return base64.b64decode(b64)


def _decode_gemini_image_response(body: dict[str, Any]) -> bytes:
    candidates = body.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini response carried no candidates")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    raise RuntimeError("Gemini response missing inline image data")


def call_image_model(
    model: str,
    prompt: str,
    *,
    api_key: str,
    timeout_seconds: int = 60,
) -> bytes:
    """POST to the chosen model's REST endpoint and return raw image
    bytes. Tests patch this function so no network is touched.

    Raises:
        RuntimeError when the API key is missing or the response shape
        doesn't carry image bytes.
        requests.HTTPError on 4xx/5xx.
    """
    if not api_key:
        raise RuntimeError("Google API key not configured")

    if model.startswith("imagen-"):
        url = _IMAGEN_PREDICT_URL.format(model=model)
        payload = _imagen_payload(prompt)
        decoder = _decode_imagen_response
    else:
        url = _GEMINI_GENERATE_URL.format(model=model)
        payload = _gemini_image_payload(prompt)
        decoder = _decode_gemini_image_response

    resp = requests.post(
        url,
        params={"key": api_key},
        json=payload,
        timeout=timeout_seconds,
    )
    resp.raise_for_status()
    return decoder(resp.json())


# ── Top-level generate + upload ────────────────────────────────────────────


def generate_and_upload(
    *,
    map_description: str,
    letter_options: list[str] | None,
    test_id: str,
    exercise_id: str,
    supabase: Any,
    api_key: str | None = None,
    model: str | None = None,
    bucket: str | None = None,
) -> dict[str, Any]:
    """Generate a floor-plan image and upload it to Supabase Storage.

    Returns the metadata that should be merged into the exercise's
    ``payload`` (``map_image_storage_path`` + ``map_image_model`` +
    ``map_image_prompt`` + ``map_image_generated_at`` +
    ``map_image_size_bytes``).

    The primary model is tried first; on any non-auth failure the
    service falls back to ``gemini-2.5-flash-image``. A missing API
    key short-circuits with a clear RuntimeError — no fallback can
    recover that.
    """
    from config import settings

    if not map_description or len(map_description.strip()) < 50:
        raise ValueError(
            "Map description too short (need ≥50 chars) — image quality "
            "depends on a rich textual layout.",
        )

    resolved_key = api_key if api_key is not None else os.getenv("GEMINI_API_KEY", "")
    if not resolved_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    primary = model or settings.LISTENING_MAP_IMAGE_MODEL
    prompt = build_map_image_prompt(map_description, letter_options)

    try:
        image_bytes = call_image_model(primary, prompt, api_key=resolved_key)
        model_used = primary
    except Exception as exc:                                              # pragma: no cover
        if primary == "gemini-2.5-flash-image":
            # Already the fallback — surface the real failure.
            logger.error("[map_image] generation failed (no fallback left): %s", exc)
            raise
        logger.warning(
            "[map_image] primary model %s failed (%s); falling back to "
            "gemini-2.5-flash-image",
            primary, exc,
        )
        image_bytes = call_image_model(
            "gemini-2.5-flash-image", prompt, api_key=resolved_key,
        )
        model_used = "gemini-2.5-flash-image"

    if not image_bytes:
        raise RuntimeError("Image generation returned empty bytes")

    storage_path = f"tests/{test_id}/maps/{exercise_id}.png"
    resolved_bucket = bucket or settings.LISTENING_IMAGES_BUCKET
    supabase.storage.from_(resolved_bucket).upload(
        storage_path,
        image_bytes,
        {"content-type": "image/png", "upsert": "true"},
    )

    return {
        "map_image_storage_path": storage_path,
        "map_image_size_bytes":   len(image_bytes),
        "map_image_model":        model_used,
        "map_image_prompt":       prompt,
        "map_image_generated_at": datetime.now(timezone.utc).isoformat(),
    }
