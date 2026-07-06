"""tests/test_listening_audit.py — listening content audit engine + GET endpoint.

The audit engine is PURE (rows in → issues out). We build realistic rows from
the real drill fixtures via listening_drill_import.parse_drill (same payload
shape the importer persists), assert a clean test flags nothing, then inject
each defect and assert exactly that check fires.
"""

from __future__ import annotations

import asyncio
import copy
import json
import pathlib

import pytest
from fastapi import HTTPException, UploadFile
import io

from services import listening_audit as audit
from services import listening_drill_import as drill
from routers import listening as listening_module

_FIX = pathlib.Path(__file__).parent / "fixtures" / "drills"


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _drill(code: str):
    sj = json.loads((_FIX / f"ILR-LIS-DRL-{code}-L2-T1.json").read_text(encoding="utf-8"))
    tp = _FIX / f"ILR-LIS-DRL-{code}-L2-T1.timings.json"
    tim = json.loads(tp.read_text(encoding="utf-8")) if tp.exists() else None
    return drill.parse_drill(sj, tim)


def _rows(code: str, *, full_dur=400, transcript_ok=True):
    """Build (test, contents, exercises) DB-shaped rows from a drill fixture."""
    res = _drill(code)
    test = {
        "id": "t-uuid", "test_id": f"ILR-LIS-DRL-{code}-L2-T1", "status": "published",
        "metadata": res.test_metadata["metadata"],
        "full_audio_storage_path": "drills/x/full.mp3",
        "full_audio_duration_seconds": full_dur,
    }
    content = dict(res.content_row)
    content["id"] = "c-uuid"
    content["test_id"] = "t-uuid"
    content["audio_duration_seconds"] = full_dur
    if not transcript_ok:
        content["transcript"] = ""
    exercises = []
    for i, ex in enumerate(res.exercise_rows):
        exercises.append({"id": f"ex-{i}", "content_id": "c-uuid",
                          "exercise_type": ex["exercise_type"], "order_num": ex["order_num"],
                          "payload": copy.deepcopy(ex["payload"])})
    return test, [content], exercises


def _hydrate(code: str, **kw):
    t, c, e = _rows(code, **kw)
    return audit.hydrate_test(t, c, e), (t, c, e)


def _errs(issues):
    return [i for i in issues if i["severity"] == "error"]


# ── hydrate ────────────────────────────────────────────────────────────────

def test_hydrate_assembles_questions():
    h, _ = _hydrate("MCQ")
    assert h["test_type"] == "drill"
    assert len(h["sections"]) == 1
    assert len(h["all_questions"]) == 10
    q1 = next(q for q in h["all_questions"] if q["q_num"] == 1)
    assert q1["template_kind"] == "mcq_3option"
    assert q1["answer"]
    assert q1["audio_window"] and q1["audio_window"]["end"] > q1["audio_window"]["start"]


# ── structural: clean fixtures flag nothing (per type) ─────────────────────

@pytest.mark.parametrize("code", ["MCQ", "FORM", "NOTE", "TABLE", "MAP", "MATCH", "SUMM"])
def test_clean_drill_has_no_structural_errors(code):
    # MAP/MATCH/etc have no timings fixture → windows absent → expected timeline
    # errors; restrict the "clean" claim to non-timeline dims for those.
    h, _ = _hydrate(code)
    issues = audit.structural_checks(h)
    non_timeline_errs = [i for i in _errs(issues) if i["dimension"] != "timeline"]
    assert not non_timeline_errs, (code, non_timeline_errs)


def test_mcq_with_timings_fully_clean():
    h, _ = _hydrate("MCQ")  # MCQ has a timings fixture → windows present
    issues = audit.structural_checks(h) + audit.audio_bounds_checks(h)
    assert not _errs(issues), _errs(issues)


# ── structural: inject each defect ─────────────────────────────────────────

def test_missing_answer_flagged():
    t, c, e = _rows("MCQ")
    e[0]["payload"]["answers"][0]["answer"] = ""
    h = audit.hydrate_test(t, c, e)
    codes = {i["code"] for i in audit.structural_checks(h)}
    assert "no_answer" in codes


def test_gap_in_qnums_flagged():
    t, c, e = _rows("MCQ")
    # drop q_num 3 from questions + answers
    for key in ("questions", "answers"):
        e[0]["payload"][key] = [x for x in e[0]["payload"][key]
                                if int(str(x["q_num"])) != 3]
    e[0]["payload"]["audio_windows"].pop("3", None)
    h = audit.hydrate_test(t, c, e)
    codes = {i["code"] for i in audit.structural_checks(h)}
    assert "gap" in codes


def test_missing_and_bad_window_flagged():
    t, c, e = _rows("MCQ")
    e[0]["payload"]["audio_windows"]["1"] = {"start": 50, "end": 40, "section": "S3"}  # end<=start
    e[0]["payload"]["audio_windows"].pop("2", None)                                    # missing
    h = audit.hydrate_test(t, c, e)
    codes = {i["code"] for i in audit.structural_checks(h)}
    assert "bad_window" in codes and "no_window" in codes


def test_unknown_template_flagged():
    t, c, e = _rows("MCQ")
    e[0]["payload"]["template_kind"] = "totally_made_up"
    h = audit.hydrate_test(t, c, e)
    assert "unknown_template" in {i["code"] for i in audit.structural_checks(h)}


def test_mcq_missing_options_flagged():
    t, c, e = _rows("MCQ")
    for q in e[0]["payload"]["questions"]:
        q.pop("options", None)
    h = audit.hydrate_test(t, c, e)
    assert "no_options" in {i["code"] for i in audit.structural_checks(h)}


def test_empty_transcript_flagged():
    h, _ = _hydrate("MCQ", transcript_ok=False)
    assert "no_transcript" in {i["code"] for i in audit.structural_checks(h)}


# ── audio bounds ───────────────────────────────────────────────────────────

def test_no_audio_flagged():
    t, c, e = _rows("MCQ")
    t["full_audio_storage_path"] = None
    t["full_audio_duration_seconds"] = None
    for cc in c:
        cc["audio_duration_seconds"] = None
    h = audit.hydrate_test(t, c, e)
    assert "no_audio" in {i["code"] for i in audit.audio_bounds_checks(h)}


def test_window_past_end_flagged():
    # MCQ windows reach ~273s; a 120s audio makes them overrun.
    h, _ = _hydrate("MCQ", full_dur=120)
    assert "window_past_end" in {i["code"] for i in audit.audio_bounds_checks(h)}


# ── LLM audit parsing ──────────────────────────────────────────────────────

def test_parse_llm_audit_valid():
    raw = 'noise [{"q_num":3,"code":"answer_in_script","severity":"error","message":"đáp án không có trong script"}] tail'
    out = audit.parse_llm_audit(raw)
    assert len(out) == 1 and out[0]["q_num"] == 3 and out[0]["severity"] == "error"
    assert out[0]["dimension"] == "solution"


def test_parse_llm_audit_garbage_is_inconclusive():
    out = audit.parse_llm_audit("the model refused to answer")
    assert out and out[0]["code"] == "audit_inconclusive" and out[0]["severity"] == "warning"


# ── GET endpoint ───────────────────────────────────────────────────────────

class _AuditGetStub:
    """Serves listening_tests/content/exercises + an empty listening_audit."""
    def __init__(self, test, contents, exercises):
        self._data = {"listening_tests": [test], "listening_content": contents,
                      "listening_exercises": exercises, "listening_audit": []}
    def table(self, name): self._t = name; return self
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return type("R", (), {"data": self._data.get(self._t, [])})()


def test_get_audit_endpoint(monkeypatch):
    async def _ok(_a): return {"id": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    t, c, e = _rows("MCQ")
    t["id"] = "t-uuid"
    monkeypatch.setattr(listening_module, "supabase_admin", _AuditGetStub(t, c, e))
    out = _run(listening_module.admin_get_test_audit(test_id="t-uuid", authorization="x"))
    assert out["question_count"] == 10
    assert out["live"]["health"]["status"] == "passed"
    assert out["saved"] is None


def test_get_audit_requires_admin(monkeypatch):
    async def _deny(_a): raise HTTPException(403, "no")
    monkeypatch.setattr(listening_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as ex:
        _run(listening_module.admin_get_test_audit(test_id="x", authorization=None))
    assert ex.value.status_code == 403


# ── per-question in-place edit (PATCH exercises/{id}/questions/{q}) ─────────

class _EditStub:
    """Serves exercise/content/test for the edit ctx + captures the payload
    written back on update."""
    def __init__(self, ex, content, test):
        self._rows = {"listening_exercises": [ex], "listening_content": [content],
                      "listening_tests": [test]}
        self.updated_payload = None
    def table(self, name): self._t = name; return self
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def update(self, patch): self.updated_payload = patch.get("payload"); return self
    def execute(self): return type("R", (), {"data": self._rows.get(self._t, [])})()


def _edit_ctx(code="MCQ"):
    t, c, e = _rows(code)
    ex = e[0]
    ex["content_id"] = c[0]["id"]
    return ex, c[0], t


def _patch(monkeypatch, exercise_id, q_num, body, stub):
    from routers.listening import QuestionEditRequest
    async def _ok(_a): return {"id": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    return _run(listening_module.admin_edit_exercise_question(
        exercise_id=exercise_id, q_num=q_num,
        body=QuestionEditRequest(**body), authorization="x"))


def test_edit_answer_and_solution(monkeypatch):
    ex, c, t = _edit_ctx()
    stub = _EditStub(ex, c, t)
    out = _patch(monkeypatch, ex["id"], 1,
                 {"answer": "Z", "solution": "vì trong script nói Z", "alternatives": ["z"]}, stub)
    assert "answer" in out["changed"] and "solution" in out["changed"]
    # payload written back with the new answer + notes + solutions.why_correct
    ans1 = next(a for a in stub.updated_payload["answers"] if int(str(a["q_num"])) == 1)
    assert ans1["answer"] == "Z" and ans1["notes"] == "vì trong script nói Z"
    assert stub.updated_payload["solutions"]["1"]["why_correct"] == "vì trong script nói Z"
    assert stub.updated_payload["solutions"]["1"]["answer"] == "Z"


def test_edit_audio_window(monkeypatch):
    ex, c, t = _edit_ctx()
    stub = _EditStub(ex, c, t)
    out = _patch(monkeypatch, ex["id"], 2, {"audio_window": {"start": 10, "end": 25}}, stub)
    assert "audio_window" in out["changed"]
    assert stub.updated_payload["audio_windows"]["2"] == {"start": 10.0, "end": 25.0, "section": "S3"}
    assert out["ok"] is True


def test_edit_bad_window_rejected(monkeypatch):
    ex, c, t = _edit_ctx()
    stub = _EditStub(ex, c, t)
    with pytest.raises(HTTPException) as e:
        _patch(monkeypatch, ex["id"], 2, {"audio_window": {"start": 30, "end": 20}}, stub)
    assert e.value.status_code == 422


def test_edit_unknown_qnum_404(monkeypatch):
    ex, c, t = _edit_ctx()
    stub = _EditStub(ex, c, t)
    with pytest.raises(HTTPException) as e:
        _patch(monkeypatch, ex["id"], 999, {"answer": "X"}, stub)
    assert e.value.status_code == 404


def test_edit_recheck_clears_issue(monkeypatch):
    # break Q1's window in the stored payload, then fix it via PATCH → issue clears
    ex, c, t = _edit_ctx()
    ex["payload"]["audio_windows"]["1"] = {"start": 50, "end": 40, "section": "S3"}
    stub = _EditStub(ex, c, t)
    out = _patch(monkeypatch, ex["id"], 1, {"audio_window": {"start": 40, "end": 55}}, stub)
    assert out["ok"] is True
    assert not [i for i in out["issues"] if i["severity"] == "error"]


def test_edit_nothing_to_change_422(monkeypatch):
    ex, c, t = _edit_ctx()
    stub = _EditStub(ex, c, t)
    with pytest.raises(HTTPException) as e:
        _patch(monkeypatch, ex["id"], 1, {}, stub)
    assert e.value.status_code == 422


# ── POST audit/run + PATCH triage ───────────────────────────────────────────

class _AuditRunStub:
    def __init__(self, test, contents, exercises, existing_audit=None):
        self._data = {"listening_tests": [test], "listening_content": contents,
                      "listening_exercises": exercises,
                      "listening_audit": [existing_audit] if existing_audit else []}
        self.inserted = None
        self.updated = None
    def table(self, name): self._t = name; return self
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def insert(self, row): self.inserted = row; return self
    def update(self, patch): self.updated = patch; return self
    def execute(self): return type("R", (), {"data": self._data.get(self._t, [])})()


class _FakeProvider:
    def __init__(self, raw=None, exc=None): self._raw = raw; self._exc = exc
    async def invoke(self, system, user, **kw):
        if self._exc: raise self._exc
        return self._raw


def test_audit_run_persists_with_llm(monkeypatch):
    async def _ok(_a): return {"id": "admin-1"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    t, c, e = _rows("MCQ"); t["id"] = "t-uuid"
    stub = _AuditRunStub(t, c, e)
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    monkeypatch.setattr(listening_module, "_audit_provider",
                        lambda: _FakeProvider(raw='[{"q_num":4,"code":"answer_in_script","severity":"error","message":"đáp án không thấy trong script"}]'))
    out = _run(listening_module.admin_run_test_audit(test_id="t-uuid", authorization="x"))
    # structural clean + 1 LLM error → has_issues, persisted via INSERT
    assert out["status"] == "has_issues"
    assert any(i["code"] == "answer_in_script" and i["q_num"] == 4 for i in out["issues"])
    assert stub.inserted is not None and stub.inserted["test_id"] == "t-uuid"
    assert stub.inserted["health"]["llm_model"]


def test_audit_run_llm_skipped_when_no_provider(monkeypatch):
    async def _ok(_a): return {"id": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    t, c, e = _rows("MCQ"); t["id"] = "t-uuid"
    stub = _AuditRunStub(t, c, e)
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    monkeypatch.setattr(listening_module, "_audit_provider", lambda: None)
    out = _run(listening_module.admin_run_test_audit(test_id="t-uuid", authorization="x"))
    assert any(i["code"] == "llm_skipped" for i in out["issues"])
    # structural clean + only a warning → passed
    assert out["status"] == "passed"


def test_audit_run_llm_error_is_inconclusive(monkeypatch):
    async def _ok(_a): return {"id": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    t, c, e = _rows("MCQ"); t["id"] = "t-uuid"
    stub = _AuditRunStub(t, c, e)
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    monkeypatch.setattr(listening_module, "_audit_provider",
                        lambda: _FakeProvider(exc=RuntimeError("boom")))
    out = _run(listening_module.admin_run_test_audit(test_id="t-uuid", authorization="x"))
    assert any(i["code"] == "audit_inconclusive" for i in out["issues"])


def test_audit_triage_updates_status_and_resolves(monkeypatch):
    from routers.listening import AuditTriageRequest
    async def _ok(_a): return {"id": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    existing = {"test_id": "t-uuid", "status": "has_issues",
                "issues": [{"q_num": 1, "code": "x", "severity": "error", "resolved": False},
                           {"q_num": 2, "code": "y", "severity": "error", "resolved": False}]}
    t, c, e = _rows("MCQ"); t["id"] = "t-uuid"
    stub = _AuditRunStub(t, c, e, existing_audit=existing)
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    out = _run(listening_module.admin_triage_test_audit(
        test_id="t-uuid", body=AuditTriageRequest(status="fixed", notes="đã sửa Q1", resolved_indexes=[0]),
        authorization="x"))
    assert stub.updated["status"] == "fixed"
    assert stub.updated["issues"][0]["resolved"] is True
    assert stub.updated["issues"][1]["resolved"] is False


def test_audit_triage_404_when_no_audit(monkeypatch):
    from routers.listening import AuditTriageRequest
    async def _ok(_a): return {"id": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    t, c, e = _rows("MCQ"); t["id"] = "t-uuid"
    stub = _AuditRunStub(t, c, e, existing_audit=None)
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    with pytest.raises(HTTPException) as ex:
        _run(listening_module.admin_triage_test_audit(
            test_id="t-uuid", body=AuditTriageRequest(status="fixed"), authorization="x"))
    assert ex.value.status_code == 404


# ── het-block no_options + options editing ──────────────────────────────────

def test_mcq_hetblock_shortanswer_not_flagged():
    """An mcq exercise item with a WORD answer + no options is a valid
    short-answer (het-block) — must NOT flag no_options."""
    t, c, e = _rows("MCQ")
    q = e[0]["payload"]["questions"][0]
    q.pop("options", None)
    e[0]["payload"]["answers"][0]["answer"] = "Hadley"   # word, not a letter
    h = audit.hydrate_test(t, c, e)
    assert "no_options" not in {i["code"] for i in audit.structural_checks(h)}


def test_mcq_letter_answer_missing_options_still_flagged():
    t, c, e = _rows("MCQ")
    q = e[0]["payload"]["questions"][0]
    q.pop("options", None)
    e[0]["payload"]["answers"][0]["answer"] = "B"        # letter → real MCQ
    h = audit.hydrate_test(t, c, e)
    assert "no_options" in {i["code"] for i in audit.structural_checks(h)}


def test_edit_clear_options(monkeypatch):
    ex, c, t = _edit_ctx()   # MCQ drill, q1 has options
    stub = _EditStub(ex, c, t)
    out = _patch(monkeypatch, ex["id"], 1, {"options": []}, stub)
    assert "options" in out["changed"]
    q1 = next(q for q in stub.updated_payload["questions"] if int(str(q["q_num"])) == 1)
    assert "options" not in q1   # cleared → het-block short-answer


def test_edit_set_options(monkeypatch):
    ex, c, t = _edit_ctx()
    stub = _EditStub(ex, c, t)
    opts = [{"letter": "A", "text": "aa"}, {"letter": "B", "text": "bb"}, {"letter": "C", "text": "cc"}]
    out = _patch(monkeypatch, ex["id"], 1, {"options": opts}, stub)
    q1 = next(q for q in stub.updated_payload["questions"] if int(str(q["q_num"])) == 1)
    assert q1["options"] == opts
