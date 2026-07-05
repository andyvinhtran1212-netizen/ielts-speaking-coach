"""Phase 2 — microcheck/mastery/roadmap endpoints + roadmap graph logic.

DB mocked. Handlers are called directly (async) with get_supabase_user and the
service layer monkeypatched — mirrors tests/test_feedback.py.
"""
from __future__ import annotations

import asyncio

from routers import kp as KP
from services import kp_evidence, kp_roadmap, quiz_service


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _as_user(monkeypatch, uid="U1"):
    async def _u(_a):
        return {"id": uid, "email": "u@x"}
    monkeypatch.setattr(KP, "get_supabase_user", _u)


# ── POST /api/kp/microcheck-answers ──────────────────────────────────────────

def test_microcheck_counts_recorded_and_skipped(monkeypatch):
    _as_user(monkeypatch)
    calls = []

    def _rec(user_id, *, kp_type, ref_slug, anchor, correct, context=None):
        calls.append((user_id, kp_type, ref_slug, anchor, correct))
        # 'ghost' slug does not resolve to a KP → returns None (skipped)
        return None if ref_slug == "ghost" else "kp-123"

    monkeypatch.setattr(KP.kp_evidence, "record_microcheck", _rec)
    body = KP.MicrocheckBody(answers=[
        KP.MicrocheckAnswer(kp=KP.KpRef(type="grammar", slug="passive-voice",
                                        anchor="passive-voice.overview"), correct=True),
        KP.MicrocheckAnswer(kp=KP.KpRef(type="vocab", slug="ghost"), correct=False),
    ])
    out = _run(KP.submit_microcheck_answers(body, authorization="x"))
    assert out == {"recorded": 1, "skipped": 1}
    assert calls[0] == ("U1", "grammar", "passive-voice", "passive-voice.overview", True)
    assert calls[1][4] is False  # correct flag passed through


# ── GET /api/me/kp-mastery ───────────────────────────────────────────────────

def test_kp_mastery_returns_counts_and_items(monkeypatch):
    _as_user(monkeypatch)
    items = [
        {"kp_id": "1", "kp_type": "grammar", "ref_slug": "articles", "anchor": "",
         "level": "", "score": -2.0, "status": "weak", "evidence_count": 1,
         "last_evidence_at": None},
        {"kp_id": "2", "kp_type": "grammar", "ref_slug": "passive-voice", "anchor": "",
         "level": "", "score": 4.0, "status": "strong", "evidence_count": 2,
         "last_evidence_at": None},
    ]
    monkeypatch.setattr(KP.kp_evidence, "get_user_mastery", lambda uid, **kw: items)
    out = _run(KP.get_my_kp_mastery(status=None, kp_type=None, authorization="x"))
    assert out["counts"] == {"weak": 1, "learning": 0, "strong": 1}
    assert out["items"] == items


# ── roadmap graph logic (pure) ───────────────────────────────────────────────

def test_topo_order_puts_prerequisites_first():
    # c requires b requires a → a, b, c.
    deps = {"c": {"b"}, "b": {"a"}}
    assert kp_roadmap._topo_order({"a", "b", "c"}, deps) == ["a", "b", "c"]


def test_topo_order_cycle_guard_appends_leftovers():
    deps = {"x": {"y"}, "y": {"x"}}  # 2-cycle
    order = kp_roadmap._topo_order({"x", "y"}, deps)
    assert set(order) == {"x", "y"} and len(order) == 2


def test_rollup_status_worst_wins(monkeypatch):
    rows = [
        {"ref_slug": "passive-voice", "status": "strong"},
        {"ref_slug": "passive-voice", "status": "weak"},   # any weak → weak
        {"ref_slug": "articles", "status": "learning"},
    ]
    monkeypatch.setattr(kp_evidence, "get_user_mastery", lambda uid, **kw: rows)
    out = kp_roadmap._rollup_status_by_slug("U1")
    assert out == {"passive-voice": "weak", "articles": "learning"}


def test_build_roadmap_static_when_no_weak(monkeypatch):
    monkeypatch.setattr(kp_evidence, "get_user_mastery",
                        lambda uid, **kw: [{"ref_slug": "articles", "status": "learning"}])
    assert kp_roadmap.build_roadmap("U1") == {"mode": "static", "nodes": []}


def test_build_roadmap_personal_pulls_prereqs_in_order(monkeypatch):
    # User is weak on 'relative-clauses', which requires 'sentence-elements'
    # (unseen) → both appear, prereq first.
    monkeypatch.setattr(kp_evidence, "get_user_mastery",
                        lambda uid, **kw: [{"ref_slug": "relative-clauses", "status": "weak"}])
    monkeypatch.setattr(kp_roadmap, "_article_kp_maps",
                        lambda: ({"relative-clauses": "k1", "sentence-elements": "k2"},
                                 {"k1": "relative-clauses", "k2": "sentence-elements"}))
    monkeypatch.setattr(kp_roadmap, "_prereq_edges_by_slug",
                        lambda id_to_slug: {"relative-clauses": {"sentence-elements"}})
    out = kp_roadmap.build_roadmap("U1")
    assert out["mode"] == "personal" and out["weak_count"] == 1
    slugs = [n["slug"] for n in out["nodes"]]
    assert slugs == ["sentence-elements", "relative-clauses"]  # prereq first
    weak_flags = {n["slug"]: n["is_weak"] for n in out["nodes"]}
    assert weak_flags == {"sentence-elements": False, "relative-clauses": True}


# ── 2.4 quiz → KP evidence ───────────────────────────────────────────────────

class _QQ:
    """Minimal supabase chain returning fixed quiz_questions rows."""
    def __init__(self, rows): self._rows = rows
    def table(self, *_a): return self
    def select(self, *_a): return self
    def eq(self, *_a): return self
    def in_(self, *_a): return self
    def execute(self): return type("R", (), {"data": self._rows})()


def test_quiz_evidence_maps_correct_and_wrong(monkeypatch):
    monkeypatch.setattr(quiz_service, "supabase_admin", _QQ([
        {"item_key": "w1", "grammar_article_slug": "articles"},
        {"item_key": "w2", "grammar_article_slug": None},  # pure vocab → no KP
    ]))
    calls = []
    from services import kp_evidence as ke
    monkeypatch.setattr(ke, "record_evidence_safe",
                        lambda uid, **kw: calls.append((uid, kw)) or "kp")
    attempt_rows = [
        {"item_key": "w1", "is_correct": True},
        {"item_key": "w1", "is_correct": False},
        {"item_key": "w2", "is_correct": True},   # skipped (no slug)
        {"item_key": "w3", "is_correct": True},   # skipped (not in bank)
    ]
    quiz_service._record_quiz_kp_evidence("U1", "bank-1", attempt_rows)
    # Only the two 'articles'-linked attempts recorded, with correct signal signs.
    assert len(calls) == 2
    signals = sorted(kw["signal"] for _u, kw in calls)
    assert signals == [-1, 1]
    assert all(kw["source"] == "quiz" and kw["ref_slug"] == "articles"
               for _u, kw in calls)


def test_quiz_evidence_no_grammar_links_is_noop(monkeypatch):
    monkeypatch.setattr(quiz_service, "supabase_admin", _QQ([
        {"item_key": "v1", "grammar_article_slug": None}]))
    from services import kp_evidence as ke
    calls = []
    monkeypatch.setattr(ke, "record_evidence_safe", lambda uid, **kw: calls.append(1))
    quiz_service._record_quiz_kp_evidence("U1", "bank-1", [{"item_key": "v1", "is_correct": True}])
    assert calls == []
