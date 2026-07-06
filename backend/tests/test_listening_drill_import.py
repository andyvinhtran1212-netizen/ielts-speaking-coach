"""tests/test_listening_drill_import.py — skill-drill importer.

Assert REAL parsed values from real Source_JSON fixtures (one per render type),
that the emitted exercise payloads match the player/grader contract
(variant / template_kind / template / answers / alternatives), that map drills
keep their inline SVG, and that timings.json becomes per-question audio_windows.
The importer is pure — no DB — so these run fast and offline.
"""

from __future__ import annotations

import asyncio
import io
import json
import pathlib

import pytest
from fastapi import HTTPException, UploadFile

from services import listening_drill_import as imp
from services import listening_test_grader as grader
from routers import listening as listening_module

_FIX = pathlib.Path(__file__).parent / "fixtures" / "drills"


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _upload(name: str, data: bytes) -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(data))


def _load(type_code: str) -> dict:
    return json.loads((_FIX / f"ILR-LIS-DRL-{type_code}-L2-T1.json").read_text(encoding="utf-8"))


def _timings(type_code: str) -> dict | None:
    p = _FIX / f"ILR-LIS-DRL-{type_code}-L2-T1.timings.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


_ALL = ["FLOW", "FORM", "MAP", "MATCH", "MCQ", "MCQM", "NOTE", "SAQ", "SENT", "SUMM", "TABLE"]

_EXPECT_TK = {
    "FLOW": "flow_chart_completion", "FORM": "form_completion", "MAP": "plan_label",
    "MATCH": "matching", "MCQ": "mcq_3option", "MCQM": "mcq_multi",
    "NOTE": "notes_completion", "SAQ": "short_answer", "SENT": "sentence_completion",
    "SUMM": "summary_completion", "TABLE": "table_completion",
}
_EXPECT_SKILL = {
    "FLOW": "flowchart", "FORM": "form", "MAP": "map", "MATCH": "matching",
    "MCQ": "mcq", "MCQM": "mcq_multi", "NOTE": "note", "SAQ": "short_answer",
    "SENT": "sentence", "SUMM": "summary", "TABLE": "table",
}


@pytest.mark.parametrize("code", _ALL)
def test_parse_each_type_clean(code):
    res = imp.parse_drill(_load(code), _timings(code))
    assert not res.errors, f"{code} errors: {res.errors}"
    assert res.exercise_rows, f"{code} produced no exercises"
    # metadata carries the drill discriminators
    md = res.test_metadata["metadata"]
    assert md["test_type"] == "drill"
    assert md["drill_type"] == _EXPECT_SKILL[code]
    assert md["level"] == "L2"
    assert md["task"] == "T1"
    # every exercise uses the expected template_kind
    for ex in res.exercise_rows:
        assert ex["payload"]["template_kind"] == _EXPECT_TK[code], code


@pytest.mark.parametrize("code", _ALL)
def test_answer_key_grades_perfectly(code):
    """Feeding the canonical answers back through the real grader must score
    100% — proves answer/alternatives/group_key land where the grader reads."""
    res = imp.parse_drill(_load(code), _timings(code))
    key = grader.collect_answer_key(res.exercise_rows)
    assert key, code
    user = [{"q_num": k["q_num"], "user_answer": k["answer"]} for k in key]
    graded = grader.grade_attempt(user, key)
    assert graded["score"] == graded["max_score"] == res.question_count, (
        code, graded["score"], graded["max_score"], res.question_count)


def test_alternatives_from_accept():
    """SAQ answers carry `accept` → must surface as payload alternatives."""
    res = imp.parse_drill(_load("SAQ"), None)
    answers = [a for ex in res.exercise_rows for a in ex["payload"]["answers"]]
    assert any(a["alternatives"] for a in answers), "no alternatives carried from accept[]"


def test_map_keeps_inline_svg():
    res = imp.parse_drill(_load("MAP"), None)
    svgs = [ex["payload"].get("map_svg") for ex in res.exercise_rows]
    assert any(s and s.strip().startswith("<svg") for s in svgs), "map_svg not carried inline"
    # plan_label letter_options derived for the dropdown
    ex = res.exercise_rows[0]
    assert ex["payload"]["metadata"]["letter_options"], "no letter_options for plan_label"


def test_audio_windows_from_timings():
    res = imp.parse_drill(_load("MCQ"), _timings("MCQ"))
    windows = {}
    for ex in res.exercise_rows:
        windows.update(ex["payload"]["audio_windows"])
    assert windows, "no audio_windows built from timings"
    w = next(iter(windows.values()))
    assert w["end"] > w["start"] and "section" in w
    assert res.has_audio is True


def test_missing_audio_warns_not_errors():
    # FLOW L2-T1 has no timings fixture → still parses, warns, no error.
    res = imp.parse_drill(_load("FLOW"), None)
    assert not res.errors
    assert res.has_audio is False
    assert any("audio" in w.lower() for w in res.warnings)


def test_mcq_multi_grouped_grading():
    """A Choose-TWO block is graded any-order as a set."""
    res = imp.parse_drill(_load("MCQM"), None)
    key = grader.collect_answer_key(res.exercise_rows)
    # every mcq_multi row shares a group_key with its pair
    gkeys = {k["group_key"] for k in key if k["template_kind"] == "mcq_multi"}
    assert gkeys and None not in gkeys
    # swap the two answers within the first pair → still fully correct (any-order)
    by_pair: dict[str, list] = {}
    for k in key:
        by_pair.setdefault(k["group_key"], []).append(k)
    pair = next(v for v in by_pair.values() if len(v) == 2)
    user = [{"q_num": k["q_num"], "user_answer": k["answer"]} for k in key]
    umap = {u["q_num"]: u for u in user}
    umap[pair[0]["q_num"]]["user_answer"], umap[pair[1]["q_num"]]["user_answer"] = (
        pair[1]["answer"], pair[0]["answer"])
    graded = grader.grade_attempt(user, key)
    assert graded["score"] == graded["max_score"], "any-order mcq_multi not honoured"


# ── admin endpoints (mocked supabase + audio) ──────────────────────────────

class _DupNone:
    def table(self, *a, **k): return self
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return type("R", (), {"data": []})()


class _CommitStub:
    def __init__(self):
        self.inserts: list[tuple] = []
    def table(self, name): self._t = name; return self
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def insert(self, payload): self.inserts.append((self._t, payload)); return self
    def delete(self): self._del = True; return self
    def execute(self): return type("R", (), {"data": []})()


def _bytes(code: str) -> bytes:
    return (_FIX / f"ILR-LIS-DRL-{code}-L2-T1.json").read_bytes()


def _timings_bytes(code: str) -> bytes | None:
    p = _FIX / f"ILR-LIS-DRL-{code}-L2-T1.timings.json"
    return p.read_bytes() if p.exists() else None


def test_drill_dry_run_requires_admin(monkeypatch):
    async def _deny(_a): raise HTTPException(403, "forbidden")
    monkeypatch.setattr(listening_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as e:
        _run(listening_module.admin_import_drill_dry_run(
            source_json=_upload("d.json", b"{}"), timings=None, authorization=None))
    assert e.value.status_code == 403


def test_drill_dry_run_preview(monkeypatch):
    async def _ok(_a): return {"id": "admin", "role": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    monkeypatch.setattr(listening_module, "supabase_admin", _DupNone())
    out = _run(listening_module.admin_import_drill_dry_run(
        source_json=_upload("ILR-LIS-DRL-MCQ-L2-T1.json", _bytes("MCQ")),
        timings=_upload("timings.json", _timings_bytes("MCQ")),
        authorization="x"))
    assert out["ok"] is True
    assert out["drill_type"] == "mcq"
    assert out["level"] == "L2"
    assert out["has_audio"] is True
    assert out["question_count"] == 10


def test_drill_commit_persists_with_audio(monkeypatch):
    from services import listening_audio
    async def _ok(_a): return {"id": "admin", "role": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    stub = _CommitStub()
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    monkeypatch.setattr(listening_module, "_upload_audio_to_bucket", lambda p, b: None)
    monkeypatch.setattr(listening_audio, "validate_section_audio",
                        lambda b: {"duration_seconds": 281, "size_bytes": len(b), "errors": [], "warnings": []})
    out = _run(listening_module.admin_import_drill_commit(
        source_json=_upload("ILR-LIS-DRL-MCQ-L2-T1.json", _bytes("MCQ")),
        timings=_upload("timings.json", _timings_bytes("MCQ")),
        audio=_upload("full.mp3", b"x" * 5000),
        authorization="x"))
    assert out["test_id"] == "ILR-LIS-DRL-MCQ-L2-T1"
    assert out["has_audio"] is True
    assert out["exercises_created"] >= 1
    tests_rows = [p for (t, p) in stub.inserts if t == "listening_tests"]
    assert len(tests_rows) == 1
    tr = tests_rows[0]
    assert tr["metadata"]["test_type"] == "drill"
    assert tr["metadata"]["drill_type"] == "mcq"
    assert tr["full_audio_storage_path"].startswith("drills/")
    content_rows = [p for (t, p) in stub.inserts if t == "listening_content"]
    assert len(content_rows) == 1


def test_drill_commit_without_audio_imports_draft(monkeypatch):
    async def _ok(_a): return {"id": "admin", "role": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    stub = _CommitStub()
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    out = _run(listening_module.admin_import_drill_commit(
        source_json=_upload("ILR-LIS-DRL-FLOW-L2-T1.json", _bytes("FLOW")),
        timings=None, audio=None, authorization="x"))
    assert out["has_audio"] is False
    assert out["status"] == "draft"
    tr = [p for (t, p) in stub.inserts if t == "listening_tests"][0]
    assert "full_audio_storage_path" not in tr   # no audio → no path


# ── student list endpoint: drill segregation ───────────────────────────────

class _ListStub:
    """Records the test_type filter applied and returns a fixed drill row so we
    can assert both the query filter and the surfaced item shape."""
    def __init__(self):
        self.eq_filter = None
        self.or_filter = None
    def table(self, name): self._t = name; return self
    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def eq(self, col, val=None):
        if col == "metadata->>test_type":
            self.eq_filter = val
        return self
    def or_(self, expr):
        self.or_filter = expr
        return self
    def execute(self):
        if self._t == "listening_test_attempts":
            return type("R", (), {"data": []})()
        row = {
            "id": "t-1", "test_id": "ILR-LIS-DRL-MCQ-L2-T1", "title": "MCQ drill",
            "band_target": 6.0, "themes": {}, "accent_profile": ["uk_rp"],
            "audio_assembly_mode": "full_premixed",
            "full_audio_storage_path": "drills/x/full.mp3",
            "assembled_audio_storage_path": None,
            "metadata": {"test_type": "drill", "drill_type": "mcq", "level": "L2", "task": "T1"},
        }
        return type("R", (), {"data": [row], "count": 1})()


def test_list_drill_filter_and_item_shape(monkeypatch):
    async def _auth(_a): return {"id": "u-1"}
    monkeypatch.setattr(listening_module, "_require_auth", _auth)
    stub = _ListStub()
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    out = _run(listening_module.list_published_listening_tests(
        test_type="drill", limit=50, offset=0, authorization="x"))
    assert stub.eq_filter == "drill"
    item = out["items"][0]
    assert item["drill_type"] == "mcq" and item["level"] == "L2" and item["task"] == "T1"


def test_list_default_excludes_drill(monkeypatch):
    async def _auth(_a): return {"id": "u-1"}
    monkeypatch.setattr(listening_module, "_require_auth", _auth)
    stub = _ListStub()
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    _run(listening_module.list_published_listening_tests(
        test_type="full", limit=50, offset=0, authorization="x"))
    assert stub.or_filter and "not.in.(mini,drill)" in stub.or_filter


def test_list_rejects_bad_test_type(monkeypatch):
    async def _auth(_a): return {"id": "u-1"}
    monkeypatch.setattr(listening_module, "_require_auth", _auth)
    with pytest.raises(HTTPException) as e:
        _run(listening_module.list_published_listening_tests(
            test_type="bogus", limit=50, offset=0, authorization="x"))
    assert e.value.status_code == 422


def test_drill_commit_audio_without_timings_rejected(monkeypatch):
    """Audio WITHOUT timings would publish an audio-ready drill with no replay
    windows — must 422 (require timings whenever audio is sent)."""
    from services import listening_audio
    async def _ok(_a): return {"id": "admin", "role": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    monkeypatch.setattr(listening_module, "supabase_admin", _CommitStub())
    monkeypatch.setattr(listening_audio, "validate_section_audio",
                        lambda b: {"duration_seconds": 281, "size_bytes": len(b), "errors": [], "warnings": []})
    with pytest.raises(HTTPException) as e:
        _run(listening_module.admin_import_drill_commit(
            source_json=_upload("ILR-LIS-DRL-MCQ-L2-T1.json", _bytes("MCQ")),
            timings=None,
            audio=_upload("full.mp3", b"x" * 5000),
            authorization="x"))
    assert e.value.status_code == 422
    assert "timings" in str(e.value.detail).lower()
