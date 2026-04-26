"""
Tests for services.d1_content_gen chunking behaviour.

We stub _generate_single_chunk so the tests don't touch Gemini.  Each test
locks down one of the contracts Phase D Wave 1 production smoke surfaced:

  - 20 words split into exactly 2 chunks of 10
  - chunk failure does NOT abort remaining chunks (partial success path)
  - 1-word input still works (single chunk of 1)
  - 60-word batch produces 6 chunks → up to 60 drafts

Run: pytest backend/tests/test_d1_content_gen.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from services import d1_content_gen as cg
from services.d1_content_gen import GeminiBatchError


def _stub_chunk(monkeypatch, items_per_chunk: int | dict | None = None):
    """
    Replace _generate_single_chunk with a deterministic stub.  Returns the
    list of (chunk_idx, words) the stub was called with so tests can assert.

    `items_per_chunk` controls behaviour:
      - None or int  → every chunk returns that many fake items (default len(words))
      - dict[int]    → per-1-indexed-chunk override; values are either an int
                       (#items to return) or an Exception instance (raise it).
    """
    seen: list[tuple[int, list[str]]] = []
    counter = {"i": 0}

    def _stub(words, _model_name=None):
        counter["i"] += 1
        idx = counter["i"]
        seen.append((idx, list(words)))

        spec = items_per_chunk
        if isinstance(spec, dict):
            spec = spec.get(idx)

        if isinstance(spec, BaseException):
            raise spec
        if spec is None:
            n = len(words)
        else:
            n = int(spec)

        return [
            {
                "word":        w,
                "answer":      w,
                "sentence":    f"This ___ matters {w}.",
                "distractors": ["a", "b", "c"],
            }
            for w in words[:n]
        ]

    monkeypatch.setattr(cg, "_generate_single_chunk", _stub)
    return seen


def test_chunk_size_constant_is_ten():
    """A regression on this constant would silently re-introduce the
    truncation bug — pin it explicitly."""
    assert cg.CHUNK_SIZE == 10


def test_generate_batch_chunks_correctly(monkeypatch):
    """20 words should split into 2 chunks of 10."""
    seen = _stub_chunk(monkeypatch)
    words = [f"w{i}" for i in range(20)]

    items = cg.generate_d1_exercises(words, count=20)

    assert len(seen) == 2, f"expected 2 chunk calls, got {len(seen)}"
    assert len(seen[0][1]) == 10
    assert len(seen[1][1]) == 10
    # Aggregated output is the union of both chunks.
    assert len(items) == 20


def test_generate_batch_partial_success(monkeypatch):
    """If chunk 2 fails, chunks 1 and 3 should still produce items."""
    seen = _stub_chunk(monkeypatch, items_per_chunk={
        1: 10,
        2: GeminiBatchError("simulated chunk-2 outage"),
        3: 5,
    })
    words = [f"w{i}" for i in range(30)]

    items = cg.generate_d1_exercises(words, count=30)

    assert len(seen) == 3, "all 3 chunks should have been attempted"
    # 10 (chunk 1) + 0 (chunk 2 raised) + 5 (chunk 3) = 15
    assert len(items) == 15
    # Verify chunk 2's words are NOT in the output (it raised before producing).
    chunk2_words = {f"w{i}" for i in range(10, 20)}
    assert not any(it["word"] in chunk2_words for it in items)


def test_generate_batch_callback_skips_failed_chunk(monkeypatch):
    """on_chunk_validated must NOT be called for a failed chunk — that's the
    whole point of the callback (incremental persistence of successful chunks
    only)."""
    _stub_chunk(monkeypatch, items_per_chunk={
        1: 10,
        2: GeminiBatchError("simulated outage"),
        3: 5,
    })
    words = [f"w{i}" for i in range(30)]

    callback_calls: list[int] = []
    cg.generate_d1_exercises(
        words, count=30,
        on_chunk_validated=lambda items: callback_calls.append(len(items)),
    )

    assert callback_calls == [10, 5], "callback fired only for successful chunks"


def test_generate_batch_single_word(monkeypatch):
    """1 word should still work — one chunk of one item."""
    seen = _stub_chunk(monkeypatch)
    items = cg.generate_d1_exercises(["solo"], count=1)

    assert len(seen) == 1
    assert seen[0][1] == ["solo"]
    assert len(items) == 1
    assert items[0]["word"] == "solo"


def test_generate_batch_60_words(monkeypatch):
    """60 words → 6 chunks of 10 → up to 60 items.  Locks down the original
    production-bug threshold."""
    seen = _stub_chunk(monkeypatch)
    words = [f"w{i}" for i in range(60)]

    items = cg.generate_d1_exercises(words, count=60)

    assert len(seen) == 6
    assert all(len(call[1]) == 10 for call in seen)
    assert len(items) == 60


def test_generate_batch_all_chunks_failing_raises(monkeypatch):
    """When every chunk raises, generate_d1_exercises must surface a single
    GeminiBatchError so the admin endpoint can return 502 instead of a
    silent empty list."""
    _stub_chunk(monkeypatch, items_per_chunk={
        1: GeminiBatchError("c1 down"),
        2: GeminiBatchError("c2 down"),
        3: GeminiBatchError("c3 down"),
    })
    words = [f"w{i}" for i in range(30)]

    with pytest.raises(GeminiBatchError) as exc:
        cg.generate_d1_exercises(words, count=30)
    assert "All 3 chunk(s) failed" in str(exc.value)


def test_generate_batch_caps_to_count(monkeypatch):
    """count=15 with 30 words should stop after 2 chunks (the early-exit
    optimisation) — no point burning a 3rd Gemini call."""
    seen = _stub_chunk(monkeypatch)  # default: each chunk returns full count
    words = [f"w{i}" for i in range(30)]

    items = cg.generate_d1_exercises(words, count=15)

    # The early-exit only triggers AFTER the chunk that put us at/over count.
    # 1st chunk returns 10 → not enough → 2nd chunk returns 10 (now 20 ≥ 15) → stop.
    assert len(seen) == 2
    assert len(items) == 15
