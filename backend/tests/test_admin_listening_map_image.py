"""Tests for Sprint 13.5.6 — map image generation for plan-label exercises.

Pins:
  * services/listening_map_image — prompt builder + HTTP boundary +
    generate_and_upload (with mocked call_image_model)
  * router endpoints — POST .../generate-map-image, DELETE
    .../map-image, GET .../map-image/signed-url
  * student GET /api/listening/tests/{id} injects a fresh signed URL
    onto plan-label exercises that have a stored image

All network + Supabase Storage interactions are stubbed in-process —
no real Imagen/Gemini call ever fires from a unit test.
"""

from __future__ import annotations

import asyncio
import base64
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services import listening_map_image


# ── Fake supabase + storage (mirrors the surface this code uses) ──────────


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Q:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name
        self._mode = "select"
        self._payload = None
        self._eq = []
        self._neq = []
        self._in = []

    def select(self, *_a, **_kw): self._mode = "select"; return self
    def insert(self, payload): self._mode = "insert"; self._payload = payload; return self
    def update(self, payload): self._mode = "update"; self._payload = payload; return self
    def delete(self): self._mode = "delete"; return self
    def eq(self, c, v): self._eq.append((c, v)); return self
    def neq(self, c, v): self._neq.append((c, v)); return self
    def in_(self, c, vs): self._in.append((c, list(vs))); return self
    def order(self, *_a, **_kw): return self
    def limit(self, *_a, **_kw): return self
    def range(self, *_a): return self

    def _match(self, row):
        for c, v in self._eq:
            if row.get(c) != v: return False
        for c, v in self._neq:
            if row.get(c) == v: return False
        for c, vs in self._in:
            if row.get(c) not in vs: return False
        return True

    def execute(self):
        rows = self.fake.tables.setdefault(self.name, [])
        if self._mode == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            for p in payloads:
                rows.append(dict(p))
            return _Resp(payloads)
        if self._mode == "update":
            matched = [r for r in rows if self._match(r)]
            for r in matched:
                r.update(self._payload or {})
            return _Resp(matched)
        if self._mode == "delete":
            kept = [r for r in rows if not self._match(r)]
            removed = [r for r in rows if self._match(r)]
            self.fake.tables[self.name] = kept
            return _Resp(removed)
        return _Resp([r for r in rows if self._match(r)])


class _Bucket:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name

    def upload(self, path, data, options=None):
        self.fake.uploads.append((self.name, path, len(data) if data else 0))
        self.fake.objects[(self.name, path)] = data
        return {"path": path}

    def remove(self, paths):
        for p in paths:
            self.fake.objects.pop((self.name, p), None)
            self.fake.removed.append((self.name, p))
        return {"removed": list(paths)}

    def create_signed_url(self, path, ttl):
        if (self.name, path) not in self.fake.objects:
            # Mirror Supabase: signing a missing object still returns a URL
            # in some configurations — keep the fake forgiving so router
            # logic that doesn't pre-check still works.
            pass
        return {"signedURL": f"https://stor.test/{self.name}/{path}?ttl={ttl}"}


class _Storage:
    def __init__(self, fake): self.fake = fake
    def from_(self, name): return _Bucket(self.fake, name)


class _Fake:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "listening_tests":     [],
            "listening_content":   [],
            "listening_exercises": [],
        }
        self.uploads: list[tuple[str, str, int]] = []
        self.removed: list[tuple[str, str]] = []
        self.objects: dict[tuple[str, str], bytes] = {}
        self.storage = _Storage(self)

    def table(self, name): return _Q(self, name)


def _patch(monkeypatch):
    fake = _Fake()
    monkeypatch.setattr(listening_router, "supabase_admin", fake)

    async def _ok_admin(_authz):
        return {"id": "admin-1"}
    monkeypatch.setattr(listening_router, "require_admin", _ok_admin)

    # GEMINI_API_KEY visible to the endpoint guard. Patch settings + env
    # because the endpoint reads both with the env-var as a fallback.
    monkeypatch.setattr(listening_router.settings, "GEMINI_API_KEY", "test-key", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    return fake, "Bearer admin-token"


def _run(coro): return asyncio.run(coro)


def _seed_plan_label_exercise(fake: _Fake, *, with_image: bool = False) -> dict:
    test_id  = str(uuid4())
    content_id = str(uuid4())
    exercise_id = str(uuid4())
    fake.tables["listening_tests"].append({"id": test_id, "test_id": "ILR-LIS-001"})
    fake.tables["listening_content"].append({
        "id":          content_id,
        "test_id":     test_id,
        "section_num": 2,
        "title":       "Section 2",
    })
    payload: dict = {
        "variant":       "mcq_letter_label",
        "template_kind": "plan_label",
        "metadata": {
            "map_description": (
                "Floor plan with entrance at south. Reception (F) in centre. "
                "Café (C) to the left of reception; lockers (A) behind the "
                "café; changing rooms (D) east of reception; pool (G) to the "
                "north; crèche (B) at the north-east corner; gym (E) at the "
                "north-west; staff room (H) behind reception."
            ),
            "letter_options": list("ABCDEFGH"),
        },
        "questions": [
            {"q_num": 16, "prompt": "Café"},
            {"q_num": 17, "prompt": "Changing rooms"},
        ],
    }
    if with_image:
        payload["map_image_storage_path"] = f"tests/{test_id}/maps/{exercise_id}.png"
        payload["map_image_model"]        = "imagen-4.0-fast-generate-001"
        payload["map_image_size_bytes"]   = 12345
        payload["map_image_prompt"]       = "stub prompt"
        payload["map_image_generated_at"] = "2026-05-21T00:00:00+00:00"
        fake.objects[("listening-images", payload["map_image_storage_path"])] = b"\x89PNG"
    fake.tables["listening_exercises"].append({
        "id":         exercise_id,
        "content_id": content_id,
        "exercise_type": "mcq",
        "variant":    "mcq_letter_label",
        "payload":    payload,
    })
    return {
        "test_id_uuid": test_id,
        "content_id":   content_id,
        "exercise_id":  exercise_id,
    }


# ── Sprint 13.5.9.2 — model registry + Gemini 3.x dispatch ────────────────


def test_supported_models_registry_lists_all_andy_locked_models():
    """The cluster's accepted model set is pinned here so a future
    refactor can't quietly drop one (or add a new one without an
    admin-UI label).
    """
    expected = {
        "gemini-3.1-flash-image-preview",     # Nano Banana 2 — default
        "gemini-3-pro-image-preview",         # Nano Banana Pro — premium
        "imagen-4.0-ultra-generate-001",      # publication-grade
        "imagen-4.0-generate-001",            # general-purpose
        "imagen-4.0-fast-generate-001",       # cheapest
        "gemini-2.5-flash-image",             # legacy (deprecated 2026-10-02)
    }
    assert set(listening_map_image.SUPPORTED_MODELS.keys()) == expected
    # Each entry must carry the minimum metadata the dispatcher reads.
    for model_id, cfg in listening_map_image.SUPPORTED_MODELS.items():
        assert "price" in cfg, f"{model_id} missing price"
        assert "endpoint" in cfg, f"{model_id} missing endpoint"
        assert "label" in cfg, f"{model_id} missing label"
        assert "deprecated" in cfg, f"{model_id} missing deprecated flag"


def test_default_model_is_nano_banana_2_per_andy_lock():
    """Andy 2026-05-21 explicit lock: Nano Banana 2 is the default.
    Pinned here so a refactor can't silently downgrade.
    """
    assert listening_map_image.DEFAULT_MODEL == "gemini-3.1-flash-image-preview"


def test_fallback_chain_walks_pro_then_legacy_25_flash():
    """The fallback chain order matters — Pro is tried before the
    deprecated 2.5 Flash so quality improves on retry rather than
    regressing.
    """
    chain = listening_map_image.FALLBACK_CHAIN
    assert chain == (
        "gemini-3-pro-image-preview",
        "gemini-2.5-flash-image",
    )
    # All chain members must be in the registry.
    for step in chain:
        assert step in listening_map_image.SUPPORTED_MODELS


def test_gemini_2_5_flash_image_marked_deprecated_with_shutdown_date():
    """Andy needs the admin UI to surface the deprecation warning so
    the option isn't a silent footgun.
    """
    cfg = listening_map_image.SUPPORTED_MODELS["gemini-2.5-flash-image"]
    assert cfg["deprecated"] is True
    assert cfg["shutdown_date"] == "2026-10-02"


def test_gemini_v1beta_payload_attaches_response_modalities_image():
    """v1beta endpoint requires ``generationConfig.responseModalities``
    to be set, or the model returns text-only output. Pin the field
    so a future refactor of the payload builder doesn't drop it.
    """
    body = listening_map_image._gemini_v1beta_payload(
        "Test prompt", supports_thinking=False,
    )
    assert body["generationConfig"]["responseModalities"] == ["IMAGE"]
    # Thinking config absent when not requested.
    assert "thinkingConfig" not in body["generationConfig"]
    assert body["contents"][0]["parts"][0]["text"] == "Test prompt"


def test_gemini_v1beta_payload_adds_thinking_config_when_supported():
    """For Nano Banana Pro (and any future model with
    ``supports_thinking``), the dispatcher attaches
    ``thinkingConfig.thinkingBudget = "medium"`` — that's the knob
    Andy wants for IELTS spatial-layout accuracy.
    """
    body = listening_map_image._gemini_v1beta_payload(
        "Test prompt", supports_thinking=True,
    )
    assert body["generationConfig"]["thinkingConfig"] == {
        "thinkingBudget": "medium",
    }
    assert body["generationConfig"]["responseModalities"] == ["IMAGE"]


def test_call_image_model_dispatches_via_endpoint_key_for_nano_banana_2(monkeypatch):
    """Calling the Gemini 3.x family must hit the v1beta endpoint with
    the v1beta payload shape — NOT the legacy gemini payload.
    """
    captured = {}

    class _Stub:
        def __init__(self, body):
            self._body = body
        def raise_for_status(self): pass
        def json(self): return self._body

    def _fake_post(url, params=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return _Stub({"candidates": [{
            "content": {"parts": [{
                "inlineData": {
                    "data": base64.b64encode(b"\x89PNGnb2").decode(),
                },
            }]},
        }]})
    monkeypatch.setattr(listening_map_image.requests, "post", _fake_post)

    out = listening_map_image.call_image_model(
        "gemini-3.1-flash-image-preview",
        "Floor plan prompt",
        api_key="test-key",
    )
    assert out == b"\x89PNGnb2"
    # Endpoint URL targets the Gemini :generateContent path.
    assert "gemini-3.1-flash-image-preview:generateContent" in captured["url"]
    # Payload carries the v1beta-only responseModalities field.
    body = captured["json"]
    assert body["generationConfig"]["responseModalities"] == ["IMAGE"]
    assert body["generationConfig"]["thinkingConfig"] == {
        "thinkingBudget": "medium",
    }


def test_call_image_model_legacy_gemini_25_path_unchanged_regression(monkeypatch):
    """Regression — selecting the legacy gemini-2.5-flash-image must
    keep using the simpler legacy payload (no responseModalities, no
    thinkingConfig) so existing Andy-pinned exercises still work.
    """
    captured = {}

    class _Stub:
        def __init__(self, body):
            self._body = body
        def raise_for_status(self): pass
        def json(self): return self._body

    def _fake_post(url, params=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return _Stub({"candidates": [{
            "content": {"parts": [{
                "inlineData": {
                    "data": base64.b64encode(b"\x89PNGlegacy").decode(),
                },
            }]},
        }]})
    monkeypatch.setattr(listening_map_image.requests, "post", _fake_post)

    out = listening_map_image.call_image_model(
        "gemini-2.5-flash-image",
        "Floor plan prompt",
        api_key="test-key",
    )
    assert out == b"\x89PNGlegacy"
    assert "gemini-2.5-flash-image:generateContent" in captured["url"]
    # Legacy payload — neither v1beta field present.
    body = captured["json"]
    assert "generationConfig" not in body
    assert "responseModalities" not in str(body)


def test_call_image_model_imagen_path_unchanged_regression(monkeypatch):
    """Regression — Imagen :predict path still uses the
    ``instances[{prompt}]`` body shape (not Gemini's contents).
    """
    captured = {}

    class _Stub:
        def __init__(self, body):
            self._body = body
        def raise_for_status(self): pass
        def json(self): return self._body

    def _fake_post(url, params=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return _Stub({"predictions": [{
            "bytesBase64Encoded": base64.b64encode(b"\x89PNGimg").decode(),
        }]})
    monkeypatch.setattr(listening_map_image.requests, "post", _fake_post)

    out = listening_map_image.call_image_model(
        "imagen-4.0-fast-generate-001",
        "Floor plan prompt",
        api_key="test-key",
    )
    assert out == b"\x89PNGimg"
    assert "imagen-4.0-fast-generate-001:predict" in captured["url"]
    body = captured["json"]
    assert "instances" in body
    assert body["instances"][0]["prompt"] == "Floor plan prompt"


def test_call_image_model_logs_deprecation_warning_for_legacy_model(monkeypatch, caplog):
    """Sprint 13.5.9.2 — the dispatcher must emit a logger.warning the
    moment a deprecated model is used so server logs flag silent
    long-term-incompatible choices.
    """
    import logging

    class _Stub:
        def raise_for_status(self): pass
        def json(self):
            return {"candidates": [{"content": {"parts": [{
                "inlineData": {
                    "data": base64.b64encode(b"\x89PNG").decode(),
                },
            }]}}]}

    monkeypatch.setattr(
        listening_map_image.requests, "post",
        lambda *a, **kw: _Stub(),
    )
    with caplog.at_level(logging.WARNING, logger="services.listening_map_image"):
        listening_map_image.call_image_model(
            "gemini-2.5-flash-image", "prompt", api_key="test-key",
        )
    msgs = [r.getMessage() for r in caplog.records
            if "deprecated model gemini-2.5-flash-image" in r.getMessage()]
    assert msgs, "expected a deprecation warning for the legacy model"
    assert "2026-10-02" in msgs[0]


def test_estimate_cost_reads_from_registry_for_all_supported_models():
    """``estimate_cost`` must return the registry price for every
    supported model, and the priciest entry for unknowns (UI never
    under-quotes).
    """
    for model_id, cfg in listening_map_image.SUPPORTED_MODELS.items():
        assert listening_map_image.estimate_cost(model_id) == cfg["price"]
    assert (
        listening_map_image.estimate_cost("totally-unknown")
        >= max(c["price"] for c in listening_map_image.SUPPORTED_MODELS.values())
    )


# ── Service-level tests ────────────────────────────────────────────────────


def test_build_prompt_carries_cambridge_style_invariants():
    prompt = listening_map_image.build_map_image_prompt(
        "Floor plan with entrance south. Reception centre.",
        list("ABCDEFGH"),
    )
    assert "Cambridge IELTS" in prompt
    assert "top-down" in prompt.lower() or "Top-down" in prompt
    assert "ENTRANCE" in prompt
    assert "1024" in prompt
    for L in "ABCDEFGH":
        assert L in prompt


# ── Sprint 13.5.9 — custom prompt path ────────────────────────────────────


def test_build_prompt_returns_custom_prompt_verbatim_when_provided():
    """Sprint 13.5.9 — a non-empty ``custom_prompt`` must short-circuit
    the template and be returned verbatim. Andy's curated prompts
    encode visual specs the template can't express (letter positions,
    verification checklist).
    """
    curated = "## Curated AI Prompt\n\nGenerate floor plan with X, Y, Z.\n"
    out = listening_map_image.build_map_image_prompt(
        "Floor plan with entrance south.",
        list("ABCDEFGH"),
        custom_prompt=curated,
    )
    # Verbatim (after .strip()). The Cambridge template invariants
    # ("ENTRANCE", "1024", "top-down") must be ABSENT — we deliberately
    # bypassed the template.
    assert out == curated.strip()
    assert "ENTRANCE" not in out
    assert "Cambridge IELTS test paper style" not in out


def test_build_prompt_falls_back_to_template_when_custom_prompt_empty():
    """Whitespace-only or None custom prompts fall back to the
    template so a stray `<details>` block with a blank body never
    sends an empty string to the image model.
    """
    for empty in (None, "", "   \n\n  "):
        out = listening_map_image.build_map_image_prompt(
            "Floor plan with entrance south. Reception centre.",
            list("ABCDEFGH"),
            custom_prompt=empty,
        )
        assert "Cambridge IELTS" in out


def test_generate_and_upload_uses_custom_prompt_and_returns_source(monkeypatch):
    """End-to-end with a curated prompt: the prompt actually sent to
    the model is Andy's text (not the template) and the result
    metadata carries ``map_image_prompt_source == "custom"`` so the
    admin UI can show the source transparently.
    """
    fake = _Fake()
    seed = _seed_plan_label_exercise(fake)
    captured = {}

    def _fake_call(model, prompt, *, api_key, timeout_seconds=60):
        captured["prompt"] = prompt
        return b"\x89PNGfakebytes"
    monkeypatch.setattr(listening_map_image, "call_image_model", _fake_call)

    curated = "## Curated Cambridge prompt — north arrow at top-left, monochrome only."
    result = listening_map_image.generate_and_upload(
        map_description="Floor plan with entrance at south, reception in centre, "
                        "and labelled rooms around the perimeter.",
        letter_options=list("ABCDEFGH"),
        test_id=seed["test_id_uuid"],
        exercise_id=seed["exercise_id"],
        supabase=fake,
        api_key="test-key",
        model="imagen-4.0-fast-generate-001",
        custom_prompt=curated,
    )
    assert captured["prompt"] == curated
    assert result["map_image_prompt"] == curated
    assert result["map_image_prompt_source"] == "custom"


def test_generate_and_upload_bypasses_50char_guard_with_custom_prompt(monkeypatch):
    """The 50-char map_description guard only protects the template
    path. With a custom prompt the description is unused, so the
    guard must NOT block generation when Andy supplies a curated
    prompt + a short / empty description.
    """
    fake = _Fake()
    seed = _seed_plan_label_exercise(fake)

    def _fake_call(model, prompt, *, api_key, timeout_seconds=60):
        return b"\x89PNGfakebytes"
    monkeypatch.setattr(listening_map_image, "call_image_model", _fake_call)

    result = listening_map_image.generate_and_upload(
        map_description="too short",         # would normally fail
        letter_options=list("ABCDEFGH"),
        test_id=seed["test_id_uuid"],
        exercise_id=seed["exercise_id"],
        supabase=fake,
        api_key="test-key",
        custom_prompt="## A custom prompt long enough to drive image gen.",
    )
    assert result["map_image_prompt_source"] == "custom"


def test_generate_and_upload_marks_template_when_no_custom_prompt(monkeypatch):
    """Regression — the template path must still tag
    ``map_image_prompt_source == "template"`` so the admin UI can
    distinguish between curated and default generations after the
    fact.
    """
    fake = _Fake()
    seed = _seed_plan_label_exercise(fake)

    def _fake_call(model, prompt, *, api_key, timeout_seconds=60):
        return b"\x89PNGfakebytes"
    monkeypatch.setattr(listening_map_image, "call_image_model", _fake_call)

    result = listening_map_image.generate_and_upload(
        map_description="Floor plan with entrance at south, reception in centre, "
                        "and labelled rooms around the perimeter.",
        letter_options=list("ABCDEFGH"),
        test_id=seed["test_id_uuid"],
        exercise_id=seed["exercise_id"],
        supabase=fake,
        api_key="test-key",
    )
    assert result["map_image_prompt_source"] == "template"
    assert "Cambridge IELTS" in result["map_image_prompt"]


def test_estimate_cost_returns_pricing_table_value():
    assert listening_map_image.estimate_cost("imagen-4.0-fast-generate-001") == 0.02
    assert listening_map_image.estimate_cost("gemini-2.5-flash-image")       == 0.039
    # Unknown model → safe-side upper bound (never under-quotes).
    assert listening_map_image.estimate_cost("totally-unknown") >= 0.039


def test_generate_and_upload_writes_to_storage_and_returns_metadata(monkeypatch):
    fake = _Fake()
    seed = _seed_plan_label_exercise(fake)

    def _fake_call(model, prompt, *, api_key, timeout_seconds=60):
        return b"\x89PNGfakebytes"
    monkeypatch.setattr(listening_map_image, "call_image_model", _fake_call)

    result = listening_map_image.generate_and_upload(
        map_description="Floor plan with entrance at south, reception in centre, "
                        "and labelled rooms around the perimeter.",
        letter_options=list("ABCDEFGH"),
        test_id=seed["test_id_uuid"],
        exercise_id=seed["exercise_id"],
        supabase=fake,
        api_key="test-key",
        model="imagen-4.0-fast-generate-001",
    )
    assert result["map_image_model"] == "imagen-4.0-fast-generate-001"
    assert result["map_image_storage_path"].endswith(f"/{seed['exercise_id']}.png")
    assert result["map_image_size_bytes"] > 0
    assert fake.uploads, "image bytes must hit the bucket"
    bucket_name, path, size = fake.uploads[0]
    assert bucket_name == "listening-images"
    assert size == len(b"\x89PNGfakebytes")


def test_generate_and_upload_rejects_short_description(monkeypatch):
    fake = _Fake()
    with pytest.raises(ValueError):
        listening_map_image.generate_and_upload(
            map_description="too short",
            letter_options=None,
            test_id="t",
            exercise_id="e",
            supabase=fake,
            api_key="test-key",
        )


def test_generate_and_upload_requires_api_key(monkeypatch):
    fake = _Fake()
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        listening_map_image.generate_and_upload(
            map_description="A floor plan with an entrance to the south and "
                            "labelled rooms around the perimeter.",
            letter_options=None,
            test_id="t", exercise_id="e",
            supabase=fake, api_key="",
        )


def test_call_image_model_decodes_imagen_response(monkeypatch):
    """Pin the Imagen response shape — predictions[0].bytesBase64Encoded."""
    class _Stub:
        def __init__(self, body):
            self._body = body
        def raise_for_status(self): pass
        def json(self): return self._body
    captured = {}
    def _fake_post(url, params=None, json=None, timeout=None):
        captured["url"] = url
        return _Stub({"predictions": [{
            "bytesBase64Encoded": base64.b64encode(b"\x89PNGimagen").decode(),
        }]})
    monkeypatch.setattr(listening_map_image.requests, "post", _fake_post)

    out = listening_map_image.call_image_model(
        "imagen-4.0-fast-generate-001", "p", api_key="K",
    )
    assert out == b"\x89PNGimagen"
    assert "imagen-4.0-fast-generate-001:predict" in captured["url"]


def test_call_image_model_decodes_gemini_inline_data(monkeypatch):
    """Pin the Gemini 2.5 Flash Image shape — candidates[0].content.parts[*].inlineData."""
    class _Stub:
        def raise_for_status(self): pass
        def json(self):
            return {"candidates": [{"content": {"parts": [
                {"text": "Here it is"},
                {"inlineData": {
                    "mimeType": "image/png",
                    "data": base64.b64encode(b"\x89PNGgem").decode(),
                }},
            ]}}]}
    monkeypatch.setattr(
        listening_map_image.requests, "post",
        lambda *a, **kw: _Stub(),
    )
    out = listening_map_image.call_image_model(
        "gemini-2.5-flash-image", "p", api_key="K",
    )
    assert out == b"\x89PNGgem"


# ── Endpoint tests ─────────────────────────────────────────────────────────


def test_generate_endpoint_rejects_non_plan_label_exercise(monkeypatch):
    fake, authz = _patch(monkeypatch)
    fake.tables["listening_exercises"].append({
        "id": "ex-1", "content_id": "c-1",
        "exercise_type": "mcq",
        "payload": {"variant": "mcq_3option"},
    })
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_generate_map_image(
            exercise_id="ex-1", body=None, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_generate_endpoint_404_on_missing_exercise(monkeypatch):
    _fake, authz = _patch(monkeypatch)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_generate_map_image(
            exercise_id="nope", body=None, authorization=authz,
        ))
    assert excinfo.value.status_code == 404


def test_generate_endpoint_500_when_api_key_missing(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    monkeypatch.setattr(listening_router.settings, "GEMINI_API_KEY", "", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_generate_map_image(
            exercise_id=seed["exercise_id"], body=None, authorization=authz,
        ))
    assert excinfo.value.status_code == 500
    assert "GEMINI_API_KEY" in str(excinfo.value.detail)


def test_generate_endpoint_happy_path_returns_signed_url_and_updates_payload(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    monkeypatch.setattr(
        listening_map_image, "call_image_model",
        lambda model, prompt, *, api_key, timeout_seconds=60: b"\x89PNGok",
    )
    out = _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(model=None),
        authorization=authz,
    ))
    assert out["exercise_id"] == seed["exercise_id"]
    assert out["signed_url"].startswith("https://stor.test/listening-images/")
    # Sprint 13.5.9.2 — cluster default flipped from imagen-4.0-fast
    # to Nano Banana 2 (gemini-3.1-flash-image-preview). The endpoint
    # respects ``settings.LISTENING_MAP_IMAGE_MODEL`` which now points
    # at the new default.
    assert out["map_image_model"] == "gemini-3.1-flash-image-preview"
    assert out["cost_estimate_usd"] == 0.067
    # Sprint 13.5.9 — the response must declare prompt source so the
    # admin UI can render the indicator without a follow-up fetch.
    assert out["map_image_prompt_source"] == "template"

    ex = fake.tables["listening_exercises"][0]
    assert ex["payload"]["map_image_storage_path"].endswith(".png")
    assert ex["payload"]["map_image_size_bytes"] > 0
    assert ex["payload"]["map_image_generated_at"]
    assert ex["payload"]["map_image_prompt_source"] == "template"


def test_generate_endpoint_forwards_custom_prompt_from_payload(monkeypatch):
    """Sprint 13.5.9 — when the parser deposits a curated prompt on
    ``metadata.map_image_custom_prompt``, the endpoint must lift it
    onto the ``generate_and_upload`` call and the result must declare
    ``map_image_prompt_source == "custom"``. The prompt actually sent
    to the model is the curated text, not the Cambridge template.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)

    # Inject a curated prompt onto the exercise payload as the parser
    # would after Sprint 13.5.9.
    curated = "## Curated AI prompt — north arrow at top-left, monochrome only."
    fake.tables["listening_exercises"][0]["payload"]["metadata"][
        "map_image_custom_prompt"
    ] = curated

    captured = {}

    def _fake_call(model, prompt, *, api_key, timeout_seconds=60):
        captured["prompt"] = prompt
        return b"\x89PNGok"
    monkeypatch.setattr(listening_map_image, "call_image_model", _fake_call)

    out = _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(model=None),
        authorization=authz,
    ))
    # Curated prompt sent verbatim — no template language sneaks in.
    assert captured["prompt"] == curated
    assert out["map_image_prompt_source"] == "custom"
    assert out["map_image_prompt"] == curated

    ex = fake.tables["listening_exercises"][0]
    assert ex["payload"]["map_image_prompt_source"] == "custom"


def test_admin_get_test_surfaces_custom_prompt_and_last_source(monkeypatch):
    """Sprint 13.5.9 — the admin ``GET /tests/{id}`` endpoint must
    surface both the curated prompt (for the preview panel) and the
    source used by the last generation (for the "current image was
    generated from …" sub-label).
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=True)
    fake.tables["listening_exercises"][0]["payload"]["metadata"][
        "map_image_custom_prompt"
    ] = "## Curated AI prompt — sample"
    fake.tables["listening_exercises"][0]["payload"][
        "map_image_prompt_source"
    ] = "custom"

    out = _run(listening_router.admin_get_listening_test(
        test_id=seed["test_id_uuid"], authorization=authz,
    ))
    pl_list = out.get("plan_label_exercises") or []
    assert len(pl_list) == 1
    pl = pl_list[0]
    assert pl["map_image_custom_prompt"].startswith("## Curated AI prompt")
    assert pl["map_image_prompt_source"] == "custom"
    assert pl["has_map_image"] is True


def test_admin_get_test_omits_custom_prompt_when_none_present(monkeypatch):
    """Regression — when no parser-deposited prompt exists, the
    admin endpoint surfaces ``map_image_custom_prompt = None`` so the
    UI can render the "template" indicator without ambiguity.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    out = _run(listening_router.admin_get_listening_test(
        test_id=seed["test_id_uuid"], authorization=authz,
    ))
    pl_list = out.get("plan_label_exercises") or []
    assert len(pl_list) == 1
    assert pl_list[0]["map_image_custom_prompt"] is None


# ── Sprint 13.5.9.1 — admin override precedence + observability ───────────


def test_generate_endpoint_prefers_admin_override_over_parser_prompt(monkeypatch):
    """Sprint 13.5.9.1 — when the admin types a reviewed/edited prompt
    into the textarea and clicks Generate, the override beats the
    parser-extracted prompt. The result must declare
    ``map_image_prompt_source == "admin_override"`` so the panel can
    differentiate edited vs untouched runs.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)

    # The exercise carries a curated prompt from markdown.
    parser_prompt = "## Parser-extracted curated prompt"
    fake.tables["listening_exercises"][0]["payload"]["metadata"][
        "map_image_custom_prompt"
    ] = parser_prompt

    override = "## Admin-edited prompt — emphasise north arrow at top-left, larger"
    captured = {}

    def _fake_call(model, prompt, *, api_key, timeout_seconds=60):
        captured["prompt"] = prompt
        return b"\x89PNGok"
    monkeypatch.setattr(listening_map_image, "call_image_model", _fake_call)

    out = _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(
            model=None, custom_prompt_override=override,
        ),
        authorization=authz,
    ))

    # The image model received the override, not the parser prompt.
    assert captured["prompt"] == override
    assert out["map_image_prompt"] == override
    assert out["map_image_prompt_source"] == "admin_override"

    # Persisted payload reflects the actual source for the panel.
    ex = fake.tables["listening_exercises"][0]
    assert ex["payload"]["map_image_prompt_source"] == "admin_override"
    # The parser-extracted prompt itself must NOT be overwritten — a
    # subsequent generation without override should still find it.
    assert ex["payload"]["metadata"]["map_image_custom_prompt"] == parser_prompt


def test_generate_endpoint_falls_back_to_parser_prompt_when_override_empty(monkeypatch):
    """An override of None / "" / whitespace-only must fall through to
    the parser-extracted prompt rather than silently bypassing it.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)

    parser_prompt = "## Parser-extracted curated prompt — keep using me"
    fake.tables["listening_exercises"][0]["payload"]["metadata"][
        "map_image_custom_prompt"
    ] = parser_prompt
    captured = {}

    def _fake_call(model, prompt, *, api_key, timeout_seconds=60):
        captured["prompt"] = prompt
        return b"\x89PNGok"
    monkeypatch.setattr(listening_map_image, "call_image_model", _fake_call)

    for empty in (None, "", "   \n\n  "):
        captured.clear()
        out = _run(listening_router.admin_generate_map_image(
            exercise_id=seed["exercise_id"],
            body=listening_router.GenerateMapImageRequest(
                model=None, custom_prompt_override=empty,
            ),
            authorization=authz,
        ))
        assert captured["prompt"] == parser_prompt
        assert out["map_image_prompt_source"] == "custom"


def test_generate_endpoint_admin_override_falls_to_template_when_no_parser_prompt(monkeypatch):
    """Edge case — admin sends an empty override AND no parser prompt
    exists. The service should fall all the way through to the
    Cambridge template (source = "template").
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    # Sanity — no curated prompt seeded on this exercise.
    assert "map_image_custom_prompt" not in (
        fake.tables["listening_exercises"][0]["payload"].get("metadata") or {}
    )
    monkeypatch.setattr(
        listening_map_image, "call_image_model",
        lambda model, prompt, *, api_key, timeout_seconds=60: b"\x89PNGok",
    )

    out = _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(
            model=None, custom_prompt_override="",
        ),
        authorization=authz,
    ))
    assert out["map_image_prompt_source"] == "template"


def test_generate_endpoint_logs_origin_and_prompt_length(monkeypatch, caplog):
    """Sprint 13.5.9.1 — the endpoint emits a single structured INFO
    log per generation that names the prompt origin and length. The
    next time Andy reports a quality regression we can grep this line
    to know whether the chain carried the curated text or the
    template.
    """
    import logging
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    monkeypatch.setattr(
        listening_map_image, "call_image_model",
        lambda model, prompt, *, api_key, timeout_seconds=60: b"\x89PNGok",
    )

    with caplog.at_level(logging.INFO, logger="routers.listening"):
        _run(listening_router.admin_generate_map_image(
            exercise_id=seed["exercise_id"],
            body=listening_router.GenerateMapImageRequest(model=None),
            authorization=authz,
        ))
    msgs = [r.getMessage() for r in caplog.records if "[map_image] generate" in r.getMessage()]
    assert msgs, "expected a structured generate log from the endpoint"
    line = msgs[0]
    assert "origin=template" in line
    assert "prompt_chars=0" in line


def test_generate_request_accepts_optional_override_field():
    """Sprint 13.5.9.1 — ``GenerateMapImageRequest`` must declare
    ``custom_prompt_override: Optional[str]`` so the body schema can
    accept the new field without breaking existing callers (model-only).
    """
    # Old shape — still accepted.
    req_old = listening_router.GenerateMapImageRequest(model="imagen-4.0-fast-generate-001")
    assert req_old.custom_prompt_override is None

    # New shape — override carries a string.
    req_new = listening_router.GenerateMapImageRequest(
        model=None, custom_prompt_override="my prompt",
    )
    assert req_new.custom_prompt_override == "my prompt"


def test_generate_request_serialises_override_correctly_via_round_trip():
    """Sanity — the body Pydantic model must round-trip the override
    field through ``model_dump`` so FastAPI's JSON encoding doesn't
    drop it. Caught a real regression in an earlier hotfix where a
    body field was declared but never serialised.
    """
    req = listening_router.GenerateMapImageRequest(
        model="imagen-4.0-fast-generate-001",
        custom_prompt_override="## reviewed prompt",
    )
    dumped = req.model_dump()
    assert dumped["custom_prompt_override"] == "## reviewed prompt"
    assert dumped["model"] == "imagen-4.0-fast-generate-001"


def test_generate_request_rejects_unknown_body_fields():
    """The body model uses ``extra="forbid"`` so a typo in the JSON
    (e.g. ``custom_prompt`` instead of ``custom_prompt_override``)
    surfaces a 422 at the boundary instead of silently dropping.
    """
    with pytest.raises(Exception):
        listening_router.GenerateMapImageRequest(
            model=None, customPrompt="oops camelCase",
        )


def test_admin_override_repeats_correctly_across_generations(monkeypatch):
    """First call with an override sets source=admin_override; a
    follow-up call WITHOUT override on the same exercise must restore
    source=custom (the parser prompt still lives in metadata) and not
    silently keep using the previous override.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    parser_prompt = "## Parser prompt — keep me available"
    fake.tables["listening_exercises"][0]["payload"]["metadata"][
        "map_image_custom_prompt"
    ] = parser_prompt
    monkeypatch.setattr(
        listening_map_image, "call_image_model",
        lambda model, prompt, *, api_key, timeout_seconds=60: b"\x89PNGok",
    )

    # 1) Admin override drives generation.
    out1 = _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(
            model=None, custom_prompt_override="## edited once"),
        authorization=authz,
    ))
    assert out1["map_image_prompt_source"] == "admin_override"

    # 2) Same exercise, no override — must fall back to parser prompt.
    out2 = _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(model=None),
        authorization=authz,
    ))
    assert out2["map_image_prompt_source"] == "custom"
    assert out2["map_image_prompt"] == parser_prompt


def test_admin_override_bypasses_50char_guard(monkeypatch):
    """The 50-char map_description guard only protects the template
    path. An admin override must let generation proceed even when the
    description is short — mirrors the service-layer contract for the
    parser-prompt path (already pinned in 13.5.9).
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    fake.tables["listening_exercises"][0]["payload"]["metadata"][
        "map_description"
    ] = "too short"
    fake.tables["listening_exercises"][0]["payload"]["map_description"] = "too short"
    monkeypatch.setattr(
        listening_map_image, "call_image_model",
        lambda model, prompt, *, api_key, timeout_seconds=60: b"\x89PNGok",
    )

    out = _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(
            model=None,
            custom_prompt_override="## Override long enough to drive image gen.",
        ),
        authorization=authz,
    ))
    assert out["map_image_prompt_source"] == "admin_override"


def test_admin_override_takes_priority_over_top_level_payload_prompt(monkeypatch):
    """Defensive: even when both the metadata-nested prompt AND a
    top-level ``payload.map_image_custom_prompt`` exist, an admin
    override beats them. Pins the precedence chain explicitly.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    fake.tables["listening_exercises"][0]["payload"]["metadata"][
        "map_image_custom_prompt"
    ] = "## from metadata"
    fake.tables["listening_exercises"][0]["payload"][
        "map_image_custom_prompt"
    ] = "## from payload root"
    captured = {}

    def _fake_call(model, prompt, *, api_key, timeout_seconds=60):
        captured["prompt"] = prompt
        return b"\x89PNGok"
    monkeypatch.setattr(listening_map_image, "call_image_model", _fake_call)

    out = _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(
            model=None, custom_prompt_override="## override wins",
        ),
        authorization=authz,
    ))
    assert captured["prompt"] == "## override wins"
    assert out["map_image_prompt_source"] == "admin_override"


def test_admin_override_preserves_parser_prompt_field_in_payload(monkeypatch):
    """Regression — the override is session-only. The persisted payload
    must still expose the parser-extracted prompt for the next render
    of the admin panel (so the textarea re-fills from the canonical
    source after a page refresh).
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    parser_prompt = "## parser prompt that must survive"
    fake.tables["listening_exercises"][0]["payload"]["metadata"][
        "map_image_custom_prompt"
    ] = parser_prompt
    monkeypatch.setattr(
        listening_map_image, "call_image_model",
        lambda model, prompt, *, api_key, timeout_seconds=60: b"\x89PNGok",
    )

    _run(listening_router.admin_generate_map_image(
        exercise_id=seed["exercise_id"],
        body=listening_router.GenerateMapImageRequest(
            model=None, custom_prompt_override="## override ephemeral",
        ),
        authorization=authz,
    ))
    ex = fake.tables["listening_exercises"][0]
    # Parser prompt still there for the next panel render.
    assert ex["payload"]["metadata"]["map_image_custom_prompt"] == parser_prompt


def test_generate_endpoint_logs_admin_override_origin(monkeypatch, caplog):
    """Companion sentinel — when the admin override drives generation
    the log must say so, with the override length.
    """
    import logging
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    monkeypatch.setattr(
        listening_map_image, "call_image_model",
        lambda model, prompt, *, api_key, timeout_seconds=60: b"\x89PNGok",
    )

    override = "## Admin-edited prompt with 42 chars exactly!!"  # = 47
    with caplog.at_level(logging.INFO, logger="routers.listening"):
        _run(listening_router.admin_generate_map_image(
            exercise_id=seed["exercise_id"],
            body=listening_router.GenerateMapImageRequest(
                model=None, custom_prompt_override=override,
            ),
            authorization=authz,
        ))
    msgs = [r.getMessage() for r in caplog.records if "[map_image] generate" in r.getMessage()]
    assert msgs
    assert "origin=admin_override" in msgs[0]
    assert f"prompt_chars={len(override)}" in msgs[0]


def test_delete_endpoint_clears_payload_and_storage(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=True)
    out = _run(listening_router.admin_delete_map_image(
        exercise_id=seed["exercise_id"], authorization=authz,
    ))
    assert out["deleted"] is True
    assert out["had_image"] is True
    assert fake.removed, "storage object must be removed"
    ex = fake.tables["listening_exercises"][0]
    for k in ("map_image_storage_path", "map_image_model", "map_image_size_bytes",
              "map_image_prompt", "map_image_generated_at"):
        assert k not in ex["payload"]


def test_delete_endpoint_idempotent_when_no_image_present(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=False)
    out = _run(listening_router.admin_delete_map_image(
        exercise_id=seed["exercise_id"], authorization=authz,
    ))
    assert out["deleted"] is True
    assert out["had_image"] is False
    assert fake.removed == []


def test_signed_url_endpoint_returns_404_when_no_image(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=False)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_get_map_image_signed_url(
            exercise_id=seed["exercise_id"], expires_in=3600, authorization=authz,
        ))
    assert excinfo.value.status_code == 404


def test_signed_url_endpoint_returns_fresh_url_with_metadata(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=True)
    out = _run(listening_router.admin_get_map_image_signed_url(
        exercise_id=seed["exercise_id"], expires_in=600, authorization=authz,
    ))
    assert out["signed_url"].startswith("https://stor.test/listening-images/")
    assert out["expires_in"] == 600
    assert out["map_image_model"] == "imagen-4.0-fast-generate-001"


def test_student_endpoint_injects_signed_url_into_plan_label_payload(monkeypatch):
    """Sprint 13.5.6 — GET /api/listening/tests/{id} must mint a fresh
    2h signed URL for each plan-label exercise that has a generated
    map image, surfaced as `payload.map_image_url`.
    """
    fake, _authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=True)
    # Mark the test row as published + audio-ready so the student
    # endpoint will serve it.
    fake.tables["listening_tests"][0].update({
        "status": "published",
        "full_audio_storage_path": "tests/x/full.mp3",
        "assembled_audio_storage_path": None,
        "themes": {},
        "title": "Pilot 01",
    })
    # User auth stub.
    async def _ok_user(_authz):
        return {"id": "user-1"}
    monkeypatch.setattr(listening_router, "_require_auth", _ok_user)

    out = _run(listening_router.get_published_listening_test(
        test_id=seed["test_id_uuid"], authorization="Bearer u",
    ))
    sec2 = next(s for s in out["sections"] if s["section_num"] == 2)
    ex = sec2["exercises"][0]
    assert ex["payload"]["map_image_url"].startswith(
        "https://stor.test/listening-images/",
    )
    # The Sprint 13.5 security guard still applies — no answer key
    # leaks even though we are injecting the image URL.
    assert "answers" not in ex["payload"]


# ── Sprint 13.5.9.3 — manual upload escape hatch ───────────────────────────


# Smallest valid signatures for each format. Each is padded to 256 B
# so it clears the endpoint's 100-byte sanity floor without being so
# large that it hides off-by-one bugs in the size guard.

_VALID_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 248
_VALID_JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 252
_VALID_WEBP = b"RIFF" + (256).to_bytes(4, "little") + b"WEBP" + b"\x00" * 244
_GIF87 = b"GIF87a" + b"\x00" * 250          # unsupported
_TINY = b"PNG"                              # too small


class _FakeUpload:
    """Mimics the FastAPI ``UploadFile`` surface our endpoint uses
    (``read()`` returns bytes once). Keeping this in this test module
    avoids dragging in starlette's multipart wiring for unit tests.
    """

    def __init__(self, contents: bytes, filename: str = "map.png"):
        self._contents = contents
        self.filename = filename

    async def read(self) -> bytes:
        return self._contents


def test_detect_image_format_classifies_png_jpg_webp_and_rejects_others():
    detect = listening_router._detect_image_format
    assert detect(_VALID_PNG)  == "png"
    assert detect(_VALID_JPG)  == "jpg"
    assert detect(_VALID_WEBP) == "webp"
    # GIF / empty / short / random bytes all return None.
    assert detect(_GIF87)               is None
    assert detect(b"")                  is None
    assert detect(b"PNG")               is None
    assert detect(b"\x00" * 256)        is None


def test_upload_map_image_happy_path_persists_png_and_tags_manual_upload(monkeypatch):
    """End-to-end PNG upload: bytes hit storage, payload carries the
    full manual-upload provenance, response is wired for the admin
    panel preview."""
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)

    out = _run(listening_router.admin_upload_map_image(
        exercise_id=seed["exercise_id"],
        image_file=_FakeUpload(_VALID_PNG),
        authorization=authz,
    ))

    assert out["exercise_id"] == seed["exercise_id"]
    assert out["map_image_source"] == "manual_upload"
    assert out["map_image_format"] == "png"
    assert out["map_image_size_bytes"] == len(_VALID_PNG)
    assert out["signed_url"].startswith("https://stor.test/listening-images/")
    # Storage path lives under the same tests/<uuid>/maps/ prefix as
    # API-generated images so the existing delete endpoint sweeps it.
    assert out["map_image_storage_path"].startswith(
        f"tests/{seed['test_id_uuid']}/maps/{seed['exercise_id']}-manual-",
    )
    assert out["map_image_storage_path"].endswith(".png")

    # Bytes uploaded to the listening-images bucket.
    assert fake.uploads, "expected the PNG bytes to hit storage"
    bucket_name, path, size = fake.uploads[0]
    assert bucket_name == "listening-images"
    assert size == len(_VALID_PNG)
    assert path == out["map_image_storage_path"]

    # Persisted payload: source flag set, API-only fields nulled.
    ex = fake.tables["listening_exercises"][0]
    p = ex["payload"]
    assert p["map_image_source"] == "manual_upload"
    assert p["map_image_model"] is None
    assert p["map_image_prompt"] is None
    assert p["map_image_prompt_source"] is None
    assert p["map_image_uploaded_by"] == "admin-1"


def test_upload_map_image_accepts_jpg_via_magic_byte_sniff(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    out = _run(listening_router.admin_upload_map_image(
        exercise_id=seed["exercise_id"],
        image_file=_FakeUpload(_VALID_JPG, filename="map.jpeg"),
        authorization=authz,
    ))
    assert out["map_image_format"] == "jpg"
    assert out["map_image_storage_path"].endswith(".jpg")
    # JPG content-type spelled out properly (image/jpeg, not image/jpg).
    # Our fake bucket records only path+size, so verify via the payload
    # extension; the upload call itself doesn't blow up.


def test_upload_map_image_accepts_webp(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    out = _run(listening_router.admin_upload_map_image(
        exercise_id=seed["exercise_id"],
        image_file=_FakeUpload(_VALID_WEBP, filename="map.webp"),
        authorization=authz,
    ))
    assert out["map_image_format"] == "webp"
    assert out["map_image_storage_path"].endswith(".webp")


def test_upload_map_image_rejects_too_small_400(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_upload_map_image(
            exercise_id=seed["exercise_id"],
            image_file=_FakeUpload(_TINY),
            authorization=authz,
        ))
    assert excinfo.value.status_code == 400
    assert "too small" in str(excinfo.value.detail).lower()


def test_upload_map_image_rejects_too_large_413(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    # 5MB + 1 byte payload, still PNG-signatured so size is the only
    # thing the endpoint can reject on.
    too_big = _VALID_PNG + b"\x00" * (5 * 1024 * 1024)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_upload_map_image(
            exercise_id=seed["exercise_id"],
            image_file=_FakeUpload(too_big),
            authorization=authz,
        ))
    assert excinfo.value.status_code == 413
    assert "5 MB" in str(excinfo.value.detail)


def test_upload_map_image_rejects_unsupported_format_415(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    # GIF passes the size guard but fails the format sniff.
    gif_payload = _GIF87 + b"\x00" * 100
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_upload_map_image(
            exercise_id=seed["exercise_id"],
            image_file=_FakeUpload(gif_payload, filename="map.gif"),
            authorization=authz,
        ))
    assert excinfo.value.status_code == 415
    assert "PNG, JPG, WebP" in str(excinfo.value.detail)


def test_upload_map_image_rejects_non_plan_label_exercise_422(monkeypatch):
    fake, authz = _patch(monkeypatch)
    fake.tables["listening_exercises"].append({
        "id": "ex-1", "content_id": "c-1",
        "exercise_type": "mcq",
        "payload": {"variant": "mcq_3option"},
    })
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_upload_map_image(
            exercise_id="ex-1",
            image_file=_FakeUpload(_VALID_PNG),
            authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_upload_map_image_404_when_exercise_missing(monkeypatch):
    fake, authz = _patch(monkeypatch)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_upload_map_image(
            exercise_id=str(uuid4()),
            image_file=_FakeUpload(_VALID_PNG),
            authorization=authz,
        ))
    assert excinfo.value.status_code == 404


def test_upload_map_image_overwrites_existing_api_generated_image(monkeypatch):
    """Sprint 13.5.6 → 13.5.9.3 transition: when an API-generated image
    already exists, a manual upload swaps the storage path + flips the
    source flag. The API-only fields are nulled so the panel never
    shows stale model / prompt-source metadata after a manual replace.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=True)

    # Sanity — the seeded row has API provenance.
    seeded = fake.tables["listening_exercises"][0]["payload"]
    assert seeded["map_image_model"] == "imagen-4.0-fast-generate-001"

    out = _run(listening_router.admin_upload_map_image(
        exercise_id=seed["exercise_id"],
        image_file=_FakeUpload(_VALID_PNG),
        authorization=authz,
    ))

    ex = fake.tables["listening_exercises"][0]["payload"]
    assert ex["map_image_source"] == "manual_upload"
    assert ex["map_image_model"] is None
    assert ex["map_image_storage_path"] == out["map_image_storage_path"]
    # New path is different from the seeded API path — admin can clean
    # up the old object via the delete endpoint in a follow-up.
    assert ex["map_image_storage_path"] != seeded["map_image_storage_path"]


def test_upload_map_image_records_uploader_admin_id(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    _run(listening_router.admin_upload_map_image(
        exercise_id=seed["exercise_id"],
        image_file=_FakeUpload(_VALID_PNG),
        authorization=authz,
    ))
    p = fake.tables["listening_exercises"][0]["payload"]
    assert p["map_image_uploaded_by"] == "admin-1"
    # Same value also drives the audit log line.
    assert p.get("map_image_uploaded_at"), "missing manual-upload timestamp"


def test_upload_map_image_logs_audit_line(monkeypatch, caplog):
    """One INFO log line per manual upload so server logs flag every
    non-API map image. Mirrors the Sprint 13.5.9.1 generate log shape.
    """
    import logging
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    with caplog.at_level(logging.INFO, logger="routers.listening"):
        _run(listening_router.admin_upload_map_image(
            exercise_id=seed["exercise_id"],
            image_file=_FakeUpload(_VALID_PNG),
            authorization=authz,
        ))
    msgs = [r.getMessage() for r in caplog.records
            if "manual upload" in r.getMessage()]
    assert msgs, "expected a manual-upload INFO log line"
    line = msgs[0]
    assert f"exercise={seed['exercise_id']}" in line
    assert f"size={len(_VALID_PNG)}" in line
    assert "fmt=png" in line


def test_upload_map_image_storage_path_uses_manual_marker(monkeypatch):
    """The storage path must include ``-manual-<timestamp>`` so a
    bucket browser can tell at a glance which images came from the
    escape hatch vs the API path (``<exercise_id>.png``).
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake)
    out = _run(listening_router.admin_upload_map_image(
        exercise_id=seed["exercise_id"],
        image_file=_FakeUpload(_VALID_PNG),
        authorization=authz,
    ))
    import re
    pattern = (
        rf"^tests/{seed['test_id_uuid']}/maps/{seed['exercise_id']}"
        r"-manual-\d{9,12}\.png$"
    )
    assert re.match(pattern, out["map_image_storage_path"]), (
        f"path {out['map_image_storage_path']!r} does not match {pattern}"
    )


def test_delete_endpoint_also_clears_manual_upload_provenance_fields(monkeypatch):
    """Regression — Sprint 13.5.9.3 added new payload fields; the
    delete endpoint must sweep them so a stale Manual-upload badge
    doesn't survive the wipe.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=True)
    # Add the new manual-upload tags onto the seeded payload.
    p = fake.tables["listening_exercises"][0]["payload"]
    p["map_image_source"]      = "manual_upload"
    p["map_image_uploaded_at"] = "2026-05-21T00:00:00+00:00"
    p["map_image_uploaded_by"] = "admin-1"

    out = _run(listening_router.admin_delete_map_image(
        exercise_id=seed["exercise_id"], authorization=authz,
    ))
    assert out["deleted"] is True
    after = fake.tables["listening_exercises"][0]["payload"]
    for key in (
        "map_image_storage_path", "map_image_source",
        "map_image_uploaded_at", "map_image_uploaded_by",
        "map_image_prompt_source", "map_image_model",
    ):
        assert key not in after, f"{key} survived the wipe"


def test_admin_get_test_surfaces_map_image_source_manual_upload(monkeypatch):
    """The admin detail projection must include
    ``map_image_source`` so the admin panel can render the correct
    badge (Manual upload vs API: <model>) without a follow-up fetch.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=True)
    fake.tables["listening_exercises"][0]["payload"]["map_image_source"] = (
        "manual_upload"
    )
    out = _run(listening_router.admin_get_listening_test(
        test_id=seed["test_id_uuid"], authorization=authz,
    ))
    pl = (out.get("plan_label_exercises") or [])[0]
    assert pl["map_image_source"] == "manual_upload"


def test_admin_get_test_infers_api_source_when_model_present_and_no_explicit_source(monkeypatch):
    """Backwards-compat: legacy exercises generated under Sprint
    13.5.6 lack the ``map_image_source`` field but have a non-null
    ``map_image_model``. The projection infers ``"api_generation"``
    so the panel can still render the right badge.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_plan_label_exercise(fake, with_image=True)
    # Sanity — the seeded row has model but not the new explicit flag.
    p = fake.tables["listening_exercises"][0]["payload"]
    assert p["map_image_model"]
    assert "map_image_source" not in p
    out = _run(listening_router.admin_get_listening_test(
        test_id=seed["test_id_uuid"], authorization=authz,
    ))
    pl = (out.get("plan_label_exercises") or [])[0]
    assert pl["map_image_source"] == "api_generation"
