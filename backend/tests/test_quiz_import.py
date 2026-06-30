"""Tests for services.quiz_import (Pha 1 — Quick-Check quiz bank importer).

Parser tests run offline (dry_run, no DB). Commit tests mock supabase_admin.
"""

from __future__ import annotations

from typing import Optional
from unittest.mock import MagicMock, patch

import pytest

from services import quiz_import

# A small but representative bank: 2 pools (Alpha, Beta), mixed input types,
# one prompt with {{audio}}, one boolean.
_BANK = """\
---
kind: quiz
code: "T1"
title: "Test One"
skill_area: "vocab"
correct_to_master: 2
require_production_to_master: true
cooldown: 2
words_count: 2
---

# ===== TỪ 1/2 · Alpha =====

---
id: "alpha_v1"
type: "mcq"
subtype: "meaning_en_vi"
input: "choice"
headword: "Alpha"
skill: "meaning"
pair: "meaning"
prompt: "Alpha nghĩa là gì?"
options: ["a", "b", "c", "d"]
answer: 0
explain: "x"
---

---
id: "alpha_v2"
type: "gap_text"
input: "text"
headword: "Alpha"
skill: "usage"
prompt: "The ____ thing.  {{audio}}"
accept: ["alpha"]
---

---
id: "alpha_v3"
type: "boolean"
input: "boolean"
headword: "Alpha"
skill: "judgement"
pair: "colloc"
prompt: "Đúng hay Sai: ..."
answer: true
explain: "y"
---

# ===== TỪ 2/2 · Beta =====

---
id: "beta_v1"
type: "mcq"
input: "choice"
headword: "Beta"
skill: "meaning"
prompt: "Beta?"
options: ["a", "b"]
answer: 1
---
"""


# ── Parse / validate (offline) ───────────────────────────────────────

def test_parses_meta_and_questions_clean():
    r = quiz_import.import_quiz_file(_BANK, dry_run=True)
    assert r["meta"]["code"] == "T1"
    assert r["meta"]["skill_area"] == "vocab"
    assert r["meta"]["meta"]["correct_to_master"] == 2
    assert r["summary"] == {"words": 2, "questions": 4, "errors": 0, "pools": 2}
    assert r["validation_errors"] == []


def test_missing_meta_block_flagged():
    body = _BANK.split("# ===== TỪ 1/2", 1)[1]
    body = "---\n" + body.split("---", 1)[1]  # drop the META block, keep questions
    r = quiz_import.import_quiz_file(body, dry_run=True)
    assert any(e["field"] == "meta" for e in r["validation_errors"])


def test_mcq_without_options_flagged():
    bad = """\
---
kind: quiz
code: "T2"
words_count: 1
---

---
id: "x_v1"
type: "mcq"
input: "choice"
headword: "X"
skill: "meaning"
prompt: "?"
answer: 0
---
"""
    r = quiz_import.import_quiz_file(bad, dry_run=True)
    fields = {e["field"] for e in r["validation_errors"]}
    assert "options" in fields


def test_boolean_answer_accepted():
    r = quiz_import.import_quiz_file(_BANK, dry_run=True)
    # alpha_v3 is boolean with answer:true → no error on it
    errs = [e for e in r["validation_errors"] if e["qid"] == "alpha_v3"]
    assert errs == []


def test_duplicate_qid_flagged():
    dup = _BANK.replace('id: "beta_v1"', 'id: "alpha_v1"')
    r = quiz_import.import_quiz_file(dup, dry_run=True)
    assert any("Trùng id" in e["message"] for e in r["validation_errors"])


def test_meta_only_file_flagged_no_questions():
    """A file with only the META block must NOT be importable (it would wipe an
    existing bank's questions)."""
    meta_only = "\n".join(_BANK.splitlines()[:11]) + "\n"   # META block only
    r = quiz_import.import_quiz_file(meta_only, dry_run=True)
    assert any(e["field"] == "questions" for e in r["validation_errors"])


def test_boolean_answer_on_choice_question_flagged():
    """answer: true on a choice question must fail (not silently become index 1)."""
    bad = _BANK.replace('answer: 0\nexplain: "x"', 'answer: true\nexplain: "x"')
    r = quiz_import.import_quiz_file(bad, dry_run=True)
    assert any(e["field"] == "answer" for e in r["validation_errors"])


_GBANK = """\
---
kind: quiz
code: "G1"
skill_area: "grammar"
words_count: 1
---

---
id: "g_v1"
type: "mcq"
input: "choice"
headword: "present-perfect"
skill: "form"
prompt: "She ____ here since 2010."
options: ["has lived", "lived"]
answer: 0
grammar_article_slug: "present-perfect"
explain: "since + present perfect."
---
"""


def test_grammar_unknown_article_slug_flagged(monkeypatch):
    monkeypatch.setattr(quiz_import, "_grammar_slug_exists", lambda s: False)
    r = quiz_import.import_quiz_file(_GBANK, dry_run=True)
    assert any(e["field"] == "grammar_article_slug" for e in r["validation_errors"])


def test_grammar_known_article_slug_ok(monkeypatch):
    monkeypatch.setattr(quiz_import, "_grammar_slug_exists", lambda s: True)
    r = quiz_import.import_quiz_file(_GBANK, dry_run=True)
    assert not any(e["field"] == "grammar_article_slug" for e in r["validation_errors"])
    assert r["meta"]["skill_area"] == "grammar"


def test_syllable_answer_out_of_bounds_flagged():
    """A stress index beyond the segments list must be rejected at import."""
    sy = (
        '---\nkind: quiz\ncode: "T3"\nwords_count: 1\n---\n\n'
        '---\nid: "x_v1"\ntype: "stress"\ninput: "syllable"\nheadword: "X"\n'
        'skill: "stress"\nprompt: "?"\nsegments: ["a", "b", "c"]\nanswer: 5\n---\n'
    )
    r = quiz_import.import_quiz_file(sy, dry_run=True)
    assert any(e["field"] == "answer" for e in r["validation_errors"])


# ── Commit (mocked supabase) ─────────────────────────────────────────

class _FakeSupabase:
    def __init__(self, responses: dict | None = None) -> None:
        self.responses = responses or {}
        self.calls: list[dict] = []

    def table(self, name):
        return _FakeQuery(self, name)

    def rpc(self, name, params):
        return _FakeRpc(self, name, params)


class _FakeRpc:
    def __init__(self, p, name, params):
        self._p = p; self._name = name; self._params = params

    def execute(self):
        data = self._p.responses.get(("rpc", self._name), [])
        self._p.calls.append({"table": "rpc:" + self._name, "op": "rpc", "payload": self._params})
        if isinstance(data, Exception):
            raise data
        return MagicMock(data=data)


class _FakeQuery:
    def __init__(self, p, t):
        self._p = p; self._t = t; self._op = None; self._payload = None; self._filters = []

    def insert(self, payload):
        self._op = "insert"; self._payload = payload; return self

    def upsert(self, payload, **k):
        self._op = "upsert"; self._payload = payload; return self

    def update(self, payload):
        self._op = "update"; self._payload = payload; return self

    def delete(self):
        self._op = "delete"; return self

    def select(self, *a, **k):
        self._op = "select"; return self

    def eq(self, c, v):
        self._filters.append((c, v)); return self

    @property
    def not_(self):
        return self

    def in_(self, c, vals):
        self._filters.append(("not_in", c, list(vals))); return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        data = self._p.responses.get((self._t, self._op), [])
        self._p.calls.append({"table": self._t, "op": self._op, "payload": self._payload})
        if isinstance(data, Exception):
            raise data
        return MagicMock(data=data)


# content_topics.skill_area read for the META↔topic cross-check (must match META).
_TOPIC_VOCAB = {("content_topics", "select"): [{"skill_area": "vocab"}]}


def test_commit_inserts_bank_and_questions_via_rpc_with_audio():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [],                       # new bank
        ("quiz_banks", "insert"): [{"id": "bank-1"}],
        ("vocab_cards", "select"): [{"headword": "Alpha", "audio_headword": "https://a.mp3"}],
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(_BANK, topic_id="topic-1", dry_run=False)

    assert r["committed_bank_id"] == "bank-1"
    # Questions written atomically via the RPC (delete-all + insert-all in one txn).
    rpc = next(c for c in fake.calls if c["op"] == "rpc")
    assert rpc["payload"]["p_bank_id"] == "bank-1"
    rows = rpc["payload"]["p_rows"]
    assert len(rows) == 4
    assert "bank_id" not in rows[0]                      # rpc supplies p_bank_id
    assert next(row for row in rows if row["qid"] == "alpha_v3")["answer"] == 1   # boolean → 1
    assert next(row for row in rows if row["qid"] == "alpha_v2")["audio_url"] == "https://a.mp3"
    assert next(row for row in rows if row["qid"] == "alpha_v1")["audio_url"] is None
    assert [row["order"] for row in rows] == [0, 1, 2, 3]


def test_commit_replaces_existing_bank_via_rpc_then_updates_meta():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": "bank-existing"}],   # already exists
        ("vocab_cards", "select"): [],
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(_BANK, topic_id="topic-1", dry_run=False)

    assert r["committed_bank_id"] == "bank-existing"
    ops = [(c["table"], c["op"]) for c in fake.calls]
    assert ("rpc:quiz_replace_questions", "rpc") in ops    # atomic replace
    assert ("quiz_banks", "update") in ops                 # metadata updated AFTER
    # the rpc replace runs BEFORE the metadata update.
    seq = [t for (t, o) in ops if t in ("rpc:quiz_replace_questions", "quiz_banks") and o in ("rpc", "update")]
    assert seq.index("rpc:quiz_replace_questions") < seq.index("quiz_banks")


def test_commit_rejects_skill_area_mismatch_with_topic():
    """META skill_area must match the selected topic's (else the bank would vanish
    from that area's list)."""
    fake = _FakeSupabase(responses={
        ("content_topics", "select"): [{"skill_area": "grammar"}],   # topic is grammar
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(_BANK, topic_id="topic-g", dry_run=False)  # META says vocab
    assert r["committed_bank_id"] is None
    assert any(e["field"] == "skill_area" for e in r["validation_errors"])
    assert not any(c["op"] in ("insert", "rpc", "update") for c in fake.calls)


def test_commit_rolls_back_new_bank_when_question_write_fails():
    """P2: a new bank whose question write fails must NOT be left orphaned (a
    published bank with no questions) — the bank row is rolled back."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [],                       # new bank
        ("quiz_banks", "insert"): [{"id": "bank-x"}],
        ("vocab_cards", "select"): [],
        ("rpc", "quiz_replace_questions"): Exception("boom: replace failed"),
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        with pytest.raises(Exception):
            quiz_import.import_quiz_file(_BANK, topic_id="topic-1", dry_run=False)
    # The orphan bank row was deleted (rolled back).
    assert any(c["table"] == "quiz_banks" and c["op"] == "delete" for c in fake.calls)


def test_commit_preserves_existing_bank_metadata_on_question_failure():
    """P2: a failed replace on an EXISTING bank must not change its metadata
    (the bank update happens only after the replace succeeds) and must not delete it."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": "bank-ex"}],          # existing bank
        ("vocab_cards", "select"): [],
        ("rpc", "quiz_replace_questions"): Exception("boom"),
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        with pytest.raises(Exception):
            quiz_import.import_quiz_file(_BANK, topic_id="topic-1", dry_run=False)
    ops = [(c["table"], c["op"]) for c in fake.calls]
    assert ("quiz_banks", "update") not in ops    # metadata untouched
    assert ("quiz_banks", "delete") not in ops    # existing bank not rolled back


def test_commit_requires_topic_id():
    fake = _FakeSupabase()
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(_BANK, topic_id=None, dry_run=False)
    assert r["committed_bank_id"] is None
    assert any(e["field"] == "topic_id" for e in r["validation_errors"])
    assert fake.calls == []      # nothing written without a topic


def test_commit_blocked_when_validation_errors():
    bad = _BANK.replace('options: ["a", "b"]', "")   # beta_v1 loses options
    fake = _FakeSupabase()
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(bad, topic_id="topic-1", dry_run=False)
    assert r["committed_bank_id"] is None
    assert not any(c["op"] in ("insert", "upsert", "delete", "update") for c in fake.calls)  # all-or-nothing
