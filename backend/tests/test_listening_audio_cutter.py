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
