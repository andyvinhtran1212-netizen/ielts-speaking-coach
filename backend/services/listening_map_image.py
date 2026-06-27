"""services/listening_map_image.py — Sprint 13.5.6 + 13.5.9.2.

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
* **Model registry + fallback chain.** Sprint 13.5.9.2 — Andy's
  authoring quality jumped past what Gemini 2.5 Flash Image could
  reliably deliver (garbled labels, layout drift). The primary model
  is now ``gemini-3.1-flash-image-preview`` (Nano Banana 2); on any
  non-auth failure the service walks
  ``DEFAULT_MODEL → FALLBACK_CHAIN`` until one succeeds. The legacy
  Gemini 2.5 Flash Image stays in the chain (deprecated 2026-10-02)
  so the upgrade is non-breaking.
* **Storage.** Generated PNGs land in the Supabase Storage bucket
  named by ``settings.LISTENING_IMAGES_BUCKET`` under
  ``tests/<test_uuid>/maps/<exercise_uuid>.png``. The bucket is
  private; the student endpoint mints a 2h signed URL per fetch.
* **Pure-function prompt builder.** ``build_map_image_prompt`` is
  exported so admin UI can preview the prompt + so tests can pin the
  Cambridge style invariants.

Public API:

  SUPPORTED_MODELS                          # registry dict
  DEFAULT_MODEL                             # "gemini-3.1-flash-image-preview"
  FALLBACK_CHAIN                            # tuple[str, ...]
  build_map_image_prompt(...)               -> str
  call_image_model(model, prompt, *, api_key) -> bytes   # HTTP boundary
  generate_and_upload(...)                  -> dict
  estimate_cost(model)                      -> float
"""

from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)


# ── Model registry (Sprint 13.5.9.2) ───────────────────────────────────────
#
# Each entry carries:
#   * price             — USD per generated image (single, standard mode)
#   * endpoint          — dispatcher key (see ``call_image_model``):
#                         ``imagen`` / ``gemini`` / ``gemini_v1beta``
#   * supports_thinking — Gemini 3.x only; when True we attach a
#                         ``thinkingConfig`` block so the model spends
#                         extra reasoning tokens on spatial layout
#                         (helps IELTS letter-placement accuracy).
#   * deprecated        — True for sunset models; UI surfaces a warning.
#   * label             — admin-UI option text (single source of truth).

SUPPORTED_MODELS: dict[str, dict[str, Any]] = {
    # Default — Nano Banana 2. Andy 2026-05-21 explicit lock: 95% of
    # Pro quality at half the cost; ranks #1 AI Arena text-to-image.
    "gemini-3.1-flash-image-preview": {
        "price":             0.067,
        "endpoint":          "gemini_v1beta",
        "supports_thinking": True,
        "deprecated":        False,
        "label":             "Gemini 3.1 Flash Image (Nano Banana 2) — $0.067 ⭐ DEFAULT",
    },
    # Premium quality — Nano Banana Pro. Used as auto-upgrade when
    # NB2 fails, or explicit admin pick for hard floor plans.
    "gemini-3-pro-image-preview": {
        "price":             0.134,
        "endpoint":          "gemini_v1beta",
        "supports_thinking": True,
        "deprecated":        False,
        "label":             "Gemini 3 Pro Image (Nano Banana Pro) — $0.134 (premium quality)",
    },
    # Imagen 4 family — kept for completeness. Photorealistic but
    # doesn't follow letter-placement instructions as reliably as
    # Gemini 3.x for IELTS maps.
    "imagen-4.0-ultra-generate-001": {
        "price":             0.06,
        "endpoint":          "imagen",
        "supports_thinking": False,
        "deprecated":        False,
        "label":             "Imagen 4 Ultra — $0.06 (publication-grade max fidelity)",
    },
    "imagen-4.0-generate-001": {
        "price":             0.04,
        "endpoint":          "imagen",
        "supports_thinking": False,
        "deprecated":        False,
        "label":             "Imagen 4 Standard — $0.04 (general-purpose)",
    },
    "imagen-4.0-fast-generate-001": {
        "price":             0.02,
        "endpoint":          "imagen",
        "supports_thinking": False,
        "deprecated":        False,
        "label":             "Imagen 4 Fast — $0.02 (cheapest, basic)",
    },
    # Legacy — Nano Banana. Stays in the fallback chain because it's
    # still live until 2026-10-02. Admin still allowed to pick it.
    "gemini-2.5-flash-image": {
        "price":             0.039,
        "endpoint":          "gemini",
        "supports_thinking": False,
        "deprecated":        True,
        "shutdown_date":     "2026-10-02",
        "label":             "Gemini 2.5 Flash Image (Nano Banana) — $0.039 ⚠️ deprecated 2026-10-02",
    },
}

# Default model — Andy 2026-05-21 lock. Stays in code so deployments
# pin the cluster decision; ``settings.LISTENING_MAP_IMAGE_MODEL`` can
# still override per-environment without a code change.
DEFAULT_MODEL: str = "gemini-3.1-flash-image-preview"

# Walked top-to-bottom when the primary fails. Each step swaps the
# request shape for a different family (Nano Banana 2 → Pro → 2.5
# Flash legacy). The legacy Gemini 2.5 stays last so a transient
# Gemini 3.x outage still produces a usable image.
FALLBACK_CHAIN: tuple[str, ...] = (
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
)


def estimate_cost(model: str) -> float:
    """Best-effort USD-per-image estimate; defaults to the priciest
    tier if the model is unknown so the UI never under-quotes Andy.
    """
    cfg = SUPPORTED_MODELS.get(model)
    if cfg is not None:
        return float(cfg["price"])
    return max(m["price"] for m in SUPPORTED_MODELS.values())


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
    custom_prompt: str | None = None,
) -> str:
    """Render the prompt sent to the image model.

    Sprint 13.5.9 — if ``custom_prompt`` is a non-empty string we return
    it verbatim. Andy curates Cambridge-specific guidance (north arrow,
    letter positions, verification checklist) inside a `<details>`
    block in the markdown source; the convert pipeline lifts it onto
    ``metadata.map_image_custom_prompt`` and we pass it straight through
    to the model. Empty / whitespace-only values are treated as missing
    so a stray `<details>` block with a blank body falls back to the
    template.

    Sprint 13.5.6 — when no custom prompt is supplied we fall back to
    the canonical Cambridge template; admin still regenerates with a
    different model or refines the source map_description if the
    output is off.
    """
    if custom_prompt and custom_prompt.strip():
        return custom_prompt.strip()
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


def _gemini_v1beta_payload(prompt: str, *, supports_thinking: bool) -> dict[str, Any]:
    """Sprint 13.5.9.2 — Gemini 3.x (Nano Banana 2 / Pro) request shape.

    Differs from the 2.5 Flash Image body in two places:
      1. ``generationConfig.responseModalities = ["IMAGE"]`` — required
         on the v1beta endpoint or the model returns text-only output.
      2. Optional ``generationConfig.thinkingConfig.thinkingBudget`` —
         when set to "medium" the model spends extra reasoning tokens
         on spatial layout, which fixes the letter-placement drift
         Andy reported in Sprint 13.5.9.1's image-3 regression. Only
         attached when the registry's ``supports_thinking`` is True
         (currently the entire Gemini 3.x family).
    """
    generation_config: dict[str, Any] = {
        "responseModalities": ["IMAGE"],
    }
    if supports_thinking:
        generation_config["thinkingConfig"] = {"thinkingBudget": "medium"}
    return {
        "contents": [{
            "role": "user",
            "parts": [{"text": prompt}],
        }],
        "generationConfig": generation_config,
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

    Sprint 13.5.9.2 — dispatch is driven by the ``SUPPORTED_MODELS``
    registry (endpoint type ``imagen`` / ``gemini`` / ``gemini_v1beta``).
    Unknown model IDs fall back to a prefix-based heuristic so a future
    Imagen / Gemini model can be invoked before its registry entry
    lands (the admin still gets a usable image even if the dropdown
    doesn't list it).

    Raises:
        RuntimeError when the API key is missing or the response shape
        doesn't carry image bytes.
        requests.HTTPError on 4xx/5xx.
    """
    if not api_key:
        raise RuntimeError("Google API key not configured")

    config = SUPPORTED_MODELS.get(model)
    endpoint_kind = (config or {}).get("endpoint")
    if endpoint_kind is None:
        # Heuristic for unregistered model IDs: Imagen → :predict,
        # Gemini 3.x → v1beta:generateContent, everything else →
        # legacy :generateContent.
        if model.startswith("imagen-"):
            endpoint_kind = "imagen"
        elif model.startswith(("gemini-3", "gemini-4")):
            endpoint_kind = "gemini_v1beta"
        else:
            endpoint_kind = "gemini"

    if endpoint_kind == "imagen":
        url = _IMAGEN_PREDICT_URL.format(model=model)
        payload = _imagen_payload(prompt)
        decoder = _decode_imagen_response
    elif endpoint_kind == "gemini_v1beta":
        url = _GEMINI_GENERATE_URL.format(model=model)
        supports_thinking = bool((config or {}).get("supports_thinking"))
        payload = _gemini_v1beta_payload(
            prompt, supports_thinking=supports_thinking,
        )
        decoder = _decode_gemini_image_response
    else:
        # Legacy Gemini 2.5 Flash Image.
        url = _GEMINI_GENERATE_URL.format(model=model)
        payload = _gemini_image_payload(prompt)
        decoder = _decode_gemini_image_response

    if (config or {}).get("deprecated"):
        shutdown = (config or {}).get("shutdown_date") or "scheduled"
        logger.warning(
            "[map_image] using deprecated model %s (shutdown %s)",
            model, shutdown,
        )

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
    custom_prompt: str | None = None,
) -> dict[str, Any]:
    """Generate a floor-plan image and upload it to Supabase Storage.

    Returns the metadata that should be merged into the exercise's
    ``payload`` (``map_image_storage_path`` + ``map_image_model`` +
    ``map_image_prompt`` + ``map_image_prompt_source`` +
    ``map_image_generated_at`` + ``map_image_size_bytes``).

    Sprint 13.5.9 — when ``custom_prompt`` (a non-empty string) is
    supplied, the canonical template + 50-char map_description guard
    are bypassed and the curated prompt is sent verbatim. The result
    carries ``map_image_prompt_source = "custom"`` so the admin UI can
    surface what was actually used. With no custom prompt the call
    falls back to the Sprint 13.5.6 template (and the description
    length guard re-engages).

    Sprint 13.5.9.2 — primary model is ``DEFAULT_MODEL``
    (``gemini-3.1-flash-image-preview``). On any non-auth failure the
    service walks ``FALLBACK_CHAIN`` (Pro → 2.5 Flash legacy) until
    one succeeds. A missing API key short-circuits with a clear
    RuntimeError — no fallback can recover that.
    """
    from config import settings

    has_custom = bool(custom_prompt and custom_prompt.strip())
    if not has_custom and (not map_description or len(map_description.strip()) < 50):
        raise ValueError(
            "Map description too short (need ≥50 chars) — image quality "
            "depends on a rich textual layout.",
        )

    resolved_key = api_key if api_key is not None else settings.GEMINI_API_KEY  # Mục 17 (B5): via Settings, not os.getenv
    if not resolved_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    # Resolve the model chain: caller's pick → env override → cluster
    # default. The chain dedupes so an env that already points at a
    # fallback step doesn't double-try the same model.
    primary = model or settings.LISTENING_MAP_IMAGE_MODEL or DEFAULT_MODEL
    chain: list[str] = [primary]
    for step in FALLBACK_CHAIN:
        if step not in chain:
            chain.append(step)

    prompt = build_map_image_prompt(
        map_description, letter_options, custom_prompt=custom_prompt,
    )

    image_bytes: bytes | None = None
    model_used: str | None = None
    last_exc: Exception | None = None
    for step in chain:
        try:
            image_bytes = call_image_model(step, prompt, api_key=resolved_key)
            model_used = step
            if step != primary:
                logger.warning(
                    "[map_image] primary model %s failed; used fallback %s",
                    primary, step,
                )
            break
        except Exception as exc:                                          # pragma: no cover
            last_exc = exc
            logger.warning(
                "[map_image] model %s failed: %s — trying next in chain",
                step, exc,
            )
    if image_bytes is None or model_used is None:
        logger.error(
            "[map_image] all models in the fallback chain failed (last error: %s)",
            last_exc,
        )
        raise RuntimeError(
            f"Image generation failed across the full fallback chain "
            f"({', '.join(chain)}): {last_exc}",
        )

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
        "map_image_prompt_source": "custom" if has_custom else "template",
        "map_image_generated_at": datetime.now(timezone.utc).isoformat(),
    }
