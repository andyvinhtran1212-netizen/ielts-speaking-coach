"""Schema-aware guard for the composed writing_feedback INSERT (prod 500, code
23502). FakeSupabase doesn't enforce NOT NULL, so GV-1c/F2's
upsert_composed_version INSERT shipped omitting prompt_version + model_used
(both NOT NULL, no default) and 500'd on real Postgres for every admin first-edit.

This test parses the NOT-NULL-no-default columns of writing_feedback straight
from the migrations and asserts the row upsert_composed_version actually INSERTs
covers them — catching prompt_version/model_used now AND any future NOT-NULL
column, on a mock (column-set compare, no live PG needed).
"""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from models.writing_feedback import WritingFeedback

_MIG = Path(__file__).parent.parent / "migrations"


# ── parse required (NOT NULL, no DEFAULT) columns of writing_feedback ──


def _required_columns() -> set[str]:
    sql = (_MIG / "033_writing_coach_tables.sql").read_text(encoding="utf-8")
    m = re.search(r"CREATE TABLE[^(]*writing_feedback\s*\((.*?)\n\)\s*;", sql, re.DOTALL | re.IGNORECASE)
    assert m, "writing_feedback CREATE TABLE block not found in migration 033"
    required: set[str] = set()
    for raw in m.group(1).splitlines():
        line = raw.strip().rstrip(",")
        if not line or line.startswith("--"):
            continue
        up = line.upper()
        if any(up.startswith(k) for k in ("CONSTRAINT", "PRIMARY", "FOREIGN", "CHECK", "UNIQUE", "REFERENCES")):
            continue
        col = re.match(r"([a-zA-Z_][a-zA-Z0-9_]*)", line)
        if col and "NOT NULL" in up and "DEFAULT" not in up:
            required.add(col.group(1).lower())
    # later ALTER ... ADD COLUMN ... NOT NULL without DEFAULT (future-proof; mig109's
    # version has a DEFAULT so it's excluded).
    for p in _MIG.glob("*.sql"):
        for line in p.read_text(encoding="utf-8").splitlines():
            am = re.search(r"ALTER TABLE\s+writing_feedback\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_]+)", line, re.IGNORECASE)
            if am and "NOT NULL" in line.upper() and "DEFAULT" not in line.upper():
                required.add(am.group(1).lower())
    return required


def test_required_columns_include_the_two_that_broke_prod():
    req = _required_columns()
    # sanity that the parser found the real NOT-NULL set
    assert {"essay_id", "overall_band_score", "feedback_json", "prompt_version", "model_used"} <= req


# ── recording fake + drive upsert_composed_version ────────────────────


class _Res:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, name, store, captured):
        self.name, self.store, self.captured = name, store, captured
        self.op, self.payload, self.filters = "select", None, []

    def select(self, *a, **k): self.op = "select"; return self
    def insert(self, p): self.op = "insert"; self.payload = p; return self
    def update(self, p): self.op = "update"; self.payload = p; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, c, v): self.filters.append((c, v)); return self
    def in_(self, c, vals): self.filters.append((c, ("__in__", [str(x) for x in vals]))); return self
    def is_(self, c, v): return self
    def limit(self, *a, **k): return self
    def order(self, *a, **k): return self

    def _match(self, r):
        for c, v in self.filters:
            if isinstance(v, tuple) and v[0] == "__in__":
                if str(r.get(c)) not in v[1]:
                    return False
            elif str(r.get(c)) != str(v):
                return False
        return True

    def execute(self):
        rows = self.store.setdefault(self.name, [])
        if self.op == "insert":
            if self.name == "writing_feedback":
                self.captured.append(dict(self.payload))   # record the composed INSERT
            rows.append(dict(self.payload))
            return _Res([dict(self.payload)])
        matched = [r for r in rows if self._match(r)]
        if self.op == "select":
            return _Res([dict(r) for r in matched])
        if self.op == "update":
            for r in rows:
                if self._match(r):
                    r.update(self.payload)
            return _Res([dict(r) for r in matched])
        if self.op == "delete":
            self.store[self.name] = [r for r in rows if not self._match(r)]
            return _Res([])
        return _Res([])


class _FakeSB:
    def __init__(self, store, captured):
        self.store, self.captured = store, captured
    def table(self, name): return _Q(name, self.store, self.captured)


def _feedback():
    crit = lambda b: {"title": "T", "explanation": "e", "feedback": "f", "bandScore": b}
    return WritingFeedback(**{
        "overallBandScore": 6.5, "overallBandScoreSummary": "s",
        "keyTakeaways": {"strengths": ["s"], "areasForImprovement": ["a"]},
        "criteriaFeedback": {"mainCriterion": crit(7), "coherenceCohesion": crit(6),
                             "lexicalResource": crit(7), "grammaticalRange": crit(6)},
        "mistakeAnalysis": [], "aiContentAnalysis": {"likelihood": 5, "explanation": "n"},
        "improvedEssay": "x",
    })


def test_composed_insert_sets_all_notnull_columns():
    """The exact prod scenario: a LEGACY current row (source=NULL, version=1) →
    upsert mints a composed version → the INSERT must cover every NOT-NULL column."""
    eid = str(uuid4())
    store = {
        "writing_essays": [{"id": eid, "current_version": 1}],
        "writing_feedback": [{
            "essay_id": eid, "version": 1, "source": None, "parent_version": None,
            "prompt_version": "v2.1", "model_used": "gemini-2.5-pro",
        }],
    }
    captured: list = []
    with patch("services.essay_service.supabase_admin", _FakeSB(store, captured)):
        from services import essay_service
        essay_service.upsert_composed_version(eid, _feedback(), edited_by="adm")

    assert captured, "composed version must be INSERTed"
    row_keys = set(captured[0].keys())
    missing = _required_columns() - row_keys
    assert not missing, f"composed INSERT missing NOT-NULL columns → 23502 on prod: {missing}"
    # the two that broke prod, with sensible values
    assert captured[0]["prompt_version"] == "v2.1-composed"   # inherited + stamped
    assert captured[0]["model_used"] == "composed"            # no AI call
