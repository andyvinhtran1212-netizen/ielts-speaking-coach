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
    assert out["map_image_model"] == "imagen-4.0-fast-generate-001"
    assert out["cost_estimate_usd"] == 0.02
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
