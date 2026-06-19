"""GV-1b — regrade write-path versioning.

Pins:
  • budget = LIVE versions (current + parent ancestor chain); orphans
    (advance-failed inserts, non-ancestors) are NOT counted and are GC'd.
  • _bg_grade_essay: first grade → v1; regrade → next version (v1 KEPT, not
    overwritten) + advance current_version LAST; job_id idempotency (re-invoke
    same job → reuse, no double-slot); orphan-GC reclaims the version-number.
  • regrade endpoints reject the 4th version (409, no evict, no 500); D1
    regrade_count bump preserved; the :675 admin_edits_json overlay is NOT
    touched (GV-1c).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest


# ── version-aware filtering fake ──────────────────────────────────────


class _Res:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, name, store):
        self.name, self.store = name, store
        self.op, self.payload, self.filters, self.limit_n = "select", None, [], None

    def select(self, *a, **k): self.op = "select"; return self
    def insert(self, p): self.op = "insert"; self.payload = p; return self
    def update(self, p): self.op = "update"; self.payload = p; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, c, v): self.filters.append((c, v)); return self
    def in_(self, c, vals): self.filters.append((c, ("__in__", [str(x) for x in vals]))); return self
    def is_(self, c, v): self.filters.append((c, ("__is__", v))); return self
    def limit(self, n, *a, **k): self.limit_n = n; return self
    def order(self, *a, **k): return self

    def _src(self):
        if self.name == "writing_feedback_current":
            cv = {e["id"]: e.get("current_version", 1) for e in self.store.get("writing_essays", [])}
            return [r for r in self.store.get("writing_feedback", [])
                    if r.get("version", 1) == cv.get(r.get("essay_id"))]
        return self.store.setdefault(self.name, [])

    def _match(self, r):
        for c, v in self.filters:
            if isinstance(v, tuple) and v and v[0] == "__in__":
                if str(r.get(c)) not in v[1]:
                    return False
            elif isinstance(v, tuple) and v and v[0] == "__is__":
                if v[1] == "null" and r.get(c) is not None:
                    return False
            elif "->>" in c:                       # JSON path filter: provenance->>job_id
                col, key = c.split("->>")
                if str((r.get(col) or {}).get(key)) != str(v):
                    return False
            elif str(r.get(c)) != str(v):
                return False
        return True

    def execute(self):
        if self.op == "insert":
            rows = self.store.setdefault(self.name, [])
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            created = [dict(it) for it in items]
            rows.extend(created)
            return _Res([dict(r) for r in created])
        src = self._src()
        matched = [r for r in src if self._match(r)]
        if self.op == "select":
            if self.limit_n is not None:
                matched = matched[:self.limit_n]
            return _Res([dict(r) for r in matched])
        if self.op == "update":
            for r in src:
                if self._match(r):
                    r.update(self.payload)
            return _Res([dict(r) for r in matched])
        if self.op == "delete":
            self.store[self.name] = [r for r in src if not self._match(r)]
            return _Res([dict(r) for r in matched])
        return _Res([])


class _FakeSB:
    def __init__(self, store): self.store = store
    def table(self, name): return _Q(name, self.store)


EID = str(uuid4())


def _essay(**kw):
    base = {"id": EID, "current_version": 1, "status": "graded", "deleted_at": None}
    base.update(kw)
    return base


def _fb(version, *, parent=None, band=6.0, job="j", essay_id=EID):
    return {"essay_id": essay_id, "version": version, "parent_version": parent,
            "overall_band_score": band, "provenance": {"job_id": job}, "source": "ai_pro",
            "feedback_json": {"v": version}}


# ── helpers: ancestor / budget / orphan-GC ────────────────────────────


def test_ancestor_chain_and_budget():
    store = {"writing_essays": [_essay(current_version=3)],
             "writing_feedback": [_fb(1), _fb(2, parent=1), _fb(3, parent=2)]}
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        assert essay_service._ancestor_versions(EID) == {1, 2, 3}
        assert essay_service.live_version_count(EID) == 3


def test_orphan_not_counted_in_budget():
    # current=2 (chain {1,2}); v3 is an orphan (advance-failed, parent=2 but
    # current never reached it) → NOT counted.
    store = {"writing_essays": [_essay(current_version=2)],
             "writing_feedback": [_fb(1), _fb(2, parent=1), _fb(3, parent=2)]}
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        assert essay_service._ancestor_versions(EID) == {1, 2}
        assert essay_service.live_version_count(EID) == 2     # orphan v3 excluded → not locked


def test_gc_deletes_orphans_keeps_ancestors():
    store = {"writing_essays": [_essay(current_version=2)],
             "writing_feedback": [_fb(1), _fb(2, parent=1), _fb(3, parent=2)]}
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        live = essay_service._ancestor_versions(EID)
        essay_service._gc_orphan_versions(EID, live)
        remaining = {r["version"] for r in store["writing_feedback"]}
    assert remaining == {1, 2}, "orphan v3 GC'd; kept versions 1+2 preserved"


def test_first_grade_empty_chain():
    store = {"writing_essays": [_essay(current_version=1)], "writing_feedback": []}
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        assert essay_service._ancestor_versions(EID) == set()
        assert essay_service.live_version_count(EID) == 0


# ── _bg_grade_essay versioned write ───────────────────────────────────


def _fake_grader_result(tier="standard", band=7.0):
    crit = SimpleNamespace(
        mainCriterion=SimpleNamespace(bandScore=band),
        coherenceCohesion=SimpleNamespace(bandScore=band),
        lexicalResource=SimpleNamespace(bandScore=band),
        grammaticalRange=SimpleNamespace(bandScore=band),
    )
    fb = SimpleNamespace(
        mistakeAnalysis=[], criteriaFeedback=crit, overallBandScore=band,
        model_dump=lambda mode="json": {"overallBandScore": band},
    )
    from models.writing_feedback import GradingTier
    return SimpleNamespace(
        feedback=fb, grading_tier=GradingTier.STANDARD, prompt_version="v2.1",
        model_used="gemini-2.5-pro", tokens_input=10, tokens_output=10, cost_usd=0.05,
        grading_duration_ms=100, tier_metadata={},
    )


def _run_bg(store, essay_id, job_id, band=7.0):
    """Drive _bg_grade_essay with the grader + history + helpers mocked so it
    reaches the versioned persist block deterministically."""
    fake = _FakeSB(store)
    class _Grader:
        async def grade_essay(self, cfg): return _fake_grader_result(band=band)
    with patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.get_grader", lambda: _Grader()), \
         patch("services.essay_service.get_recurring_patterns", lambda *a, **k: None), \
         patch("services.essay_service.get_band_trajectory", lambda *a, **k: None), \
         patch("services.essay_service.get_sentence_structure_history", lambda *a, **k: None), \
         patch("services.essay_service.validate_level_coverage", lambda *a, **k: None), \
         patch("services.essay_service.drop_noncorrection_mistakes", lambda m: (m, 0)), \
         patch("services.essay_service.overall_from_criteria", lambda *a, **k: band):
        from services import essay_service
        asyncio.run(essay_service._bg_grade_essay(essay_id, job_id))


def _seed_graded_essay():
    return {
        "writing_essays": [_essay(current_version=1, task_type="task2", prompt_text="p",
                                  prompt_image_url=None, essay_text="hello world", analysis_level=3,
                                  form_of_address="em", selected_model="gemini-2.5-pro",
                                  grading_tier="standard", student_id=str(uuid4()))],
        "writing_feedback": [_fb(1, band=6.0, job="job-v1")],
        "writing_jobs": [{"id": "job-v2"}],
    }


def test_regrade_creates_v2_keeps_v1_advances_pointer():
    store = _seed_graded_essay()
    _run_bg(store, EID, "job-v2", band=7.0)
    versions = {r["version"]: r for r in store["writing_feedback"]}
    assert set(versions) == {1, 2}, "v1 KEPT, v2 created (not overwritten)"
    assert versions[1]["overall_band_score"] == 6.0       # v1 intact (compare-able)
    assert versions[2]["overall_band_score"] == 7.0
    assert versions[2]["parent_version"] == 1
    assert store["writing_essays"][0]["current_version"] == 2   # advanced LAST


def test_job_id_idempotent_no_double_slot():
    store = _seed_graded_essay()
    _run_bg(store, EID, "job-v2", band=7.0)
    _run_bg(store, EID, "job-v2", band=7.0)   # re-invoke SAME job
    versions = [r["version"] for r in store["writing_feedback"]]
    assert sorted(versions) == [1, 2], "same job_id must NOT burn a 2nd slot"


def test_orphan_gc_reclaims_slot_on_next_regrade():
    # An advance-failed v2 (current still 1) is an orphan; next regrade GCs it and
    # reuses version 2 — budget not silently locked.
    store = _seed_graded_essay()
    store["writing_feedback"].append(_fb(2, parent=1, band=6.5, job="orphan"))  # current still 1
    store["writing_jobs"].append({"id": "job-v2b"})
    _run_bg(store, EID, "job-v2b", band=7.0)
    versions = {r["version"]: r for r in store["writing_feedback"]}
    assert set(versions) == {1, 2}, "orphan GC'd, slot 2 reused (not inflated to 3/4)"
    assert versions[2]["provenance"]["job_id"] == "job-v2b"
    assert store["writing_essays"][0]["current_version"] == 2


# ── static: D1 preserved + DELETE removed + overlay untouched ─────────


def test_regrade_endpoints_no_delete_and_keep_d1():
    import pathlib
    aw = (pathlib.Path(__file__).parent.parent / "routers" / "admin_writing.py").read_text()
    ins = (pathlib.Path(__file__).parent.parent / "routers" / "instructor.py").read_text()
    # No pre-DELETE of writing_feedback in the regrade flow (versions are kept).
    assert 'table("writing_feedback")\n            .delete()' not in aw and \
           'table("writing_feedback").delete()' not in ins, "regrade must NOT DELETE feedback (GV-1b)"
    # D1 bump preserved.
    assert "regrade_count" in aw and "last_regraded_by" in aw
    assert "regrade_count" in ins and "last_regraded_by" in ins
    # budget-check present.
    assert "live_version_count" in aw and "live_version_count" in ins


def test_overlay_675_untouched_gv1c():
    import pathlib
    es = (pathlib.Path(__file__).parent.parent / "services" / "essay_service.py").read_text()
    assert 'essay.get("admin_edits_json") or fr.data[0]["feedback_json"]' in es, \
        "the admin_edits_json render overlay must remain (GV-1c), so admin edits still show"
