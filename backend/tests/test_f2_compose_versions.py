"""F2 PR-1 (BE) — compare-versions + commit-mix ($0).

Pins (service level; route auth/isolation is covered by test_instructor_routes_isolation):
  • get_live_versions → lineage (current + ancestors) compare-shape, newest first.
  • compose_version: per-criterion pick copies the WHOLE sub-object from ONE
    version; overall recomputed (IELTS) from the 4 picked bands; non-criteria
    base-derived; reuses upsert (AI immutable, advance, budget). provenance =
    {block_sources, base_version, mixed_by, mixed_at}.
  • re-mix on a composed current → in-place (no new slot).
  • 3 AI live + AI-current → compose needs slot-4 → 409 (Option A).
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest


# ── version-aware fake ────────────────────────────────────────────────


class _Res:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, name, store):
        self.name, self.store = name, store
        self.op, self.payload, self.filters, self.in_f, self.limit_n = "select", None, [], [], None

    def select(self, *a, **k): self.op = "select"; return self
    def insert(self, p): self.op = "insert"; self.payload = p; return self
    def update(self, p): self.op = "update"; self.payload = p; return self
    def eq(self, c, v): self.filters.append((c, v)); return self
    def in_(self, c, vals): self.in_f.append((c, [str(x) for x in vals])); return self
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
            if isinstance(v, tuple) and v and v[0] == "__is__":
                if v[1] == "null" and r.get(c) is not None:
                    return False
            elif str(r.get(c)) != str(v):
                return False
        for c, vals in self.in_f:
            if str(r.get(c)) not in vals:
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
        return _Res([])


class _FakeSB:
    def __init__(self, store): self.store = store
    def table(self, name): return _Q(name, self.store)


EID = str(uuid4())


def _fj(v, bands):
    """A valid WritingFeedback dict with per-criterion feedback tagged by version."""
    tr, cc, lr, gra = bands
    crit = lambda key, b: {"title": "T", "explanation": "e", "feedback": f"{key}-v{v}", "bandScore": b}
    return {
        "overallBandScore": 6.0,
        "overallBandScoreSummary": f"summary-v{v}",
        "keyTakeaways": {"strengths": ["s"], "areasForImprovement": ["a"]},
        "criteriaFeedback": {
            "mainCriterion":     crit("tr", tr),
            "coherenceCohesion": crit("cc", cc),
            "lexicalResource":   crit("lr", lr),
            "grammaticalRange":  crit("gra", gra),
        },
        "mistakeAnalysis": [],
        "aiContentAnalysis": {"likelihood": 5, "explanation": "n"},
        "improvedEssay": f"improved-v{v}",
    }


def _store(versions):
    """versions: list of (version, source, parent, bands4). current = max version."""
    cur = max(v[0] for v in versions)
    return {
        "writing_essays": [{"id": EID, "current_version": cur}],
        "writing_feedback": [
            {"essay_id": EID, "version": v, "source": s, "parent_version": p,
             "overall_band_score": 6.0, "feedback_json": _fj(v, bands)}
            for (v, s, p, bands) in versions
        ],
    }


# ── get_live_versions ─────────────────────────────────────────────────


def test_get_live_versions_returns_lineage_compare_shape():
    store = _store([(1, "ai_pro", None, (6, 6, 6, 6)), (2, "ai_pro", 1, (7, 7, 7, 7))])
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        out = essay_service.get_live_versions(EID)
    assert [r["version"] for r in out] == [2, 1]                 # newest first
    assert out[0]["source"] == "ai_pro"
    assert out[0]["criteriaFeedback"]["grammaticalRange"]["bandScore"] == 7
    assert "feedback_json" not in out[0]                          # compare-shape only


# ── compose_version ───────────────────────────────────────────────────


def test_compose_picks_whole_subobject_and_recomputes_overall():
    # v1 all-6, v2 all-7. Mix: TR/CC/LR from v2, GRA from v1. base=v2.
    store = _store([(1, "ai_pro", None, (6, 6, 6, 6)), (2, "ai_pro", 1, (7, 7, 7, 7))])
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        v = essay_service.compose_version(
            EID, base_version=2,
            picks={"mainCriterion": 2, "coherenceCohesion": 2,
                   "lexicalResource": 2, "grammaticalRange": 1},
            mixed_by="gv-A")
    assert v == 3                                               # composed slot-3
    row = next(r for r in store["writing_feedback"] if r["version"] == 3)
    assert row["source"] == "composed" and row["parent_version"] == 2
    assert store["writing_essays"][0]["current_version"] == 3   # advanced
    cf = row["feedback_json"]["criteriaFeedback"]
    # GRA = the WHOLE sub-object from v1 (band + feedback together)
    assert cf["grammaticalRange"]["bandScore"] == 6
    assert cf["grammaticalRange"]["feedback"] == "gra-v1"
    # TR = from v2
    assert cf["mainCriterion"]["bandScore"] == 7
    assert cf["mainCriterion"]["feedback"] == "tr-v2"
    # overall recomputed: mean(7,7,7,6)=6.75 → IELTS round-half-up → 7.0
    assert row["overall_band_score"] == 7.0
    assert row["feedback_json"]["overallBandScore"] == 7.0
    # non-criteria base-derived (from v2)
    assert row["feedback_json"]["improvedEssay"] == "improved-v2"
    # provenance
    prov = row["provenance"]
    assert prov["block_sources"]["grammaticalRange"] == 1
    assert prov["block_sources"]["mainCriterion"] == 2
    assert prov["base_version"] == 2
    assert prov["mixed_by"] == "gv-A" and prov["mixed_at"]


def test_remix_on_composed_current_is_in_place():
    store = _store([(1, "ai_pro", None, (6, 6, 6, 6)),
                    (2, "ai_pro", 1, (7, 7, 7, 7)),
                    (3, "composed", 2, (7, 7, 7, 6))])
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        v = essay_service.compose_version(
            EID, base_version=2,
            picks={"mainCriterion": 1, "coherenceCohesion": 1,
                   "lexicalResource": 1, "grammaticalRange": 1},
            mixed_by="gv-A")
    assert v == 3, "re-mix updates the composed current in-place"
    assert len([r for r in store["writing_feedback"]]) == 3, "no new slot"
    row = next(r for r in store["writing_feedback"] if r["version"] == 3)
    assert row["overall_band_score"] == 6.0                     # mean(6,6,6,6)=6.0


def test_compose_at_budget_full_409():
    from fastapi import HTTPException
    store = _store([(1, "ai_pro", None, (6, 6, 6, 6)),
                    (2, "ai_pro", 1, (6, 6, 6, 7)),
                    (3, "ai_pro", 2, (7, 7, 7, 7))])           # 3 AI live, current AI
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        with pytest.raises(HTTPException) as exc:
            essay_service.compose_version(
                EID, base_version=3,
                picks={"mainCriterion": 3, "coherenceCohesion": 2,
                       "lexicalResource": 1, "grammaticalRange": 3},
                mixed_by="gv-A")
    assert exc.value.status_code == 409
    assert len(store["writing_feedback"]) == 3, "no slot-4 created"


def test_compose_rejects_version_outside_lineage():
    from fastapi import HTTPException
    store = _store([(1, "ai_pro", None, (6, 6, 6, 6)), (2, "ai_pro", 1, (7, 7, 7, 7))])
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        with pytest.raises(HTTPException) as exc:
            essay_service.compose_version(
                EID, base_version=2,
                picks={"mainCriterion": 9, "coherenceCohesion": 2,   # v9 not live
                       "lexicalResource": 2, "grammaticalRange": 1},
                mixed_by="gv-A")
    assert exc.value.status_code == 409
