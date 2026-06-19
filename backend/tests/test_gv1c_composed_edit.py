"""GV-1c — admin edit → composed-version; admin_edits_json retired.

Pins:
  • upsert_composed_version: edit on an AI-current → CREATE composed (AI version
    immutable) + advance; edit on a composed-current → UPDATE in-place (no new
    slot); 3 live + AI-current → 409.
  • composed row carries the edited bands (extracted from the model).
  • single source of truth: NO functional admin_edits_json reader remains (BE+FE).
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest

from models.writing_feedback import WritingFeedback


# ── valid WritingFeedback builder ─────────────────────────────────────


def _feedback(overall=7.0, crit=7):
    return WritingFeedback(**{
        "overallBandScore": overall,
        "overallBandScoreSummary": "edit",
        "keyTakeaways": {"strengths": ["s"], "areasForImprovement": ["a"]},
        "criteriaFeedback": {
            "mainCriterion":     {"title": "T", "explanation": "x", "feedback": "y", "bandScore": crit},
            "coherenceCohesion": {"title": "T", "explanation": "x", "feedback": "y", "bandScore": crit},
            "lexicalResource":   {"title": "T", "explanation": "x", "feedback": "y", "bandScore": crit},
            "grammaticalRange":  {"title": "T", "explanation": "x", "feedback": "y", "bandScore": crit},
        },
        "mistakeAnalysis": [],
        "aiContentAnalysis": {"likelihood": 5, "explanation": "n"},
        "improvedEssay": "imp",
    })


# ── version-aware fake ────────────────────────────────────────────────


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


def _store(versions):
    """versions: list of (version, source, parent, band). current = max version."""
    cur = max(v[0] for v in versions) if versions else 1
    return {
        "writing_essays": [{"id": EID, "current_version": cur}],
        "writing_feedback": [
            {"essay_id": EID, "version": v, "source": s, "parent_version": p,
             "overall_band_score": b, "feedback_json": {"v": v}}
            for (v, s, p, b) in versions
        ],
    }


# ── upsert_composed_version ───────────────────────────────────────────


def test_edit_on_ai_current_creates_composed_and_advances():
    store = _store([(1, "ai_pro", None, 6.0)])
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        v = essay_service.upsert_composed_version(EID, _feedback(overall=7.0, crit=7), edited_by="adm")
    assert v == 2
    by_v = {r["version"]: r for r in store["writing_feedback"]}
    # v1 AI is IMMUTABLE — untouched
    assert by_v[1]["source"] == "ai_pro" and by_v[1]["overall_band_score"] == 6.0
    # v2 composed carries the edited bands
    assert by_v[2]["source"] == "composed"
    assert by_v[2]["overall_band_score"] == 7.0
    assert by_v[2]["band_main_criterion"] == 7.0
    assert by_v[2]["parent_version"] == 1
    assert store["writing_essays"][0]["current_version"] == 2   # advanced


def test_reedit_on_composed_current_updates_in_place():
    store = _store([(1, "ai_pro", None, 6.0), (2, "composed", 1, 7.0)])
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        v = essay_service.upsert_composed_version(EID, _feedback(overall=7.5, crit=8), edited_by="adm")
    assert v == 2, "re-edit must reuse the composed version (no new slot)"
    assert len(store["writing_feedback"]) == 2, "no new version row"
    by_v = {r["version"]: r for r in store["writing_feedback"]}
    assert by_v[2]["overall_band_score"] == 7.5          # updated in-place
    assert by_v[2]["band_main_criterion"] == 8.0
    assert store["writing_essays"][0]["current_version"] == 2


def test_edit_on_ai_current_at_budget_full_409():
    from fastapi import HTTPException
    store = _store([(1, "ai_pro", None, 6.0), (2, "ai_pro", 1, 6.5), (3, "ai_pro", 2, 7.0)])
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        with pytest.raises(HTTPException) as exc:
            essay_service.upsert_composed_version(EID, _feedback(), edited_by="adm")
    assert exc.value.status_code == 409
    assert len(store["writing_feedback"]) == 3, "no 4th version created"


def test_bands_extracted_from_model():
    from services import essay_service
    bands = essay_service._bands_from_feedback(_feedback(overall=6.5, crit=7))
    assert bands == {
        "overall_band_score": 6.5, "band_main_criterion": 7.0,
        "band_coherence_cohesion": 7.0, "band_lexical_resource": 7.0,
        "band_grammatical_range": 7.0,
    }


# ── single source of truth: no admin_edits_json reader remains ────────


def test_no_functional_admin_edits_json_reader_backend():
    root = Path(__file__).parent.parent
    for rel in ("services/essay_service.py", "routers/admin_writing.py", "routers/instructor.py"):
        src = (root / rel).read_text(encoding="utf-8")
        assert '.get("admin_edits_json")' not in src, f"{rel} still reads admin_edits_json"
        assert 'admin_edits_json"]' not in src, f"{rel} still indexes admin_edits_json"
        # no functional WRITE either (only comments may mention the dead column)
        assert '"admin_edits_json":' not in src, f"{rel} still writes admin_edits_json"


def test_no_admin_edits_json_reader_frontend():
    fe = (Path(__file__).parent.parent.parent / "frontend" / "pages" / "admin"
          / "writing" / "grade.html").read_text(encoding="utf-8")
    assert "detail.admin_edits_json" not in fe, "grade.html still reads detail.admin_edits_json"
    assert "_adminEdits" not in fe, "grade.html still references the retired _adminEdits"
