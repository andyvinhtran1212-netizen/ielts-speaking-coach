"""PC-J403 — GET /api/writing/my-essays/{id} tells the student who set the band.

`feedback.band_source`:
  • "ai"      — the current version is an AI grade (source ai_*, every tier incl.
                instructor), or a composed version whose 5 bands are exactly AI
                bands (text-only admin edit vs. its AI parent; F2 mix where every
                criterion band is the picked AI version's band and the overall is
                the deterministic IELTS overall of those 4 bands).
  • "teacher" — a composed version whose bands cannot be proven AI-identical
                (admin changed a band, or the AI source rows are missing).
  • "unknown" — a non-composed row without an ai_* source (legacy / unexpected).

The student payload never carries provenance / edited_by / mixed_by / source.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import writing_student as ws_module  # noqa: E402

_STUDENT = {"id": "student-1", "user_id": "user-1"}
_ESSAY_ID = "essay-1"
_ADMIN_ID = "admin-uuid-secret"
_INSTRUCTOR_ID = "instructor-uuid-secret"


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _bands(overall, main, cc, lr, gr) -> dict:
    return {
        "overall_band_score":      overall,
        "band_main_criterion":     main,
        "band_coherence_cohesion": cc,
        "band_lexical_resource":   lr,
        "band_grammatical_range":  gr,
    }


def _ai(version, bands, parent=None) -> dict:
    return {"version": version, "source": "ai_pro", "parent_version": parent,
            "provenance": None, **bands}


def _composed(version, bands, *, parent, provenance) -> dict:
    return {"version": version, "source": "composed", "parent_version": parent,
            "provenance": provenance, **bands}


class _Builder:
    def __init__(self, client, table):
        self.client, self.table = client, table
        self.action, self.cols, self.filters = "select", None, []

    def select(self, cols, *_a, **_k): self.action, self.cols = "select", cols; return self
    def update(self, payload, *_a, **_k): self.action = "update"; return self
    def eq(self, col, val): self.filters.append(("eq", col, val)); return self
    def in_(self, col, vals): self.filters.append(("in", col, list(vals))); return self
    def is_(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def execute(self):
        self.client.calls.append((self.table, self.action, self.cols, list(self.filters)))
        return self.client.respond(self)


class _Client:
    """`versions` = every writing_feedback row of the essay; the view returns the
    one whose version == current_version (the real view's JOIN)."""

    def __init__(self, *, status="delivered", versions=(), current=1, base_raises=None):
        self.status, self.versions, self.current = status, list(versions), current
        self.base_raises = base_raises
        self.calls: list[tuple] = []

    def table(self, name):
        return _Builder(self, name)

    def respond(self, b):
        class _R:
            pass
        r = _R()
        r.data = []
        if b.table == "writing_essays" and b.action == "select":
            if b.cols and "instructor_note" in b.cols and "task_type" not in b.cols:
                r.data = [{"instructor_note": None}]
            else:
                r.data = [{"id": _ESSAY_ID, "task_type": "task2", "prompt_text": "Q",
                           "prompt_image_url": None, "essay_text": "E", "status": self.status,
                           "created_at": "2026-10-30T00:00:00Z", "delivered_at": None,
                           "hide_subbands": False, "is_flagged": False, "flag_reasons": [],
                           "flagged_at": None, "error_message": None}]
        elif b.table == "writing_feedback_current":
            r.data = [dict(v, feedback_json={"overallBandScore": v["overall_band_score"]},
                           created_at="2026-10-30T00:00:00Z")
                      for v in self.versions if v["version"] == self.current]
        elif b.table == "writing_feedback":
            if self.base_raises:
                raise self.base_raises
            wanted = None
            for op, col, val in b.filters:
                if op == "in" and col == "version":
                    wanted = {int(x) for x in val}
                if op == "eq" and col == "version":
                    wanted = {int(val)}
            r.data = [dict(v) for v in self.versions if wanted is None or v["version"] in wanted]
        return r


def _get(monkeypatch, **kw):
    client = _Client(**kw)
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    monkeypatch.setattr(ws_module, "attach_signed_image_urls", lambda rows: None)
    return _run(ws_module.get_my_essay(_ESSAY_ID, student=_STUDENT)), client


_B65 = _bands(6.5, 6.5, 6.5, 6.5, 6.0)
_B70 = _bands(7.0, 7.0, 7.0, 7.0, 6.5)


@pytest.mark.parametrize("tier_source", ["ai_pro", "ai_flash"])
def test_ai_version_is_ai(monkeypatch, tier_source):
    """Standard / pro / deep / instructor tiers all persist an ai_* source
    (`_source_for_tier`), so every AI grade — first grade or regrade — is ai."""
    v1 = dict(_ai(1, _B65), source=tier_source)
    out, _ = _get(monkeypatch, versions=[v1], current=1)
    assert out["feedback"]["band_source"] == "ai"


def test_ai_regrade_on_top_of_composed_is_ai(monkeypatch):
    v1 = _ai(1, _B65)
    v2 = _composed(2, _B70, parent=1, provenance={"edited_by": _ADMIN_ID, "edited_at": "t"})
    v3 = _ai(3, _B65, parent=2)
    out, _ = _get(monkeypatch, versions=[v1, v2, v3], current=3)
    assert out["feedback"]["band_source"] == "ai"


def test_admin_text_only_edit_keeps_ai(monkeypatch):
    v1 = _ai(1, _B65)
    v2 = _composed(2, _B65, parent=1, provenance={"edited_by": _ADMIN_ID, "edited_at": "t"})
    out, _ = _get(monkeypatch, versions=[v1, v2], current=2)
    assert out["feedback"]["band_source"] == "ai"


@pytest.mark.parametrize("changed", [
    "overall_band_score", "band_main_criterion", "band_coherence_cohesion",
    "band_lexical_resource", "band_grammatical_range",
])
def test_admin_band_edit_is_teacher(monkeypatch, changed):
    v1 = _ai(1, _B65)
    edited = dict(_B65, **{changed: _B65[changed] + 0.5})
    v2 = _composed(2, edited, parent=1, provenance={"edited_by": _ADMIN_ID, "edited_at": "t"})
    out, _ = _get(monkeypatch, versions=[v1, v2], current=2)
    assert out["feedback"]["band_source"] == "teacher"


def test_band_edit_without_readable_parent_is_teacher(monkeypatch):
    """Safe default: a composed version whose AI parent is missing is never
    labelled an estimate."""
    v1 = _composed(1, _B65, parent=None, provenance={"edited_by": _ADMIN_ID, "edited_at": "t"})
    out, _ = _get(monkeypatch, versions=[v1], current=1)
    assert out["feedback"]["band_source"] == "teacher"


def test_parent_lookup_failure_is_teacher(monkeypatch):
    v1 = _ai(1, _B65)
    v2 = _composed(2, _B65, parent=1, provenance={"edited_by": _ADMIN_ID, "edited_at": "t"})
    out, _ = _get(monkeypatch, versions=[v1, v2], current=2, base_raises=RuntimeError("db down"))
    assert out["feedback"]["band_source"] == "teacher"
    assert out["feedback"]["overall_band_score"] == 6.5      # feedback still rendered


def test_parent_that_is_composed_is_teacher(monkeypatch):
    v1 = _composed(1, _B65, parent=None, provenance={"edited_by": _ADMIN_ID, "edited_at": "t"})
    v2 = _composed(2, _B65, parent=1, provenance={"edited_by": _ADMIN_ID, "edited_at": "t"})
    out, _ = _get(monkeypatch, versions=[v1, v2], current=2)
    assert out["feedback"]["band_source"] == "teacher"


def _mix_prov(**picks) -> dict:
    return {"block_sources": picks, "base_version": 2, "mixed_by": _INSTRUCTOR_ID,
            "mixed_at": "t"}


def test_f2_mix_of_ai_versions_is_ai(monkeypatch):
    """Criteria picked from two AI versions; the overall is the IELTS overall of
    the picked bands (compose_version) — equal to neither parent, still AI."""
    v1 = _ai(1, _bands(6.0, 6.0, 6.0, 6.0, 6.0))
    v2 = _ai(2, _bands(7.0, 7.0, 7.0, 7.0, 7.0), parent=1)
    mixed = _bands(6.5, 7.0, 7.0, 6.0, 6.0)          # mean 6.5 → 6.5
    v3 = _composed(3, mixed, parent=2, provenance=_mix_prov(
        mainCriterion=2, coherenceCohesion=2, lexicalResource=1, grammaticalRange=1))
    out, _ = _get(monkeypatch, versions=[v1, v2, v3], current=3)
    assert out["feedback"]["band_source"] == "ai"


def test_f2_mix_band_changed_afterwards_is_teacher(monkeypatch):
    """A mix row whose bands were later changed in place (provenance kept) no
    longer matches its picks."""
    v1 = _ai(1, _bands(6.0, 6.0, 6.0, 6.0, 6.0))
    v2 = _ai(2, _bands(7.0, 7.0, 7.0, 7.0, 7.0), parent=1)
    v3 = _composed(3, _bands(6.5, 7.0, 7.0, 6.5, 6.0), parent=2, provenance=_mix_prov(
        mainCriterion=2, coherenceCohesion=2, lexicalResource=1, grammaticalRange=1))
    out, _ = _get(monkeypatch, versions=[v1, v2, v3], current=3)
    assert out["feedback"]["band_source"] == "teacher"


def test_f2_mix_overall_not_derived_is_teacher(monkeypatch):
    v1 = _ai(1, _bands(6.0, 6.0, 6.0, 6.0, 6.0))
    v2 = _ai(2, _bands(7.0, 7.0, 7.0, 7.0, 7.0), parent=1)
    v3 = _composed(3, _bands(7.0, 7.0, 7.0, 6.0, 6.0), parent=2, provenance=_mix_prov(
        mainCriterion=2, coherenceCohesion=2, lexicalResource=1, grammaticalRange=1))
    out, _ = _get(monkeypatch, versions=[v1, v2, v3], current=3)
    assert out["feedback"]["band_source"] == "teacher"


def test_f2_mix_picking_a_composed_version_is_teacher(monkeypatch):
    """The mainCriterion band (7.0) comes from the composed row itself (an earlier
    admin band edit mixed over in place), not from an AI version."""
    v1 = _ai(1, _B65)
    v2 = _composed(2, _bands(6.5, 7.0, 6.5, 6.5, 6.0), parent=1, provenance=_mix_prov(
        mainCriterion=2, coherenceCohesion=1, lexicalResource=1, grammaticalRange=1))
    out, _ = _get(monkeypatch, versions=[v1, v2], current=2)
    assert out["feedback"]["band_source"] == "teacher"


def test_unknown_source_is_unknown(monkeypatch):
    v1 = dict(_ai(1, _B65), source=None)
    out, _ = _get(monkeypatch, versions=[v1], current=1)
    assert out["feedback"]["band_source"] == "unknown"


def test_student_payload_never_leaks_provenance(monkeypatch):
    v1 = _ai(1, _B65)
    v2 = _composed(2, _B70, parent=1, provenance={"edited_by": _ADMIN_ID, "edited_at": "t"})
    out, _ = _get(monkeypatch, versions=[v1, v2], current=2)
    fb = out["feedback"]
    for key in ("provenance", "source", "parent_version", "version"):
        assert key not in fb
    assert _ADMIN_ID not in repr(out)


def test_ai_current_does_not_read_base_table(monkeypatch):
    out, client = _get(monkeypatch, versions=[_ai(1, _B65)], current=1)
    assert out["feedback"]["band_source"] == "ai"
    assert not [c for c in client.calls if c[0] == "writing_feedback"]


def test_undelivered_essay_has_no_feedback_or_flag(monkeypatch):
    out, client = _get(monkeypatch, status="graded", versions=[_ai(1, _B65)], current=1)
    assert out["feedback"] is None
    assert not [c for c in client.calls if c[0].startswith("writing_feedback")]


def test_http_response_keeps_existing_fields_and_flag(monkeypatch):
    """The route's response_model documents band_source without dropping the
    existing open essay / feedback keys."""
    client = _Client(versions=[_ai(1, _B65)], current=1)
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    monkeypatch.setattr(ws_module, "attach_signed_image_urls",
                        lambda rows: [r.update(prompt_image_signed_url="signed") for r in rows])
    app = FastAPI()
    app.include_router(ws_module.router)
    app.dependency_overrides[ws_module.get_current_student] = lambda: _STUDENT
    body = TestClient(app).get(f"/api/writing/my-essays/{_ESSAY_ID}").json()
    assert body["feedback"]["band_source"] == "ai"
    assert body["feedback"]["feedback_json"] == {"overallBandScore": 6.5}
    assert body["feedback"]["band_grammatical_range"] == 6.0
    assert body["essay"]["prompt_image_signed_url"] == "signed"
    assert body["essay"]["hide_subbands"] is False
    assert body["instructor_note"] is None

    schema = app.openapi()["components"]["schemas"]
    fb = schema["MyEssayFeedbackOut"]
    assert fb["properties"]["band_source"]["enum"] == ["ai", "teacher", "unknown"]
    assert "band_source" in fb["required"]
