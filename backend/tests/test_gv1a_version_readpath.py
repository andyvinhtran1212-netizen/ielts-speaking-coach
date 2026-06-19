"""GV-1a — version-aware READ-PATH tests.

Two halves:
  • A static GREP-GATE (acceptance): every current-band read of writing_feedback
    goes through the `writing_feedback_current` view (or the aliased view embed);
    only writers (.insert/.update/.delete) and documented SPEND-analytics reads
    may touch the base table; no bare PostgREST embed of the base table.
  • Behavioural tests on a VIEW-AWARE fake that seeds a multi-version essay
    (v1 band 6.0 / v2 band 7.0, current_version=2) and proves:
      A  current-band read → 7.0 (current), not 6.0/arbitrary;
      C  SPEND read → sums BOTH versions (all-versions total);
      D  deliver stamps ONLY the current version row.
"""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest


# ── GREP-GATE ─────────────────────────────────────────────────────────


def test_writing_feedback_read_path_gate():
    root = Path(__file__).parent.parent
    base_re = re.compile(r'table\(\s*["\']writing_feedback["\']\s*\)')
    embed_bare_re = re.compile(r'writing_feedback\(')          # embed of the BASE table
    writer_re = re.compile(r'\.(insert|update|delete)\s*\(')
    violations: list[str] = []
    for d in (root / "routers", root / "services"):
        for p in sorted(d.glob("*.py")):
            lines = p.read_text(encoding="utf-8").splitlines()
            for i, line in enumerate(lines):
                if base_re.search(line):
                    window = " ".join(lines[i:i + 4])         # writer kw may be on a following line
                    ctx = " ".join(lines[max(0, i - 3):i + 1])
                    if not (writer_re.search(window)
                            or "SPEND-analytics exception" in ctx
                            or "version-management" in ctx):   # GV-1b budget/orphan reads need ALL versions
                        violations.append(f"{p.name}:{i+1} base writing_feedback read not via view / not allowlisted")
                if embed_bare_re.search(line) and "writing_feedback_current(" not in line:
                    violations.append(f"{p.name}:{i+1} bare writing_feedback(...) embed — must embed the view")
    assert not violations, "GV-1a read-path gate failed:\n" + "\n".join(violations)


def test_view_embed_is_aliased_to_preserve_key():
    """The reverse embed keeps the `writing_feedback` JSON key (alias) so the
    existing dict-safe consumers (get_student_summary avg-band + admin students
    FE _bandFromEssay) need no change."""
    src = (Path(__file__).parent.parent / "services" / "essay_service.py").read_text(encoding="utf-8")
    assert "writing_feedback:writing_feedback_current(overall_band_score)" in src


# ── view-aware in-memory fake ─────────────────────────────────────────


class _Res:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, name, store):
        self.name, self.store = name, store
        self.op, self.payload, self.filters, self.limit_n, self.order = "select", None, [], None, None

    def select(self, *a, **k): self.op = "select"; return self
    def insert(self, p): self.op = "insert"; self.payload = p; return self
    def update(self, p): self.op = "update"; self.payload = p; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, c, v): self.filters.append(("eq", c, v)); return self
    def in_(self, c, vals): self.filters.append(("in", c, [str(x) for x in vals])); return self
    def is_(self, c, v): self.filters.append(("is", c, v)); return self
    def limit(self, n, *a, **k): self.limit_n = n; return self
    def order(self, c, desc=False, **k): self.order = (c, desc); return self

    def _source(self):
        # The view = rows of writing_feedback whose version == essay.current_version.
        if self.name == "writing_feedback_current":
            cv = {e["id"]: e.get("current_version", 1) for e in self.store.get("writing_essays", [])}
            return [r for r in self.store.get("writing_feedback", [])
                    if r.get("version", 1) == cv.get(r.get("essay_id"), 1)]
        return self.store.setdefault(self.name, [])

    def _match(self, r):
        for op, c, v in self.filters:
            rv = r.get(c)
            if op == "eq" and str(rv) != str(v): return False
            if op == "in" and str(rv) not in v: return False
            if op == "is" and v == "null" and rv is not None: return False
        return True

    def execute(self):
        if self.op == "insert":
            rows = self.store.setdefault(self.name, [])
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            created = [dict(it) for it in items]
            rows.extend(created)
            return _Res([dict(r) for r in created])
        src = self._source()
        matched = [r for r in src if self._match(r)]
        if self.op == "select":
            if self.order:
                c, desc = self.order
                matched = sorted(matched, key=lambda r: r.get(c) or "", reverse=desc)
            if self.limit_n is not None:
                matched = matched[:self.limit_n]
            return _Res([dict(r) for r in matched])
        if self.op == "update":
            for r in matched:        # matched are live refs into the base store
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
SID = str(uuid4())


def _multiversion_store():
    return {
        "writing_essays": [{
            "id": EID, "student_id": SID, "status": "delivered", "deleted_at": None,
            "current_version": 2, "task_type": "task2",
        }],
        "writing_feedback": [
            {"essay_id": EID, "version": 1, "overall_band_score": 6.0, "feedback_json": {"v": 1},
             "prompt_version": "v2.1", "tokens_input": 100, "tokens_output": 100, "cost_usd": 0.05},
            {"essay_id": EID, "version": 2, "overall_band_score": 7.0, "feedback_json": {"v": 2},
             "prompt_version": "v2.1", "tokens_input": 200, "tokens_output": 200, "cost_usd": 0.07},
        ],
        "students": [{"id": SID, "student_code": "S1", "full_name": "S", "target_band": 7}],
    }


# ── A — current-band read returns the CURRENT version ─────────────────


def test_branchA_get_essay_with_feedback_returns_current_version():
    store = _multiversion_store()
    with patch("services.essay_service.supabase_admin", _FakeSB(store)):
        from services import essay_service
        out = essay_service.get_essay_with_feedback(EID)
    assert out["feedback"]["overall_band_score"] == 7.0, "must read current version (v2), not v1/arbitrary"
    assert out["feedback"]["version"] == 2


# ── C — SPEND read stays on base = ALL versions ───────────────────────


@pytest.mark.asyncio
async def test_branchC_spend_metric_sums_all_versions():
    inst = str(uuid4())
    store = _multiversion_store()
    store["users"] = [{"id": inst, "email": "i@x.io", "display_name": "I", "role": "instructor"}]
    store["writing_prompts"] = []
    store["writing_assignments"] = [{"id": str(uuid4()), "assigned_by": inst, "essay_id": EID}]
    store["students"][0]["instructor_id"] = inst
    fake = _FakeSB(store)
    from routers import admin_instructors
    with patch("routers.admin_instructors.supabase_admin", fake), \
         patch("services.instructor_access.supabase_admin", fake), \
         patch.object(admin_instructors, "require_admin", new=AsyncMock(return_value={"id": "adm"})):
        out = await admin_instructors.list_instructor_metrics(authorization="Bearer x")
    row = next(r for r in out if r["instructor_id"] == inst)
    # tokens = (100+100) + (200+200) = 600 across BOTH versions; cost = 0.05+0.07 = 0.12
    assert row["tokens"] == 600, "SPEND must sum ALL versions (total spend), not just current"
    assert row["cost_usd"] == pytest.approx(0.12)


# ── D — deliver stamps ONLY the current version ───────────────────────


def test_branchD_deliver_stamps_only_current_version():
    store = _multiversion_store()
    # make v2 the pending one so the stamp actually changes
    store["writing_feedback"][1]["prompt_version"] = "v2.1-instructor-pending"
    rid = str(uuid4())
    inst = str(uuid4())
    store["instructor_reviews"] = [{
        "id": rid, "essay_id": EID, "status": "claimed", "claimed_by": inst,
        "created_at": "2026-01-01", "updated_at": "2026-01-01",
    }]
    with patch("services.instructor_workflow.supabase_admin", _FakeSB(store)):
        from services import instructor_workflow
        instructor_workflow.deliver(rid, inst, instructor_note="ok")
    by_v = {r["version"]: r for r in store["writing_feedback"]}
    assert by_v[2]["prompt_version"] == "v2.1-instructor", "current version (v2) must be stamped"
    assert by_v[1]["prompt_version"] == "v2.1", "v1 must NOT be stamped (no all-version stamp)"
