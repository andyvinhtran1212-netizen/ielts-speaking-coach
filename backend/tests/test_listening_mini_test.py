"""Listening MINI TEST — loader accepts 1 section + the list endpoint segregates.

A mini = a listening full test with 1 section (M questions), flagged
metadata.test_type='mini'. The loader was hard-locked to exactly 4 sections /
40 questions; this pins the relax (1–4 sections, contiguous 1..M questions)
WITHOUT regressing the full 4-section path, plus the 2-way list filter.

The 1-section pack is sliced from the real ground-truth pack
(docs/content-samples/listening-full-test/ILR-LIS-001) so it exercises the real
markers/cross-checks; section S1's audio windows stay absolute (offset kept), so
audio-replay still points into full_test.mp3 correctly.
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from services.listening_fulltest_import import parse_fulltest
# NOTE: routers.listening is imported LAZILY inside the filter tests — importing
# it at module top can block on a Supabase-client warmup in a network-isolated
# sandbox, which would stall the (router-free) loader tests at collection.

_PACK = Path(__file__).parent.parent.parent / "docs" / "content-samples" / "listening-full-test" / "ILR-LIS-001"


def _full_pack():
    qp = (_PACK / "ILR_LIS_001_Question_Paper.md").read_text(encoding="utf-8")
    sol = (_PACK / "ILR_LIS_001_Solution.md").read_text(encoding="utf-8")
    tim = json.loads((_PACK / "timings.json").read_text(encoding="utf-8"))
    return qp, sol, tim


def _slice_section1(qp, sol, tim, new_id="ILR-LIS-MINI-TEST"):
    """Build a 1-section mini pack (questions 1..10) from the full pack."""
    h1 = f"# IELTS LISTENING — {new_id}\n"
    de = h1 + "\n_Accent: BrE · Target band: 6.0_\n\n" + \
        qp[qp.index("## SECTION 1"):qp.index("## SECTION 2")].rstrip() + f"\n\n_Test ID: {new_id}_\n"

    ans = {int(n): a.strip() for n, a in re.findall(r"\*\*(\d+)\.\*\*\s*([^|*\n]+)", sol)
           if 1 <= int(n) <= 10}
    qa = " | ".join(f"**{n}.** {ans[n]}" for n in sorted(ans))
    blocks = [b.rstrip() for b in re.split(r"(?=^### Q\d+\b)", sol, flags=re.MULTILINE)
              if re.match(r"^### Q(\d+)\b", b) and 1 <= int(re.match(r"^### Q(\d+)", b).group(1)) <= 10]
    giai = f"# IELTS LISTENING — {new_id} — Script & Answer Key\n\n## Bảng đáp án\n{qa}\n\n" + "\n\n".join(blocks) + "\n"

    s1 = next(s for s in tim["sections"] if s["id"] == "S1")
    s1q = {k: v for k, v in (s1.get("questions") or {}).items() if 1 <= int(k) <= 10}
    tmini = {
        "test_id": new_id, "timebase": "seconds",
        "full_test": {"file": "full_test.mp3",
                      "section_offsets": {"S1": tim["full_test"]["section_offsets"]["S1"]}},
        "sections": [{"id": "S1", "file": "S1.mp3", "duration": s1.get("duration"),
                      "events": s1.get("events", []), "turns": s1.get("turns", []), "questions": s1q}],
    }
    return de, giai, tmini


# ── 1. loader: 1-section mini parses clean ───────────────────────────────────


def test_loader_accepts_one_section_mini():
    de, giai, tim = _slice_section1(*_full_pack())
    r = parse_fulltest(de, giai, tim).__dict__
    assert r["errors"] == []
    assert len({q["section_num"] for q in r["questions"]}) == 1
    assert [q["q_num"] for q in r["questions"]] == list(range(1, 11))
    # audio-replay window present + absolute (BS1) — into full_test.mp3.
    assert all(q.get("audio_window") for q in r["questions"])
    assert r["questions"][0]["audio_window"]["start"] > 100  # abs (offset added), not section-rel


# ── 2. loader: full 4-section path unchanged (regression) ────────────────────


def test_loader_full_four_sections_regression():
    r = parse_fulltest(*_full_pack()).__dict__
    assert r["errors"] == []
    assert len(r["questions"]) == 40
    assert len({q["section_num"] for q in r["questions"]}) == 4


# ── 3. loader: 0 sections rejected ───────────────────────────────────────────


def test_loader_rejects_zero_sections():
    de = "# IELTS LISTENING — X\n\n(no sections)\n"
    r = parse_fulltest(de, "## Bảng đáp án\n", {"full_test": {"section_offsets": {}}, "sections": []}).__dict__
    assert any("section" in e.lower() for e in r["errors"])


# ── 4. student list endpoint: 2-way test_type filter ─────────────────────────


class _RecQ:
    def __init__(self, rec): self.rec = rec
    def select(self, *a, **k): return self
    def eq(self, c, v): self.rec.append(("eq", c, v)); return self
    def or_(self, f): self.rec.append(("or", f)); return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def execute(self):
        class _R: data = []; count = 0
        return _R()


class _RecSB:
    def __init__(self, rec): self.rec = rec
    def table(self, _n): return _RecQ(self.rec)


def _run(c):
    loop = asyncio.new_event_loop()
    try: return loop.run_until_complete(c)
    finally: loop.close()


def _call(**kw):
    from routers import listening as listening_mod   # lazy (see top-of-file note)
    rec: list = []
    params = {"test_type": None, "limit": 20, "offset": 0}
    params.update(kw)
    with patch.object(listening_mod, "supabase_admin", _RecSB(rec)), \
         patch.object(listening_mod, "_require_auth", AsyncMock(return_value={"id": "u"})):
        _run(listening_mod.list_published_listening_tests(authorization="Bearer x", **params))
    return rec


# Default/full library segregates BOTH mini and drill into their own libraries,
# while keeping legacy NULL rows.
_EXCLUDE = "metadata->>test_type.is.null,metadata->>test_type.not.in.(mini,drill)"


def test_list_mini_only():
    rec = _call(test_type="mini")
    assert ("eq", "metadata->>test_type", "mini") in rec
    assert not any(t[0] == "or" for t in rec)


def test_list_full_excludes_mini_keeps_legacy_null():
    rec = _call(test_type="full")
    assert ("or", _EXCLUDE) in rec
    assert ("eq", "metadata->>test_type", "mini") not in rec


def test_list_default_behaves_as_full():
    rec = _call()
    assert ("or", _EXCLUDE) in rec


def test_list_invalid_test_type_422():
    with pytest.raises(HTTPException) as ei:
        _call(test_type="bogus")
    assert ei.value.status_code == 422
