"""Phase 3 — exam module: pure validate/build/grade + the seed TOEIC content is
valid and its KP links all resolve to live assets.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from services import exam_service as ex
from services import kp_registry, reading_solution
from services.content_import_service import _split_frontmatter

CONTENT_DIR = Path(__file__).resolve().parents[1] / "content" / "exams"

_GOOD_Q = {
    "q_num": 1, "question_type": "mcq_single",
    "prompt": "The report ____ ready.", "answer": "B",
    "options": [{"label": "A", "text": "are"}, {"label": "B", "text": "is"}],
    "kp_focus": "grammar", "grammar_slug": "subject-verb-agreement",
}
_GOOD_FM = {"exam_source": "toeic_rc", "code": "AVR-TOEIC-P5-X", "title": "T", "questions": [_GOOD_Q]}


# ── validation ───────────────────────────────────────────────────────────────

def test_valid_exam_passes():
    assert ex.validate_exam(_GOOD_FM) == []


def test_bad_source_missing_code_and_options_rejected():
    bad = {"exam_source": "gre", "title": "T",
           "questions": [{"q_num": 1, "prompt": "p", "answer": "A", "options": []}]}
    errs = ex.validate_exam(bad)
    assert any("exam_source" in e for e in errs)
    assert any("code" in e for e in errs)
    assert any("options" in e for e in errs)


def test_duplicate_qnum_and_bad_kp_focus_rejected():
    fm = {"exam_source": "toeic_rc", "code": "C", "title": "T", "questions": [
        dict(_GOOD_Q), dict(_GOOD_Q, kp_focus="phonics")]}
    errs = ex.validate_exam(fm)
    assert any("q_num 1 bị trùng" in e for e in errs)
    assert any("kp_focus" in e for e in errs)


def test_bad_solution_structure_rejected():
    fm = {"exam_source": "toeic_rc", "code": "C", "title": "T", "questions": [
        dict(_GOOD_Q, solution={"solution_steps": [{"action": "warp", "instruction_vi": "x"}]})]}
    assert any("action" in e for e in ex.validate_exam(fm))


# ── build + grade ────────────────────────────────────────────────────────────

def test_build_payloads_shape():
    plan = ex.build_exam_payloads(_GOOD_FM)
    assert plan["test_row"]["exam_source"] == "toeic_rc"
    assert plan["test_row"]["total_questions"] == 1
    r = plan["question_rows"][0]
    assert r["answer"] == {"answer": "B", "alternatives": []}
    assert r["grammar_slug"] == "subject-verb-agreement" and r["order_num"] == 1


def test_grade_counts_correct_and_wrong():
    key = [{"q_num": 1, "answer": {"answer": "B", "alternatives": []}},
           {"q_num": 2, "answer": {"answer": "C", "alternatives": []}}]
    ua = [{"q_num": 1, "user_answer": "B"}, {"q_num": 2, "user_answer": "A"}]
    res = ex.grade_exam(ua, key)
    assert res["score"] == 1 and res["max_score"] == 2 and res["correct_count"] == 1
    verdicts = {p["q_num"]: p["correct"] for p in res["per_question"]}
    assert verdicts == {1: True, 2: False}


# ── seed content is valid + every KP link is live ────────────────────────────

def test_seed_exam_content_valid_and_kp_links_resolve():
    files = sorted(CONTENT_DIR.glob("*.md"))
    assert files, "no exam content files found"
    for path in files:
        fm, _ = _split_frontmatter(path.read_text(encoding="utf-8"))
        assert ex.validate_exam(fm) == [], f"{path.name} failed validation"
        for q in fm["questions"]:
            # grammar_slug points at a real grammar article
            if q.get("grammar_slug"):
                assert kp_registry.resolve_grammar(q["grammar_slug"]) is None, (path.name, q["grammar_slug"])
            # every kp_ref in the solution resolves (grammar/skill offline)
            for ref in reading_solution.iter_kp_refs(q.get("solution")):
                if ref["type"] in ("grammar", "skill"):
                    assert kp_registry.resolve_ref(ref["type"], ref["slug"], ref["anchor"]) is None, (path.name, ref)


# ── admin import route ───────────────────────────────────────────────────────

def test_admin_import_route_decodes_and_passes_through(monkeypatch):
    from routers import admin_exams as AE

    async def _admin(_a):
        return {"id": "A1"}
    captured = {}

    def _imp(text, dry_run=True):
        captured["text"] = text
        captured["dry_run"] = dry_run
        return {"ok": True, "committed": not dry_run}

    monkeypatch.setattr(AE, "require_admin", _admin)
    monkeypatch.setattr(AE.exam_service, "import_exam", _imp)

    class _F:
        async def read(self):
            return "xin chào".encode("utf-8")

    out = asyncio.new_event_loop().run_until_complete(
        AE.admin_import_exam(file=_F(), dry_run=True, authorization="x"))
    assert out["ok"] is True
    assert captured == {"text": "xin chào", "dry_run": True}


# ── attempt review is an immutable snapshot (review P2) ──────────────────────

class _Resp:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, db, table):
        self._db, self._t, self._op, self._payload = db, table, "select", None
    def select(self, *a, **k): self._op = "select"; return self
    def insert(self, row, *a, **k): self._op = "insert"; self._payload = row; return self
    def delete(self, *a, **k): self._op = "delete"; return self
    def upsert(self, row, *a, **k): self._op = "upsert"; self._payload = row; return self
    def eq(self, *a): return self
    def order(self, *a, **k): return self
    def limit(self, *a): return self
    def execute(self): return self._db.handle(self._t, self._op, self._payload)


class _DB:
    def __init__(self, questions=None, attempt=None):
        self.questions = questions or []
        self.attempt = attempt
        self.inserted = []
    def table(self, n): return _Q(self, n)
    def handle(self, table, op, payload):
        if table == "exam_tests":
            return _Resp([{"id": "t1", "exam_source": "toeic_rc", "status": "published"}])
        if table == "exam_questions":
            return _Resp(self.questions)
        if table == "exam_attempts":
            if op == "insert":
                self.inserted.append(payload); return _Resp([{"id": "att1"}])
            return _Resp([self.attempt] if self.attempt else [])
        return _Resp([])


def test_submit_attempt_snapshots_question_content(monkeypatch):
    qs = [{"q_num": 1, "prompt": "P1", "options": [{"label": "A", "text": "a"}],
           "answer": {"answer": "A", "alternatives": []},
           "solution": {"solution_steps": [{"action": "confirm", "instruction_vi": "x"}]},
           "explanation": None, "grammar_slug": None}]
    db = _DB(questions=qs)
    monkeypatch.setattr(ex, "supabase_admin", db)
    monkeypatch.setattr(ex.kp_evidence, "record_evidence_safe", lambda *a, **k: None)

    ex.submit_attempt("U1", "t1", [{"q_num": 1, "user_answer": "A"}])
    gd = db.inserted[0]["grading_details"][0]
    assert gd["correct"] is True
    assert gd["prompt"] == "P1" and gd["solution"] and "options" in gd  # snapshot present


def test_get_review_uses_snapshot_not_current_questions(monkeypatch):
    attempt = {
        "id": "att1", "user_id": "U1", "test_id": "t1", "status": "submitted",
        "exam_source": "toeic_rc", "score": 1, "max_score": 1, "correct_count": 1,
        "grading_details": [{
            "q_num": 1, "correct": True, "user_answer": "A", "expected": "A",
            "prompt": "ORIGINAL PROMPT", "options": [{"label": "A", "text": "a"}],
            "solution": {"solution_steps": [{"action": "confirm", "instruction_vi": "snap"}]},
            "explanation": None,
        }],
    }
    # The current exam_questions have been EDITED — must be ignored by the review.
    db = _DB(questions=[{"q_num": 1, "prompt": "EDITED PROMPT", "solution": None}], attempt=attempt)
    monkeypatch.setattr(ex, "supabase_admin", db)

    out = ex.get_review("U1", "att1")
    r = out["review"][0]
    assert r["prompt"] == "ORIGINAL PROMPT"          # from snapshot, not "EDITED PROMPT"
    assert r["stepper"]["steps"][0]["instruction_vi"] == "snap"


def test_build_payloads_strips_author_only_option_metadata():
    # An option carrying answer-key metadata must NOT survive into storage/serving.
    fm = {"exam_source": "toeic_rc", "code": "C", "title": "T", "questions": [
        {"q_num": 1, "question_type": "mcq_single", "prompt": "p", "answer": "A",
         "options": [{"label": "A", "text": "a", "is_correct": True, "explanation": "leak"},
                     {"label": "B", "text": "b"}]}]}
    opts = ex.build_exam_payloads(fm)["question_rows"][0]["options"]
    assert opts == [{"label": "A", "text": "a"}, {"label": "B", "text": "b"}]
    assert all(set(o.keys()) == {"label", "text"} for o in opts)
