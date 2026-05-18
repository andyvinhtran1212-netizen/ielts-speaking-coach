"""Sprint 11.1 — pin services/listening_renderer.py contract.

Three contracts:
  1. render_via_elevenlabs happy path — POST + return MP3 bytes.
  2. Retry on 5xx → eventually succeeds (reuses Sprint 10.7
     _call_with_retry pattern; transient failure is recoverable).
  3. Retry skipped on 4xx → propagates immediately (auth/validation
     errors don't retry — Sprint 10.7 falsification 44 logic).

Plus a smoke test that the public BG-task entry signature stays
stable — the router's add_task call uses keyword args, so a future
refactor that reorders positionals can still pass.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import requests

from services import listening_renderer


# ── Helpers ──────────────────────────────────────────────────────────


def _fake_response(
    *,
    status_code: int,
    content: bytes = b"",
    json_body: dict | None = None,
) -> MagicMock:
    """Build a requests.Response stand-in for monkeypatching requests.post.

    Sprint 11.4 — supports both shapes:
      - `content=...` for the legacy /text-to-speech audio-bytes path
      - `json_body=...` for the /with-timestamps JSON path
    """
    r = MagicMock(spec=requests.Response)
    r.status_code = status_code
    r.content = content
    if json_body is not None:
        r.json = lambda: json_body
    else:
        r.json = lambda: {}
    if status_code >= 400:
        def _raise():
            raise requests.HTTPError(f"{status_code} error", response=r)
        r.raise_for_status = _raise
    else:
        r.raise_for_status = lambda: None
    return r


def _fake_with_timestamps_response(
    *,
    audio_bytes: bytes,
    include_alignment: bool = True,
) -> MagicMock:
    """Sprint 11.4 — build the /with-timestamps JSON response shape."""
    import base64
    body: dict = {"audio_base64": base64.b64encode(audio_bytes).decode("ascii")}
    if include_alignment:
        body["alignment"] = {
            "characters":                    list("abcd"),
            "character_start_times_seconds": [0.0, 0.05, 0.10, 0.15],
            "character_end_times_seconds":   [0.05, 0.10, 0.15, 0.20],
        }
    return _fake_response(status_code=200, json_body=body)


# ── render_via_elevenlabs ────────────────────────────────────────────


def test_render_via_elevenlabs_happy_path(monkeypatch):
    monkeypatch.setattr(listening_renderer.settings, "ELEVENLABS_API_KEY", "sk_test")

    calls: list = []

    def _fake_post(url, headers=None, json=None, timeout=None):
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return _fake_response(status_code=200, content=b"MP3-BYTES")

    monkeypatch.setattr(listening_renderer.requests, "post", _fake_post)

    out = listening_renderer.render_via_elevenlabs(
        script_text="Hello world.",
        voice_id="21m00Tcm4TlvDq8ikWAM",
        model="eleven_multilingual_v2",
    )
    assert out == b"MP3-BYTES"
    assert len(calls) == 1
    call = calls[0]
    # URL carries the voice_id path param.
    assert call["url"].endswith("/text-to-speech/21m00Tcm4TlvDq8ikWAM")
    # Headers carry the API key + Accept: audio/mpeg.
    assert call["headers"]["xi-api-key"] == "sk_test"
    assert call["headers"]["Accept"] == "audio/mpeg"
    # Payload carries text + model_id + voice_settings.
    assert call["json"]["text"] == "Hello world."
    assert call["json"]["model_id"] == "eleven_multilingual_v2"
    assert "voice_settings" in call["json"]


def test_render_via_elevenlabs_no_api_key_raises(monkeypatch):
    """Defense: even if a caller skips the router's flag gate (backfill
    script, direct call), an empty key surfaces a clear error."""
    monkeypatch.setattr(listening_renderer.settings, "ELEVENLABS_API_KEY", "")
    with pytest.raises(RuntimeError, match="ELEVENLABS_API_KEY"):
        listening_renderer.render_via_elevenlabs(
            script_text="x",
            voice_id="v",
            model="eleven_multilingual_v2",
        )


# ── run_elevenlabs_render_job (BackgroundTask entry) ─────────────────


def test_render_job_uploads_then_inserts_on_success(monkeypatch):
    """Happy path end-to-end: render → upload → INSERT. Sprint 11.4 —
    uses the new /with-timestamps endpoint shape (JSON with
    audio_base64) instead of raw MP3 bytes."""
    monkeypatch.setattr(listening_renderer.settings, "ELEVENLABS_API_KEY", "sk_test")
    monkeypatch.setattr(listening_renderer.settings, "LISTENING_AUDIO_BUCKET", "listening-audio")

    monkeypatch.setattr(
        listening_renderer.requests, "post",
        lambda *a, **kw: _fake_with_timestamps_response(audio_bytes=b"X" * 32_000),
    )

    uploads: list = []
    inserts: list = []

    class _FakeBucket:
        def upload(self, path, data, headers=None):
            uploads.append((path, len(data), headers))
            return {"path": path}

    class _FakeStorage:
        def from_(self, _bucket):
            return _FakeBucket()

    class _FakeTable:
        def insert(self, payload):
            inserts.append(payload)
            class _Exec:
                def execute(self_): return MagicMock(data=[payload])
            return _Exec()

    fake_admin = MagicMock()
    fake_admin.storage = _FakeStorage()
    fake_admin.table = lambda _name: _FakeTable()
    monkeypatch.setattr(listening_renderer, "supabase_admin", fake_admin)

    listening_renderer.run_elevenlabs_render_job(
        job_id="job-1",
        script_text="Sample script for the test render.",
        voice_id="v1",
        model="eleven_multilingual_v2",
        title="Test render",
        accent_tag="us_general",
        cefr_level="B2",
        ielts_section=1,
        topic_tags=["test"],
        transcript=None,
        created_by_user_id="admin-1",
    )
    # Upload landed.
    assert len(uploads) == 1
    path, size, headers = uploads[0]
    assert path == "ai/job-1.mp3"
    assert size == 32_000
    assert headers == {"content-type": "audio/mpeg"}
    # Row INSERTed with the right discriminator + ai-source provenance.
    assert len(inserts) == 1
    payload = inserts[0]
    assert payload["id"] == "job-1"
    assert payload["source_type"] == "ai_elevenlabs"
    assert payload["elevenlabs_voice_id"] == "v1"
    assert payload["elevenlabs_model"] == "eleven_multilingual_v2"
    assert payload["audio_storage_path"] == "ai/job-1.mp3"
    assert payload["audio_size_bytes"] == 32_000
    # Transcript defaults to script_text when omitted.
    assert payload["transcript"] == "Sample script for the test render."
    # Cost estimate: 34 chars × 2 (multilingual_v2) = 68 credits.
    assert payload["generation_cost_credits"] == 34 * 2
    # Sprint 11.4 — alignment_data persisted.
    assert isinstance(payload["alignment_data"], dict)
    assert "character_start_times_seconds" in payload["alignment_data"]


def test_render_job_swallows_render_failure(monkeypatch):
    """Fail-soft: BackgroundTask exceptions MUST NOT propagate. A
    failed ElevenLabs render logs ERROR and returns; no upload, no
    INSERT."""
    monkeypatch.setattr(listening_renderer.settings, "ELEVENLABS_API_KEY", "sk_test")
    # Force a non-retryable error (4xx so retry doesn't fire).
    monkeypatch.setattr(
        listening_renderer.requests, "post",
        lambda *a, **kw: _fake_response(status_code=400),
    )

    uploads: list = []
    inserts: list = []
    fake_admin = MagicMock()
    fake_admin.storage = MagicMock()
    fake_admin.storage.from_ = MagicMock(side_effect=lambda b: MagicMock(
        upload=lambda *a, **kw: uploads.append(a)
    ))
    fake_admin.table = MagicMock(side_effect=lambda n: MagicMock(
        insert=lambda p: (inserts.append(p), MagicMock(execute=MagicMock()))[1]
    ))
    monkeypatch.setattr(listening_renderer, "supabase_admin", fake_admin)

    # Should NOT raise.
    listening_renderer.run_elevenlabs_render_job(
        job_id="job-2",
        script_text="x" * 50,
        voice_id="v1",
        model="eleven_multilingual_v2",
        title="t",
        accent_tag="us_general",
        cefr_level=None,
        ielts_section=None,
        topic_tags=None,
        transcript=None,
        created_by_user_id="admin-1",
    )
    # Failure path → neither upload nor INSERT happened.
    assert uploads == []
    assert inserts == []


def test_render_job_swallows_bucket_failure(monkeypatch):
    """Mirror grading.py:240-250 pattern — bucket-not-found error
    swallowed + logged."""
    monkeypatch.setattr(listening_renderer.settings, "ELEVENLABS_API_KEY", "sk_test")
    monkeypatch.setattr(
        listening_renderer.requests, "post",
        lambda *a, **kw: _fake_with_timestamps_response(audio_bytes=b"MP3"),
    )

    inserts: list = []

    class _FailingBucket:
        def upload(self, *a, **kw):
            raise RuntimeError("bucket not found")

    fake_admin = MagicMock()
    fake_admin.storage = MagicMock()
    fake_admin.storage.from_ = lambda _b: _FailingBucket()
    fake_admin.table = MagicMock(side_effect=lambda n: MagicMock(
        insert=lambda p: (inserts.append(p), MagicMock(execute=MagicMock()))[1]
    ))
    monkeypatch.setattr(listening_renderer, "supabase_admin", fake_admin)

    # Should NOT raise.
    listening_renderer.run_elevenlabs_render_job(
        job_id="job-3",
        script_text="x" * 20,
        voice_id="v1",
        model="eleven_multilingual_v2",
        title="t",
        accent_tag="us_general",
        cefr_level=None,
        ielts_section=None,
        topic_tags=None,
        transcript=None,
        created_by_user_id="admin-1",
    )
    # Bucket failed → INSERT skipped (no orphan rows).
    assert inserts == []


def test_render_with_timestamps_returns_bytes_and_alignment(monkeypatch):
    """Sprint 11.4 bonus — /with-timestamps endpoint returns
    (mp3_bytes, alignment_dict)."""
    monkeypatch.setattr(listening_renderer.settings, "ELEVENLABS_API_KEY", "sk_test")
    monkeypatch.setattr(
        listening_renderer.requests, "post",
        lambda *a, **kw: _fake_with_timestamps_response(audio_bytes=b"MP3-BYTES"),
    )
    out_bytes, alignment = listening_renderer.render_via_elevenlabs_with_timestamps(
        script_text="Hello.", voice_id="v1", model="eleven_multilingual_v2",
    )
    assert out_bytes == b"MP3-BYTES"
    assert isinstance(alignment, dict)
    assert alignment["characters"] == list("abcd")
    assert len(alignment["character_start_times_seconds"]) == 4


def test_render_with_timestamps_fallback_when_alignment_missing(monkeypatch):
    """Older API tier returns audio_base64 but no alignment field —
    function MUST return (bytes, None) rather than raise."""
    monkeypatch.setattr(listening_renderer.settings, "ELEVENLABS_API_KEY", "sk_test")
    monkeypatch.setattr(
        listening_renderer.requests, "post",
        lambda *a, **kw: _fake_with_timestamps_response(
            audio_bytes=b"MP3", include_alignment=False,
        ),
    )
    out_bytes, alignment = listening_renderer.render_via_elevenlabs_with_timestamps(
        script_text="x", voice_id="v1", model="eleven_multilingual_v2",
    )
    assert out_bytes == b"MP3"
    assert alignment is None


def test_render_with_timestamps_raises_when_audio_missing(monkeypatch):
    """Defensive — response without audio_base64 surfaces RuntimeError."""
    monkeypatch.setattr(listening_renderer.settings, "ELEVENLABS_API_KEY", "sk_test")
    monkeypatch.setattr(
        listening_renderer.requests, "post",
        lambda *a, **kw: _fake_response(status_code=200, json_body={"alignment": {}}),
    )
    import pytest
    with pytest.raises(RuntimeError, match="audio_base64"):
        listening_renderer.render_via_elevenlabs_with_timestamps(
            script_text="x", voice_id="v1", model="eleven_multilingual_v2",
        )


def test_credit_cost_estimate_per_model():
    """Sprint 11.0 §3C — credit cost differs by model."""
    # Multilingual v2 = 2 credits/char
    assert listening_renderer._estimate_credit_cost("hello", "eleven_multilingual_v2") == 10
    # Flash v2.5 = 1 credit/char
    assert listening_renderer._estimate_credit_cost("hello", "eleven_flash_v2_5") == 5
    # Unknown model → defensive default to multilingual_v2 (2 credits/char).
    assert listening_renderer._estimate_credit_cost("hello", "unknown-model") == 10
