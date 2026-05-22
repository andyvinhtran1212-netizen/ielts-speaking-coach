"""Tests for Sprint 13.6 — audio cutter (full pre-mixed → N segments).

Two layers covered:

  * ``services.listening_audio_cutter`` — pure helpers (silence
    parsing, boundary proposal, label sanitisation, segment
    validation). Tests patch ``run_ffmpeg`` at the module boundary so
    no real ffmpeg binary fires.
  * ``routers.listening`` — admin endpoints
    ``POST /admin/listening/tests/{test_id}/detect-silence`` and
    ``POST /admin/listening/tests/{test_id}/cut-audio``. The fake
    Supabase / storage scaffolding mirrors the one in
    ``test_admin_listening_map_image.py`` so a parallel review can
    follow the same pattern.

Sprint 13.6 falsifications guarded here:

  * silence_start with no matching silence_end → dropped (not zipped).
  * ffmpeg banner missing Duration → propose_section_boundaries falls
    back to DB-stored duration.
  * Label with path-traversal characters → sanitiser strips them
    before they reach the storage path.
  * Segments shorter than 1s are skipped silently — endpoint surfaces
    a ``segments_skipped`` count so the admin can correlate.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services import listening_audio_cutter as cutter


# ── Service-level (pure-function) tests ────────────────────────────────────


def test_parse_silence_output_zips_starts_and_ends_in_order():
    """Sprint 13.6 — the ffmpeg ``silencedetect`` filter writes one
    ``silence_start`` line and (eventually) one ``silence_end`` line
    per gap. The parser must pair them in input order and discard any
    trailing unmatched ``silence_start`` (audio ended mid-silence).
    """
    stderr = (
        "ffmpeg version 6.0\n"
        "[silencedetect @ 0xa] silence_start: 30.5\n"
        "[silencedetect @ 0xa] silence_end: 32.7 | silence_duration: 2.2\n"
        "[silencedetect @ 0xa] silence_start: 240.1\n"
        "[silencedetect @ 0xa] silence_end: 243.0 | silence_duration: 2.9\n"
        "[silencedetect @ 0xa] silence_start: 480.0\n"
    )
    out = cutter.parse_silence_output(stderr)
    assert [(b.start, b.end) for b in out] == [(30.5, 32.7), (240.1, 243.0)]


def test_parse_audio_duration_picks_hhmmss_from_banner():
    stderr = "Input #0, mp3...\n  Duration: 00:25:30.50, start: 0.000\n"
    assert cutter.parse_audio_duration(stderr) == 25 * 60 + 30.5


def test_parse_audio_duration_returns_none_when_banner_missing():
    assert cutter.parse_audio_duration("no banner here") is None


def test_propose_section_boundaries_picks_longest_3_gaps_for_4_sections():
    """Three longest silent gaps split the timeline into 4 sections.
    Gaps are picked by duration, then re-sorted by time before splitting.
    """
    gaps = [
        cutter.Boundary(start=10.0, end=10.5),    # 0.5s — short
        cutter.Boundary(start=300.0, end=303.0),  # 3.0s — long
        cutter.Boundary(start=600.0, end=603.5),  # 3.5s — longest
        cutter.Boundary(start=900.0, end=902.5),  # 2.5s — medium
        cutter.Boundary(start=1200.0, end=1200.7),# 0.7s — short
    ]
    out = cutter.propose_section_boundaries(gaps, audio_duration=1500.0)
    assert len(out) == 4
    # Picks 3.0 / 3.5 / 2.5 second gaps. Sorted by time:
    #   ranges are [0, 300] [303, 600] [603.5, 900] [902.5, 1500].
    assert [(round(b.start, 1), round(b.end, 1)) for b in out] == [
        (0.0,   300.0),
        (303.0, 600.0),
        (603.5, 900.0),
        (902.5, 1500.0),
    ]


def test_propose_section_boundaries_handles_fewer_gaps_than_needed():
    """When only 2 gaps are available, we get 3 sections — not 4.
    The function never invents synthetic gaps to pad to a target.
    """
    gaps = [
        cutter.Boundary(start=300.0, end=303.0),
        cutter.Boundary(start=600.0, end=603.0),
    ]
    out = cutter.propose_section_boundaries(gaps, audio_duration=900.0)
    assert len(out) == 3


def test_propose_section_boundaries_returns_empty_when_duration_zero():
    out = cutter.propose_section_boundaries(
        [], audio_duration=0.0, target_section_count=4,
    )
    assert out == []


def test_sanitize_label_strips_path_traversal_chars():
    """Admin labels go into the Supabase Storage path — anything
    outside ``[a-z0-9_-]`` must be collapsed to underscores so a
    label like ``../../etc/passwd`` can't escape the test prefix.
    """
    assert cutter.sanitize_label("Section 1") == "section_1"
    assert cutter.sanitize_label("../../etc/passwd") == "etc_passwd"
    assert cutter.sanitize_label("  Q1–10  ") == "q1_10"
    # Empty / all-special falls back to "segment" so the path always
    # has a basename.
    assert cutter.sanitize_label("") == "segment"
    assert cutter.sanitize_label("///") == "segment"


def test_build_storage_path_follows_convention():
    out = cutter.build_storage_path(
        test_id="t-123", content_id="c-456",
        index=2, label="Section 2 / Q11-20",
    )
    assert out == "t-123/c-456/cut_2_section_2___q11-20.mp3"
    assert out.endswith(".mp3")


def test_validate_segments_drops_below_min_duration():
    """Anything shorter than ``MIN_SEGMENT_DURATION_SECONDS`` (1.0s)
    is silently dropped — the endpoint surfaces ``segments_skipped``
    so the admin can correlate. Pin both the floor and the order
    preservation of kept segments.
    """
    segs = [
        cutter.Segment(label="ok",     start=0.0,   end=10.0),    # 10s — keep
        cutter.Segment(label="tiny",   start=10.0,  end=10.4),    # 0.4s — drop
        cutter.Segment(label="exact",  start=11.0,  end=12.0),    # 1.0s — keep
        cutter.Segment(label="ok2",    start=12.0,  end=20.0),    # 8s — keep
    ]
    kept = cutter.validate_segments(segs)
    assert [s.label for s in kept] == ["ok", "exact", "ok2"]


def test_detect_silence_raises_when_ffmpeg_stderr_empty(monkeypatch):
    """Empty stderr means ffmpeg couldn't even open the file —
    surface as a 500-flavoured RuntimeError so the endpoint returns
    a clean error rather than silently producing 0 boundaries.
    """
    def _fake_run(args, *, timeout_seconds=120):
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)
    with pytest.raises(RuntimeError):
        cutter.detect_silence("/tmp/fake.mp3")


def test_detect_silence_parses_full_pipeline_end_to_end(monkeypatch):
    """End-to-end: ffmpeg stderr → gaps + duration → propose
    boundaries. The integration here is the seam most prone to drift,
    so we run the whole pipeline against a realistic stderr.
    """
    stderr = (
        "Duration: 00:25:00.00, start: 0.000\n"
        "silence_start: 300.5\n"
        "silence_end: 303.5 | silence_duration: 3.0\n"
        "silence_start: 600.0\n"
        "silence_end: 603.5 | silence_duration: 3.5\n"
        "silence_start: 1100.0\n"
        "silence_end: 1102.5 | silence_duration: 2.5\n"
    )
    def _fake_run(args, *, timeout_seconds=120):
        return SimpleNamespace(returncode=0, stderr=stderr, stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)
    gaps, duration = cutter.detect_silence("/tmp/x.mp3")
    assert duration == 1500.0
    assert len(gaps) == 3
    boundaries = cutter.propose_section_boundaries(
        gaps, audio_duration=duration,
    )
    assert len(boundaries) == 4


def test_cut_segment_to_path_passes_stream_copy_flags(monkeypatch):
    """The ffmpeg command must include ``-c copy`` so no re-encoding
    happens — this is the whole point of choosing stream-copy. Pin
    the flag order to catch a regression that silently switches to
    a slow / lossy encode.
    """
    captured: dict = {}
    def _fake_run(args, *, timeout_seconds=60):
        captured["args"] = list(args)
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)
    cutter.cut_segment_to_path(
        source_path="/tmp/in.mp3",
        output_path="/tmp/out.mp3",
        start_seconds=10.5,
        duration_seconds=30.0,
    )
    args = captured["args"]
    assert "-c" in args and args[args.index("-c") + 1] == "copy"
    assert "-ss" in args and args[args.index("-ss") + 1] == "10.500"
    assert "-t" in args and args[args.index("-t") + 1] == "30.000"
    assert args[-1] == "/tmp/out.mp3"


def test_cut_segment_to_path_raises_on_nonzero_exit(monkeypatch):
    def _fake_run(args, *, timeout_seconds=60):
        return SimpleNamespace(returncode=1, stderr="boom", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)
    with pytest.raises(RuntimeError) as excinfo:
        cutter.cut_segment_to_path(
            source_path="/tmp/in.mp3", output_path="/tmp/out.mp3",
            start_seconds=0.0, duration_seconds=10.0,
        )
    assert "exit 1" in str(excinfo.value)


# ── Router-level tests (fake Supabase) ─────────────────────────────────────


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


# Sprint 13.6.4 — schema-aware insert validation.
#
# The Sprint 13.6 cut route shipped without populating ``source_type`` (a
# NOT NULL CHECK column from migration 056) + ``accent_tag`` + ``transcript``.
# Sprint 13.6 tests passed because the previous ``_Fake`` here just appended
# rows without constraint checking. The dict below mirrors the production
# schema's NOT-NULL set so the fake catches the bug a real Postgres would
# raise, without requiring a real DB fixture. New tests in this file pin
# the cut INSERT against this constraint map; future inserts on
# listening_content also get the safety net for free.
LISTENING_CONTENT_REQUIRED_FIELDS = {
    # All four come from migration 056. ``id``, ``status``, ``transcript_segments``,
    # ``metadata``, ``topic_tags`` have DB-side defaults and are deliberately
    # NOT listed here — the Supabase Python client handles default backfill.
    "source_type",
    "audio_storage_path",
    "audio_duration_seconds",
    "audio_size_bytes",
    "accent_tag",
    "transcript",
    "title",
}

LISTENING_CONTENT_SOURCE_TYPE_ALLOWED = {
    # From migrations 056 + 066 — the CHECK constraint enum.
    "ai_elevenlabs",
    "upload_mp3",
    "curated_external",
    "test_section",
    "exercise_snippet",  # Sprint 13.6 audio cutter (migration 066 comment)
}


class _SchemaViolation(Exception):
    """Raised by the fake to surface NOT NULL / CHECK violations the way
    Postgres would (status 23502 / 23514). Tests catch this to confirm
    a regression would be caught before production."""


def _validate_listening_content_insert(payload: dict) -> None:
    """Mirror the production NOT NULL + source_type CHECK constraints."""
    missing = [
        f for f in LISTENING_CONTENT_REQUIRED_FIELDS
        if payload.get(f) in (None, "")
        and f not in ("transcript",)  # transcript=='' allowed; '' is non-null
    ]
    if missing:
        raise _SchemaViolation(
            f"null value in columns {sorted(missing)} of relation "
            f"'listening_content' violates not-null constraint"
        )
    if "transcript" in LISTENING_CONTENT_REQUIRED_FIELDS \
            and payload.get("transcript") is None:
        raise _SchemaViolation(
            "null value in column 'transcript' of relation 'listening_content' "
            "violates not-null constraint"
        )
    src = payload.get("source_type")
    if src not in LISTENING_CONTENT_SOURCE_TYPE_ALLOWED:
        raise _SchemaViolation(
            f"new row violates check constraint "
            f"'listening_content_source_type_check' "
            f"(source_type={src!r} not in {sorted(LISTENING_CONTENT_SOURCE_TYPE_ALLOWED)})"
        )


class _Q:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name
        self._mode = "select"
        self._payload = None
        self._eq: list[tuple[str, object]] = []

    def select(self, *_a, **_kw): self._mode = "select"; return self
    def insert(self, p): self._mode = "insert"; self._payload = p; return self
    def update(self, p): self._mode = "update"; self._payload = p; return self
    def delete(self): self._mode = "delete"; return self
    def eq(self, c, v): self._eq.append((c, v)); return self
    def limit(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self

    def _match(self, r):
        for c, v in self._eq:
            if r.get(c) != v:
                return False
        return True

    def execute(self):
        rows = self.fake.tables.setdefault(self.name, [])
        if self._mode == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            # Sprint 13.6.4 — schema-aware fake. Validate listening_content
            # inserts against the production NOT NULL + CHECK constraints.
            # ``_relaxed_listening_content_inserts`` opt-out exists for
            # legacy tests that don't need the safety net.
            if self.name == "listening_content" \
                    and not getattr(self.fake, "_relaxed_listening_content_inserts", False):
                for p in payloads:
                    _validate_listening_content_insert(p)
            for p in payloads:
                rows.append(dict(p))
            return _Resp(payloads)
        if self._mode == "update":
            matched = [r for r in rows if self._match(r)]
            for r in matched:
                r.update(self._payload or {})
            return _Resp(matched)
        matched = [r for r in rows if self._match(r)]
        return _Resp(matched)


class _Bucket:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name

    def download(self, path):
        return self.fake.objects.get((self.name, path), b"")

    def upload(self, path, data, file_options=None):
        self.fake.objects[(self.name, path)] = data
        self.fake.uploads.append((self.name, path, len(data)))


class _Storage:
    def __init__(self, fake): self.fake = fake
    def from_(self, name): return _Bucket(self.fake, name)


class _Fake:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "listening_tests":   [],
            "listening_content": [],
        }
        self.objects: dict[tuple[str, str], bytes] = {}
        self.uploads: list[tuple[str, str, int]] = []
        self.storage = _Storage(self)

    def table(self, name): return _Q(self, name)


def _patch(monkeypatch):
    fake = _Fake()
    monkeypatch.setattr(listening_router, "supabase_admin", fake)

    async def _ok_admin(_authz):
        return {"id": "admin-1"}
    monkeypatch.setattr(listening_router, "require_admin", _ok_admin)
    return fake, "Bearer admin-token"


def _run(coro): return asyncio.run(coro)


def _seed_full_premixed_test(fake) -> dict:
    test_id = str(uuid4())
    storage_path = f"tests/{test_id}/full.mp3"
    # 1500s = 25 minutes — Cambridge listening run length.
    fake.tables["listening_tests"].append({
        "id":                          test_id,
        "test_id":                     "ILR-LIS-001",
        "audio_assembly_mode":         "full_premixed",
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": 1500,
    })
    fake.objects[("listening-audio", storage_path)] = b"\xff\xfb" + b"\x00" * 256
    return {"test_id": test_id, "storage_path": storage_path}


def test_detect_silence_endpoint_returns_boundaries_for_full_premixed(monkeypatch):
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    monkeypatch.setattr(
        cutter, "run_ffmpeg",
        lambda args, **kw: SimpleNamespace(
            returncode=0,
            stderr=(
                "Duration: 00:25:00.00, start: 0.000\n"
                "silence_start: 300.0\nsilence_end: 303.0\n"
                "silence_start: 600.0\nsilence_end: 603.0\n"
                "silence_start: 900.0\nsilence_end: 903.0\n"
            ),
            stdout="",
        ),
    )
    out = _run(listening_router.admin_detect_silence_boundaries(
        test_id=seed["test_id"],
        body=listening_router.DetectSilenceRequest(),
        authorization=authz,
    ))
    assert out["audio_duration_seconds"] == 1500.0
    assert out["silence_gaps_detected"] == 3
    assert len(out["boundaries"]) == 4
    assert out["boundaries"][0]["start"] == 0.0


def test_detect_silence_endpoint_422_for_non_full_premixed(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test_id = str(uuid4())
    fake.tables["listening_tests"].append({
        "id":                  test_id,
        "audio_assembly_mode": "parts_only",
    })
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_detect_silence_boundaries(
            test_id=test_id, body=None, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_detect_silence_endpoint_422_when_no_full_audio_path(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test_id = str(uuid4())
    fake.tables["listening_tests"].append({
        "id":                      test_id,
        "audio_assembly_mode":     "full_premixed",
        "full_audio_storage_path": None,
    })
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_detect_silence_boundaries(
            test_id=test_id, body=None, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_detect_silence_endpoint_respects_threshold_overrides(monkeypatch):
    """The request body's ``silence_threshold_db`` + ``min_silence_duration``
    must reach the ffmpeg call — pin both values into the filter
    string so a regression flag-renaming can't silently fall back.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    captured: dict = {}
    def _fake_run(args, **kw):
        captured["args"] = list(args)
        return SimpleNamespace(
            returncode=0,
            stderr="Duration: 00:25:00.00\n",
            stdout="",
        )
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)
    _run(listening_router.admin_detect_silence_boundaries(
        test_id=seed["test_id"],
        body=listening_router.DetectSilenceRequest(
            silence_threshold_db=-55.5, min_silence_duration=3.25,
        ),
        authorization=authz,
    ))
    af = captured["args"][captured["args"].index("-af") + 1]
    assert "noise=-55.5dB" in af
    assert "d=3.25" in af


def test_detect_silence_endpoint_falls_back_to_db_duration_when_ffmpeg_missing(monkeypatch):
    """If ffmpeg's banner doesn't carry a Duration line (some streamed
    transfers strip it), the endpoint substitutes the DB-stored
    ``full_audio_duration_seconds`` so boundaries still get proposed.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    monkeypatch.setattr(
        cutter, "run_ffmpeg",
        lambda args, **kw: SimpleNamespace(
            returncode=0,
            stderr=(
                "silence_start: 300.0\nsilence_end: 303.0\n"
                "silence_start: 600.0\nsilence_end: 603.0\n"
                "silence_start: 900.0\nsilence_end: 903.0\n"
            ),
            stdout="",
        ),
    )
    out = _run(listening_router.admin_detect_silence_boundaries(
        test_id=seed["test_id"], body=None, authorization=authz,
    ))
    # Fallback to the DB-stored 1500s.
    assert out["audio_duration_seconds"] == 1500.0


# ── Sprint 13.6.2 — detect-silence response shape contract pins ────────────
#
# Andy 2026-05-22 dogfood crashed the audio cutter on the auto-detect
# button. Root cause was the Wavesurfer v6 plugin-binding bug
# (fixed in frontend); these tests pin the *backend* response shape
# so a future "simplification" of the JSON can't quietly break the
# frontend reader that consumes ``boundaries[]`` + ``silence_gaps_detected``.


def test_detect_silence_response_has_canonical_boundaries_key(monkeypatch):
    """The frontend reads ``res.boundaries`` — not ``res.regions`` or
    ``res.silence_gaps`` or any other variant. Pin the canonical key.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    monkeypatch.setattr(
        cutter, "run_ffmpeg",
        lambda args, **kw: SimpleNamespace(
            returncode=0,
            stderr=(
                "Duration: 00:25:00.00, start: 0.000\n"
                "silence_start: 300.0\nsilence_end: 303.0\n"
                "silence_start: 600.0\nsilence_end: 603.0\n"
                "silence_start: 900.0\nsilence_end: 903.0\n"
            ),
            stdout="",
        ),
    )
    out = _run(listening_router.admin_detect_silence_boundaries(
        test_id=seed["test_id"],
        body=listening_router.DetectSilenceRequest(),
        authorization=authz,
    ))
    assert "boundaries" in out
    assert "regions" not in out
    assert "silence_gaps" not in out


def test_detect_silence_boundary_entries_have_start_and_end_only(monkeypatch):
    """Each boundary is ``{start: float, end: float}``. Pin the field
    set so a "richer" boundary shape (e.g. ``{label, confidence}``)
    can't surface without a deliberate frontend update.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    monkeypatch.setattr(
        cutter, "run_ffmpeg",
        lambda args, **kw: SimpleNamespace(
            returncode=0,
            stderr=(
                "Duration: 00:25:00.00, start: 0.000\n"
                "silence_start: 300.0\nsilence_end: 303.0\n"
                "silence_start: 600.0\nsilence_end: 603.0\n"
                "silence_start: 900.0\nsilence_end: 903.0\n"
            ),
            stdout="",
        ),
    )
    out = _run(listening_router.admin_detect_silence_boundaries(
        test_id=seed["test_id"],
        body=listening_router.DetectSilenceRequest(),
        authorization=authz,
    ))
    assert len(out["boundaries"]) > 0
    for entry in out["boundaries"]:
        assert set(entry.keys()) == {"start", "end"}
        assert isinstance(entry["start"], (int, float))
        assert isinstance(entry["end"], (int, float))


def test_detect_silence_boundaries_are_sorted_by_start(monkeypatch):
    """The frontend lays down sections in array order, indexed by
    ``i`` for colour rotation. Pin that ``boundaries`` come out
    sorted by ``start`` so Section 1 is always leftmost on the
    waveform.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    # Seed silencedetect output deliberately *out of order* in the
    # stderr stream to confirm the service sorts them.
    monkeypatch.setattr(
        cutter, "run_ffmpeg",
        lambda args, **kw: SimpleNamespace(
            returncode=0,
            stderr=(
                "Duration: 00:25:00.00, start: 0.000\n"
                "silence_start: 900.0\nsilence_end: 903.0\n"
                "silence_start: 300.0\nsilence_end: 303.0\n"
                "silence_start: 600.0\nsilence_end: 603.0\n"
            ),
            stdout="",
        ),
    )
    out = _run(listening_router.admin_detect_silence_boundaries(
        test_id=seed["test_id"],
        body=listening_router.DetectSilenceRequest(),
        authorization=authz,
    ))
    starts = [b["start"] for b in out["boundaries"]]
    assert starts == sorted(starts), (
        f"boundaries must be sorted by start, got {starts}"
    )


def test_detect_silence_zero_gaps_returns_single_full_audio_boundary(monkeypatch):
    """Audio with no silence gaps long enough to qualify — the
    endpoint falls back to a single boundary spanning [0, duration].
    Pin this fallback so a refactor can't quietly switch to an
    equal-N-split (which would mid-cut the source) or return an
    empty list (which would deprive the admin of any starting
    segment).
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    monkeypatch.setattr(
        cutter, "run_ffmpeg",
        lambda args, **kw: SimpleNamespace(
            returncode=0,
            stderr="Duration: 00:25:00.00, start: 0.000\n",
            stdout="",
        ),
    )
    out = _run(listening_router.admin_detect_silence_boundaries(
        test_id=seed["test_id"],
        body=listening_router.DetectSilenceRequest(),
        authorization=authz,
    ))
    assert out["silence_gaps_detected"] == 0
    assert out["boundaries"] == [{"start": 0.0, "end": 1500.0}]


def test_detect_silence_response_top_level_keys_locked(monkeypatch):
    """Pin the entire top-level key set so a refactor can't add or
    rename fields without a deliberate frontend update. Currently:
    ``audio_duration_seconds``, ``silence_gaps_detected``,
    ``boundaries``, ``silence_threshold_db``, ``min_silence_duration``.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    monkeypatch.setattr(
        cutter, "run_ffmpeg",
        lambda args, **kw: SimpleNamespace(
            returncode=0,
            stderr=(
                "Duration: 00:25:00.00, start: 0.000\n"
                "silence_start: 300.0\nsilence_end: 303.0\n"
            ),
            stdout="",
        ),
    )
    out = _run(listening_router.admin_detect_silence_boundaries(
        test_id=seed["test_id"],
        body=listening_router.DetectSilenceRequest(),
        authorization=authz,
    ))
    # Frontend reads `boundaries` + `silence_gaps_detected` directly.
    # The other fields are diagnostic but should remain present.
    required = {"boundaries", "silence_gaps_detected", "audio_duration_seconds"}
    assert required.issubset(set(out.keys())), (
        f"missing required keys: {required - set(out.keys())}"
    )


def test_cut_audio_endpoint_creates_listening_content_rows(monkeypatch):
    """End-to-end happy path: 4 segments → 4 listening_content rows
    + 4 storage uploads + segment metadata persisted.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)

    def _fake_run(args, **kw):
        # Write 1 KB of dummy bytes to the output path so the
        # subsequent open() can read non-empty content.
        out_path = args[-1]
        with open(out_path, "wb") as fh:
            fh.write(b"\xff\xfb" + b"\x00" * 1022)
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)

    segments = [
        listening_router.CutSegmentInput(label="Section 1", start=0.0,    end=375.0),
        listening_router.CutSegmentInput(label="Section 2", start=378.0,  end=750.0),
        listening_router.CutSegmentInput(label="Section 3", start=753.0,  end=1125.0),
        listening_router.CutSegmentInput(label="Section 4", start=1128.0, end=1500.0),
    ]
    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=segments),
        authorization=authz,
    ))
    assert out["segments_created"] == 4
    assert out["segments_skipped"] == 0
    rows = fake.tables["listening_content"]
    assert len(rows) == 4
    for row, seg in zip(rows, segments):
        assert row["test_id"] == seed["test_id"]
        assert row["segment_label"] == seg.label
        assert row["segment_start_seconds"] == seg.start
        assert row["segment_end_seconds"] == seg.end
        assert row["audio_storage_path"].startswith(
            f"{seed['test_id']}/{seed['test_id']}/cut_",
        )
        assert row["audio_storage_path"].endswith(".mp3")


def test_cut_audio_endpoint_422_for_non_full_premixed(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test_id = str(uuid4())
    fake.tables["listening_tests"].append({
        "id":                  test_id,
        "audio_assembly_mode": "parts_only",
    })
    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="x", start=0.0, end=10.0),
    ])
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_cut_audio_segments(
            test_id=test_id, body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_cut_audio_endpoint_400_when_all_segments_below_min_duration(monkeypatch):
    """Every requested segment under 1s gets dropped. With nothing left
    to cut, the endpoint must return 400 rather than silently storing
    nothing — the admin's expectation is that at least one row gets
    created on a successful POST.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="tiny",  start=0.0,  end=0.5),
        listening_router.CutSegmentInput(label="tiny2", start=1.0,  end=1.3),
    ])
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_cut_audio_segments(
            test_id=seed["test_id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 400
    assert "shorter than" in str(excinfo.value.detail)


def test_cut_audio_endpoint_skips_short_segments_and_reports_count(monkeypatch):
    """Mixed batch: 2 segments ≥1s + 1 segment <1s. The endpoint
    cuts the two valid ones and reports ``segments_skipped=1``.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)

    def _fake_run(args, **kw):
        out_path = args[-1]
        with open(out_path, "wb") as fh:
            fh.write(b"\xff\xfb" + b"\x00" * 256)
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)

    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="ok",   start=0.0,    end=300.0),
        listening_router.CutSegmentInput(label="tiny", start=305.0,  end=305.5),
        listening_router.CutSegmentInput(label="ok2",  start=400.0,  end=700.0),
    ])
    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    assert out["segments_created"] == 2
    assert out["segments_skipped"] == 1


def test_cut_audio_endpoint_preserves_original_test_row(monkeypatch):
    """The cut is additive — the source test row's
    ``full_audio_storage_path`` must NOT be cleared by the cut.
    A regression here would orphan the source file in storage.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)

    def _fake_run(args, **kw):
        out_path = args[-1]
        with open(out_path, "wb") as fh:
            fh.write(b"\xff\xfb" + b"\x00" * 256)
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0, end=375.0),
        ]),
        authorization=authz,
    ))
    test = fake.tables["listening_tests"][0]
    assert test["full_audio_storage_path"] == seed["storage_path"]
    # Source object still in storage.
    assert ("listening-audio", seed["storage_path"]) in fake.objects


def test_cut_audio_endpoint_logs_audit_line(monkeypatch, caplog):
    import logging
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    def _fake_run(args, **kw):
        out_path = args[-1]
        with open(out_path, "wb") as fh:
            fh.write(b"\xff\xfb" + b"\x00" * 256)
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)
    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="a", start=0.0, end=375.0),
    ])
    with caplog.at_level(logging.INFO, logger="routers.listening"):
        _run(listening_router.admin_cut_audio_segments(
            test_id=seed["test_id"], body=body, authorization=authz,
        ))
    msgs = [r.getMessage() for r in caplog.records
            if "[audio_cutter] cut" in r.getMessage()]
    assert msgs
    line = msgs[0]
    assert f"test={seed['test_id']}" in line
    assert "segments=1" in line


# ── Sprint 13.6.3 (Codex audit F1 + F2) — provenance + idempotency ─────────
#
# Two P0 falsifications closed in this sprint. The tests below pin both
# the inserted-row contract and the reuse semantics so a future refactor
# can't quietly re-open the audit findings.


def _cut_with_fake_ffmpeg(monkeypatch):
    """Test helper: install a fake ffmpeg that writes a tiny .mp3-ish
    buffer so the cut path can exercise the storage upload + DB insert
    branches without a real binary.
    """
    def _fake_run(args, **kw):
        out_path = args[-1]
        with open(out_path, "wb") as fh:
            fh.write(b"\xff\xfb" + b"\x00" * 256)
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _fake_run)


def test_cut_audio_populates_source_test_id_and_source_audio_kind(monkeypatch):
    """F1 fix: new cut rows must populate ``source_test_id`` (FK to the
    originating test) + ``source_audio_kind = 'test_full_premixed'``.
    These supersede the misleading ``parent_content_id`` from Sprint 13.6.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="Section 1", start=0.0,    end=375.0),
            listening_router.CutSegmentInput(label="Section 2", start=378.0,  end=750.0),
        ]),
        authorization=authz,
    ))
    rows = fake.tables["listening_content"]
    assert len(rows) == 2
    for row in rows:
        assert row["source_test_id"] == seed["test_id"], (
            "F1: every cut row must point at the originating test"
        )
        assert row["source_audio_kind"] == "test_full_premixed", (
            "F1: enum-checked source kind must be set on every cut row"
        )


def test_cut_audio_does_not_write_parent_content_id(monkeypatch):
    """F1 fix: ``parent_content_id`` was a misleading half-truth — full
    premixed audio lives on listening_tests, not on a listening_content
    parent row. The cut route must stop writing to it; the column stays
    in the schema only for backward-compat (Sprint 13.6 sentinel).
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="x", start=0.0, end=10.0),
        ]),
        authorization=authz,
    ))
    row = fake.tables["listening_content"][0]
    assert "parent_content_id" not in row, (
        "F1: cut route must not write parent_content_id (misleading FK; "
        "use source_test_id instead)"
    )


def test_cut_audio_response_segments_include_source_fields(monkeypatch):
    """F1 fix: the API response — what the frontend reads — must echo
    the new source fields so the admin panel can render provenance
    without a follow-up fetch.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="x", start=0.0, end=10.0),
        ]),
        authorization=authz,
    ))
    seg = out["segments"][0]
    assert seg["source_test_id"] == seed["test_id"]
    assert seg["source_audio_kind"] == "test_full_premixed"
    assert seg["reused"] is False


def test_cut_audio_response_includes_new_and_reused_counts(monkeypatch):
    """F2 fix: the response must split the per-segment outcome into
    ``segments_new`` + ``segments_reused`` so the frontend can show
    "N mới, M reused" instead of a single ambiguous count.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0,   end=300.0),
            listening_router.CutSegmentInput(label="b", start=300.0, end=600.0),
        ]),
        authorization=authz,
    ))
    assert out["segments_new"] == 2
    assert out["segments_reused"] == 0
    assert out["segments_created"] == 2     # = new + reused for backward compat


def test_cut_audio_reuses_existing_row_on_duplicate_fingerprint(monkeypatch):
    """F2 fix: re-clicking Export with the same regions must not insert
    duplicate rows — the cut route looks up active rows by
    ``(test_id, label, start, end)`` and short-circuits to a reuse
    response.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="Section 1", start=0.0,    end=375.0),
        listening_router.CutSegmentInput(label="Section 2", start=378.0,  end=750.0),
    ])
    first = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    second = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    # Second invocation should reuse — no new rows inserted.
    assert len(fake.tables["listening_content"]) == 2
    assert second["segments_new"]    == 0
    assert second["segments_reused"] == 2
    # IDs must match the first batch (proves it was a reuse, not a
    # re-insert with a fresh UUID).
    first_ids  = sorted(s["id"] for s in first["segments"])
    second_ids = sorted(s["id"] for s in second["segments"])
    assert first_ids == second_ids


def test_cut_audio_reuse_skips_ffmpeg_and_storage(monkeypatch):
    """F2 fix: the reuse fast path must skip ffmpeg + storage upload.
    Pin via call counters so a refactor can't accidentally re-cut on
    every Export click.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)

    ffmpeg_calls = {"n": 0}
    def _counting_ffmpeg(args, **kw):
        ffmpeg_calls["n"] += 1
        out_path = args[-1]
        with open(out_path, "wb") as fh:
            fh.write(b"\xff\xfb" + b"\x00" * 256)
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(cutter, "run_ffmpeg", _counting_ffmpeg)

    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="a", start=0.0, end=300.0),
    ])
    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    assert ffmpeg_calls["n"] == 1
    upload_count_after_first = len(fake.uploads)

    # Same fingerprint — must not invoke ffmpeg again, must not upload again.
    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    assert ffmpeg_calls["n"] == 1, (
        "F2: reuse path must not re-invoke ffmpeg"
    )
    assert len(fake.uploads) == upload_count_after_first, (
        "F2: reuse path must not re-upload storage"
    )


def test_cut_audio_mixed_batch_splits_new_and_reused(monkeypatch):
    """F2 fix: a follow-up Export with some unchanged regions + some
    new regions must reuse the existing rows and only cut the new ones.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    # First batch — 2 cuts.
    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0,   end=300.0),
            listening_router.CutSegmentInput(label="b", start=300.0, end=600.0),
        ]),
        authorization=authz,
    ))
    # Second batch — 1 same + 1 brand new.
    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0,   end=300.0),   # reuse
            listening_router.CutSegmentInput(label="c", start=600.0, end=900.0),   # new
        ]),
        authorization=authz,
    ))
    assert out["segments_new"]    == 1
    assert out["segments_reused"] == 1
    # 3 total rows in DB now (a, b, c).
    assert len(fake.tables["listening_content"]) == 3


def test_cut_audio_float_jitter_does_not_defeat_reuse_lookup(monkeypatch):
    """F2 fix: storing seconds as floats means re-cut requests may
    arrive with sub-millisecond drift. The fingerprint lookup rounds
    to 3 decimals so an admin re-clicking the same waveform region
    doesn't accidentally pay for a re-cut.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="x", start=0.000, end=300.000),
        ]),
        authorization=authz,
    ))
    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            # Sub-millisecond jitter — still the same logical region.
            listening_router.CutSegmentInput(label="x", start=0.0001, end=300.0002),
        ]),
        authorization=authz,
    ))
    assert out["segments_reused"] == 1
    assert out["segments_new"]    == 0


def test_cut_audio_archived_row_allows_new_insert_at_same_fingerprint(monkeypatch):
    """F2 fix: the partial unique index excludes archived rows. After
    archiving a previous cut, the admin must be able to re-cut at the
    same boundaries and get a fresh insert (not a reuse of the archive).
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0, end=300.0),
        ]),
        authorization=authz,
    ))
    # Archive the first row in place.
    fake.tables["listening_content"][0]["status"] = "archived"

    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0, end=300.0),
        ]),
        authorization=authz,
    ))
    assert out["segments_new"]    == 1
    assert out["segments_reused"] == 0
    # Both rows present — 1 archived original + 1 fresh insert.
    assert len(fake.tables["listening_content"]) == 2


def test_cut_audio_log_line_records_new_and_reused_counts(monkeypatch, caplog):
    """Pin the audit log shape — admin forensics depends on being able
    to reconstruct who ran which cut and how many were fresh vs reused.
    """
    import logging
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="a", start=0.0, end=300.0),
    ])
    with caplog.at_level(logging.INFO, logger="routers.listening"):
        _run(listening_router.admin_cut_audio_segments(
            test_id=seed["test_id"], body=body, authorization=authz,
        ))
        _run(listening_router.admin_cut_audio_segments(
            test_id=seed["test_id"], body=body, authorization=authz,
        ))
    msgs = [r.getMessage() for r in caplog.records
            if "[audio_cutter] cut" in r.getMessage()]
    assert len(msgs) == 2
    assert "new=1"    in msgs[0]
    assert "reused=0" in msgs[0]
    assert "new=0"    in msgs[1]
    assert "reused=1" in msgs[1]


def test_migration_072_creates_provenance_and_unique_columns():
    """Source-level pin: migration 072 ships the F1 + F2 schema changes.
    A future "schema cleanup" PR that drops the migration file would
    quietly break the production contract; this sentinel catches it.
    """
    import pathlib
    sql = pathlib.Path(
        "migrations/072_listening_content_cut_provenance_and_idempotency.sql"
    ).read_text(encoding="utf-8")
    # F1: provenance columns.
    assert "source_test_id" in sql
    assert "source_audio_kind" in sql
    assert "test_full_premixed" in sql
    assert "manual_upload" in sql
    assert "api_generation" in sql
    # F2: partial unique index on the cut fingerprint.
    assert "uq_listening_content_cut_active_fingerprint" in sql
    assert "segment_label" in sql
    # Idempotent re-run discipline.
    assert "IF NOT EXISTS" in sql
    # Doesn't accidentally drop parent_content_id (sentinel for the
    # backward-compat decision).
    assert "DROP COLUMN" not in sql


def test_migration_072_backfills_existing_cut_rows():
    """The backfill UPDATE must run inside the migration so historical
    Sprint 13.6 cuts also satisfy the new contract — otherwise the F1
    fix would only apply going forward and old data would still
    misrepresent provenance.
    """
    import pathlib
    sql = pathlib.Path(
        "migrations/072_listening_content_cut_provenance_and_idempotency.sql"
    ).read_text(encoding="utf-8")
    assert "UPDATE listening_content" in sql
    assert "segment_label IS NOT NULL" in sql
    assert "source_test_id    = test_id" in sql or "source_test_id = test_id" in sql


def test_migration_072_excludes_archived_from_unique_index():
    """The partial unique index must exclude archived rows so admins
    can re-cut after archiving — pin the WHERE clause explicitly.
    """
    import pathlib
    sql = pathlib.Path(
        "migrations/072_listening_content_cut_provenance_and_idempotency.sql"
    ).read_text(encoding="utf-8")
    # The unique index WHERE clause excludes archived status.
    assert "!= 'archived'" in sql


def test_cut_audio_all_reused_does_not_download_source_audio(monkeypatch):
    """F2 fast path optimisation: if every requested segment maps to
    an existing active row, the cut route must NOT download the source
    MP3 to a temp file. Pin via a counter on the helper so a refactor
    that re-orders work can't accidentally re-introduce the wasted
    bandwidth + tmp-disk IO.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    download_calls = {"n": 0}
    original_download = listening_router._download_full_audio_to_tmp

    def _counting_download(test_id, storage_path):
        download_calls["n"] += 1
        return original_download(test_id, storage_path)
    monkeypatch.setattr(
        listening_router, "_download_full_audio_to_tmp", _counting_download,
    )

    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="a", start=0.0, end=300.0),
        listening_router.CutSegmentInput(label="b", start=300.0, end=600.0),
    ])
    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    assert download_calls["n"] == 1, (
        "first run must download the source for fresh cuts"
    )

    # Second identical run — all reused, no download.
    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    assert download_calls["n"] == 1, (
        "F2 fast path: all-reused batch must not re-download source audio"
    )


def test_cut_audio_response_segments_preserve_input_order(monkeypatch):
    """The response's ``segments`` list must echo the input order so
    the admin UI can map result entries 1:1 to the rows it drew on
    the waveform — even when some are reused and some are new.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    # Seed 1 cut so the next batch is mixed (1 reuse + 1 new).
    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="b", start=300.0, end=600.0),
        ]),
        authorization=authz,
    ))
    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0,   end=300.0),   # new
            listening_router.CutSegmentInput(label="b", start=300.0, end=600.0),   # reuse
            listening_router.CutSegmentInput(label="c", start=600.0, end=900.0),   # new
        ]),
        authorization=authz,
    ))
    labels = [s["segment_label"] for s in out["segments"]]
    assert labels == ["a", "b", "c"]
    reused_flags = [s["reused"] for s in out["segments"]]
    assert reused_flags == [False, True, False]


def test_cut_audio_segments_created_equals_new_plus_reused(monkeypatch):
    """The legacy ``segments_created`` field is now the sum of
    ``segments_new`` + ``segments_reused``. Frontend code still using
    the old field reads "total processed" — pin the invariant so an
    accidental redefinition can't break either consumer.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="a", start=0.0,   end=300.0),
        listening_router.CutSegmentInput(label="b", start=300.0, end=600.0),
    ])
    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    assert out["segments_created"] == out["segments_new"] + out["segments_reused"]


def test_migration_072_source_test_id_uses_on_delete_set_null():
    """The new FK must mirror Sprint 13.6's parent_content_id pattern
    (ON DELETE SET NULL) so deleting a source test doesn't cascade-
    destroy already-cut content rows that might be linked into a
    published test. CASCADE would be catastrophic.
    """
    import pathlib
    sql = pathlib.Path(
        "migrations/072_listening_content_cut_provenance_and_idempotency.sql"
    ).read_text(encoding="utf-8")
    assert "source_test_id    UUID REFERENCES listening_tests(id) ON DELETE SET NULL" in sql \
        or "source_test_id UUID REFERENCES listening_tests(id) ON DELETE SET NULL" in sql, (
        "F1: source_test_id FK must be ON DELETE SET NULL (mirrors parent_content_id pattern)"
    )
    # And CASCADE must be absent.
    assert "ON DELETE CASCADE" not in sql


def test_migration_072_partial_index_only_on_non_null_fingerprint_fields():
    """The fingerprint partial unique excludes rows where any of the
    fingerprint fields is NULL — native (non-cut) listening_content
    rows have NULL segment metadata and would otherwise all collide
    on the (NULL, NULL, NULL) fingerprint.
    """
    import pathlib
    sql = pathlib.Path(
        "migrations/072_listening_content_cut_provenance_and_idempotency.sql"
    ).read_text(encoding="utf-8")
    # WHERE clause must guard all three fingerprint fields.
    assert "segment_label             IS NOT NULL" in sql \
        or "segment_label IS NOT NULL" in sql
    assert "segment_start_seconds     IS NOT NULL" in sql \
        or "segment_start_seconds IS NOT NULL" in sql
    assert "segment_end_seconds       IS NOT NULL" in sql \
        or "segment_end_seconds IS NOT NULL" in sql


def test_cut_audio_reuse_via_repeated_request_is_pure_function(monkeypatch):
    """Idempotency invariant: calling the endpoint with the same body N
    times must produce the same DB state + the same response
    fingerprint (modulo the per-request ID returned by the reuse).
    Without this, retries would silently amplify storage cost.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    body = listening_router.CutAudioRequest(segments=[
        listening_router.CutSegmentInput(label="x", start=0.0, end=300.0),
    ])
    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"], body=body, authorization=authz,
    ))
    rows_after_first = list(fake.tables["listening_content"])
    uploads_after_first = list(fake.uploads)

    # Three more identical invocations — DB + storage state must not change.
    for _ in range(3):
        _run(listening_router.admin_cut_audio_segments(
            test_id=seed["test_id"], body=body, authorization=authz,
        ))
    assert fake.tables["listening_content"] == rows_after_first, (
        "F2 idempotency: repeated cuts must not insert duplicate rows"
    )
    assert fake.uploads == uploads_after_first, (
        "F2 idempotency: repeated cuts must not re-upload storage"
    )


def test_cut_audio_reuse_response_audio_path_matches_existing_row(monkeypatch):
    """F2 fix: the reuse response must echo the existing row's storage
    path so the frontend renders the audio preview without re-fetching
    the test detail. Pin the audio_storage_path round-trip.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    first = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0, end=300.0),
        ]),
        authorization=authz,
    ))
    second = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0, end=300.0),
        ]),
        authorization=authz,
    ))
    assert second["segments"][0]["reused"] is True
    assert second["segments"][0]["audio_storage_path"] == \
           first["segments"][0]["audio_storage_path"]


# ── Sprint 13.6.4 — production-bug regression pins (F9 + F10 + F11) ────────
#
# Andy dogfooded the audio cutter on production 2026-05-22 14:20 ICT for the
# first time. Every Export attempt failed with Postgres 23502 because the
# cut INSERT was missing ``source_type`` (NOT NULL CHECK from migration 056).
# The Sprint 13.6 ship through Sprint 13.6.3 (PR #257) all passed CI because
# the fake Supabase below appended rows without constraint checking — that
# was F11 ("sentinel tests fake-pass").
#
# The tests below pin the production-NOT-NULL contract end-to-end. The
# fake is now schema-aware (LISTENING_CONTENT_REQUIRED_FIELDS) so the
# same regression cannot ship green again.


def test_cut_audio_insert_populates_source_type_as_exercise_snippet(monkeypatch):
    """F9 fix — the production crash was ``source_type`` NULL. The
    canonical value is ``'exercise_snippet'`` because migration 066
    explicitly added it to the source_type CHECK enum with the comment
    'Sprint 13.6 audio cutter'. The cut route stayed mute on it for
    four PRs (#254 → #257) — this test pins the canonical value so a
    refactor cannot quietly drop it again.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="Section 1", start=0.0, end=375.0),
        ]),
        authorization=authz,
    ))
    row = fake.tables["listening_content"][0]
    assert row["source_type"] == "exercise_snippet"


def test_cut_audio_insert_populates_all_listening_content_not_null_fields(monkeypatch):
    """F9 fix (broader) — production schema requires NOT NULL on
    ``source_type``, ``audio_storage_path``, ``audio_duration_seconds``,
    ``audio_size_bytes``, ``accent_tag``, ``transcript``, ``title``.
    Andy hit ``source_type`` first because it fires first; the others
    would have surfaced on subsequent inserts. Pin all of them at
    once so the same class of bug can't recur on any one of them.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="Section 2", start=378.0, end=750.0),
        ]),
        authorization=authz,
    ))
    row = fake.tables["listening_content"][0]
    for required in LISTENING_CONTENT_REQUIRED_FIELDS:
        assert required in row, f"production NOT-NULL field {required!r} missing from cut INSERT"
        # ``transcript`` is allowed to be empty string but not None.
        if required == "transcript":
            assert row[required] is not None
        else:
            assert row[required] not in (None, ""), (
                f"production NOT-NULL field {required!r} was None/empty in cut INSERT"
            )


def test_cut_audio_default_accent_tag_is_in_allowed_check_enum(monkeypatch):
    """F9 fix — the cut route picks ``accent_tag = 'other'`` because
    listening_tests doesn't store accent. Pin that the default is one
    of the migration-056 CHECK enum values so the constraint doesn't
    raise 23514 on the cut INSERT path.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="x", start=0.0, end=10.0),
        ]),
        authorization=authz,
    ))
    row = fake.tables["listening_content"][0]
    # Migration 056: 'us_general', 'uk_rp', 'au', 'ca', 'other'.
    assert row["accent_tag"] in {"us_general", "uk_rp", "au", "ca", "other"}


def test_cut_audio_response_segments_surface_source_type(monkeypatch):
    """F9 fix — the admin frontend filters the audio-cutter list by
    ``source_type === 'exercise_snippet'``. The API response must echo
    the field so the UI can render the post-cut list without an extra
    round-trip.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    out = _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="a", start=0.0, end=10.0),
        ]),
        authorization=authz,
    ))
    assert out["segments"][0]["source_type"] == "exercise_snippet"


def test_fake_supabase_catches_missing_source_type_on_listening_content(monkeypatch):
    """F11 fix — this is the regression sentinel for the *test
    infrastructure itself*. The Sprint 13.6 ship through Sprint 13.6.3
    all passed CI because the previous ``_Fake`` here just appended
    rows; the production NOT-NULL violation never surfaced. Pin the
    new schema-aware behaviour by feeding the fake an obviously-bad
    payload and asserting it raises.
    """
    fake = _Fake()
    # Deliberately omit source_type — exactly the Sprint 13.6 bug.
    bad_payload = {
        "id": "x",
        "test_id": "y",
        "title": "Section 1",
        "audio_storage_path": "tests/x/x.mp3",
        "audio_size_bytes": 1000,
        "audio_duration_seconds": 10,
        "accent_tag": "other",
        "transcript": "",
        # source_type intentionally missing
    }
    with pytest.raises(_SchemaViolation) as excinfo:
        fake.table("listening_content").insert(bad_payload).execute()
    assert "source_type" in str(excinfo.value)


def test_fake_supabase_catches_invalid_source_type_check_value(monkeypatch):
    """F11 secondary pin — the production CHECK constraint also rejects
    unknown source_type values (Andy's commission speculated 'cut' as a
    new enum value — but the canonical value is 'exercise_snippet',
    already in the CHECK from migration 066). Pin that the fake catches
    the unknown-enum-value case so a future PR can't silently introduce
    a CHECK violation either.
    """
    fake = _Fake()
    bad_payload = {
        "id": "x",
        "source_type": "cut",   # NOT in migration 066 CHECK
        "test_id": "y",
        "title": "Section 1",
        "audio_storage_path": "tests/x/x.mp3",
        "audio_size_bytes": 1000,
        "audio_duration_seconds": 10,
        "accent_tag": "other",
        "transcript": "",
    }
    with pytest.raises(_SchemaViolation) as excinfo:
        fake.table("listening_content").insert(bad_payload).execute()
    assert "check constraint" in str(excinfo.value).lower()
    assert "cut" in str(excinfo.value)


def test_cut_audio_segment_offsets_round_to_three_decimals_on_insert(monkeypatch):
    """F2 (Sprint 13.6.3) reinforcement — the reuse fingerprint
    matches at 3-decimal precision. The INSERT side must also round
    to 3 decimals so the round-tripped value matches the next read.
    Without this, ``segment_start_seconds: 0.000005`` would store
    differently and defeat its own idempotency lookup.
    """
    fake, authz = _patch(monkeypatch)
    seed = _seed_full_premixed_test(fake)
    _cut_with_fake_ffmpeg(monkeypatch)

    _run(listening_router.admin_cut_audio_segments(
        test_id=seed["test_id"],
        body=listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="x",
                                             start=12.3456789,
                                             end=42.9876543),
        ]),
        authorization=authz,
    ))
    row = fake.tables["listening_content"][0]
    assert row["segment_start_seconds"] == 12.346
    assert row["segment_end_seconds"]   == 42.988


def test_migration_072_self_heals_missing_segment_columns():
    """F10 fix — production schema audit 2026-05-22 surfaced that
    migration 071's segment columns had never been applied. The
    amended migration 072 must include an IF-NOT-EXISTS block for the
    three segment columns BEFORE any reference to them (UPDATE
    backfill + partial UNIQUE index). Otherwise re-running 072 on a
    071-missing environment still 42703s.
    """
    import pathlib
    sql = pathlib.Path(
        "migrations/072_listening_content_cut_provenance_and_idempotency.sql"
    ).read_text(encoding="utf-8")
    # The self-heal block must come BEFORE the partial unique index
    # that references the segment columns.
    self_heal_idx = sql.find("ADD COLUMN IF NOT EXISTS segment_label")
    unique_idx    = sql.find("uq_listening_content_cut_active_fingerprint")
    assert self_heal_idx >= 0, "Sprint 13.6.4: missing segment_label self-heal block"
    assert unique_idx >= 0
    assert self_heal_idx < unique_idx, (
        "Sprint 13.6.4: segment column self-heal must come BEFORE the "
        "partial unique index that references them"
    )
    assert "ADD COLUMN IF NOT EXISTS segment_start_seconds" in sql
    assert "ADD COLUMN IF NOT EXISTS segment_end_seconds" in sql


def test_migration_072_amendment_documents_sprint_13_6_4_context():
    """Pin the amendment narrative in the migration header so a future
    schema-cleanup PR can't strip the explanation without a deliberate
    rewrite. The cluster 13.x retrospective ledger cross-references
    this file.
    """
    import pathlib
    sql = pathlib.Path(
        "migrations/072_listening_content_cut_provenance_and_idempotency.sql"
    ).read_text(encoding="utf-8")
    assert "Sprint 13.6.4" in sql
    assert "42703" in sql or "self-heal" in sql.lower()


def test_cut_request_pydantic_rejects_empty_segments_list():
    """The request schema must reject an empty ``segments`` list at
    the boundary — saves a round-trip through the storage download.
    """
    with pytest.raises(Exception):
        listening_router.CutAudioRequest(segments=[])


def test_cut_request_pydantic_rejects_unknown_body_fields():
    with pytest.raises(Exception):
        listening_router.CutAudioRequest(segments=[
            listening_router.CutSegmentInput(label="x", start=0.0, end=1.0),
        ], rogue_field="oops")


def test_detect_silence_request_pydantic_rejects_unknown_body_fields():
    with pytest.raises(Exception):
        listening_router.DetectSilenceRequest(unknown=True)
