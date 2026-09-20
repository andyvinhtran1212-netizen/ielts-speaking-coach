"""Tests for services.quiz_import (Pha 1 — Quick-Check quiz bank importer).

Parser tests run offline (dry_run, no DB). Commit tests mock supabase_admin.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from fastapi import HTTPException, UploadFile

from routers import admin_quiz
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

---
id: "beta_v2"
type: "gap_text"
input: "text"
headword: "Beta"
skill: "usage"
prompt: "Fill: The ____ version."
accept: ["beta"]
---
"""


# ── Parse / validate (offline) ───────────────────────────────────────

def test_parses_meta_and_questions_clean():
    r = quiz_import.import_quiz_file(_BANK, dry_run=True)
    assert r["meta"]["code"] == "T1"
    assert r["meta"]["skill_area"] == "vocab"
    assert r["meta"]["meta"]["correct_to_master"] == 2
    assert r["summary"] == {"words": 2, "questions": 5, "errors": 0, "pools": 2}
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


# ── Pool mastery-contract gate (Fix C) ───────────────────────────────

_LONE_MCQ = """\
---
kind: quiz
code: "P1"
skill_area: "vocab"
require_production_to_master: true
words_count: 1
---

---
id: "x_v1"
type: "mcq"
input: "choice"
headword: "Xi"
skill: "meaning"
prompt: "Xi?"
options: ["a", "b"]
answer: 0
---
"""


def test_pool_without_production_flagged():
    """A lone-MCQ pool under require_production_to_master can never be mastered → it
    must fail import (would otherwise burn max_attempts every session forever)."""
    r = quiz_import.import_quiz_file(_LONE_MCQ, dry_run=True)
    pool_errs = [e for e in r["validation_errors"] if e["field"] == "pool:Xi"]
    assert pool_errs, "expected a pool-contract error for the un-masterable word"
    assert any("production" in e["message"] for e in pool_errs)


def test_distinct_single_mcq_uncreditable_flagged():
    """P2 (codex): even under require_distinct_skill:true, a single-MCQ pool with
    require_production_to_master:false + correct_to_master:1 is un-creditable — the
    default provisional/reversal flow only ever sets a provisional (no confirmer) so
    it never credits. The creditability guard must catch this in distinct mode too."""
    bank = _LONE_MCQ.replace(
        "require_production_to_master: true",
        "require_production_to_master: false\ncorrect_to_master: 1",   # require_distinct stays default true
    )
    r = quiz_import.import_quiz_file(bank, dry_run=True)
    pool_errs = [e for e in r["validation_errors"] if e["field"] == "pool:Xi"]
    assert any("không bao giờ ghi điểm" in e["message"] for e in pool_errs)


def test_pool_missing_second_distinct_skill_flagged():
    """Has a production text but only ONE mastery-counting skill (< correct_to_master
    distinct) under require_distinct_skill → flagged."""
    one_skill = """\
---
kind: quiz
code: "P2"
skill_area: "vocab"
correct_to_master: 2
---

---
id: "y_v1"
type: "gap_text"
input: "text"
headword: "Yo"
skill: "usage"
prompt: "____"
accept: ["yo"]
---
"""
    r = quiz_import.import_quiz_file(one_skill, dry_run=True)
    pool_errs = [e for e in r["validation_errors"] if e["field"] == "pool:Yo"]
    assert any("skill khác nhau" in e["message"] for e in pool_errs)
    assert not any("production" in e["message"] for e in pool_errs)   # production IS present


def test_relaxed_meta_allows_single_mcq():
    """With single-credit mastery AND provisional disabled, a lone MCQ credits on each
    correct answer → legitimate bank the gate must NOT flag."""
    relaxed = _LONE_MCQ.replace(
        "require_production_to_master: true",
        "require_production_to_master: false\nrequire_distinct_skill: false\n"
        "provisional_on_single_mcq: false\ncorrect_to_master: 1",
    )
    r = quiz_import.import_quiz_file(relaxed, dry_run=True)
    assert not any(e["field"].startswith("pool:") for e in r["validation_errors"])


def test_relaxed_single_mcq_with_provisional_still_flagged():
    """P2: require_distinct_skill:false but provisional_on_single_mcq LEFT ON (default)
    — a single same-skill MCQ only sets a provisional and never credits, so the word
    is carried over forever. The gate must reject it."""
    relaxed = _LONE_MCQ.replace(
        "require_production_to_master: true",
        "require_production_to_master: false\nrequire_distinct_skill: false\ncorrect_to_master: 1",
    )
    r = quiz_import.import_quiz_file(relaxed, dry_run=True)
    pool_errs = [e for e in r["validation_errors"] if e["field"] == "pool:Xi"]
    assert any("không bao giờ ghi điểm" in e["message"] for e in pool_errs)


def test_pool_only_unsupported_input_flagged():
    """A word whose only question is input:match (never served by the engine) is
    flagged — it would silently vanish from the quiz, not just fail to master."""
    match_only = """\
---
kind: quiz
code: "P3"
skill_area: "vocab"
---

---
id: "z_v1"
type: "match"
input: "match"
headword: "Ze"
skill: "meaning"
prompt: "Match:"
pairs: [["a", "b"], ["c", "d"]]
---
"""
    r = quiz_import.import_quiz_file(match_only, dry_run=True)
    assert any(e["field"] == "pool:Ze" and "không bao giờ được hỏi" in e["message"]
               for e in r["validation_errors"])


def test_pool_contract_blocks_commit():
    """The gate blocks a real commit (all-or-nothing), not just dry-run reporting."""
    fake = _FakeSupabase(responses={**_TOPIC_VOCAB})
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(_LONE_MCQ, topic_id="topic-1", dry_run=False)
    assert r["committed_bank_id"] is None
    assert not any(c["op"] in ("insert", "upsert", "rpc", "update") for c in fake.calls)


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
        ("rpc", "import_quiz_bank_atomic"): [{
            "bank_id": "bank-1", "written": 5,
            "is_published": True, "action": "created",
        }],
        ("vocab_cards", "select"): [{"headword": "Alpha", "audio_headword": "https://a.mp3"}],
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(_BANK, topic_id="topic-1", dry_run=False)

    assert r["committed_bank_id"] == "bank-1"
    # Metadata, questions, and publication are one database transaction.
    rpc = next(c for c in fake.calls if c["op"] == "rpc")
    assert rpc["table"] == "rpc:import_quiz_bank_atomic"
    assert rpc["payload"]["p_publish_state"] == "preserve"
    rows = rpc["payload"]["p_rows"]
    assert len(rows) == 5
    assert "bank_id" not in rows[0]                      # rpc supplies p_bank_id
    assert next(row for row in rows if row["qid"] == "alpha_v3")["answer"] == 1   # boolean → 1
    assert next(row for row in rows if row["qid"] == "alpha_v2")["audio_url"] == "https://a.mp3"
    assert next(row for row in rows if row["qid"] == "alpha_v1")["audio_url"] is None
    assert [row["order"] for row in rows] == [0, 1, 2, 3, 4]


def test_hint_field_parses_and_commits():
    """`hint` (migration 159) is carried from frontmatter to the RPC rows so the
    player can render it as its own line; a question without hint commits None."""
    bank = _BANK.replace('accept: ["alpha"]', 'accept: ["alpha"]\nhint: "gợi ý mẫu"')
    fake = _FakeSupabase(responses={
        ("rpc", "import_quiz_bank_atomic"): [{
            "bank_id": "bank-1", "written": 5,
            "is_published": True, "action": "created",
        }],
        ("vocab_cards", "select"): [],
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(bank, topic_id="topic-1", dry_run=False)
    assert r["committed_bank_id"] == "bank-1"
    rows = next(c for c in fake.calls if c["op"] == "rpc")["payload"]["p_rows"]
    assert next(row for row in rows if row["qid"] == "alpha_v2")["hint"] == "gợi ý mẫu"
    assert next(row for row in rows if row["qid"] == "alpha_v1")["hint"] is None


def test_commit_replaces_existing_bank_and_metadata_in_one_rpc():
    fake = _FakeSupabase(responses={
        ("rpc", "import_quiz_bank_atomic"): [{
            "bank_id": "bank-existing", "written": 5,
            "is_published": False, "action": "updated",
        }],
        ("vocab_cards", "select"): [],
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        r = quiz_import.import_quiz_file(_BANK, topic_id="topic-1", dry_run=False)

    assert r["committed_bank_id"] == "bank-existing"
    writes = [c for c in fake.calls if c["op"] in ("rpc", "insert", "update", "delete")]
    assert len(writes) == 1
    assert writes[0]["table"] == "rpc:import_quiz_bank_atomic"


@pytest.mark.parametrize("state", ["preserve", "published", "unpublished"])
def test_commit_forwards_explicit_publication_state(state):
    fake = _FakeSupabase(responses={
        ("rpc", "import_quiz_bank_atomic"): [{
            "bank_id": "bank-1", "written": 5,
            "is_published": state == "published", "action": "updated",
        }],
        ("vocab_cards", "select"): [],
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        quiz_import.import_quiz_file(
            _BANK, topic_id="topic-1", dry_run=False, publish_state=state,
        )
    rpc = next(c for c in fake.calls if c["op"] == "rpc")
    assert rpc["payload"]["p_publish_state"] == state


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


def test_commit_failure_needs_no_compensating_delete():
    fake = _FakeSupabase(responses={
        ("vocab_cards", "select"): [],
        ("rpc", "import_quiz_bank_atomic"): Exception("boom: replace failed"),
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        with pytest.raises(Exception):
            quiz_import.import_quiz_file(_BANK, topic_id="topic-1", dry_run=False)
    assert not any(c["table"] == "quiz_banks" and c["op"] == "delete" for c in fake.calls)


def test_commit_preserves_existing_bank_on_atomic_rpc_failure():
    fake = _FakeSupabase(responses={
        ("vocab_cards", "select"): [],
        ("rpc", "import_quiz_bank_atomic"): Exception("boom"),
        **_TOPIC_VOCAB,
    })
    with patch.object(quiz_import, "supabase_admin", fake):
        with pytest.raises(Exception):
            quiz_import.import_quiz_file(_BANK, topic_id="topic-1", dry_run=False)
    ops = [(c["table"], c["op"]) for c in fake.calls]
    assert ("quiz_banks", "update") not in ops    # metadata untouched
    assert ("quiz_banks", "delete") not in ops    # existing bank not rolled back


def test_unknown_publish_state_fails_before_any_write():
    fake = _FakeSupabase()
    with patch.object(quiz_import, "supabase_admin", fake):
        with pytest.raises(ValueError, match="publish_state"):
            quiz_import.import_quiz_file(
                _BANK, topic_id="topic-1", dry_run=False,
                publish_state="retired",  # type: ignore[arg-type]
            )
    assert fake.calls == []


def test_atomic_import_migration_preserves_defaults_and_shares_bank_lock():
    migration = (Path(__file__).resolve().parents[1]
                 / "migrations" / "294_atomic_quiz_import_publish_state.sql")
    sql = migration.read_text()

    assert "p_publish_state NOT IN ('preserve', 'published', 'unpublished')" in sql
    assert "ELSE NOT v_advanced" in sql
    assert "FOR UPDATE" in sql
    assert "public.quiz_replace_questions" in sql
    assert sql.index("public.quiz_replace_questions") < sql.index(
        "is_published = v_publish"
    )


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


@pytest.mark.asyncio
async def test_admin_import_route_forwards_publish_state():
    received = {}

    def fake_import(text, **kwargs):
        received.update({"text": text, **kwargs})
        return {"committed_bank_id": "bank-1"}

    upload = UploadFile(filename="bank.md", file=BytesIO(_BANK.encode()))
    with patch.object(admin_quiz, "require_admin", AsyncMock(return_value={"id": "a"})), \
         patch.object(admin_quiz, "import_quiz_file", fake_import):
        result = await admin_quiz.import_bank(
            upload, topic_id="topic-1", dry_run=False,
            publish_state="unpublished", authorization="Bearer x",
        )

    assert result == {"committed_bank_id": "bank-1"}
    assert received["publish_state"] == "unpublished"
    assert received["topic_id"] == "topic-1"
    assert received["dry_run"] is False


def test_admin_import_openapi_declares_publish_state_enum():
    route = next(route for route in admin_quiz.router.routes
                 if route.path == "/admin/quiz/import")
    parameter = next(field for field in route.dependant.query_params
                     if field.name == "publish_state")
    schema = parameter.type_.__args__
    assert schema == ("preserve", "published", "unpublished")


@pytest.mark.asyncio
async def test_delete_advanced_bank_returns_stable_conflict_without_mutation():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": "00000000-0000-4000-8000-000000000001",
            "meta": {"runtime": {"kind": "advanced_vocab"}},
        }],
    })
    with patch.object(admin_quiz, "require_admin", AsyncMock(return_value={"id": "a"})), \
         patch.object(admin_quiz, "supabase_admin", fake):
        with pytest.raises(HTTPException) as exc:
            await admin_quiz.delete_bank(
                UUID("00000000-0000-4000-8000-000000000001"),
                authorization="Bearer x",
            )

    assert exc.value.status_code == 409
    assert "bỏ xuất bản" in str(exc.value.detail)
    assert not any(call["op"] == "delete" for call in fake.calls)


@pytest.mark.asyncio
async def test_delete_maps_database_immutability_guard_to_conflict():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": "00000000-0000-4000-8000-000000000001", "meta": {},
        }],
        ("quiz_banks", "delete"): Exception(
            "cannot delete immutable advanced vocabulary bank; unpublish it instead"
        ),
    })
    with patch.object(admin_quiz, "require_admin", AsyncMock(return_value={"id": "a"})), \
         patch.object(admin_quiz, "supabase_admin", fake):
        with pytest.raises(HTTPException) as exc:
            await admin_quiz.delete_bank(
                UUID("00000000-0000-4000-8000-000000000001"),
                authorization="Bearer x",
            )

    assert exc.value.status_code == 409
