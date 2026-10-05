"""exam_only — nội dung dành riêng cho kỳ thi không lọt ra thư viện học viên.

WHY THIS EXISTS. A reading/listening test or writing prompt staged for a mock
exam must not be practisable beforehand, or the exam measures nothing.

Something already existed and was NOT enough: reserved_test_ids() hid tests
assigned to a non-archived mock exam from the two BROWSE LISTS only. Three holes
this closes (mig 170):

  1. it filtered `status <> 'archived'`, so archiving an exam republished its
     paper to the next cohort;
  2. the detail / dictation / attempt-start endpoints never checked it, so a
     direct link served the paper anyway;
  3. writing prompts had no equivalent at all.

The delicate part is that the mock runner loads Reading/Listening through the
SAME student endpoints, so the gate cannot be a blanket refusal — a student with
a sitting on an exam that uses the test must still be able to sit it. These
tests pin both directions, because getting it wrong either leaks the paper or
breaks the exam.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi import HTTPException

import services.mock_exam_service as svc_mod

BACKEND = Path(__file__).resolve().parents[1]


# ── The entitlement rule ──────────────────────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, rows, fail=False):
        self._rows, self._fail, self._f = rows, fail, []

    def select(self, *_a, **_k):
        return self

    def eq(self, c, v):
        self._f.append((c, v))
        return self

    def neq(self, c, v):
        self._f.append((c, ("!=", v)))
        return self

    def in_(self, c, vs):
        self._f.append((c, list(vs)))
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        if self._fail:
            raise RuntimeError("postgrest down")
        out = []
        for r in self._rows:
            ok = True
            for c, v in self._f:
                if isinstance(v, tuple) and v[0] == "!=":
                    ok = ok and r.get(c) != v[1]
                elif isinstance(v, list):
                    ok = ok and r.get(c) in v
                else:
                    ok = ok and str(r.get(c)) == str(v)
            if ok:
                out.append(r)
        return _Resp(out)


class _DB:
    def __init__(self, exams, sittings, fail=False):
        self._t = {"mock_exams": exams, "mock_exam_sittings": sittings}
        self._fail = fail

    def table(self, name):
        return _Q(self._t.get(name, []), self._fail)


@pytest.fixture()
def patched_db(monkeypatch):
    def _install(exams, sittings, fail=False):
        monkeypatch.setattr(svc_mod, "supabase_admin", _DB(exams, sittings, fail))
    return _install


EXAM = [{"id": "e1", "reading_test_id": "rt1", "listening_test_id": "lt1",
         "status": "published", "active_section": "reading"}]


def test_a_student_sitting_the_open_section_may_open_its_paper(patched_db):
    """The reason this cannot be a blanket 404: the mock runner loads the paper
    through the ordinary student endpoints — but only for the section the
    invigilator has actually opened."""
    patched_db(EXAM, [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                       "status": "lrw_in_progress"}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is True


def test_a_section_the_room_has_not_reached_is_refused(patched_db):
    """Holding a sitting is not entitlement to every paper the exam binds. A
    registered student could otherwise read the Listening paper while the room
    is still on Reading (Codex review, PR #862)."""
    patched_db(EXAM, [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                       "status": "lrw_in_progress"}])
    assert svc_mod.user_may_open_exam_content("u1", "listening", "lt1") is False


def test_everyone_else_may_not(patched_db):
    patched_db(EXAM, [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                       "status": "lrw_in_progress"}])
    assert svc_mod.user_may_open_exam_content("u2", "reading", "rt1") is False


def test_a_section_already_submitted_stays_open(patched_db):
    """They sat it — reviewing their own paper is the intended use, and it is
    what keeps a released sitting working after the exam has moved on."""
    patched_db([{"id": "e1", "reading_test_id": "rt1", "active_section": "done"}],
               [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                 "status": "released",
                 "reading_submitted_at": "2026-07-26T00:00:00+00:00"}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is True


def test_a_voided_sitting_grants_nothing(patched_db):
    """A cancelled exam is not an entitlement."""
    patched_db(EXAM, [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                       "status": "void"}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is False


def test_an_archived_exam_still_grants_a_sat_paper(patched_db):
    """No status filter on the EXAM, unlike reserved_test_ids — that filter is
    exactly the hole where archiving an exam republished its paper."""
    patched_db([{"id": "e1", "reading_test_id": "rt1", "status": "archived",
                 "active_section": "done"}],
               [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                 "status": "released",
                 "reading_submitted_at": "2026-07-26T00:00:00+00:00"}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is True


RETAKE = [{"id": "e1", "reading_test_id": "rt1", "listening_test_id": "lt1",
           "status": "published", "exam_mode": "retake"}]


def test_a_retake_may_open_an_assigned_skill_it_has_started(patched_db):
    patched_db(RETAKE, [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                         "status": "lrw_in_progress",
                         "assigned_skills": ["reading"],
                         "reading_started_at": "2026-07-26T00:00:00+00:00"}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is True


def test_a_retake_may_not_open_a_skill_it_was_never_assigned(patched_db):
    """The exam binds a Listening test; this student was given Reading only."""
    patched_db(RETAKE, [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                         "status": "lrw_in_progress",
                         "assigned_skills": ["reading"],
                         "reading_started_at": "2026-07-26T00:00:00+00:00"}])
    assert svc_mod.user_may_open_exam_content("u1", "listening", "lt1") is False


def test_a_retake_may_not_open_an_assigned_skill_before_starting_it(patched_db):
    """Retake is self-paced, so 'started' is the moment the clock begins — before
    that the paper is not theirs to read."""
    patched_db(RETAKE, [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                         "status": "registered",
                         "assigned_skills": ["reading", "listening"]}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is False


def test_a_lookup_failure_denies(patched_db):
    """Fail CLOSED: unable to prove entitlement is not the same as having it."""
    patched_db(EXAM, [], fail=True)
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is False


@pytest.mark.parametrize("kind,user,test", [
    ("speaking", "u1", "rt1"),   # not a gated kind
    ("reading", None, "rt1"),    # anonymous
    ("reading", "u1", None),
])
def test_missing_inputs_deny(patched_db, kind, user, test):
    patched_db(EXAM, [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                       "status": "lrw_in_progress"}])
    assert svc_mod.user_may_open_exam_content(user, kind, test) is False


# ── Every student door is gated, not just the browse list ─────────────
#
# Source sentinels: these endpoints are long, DB-backed and auth-gated, and the
# regression that matters is a door being LEFT OUT — which is a question about
# the source, not about one request's behaviour.


def _src(rel: str) -> str:
    return (BACKEND / rel).read_text(encoding="utf-8")


def test_the_three_browse_lists_filter_the_flag():
    assert '.eq("is_public", True)' in _src("routers/reading_student.py")
    assert '.eq("is_public", True)' in _src("routers/listening.py")
    assert '.eq("exam_only", False)' in _src("routers/writing_student.py")


def test_reading_detail_and_share_are_gated():
    src = _src("routers/reading_student.py")
    # the shared gate exists and the detail builder calls it
    assert "def _assert_exam_content_allowed(" in src
    body = src[src.index("def _build_reading_test_detail("):]
    assert "_assert_exam_content_allowed(test, user_id, class_item, sitting_id=sitting_id)" in body[:900]
    assert body.index("_assert_exam_content_allowed(") < body.index("_require_test_unlocked(")
    # …and the anonymous share route refuses outright: no user, no sitting, so
    # there is nothing that could entitle it
    share = src[src.index("async def boot_shared_reading_test("):]
    assert 'if not _test_is_public(test):' in share[:900]


def test_reading_detail_receives_the_caller():
    """A gate that never sees who is asking cannot gate anything — the endpoints
    must pass the user id down, not call the builder bare."""
    src = _src("routers/reading_student.py")
    for call in re.findall(r"_build_reading_test_detail\([^)]*\)", src):
        if call.startswith("_build_reading_test_detail(test_id"):
            assert "user" in call, f"caller not threaded: {call}"


def test_listening_detail_dictation_and_attempt_start_are_gated():
    """Dictation matters as much as the paper: it is built from the transcript,
    which IS the answer key read aloud."""
    src = _src("routers/listening.py")
    assert "def _assert_listening_exam_content_allowed(" in src
    for fn in ("async def get_published_listening_test(",
               "async def get_listening_test_dictation(",
               "async def start_listening_test_attempt("):
        seg = src[src.index(fn):]
        seg = seg[:seg.index("\n@")] if "\n@" in seg else seg
        assert "_assert_listening_exam_content_allowed(" in seg, f"{fn} not gated"


class _PaperAccessDB:
    """Return a purpose-bound receipt only from seeded paper/owner joins."""
    def __init__(self, *, entitlement=None):
        self.paper = {"id": "lt1", "status": "published", "exam_only": True,
                      "is_public": False, "public_practice_enabled": True}
        self.items = ([{"id": "class-item-1", "user_id": "user-1", "test_id": "lt1"}]
                      if entitlement == "class" else [])
        self.exam = {"id": "e1", "status": "published", "active_section": "listening",
                     "listening_test_id": "lt1"}
        self.sittings = ([{"id": "s1", "user_id": "user-1", "mock_exam_id": "e1",
                          "listening_attempt_id": "a1", "status": "lrw_in_progress"}]
                         if entitlement == "mock" else [])
        self.attempts = ([{"id": "a1", "user_id": "user-1", "test_id": "lt1",
                          "sitting_id": "s1", "attempt_purpose": "mock_delivery"}]
                         if entitlement == "mock" else [])
        self.calls = []

    def rpc(self, name, params):
        assert name == "fn_resolve_mock_paper_access"
        self.calls.append(params)
        assert params["p_skill"] == "listening"
        paper_matches = (params["p_test_id"] == self.paper["id"]
                         and self.paper["status"] == "published")
        assigned = any(item["id"] == params["p_class_item_id"]
                       and item["user_id"] == params["p_user_id"]
                       and item["test_id"] == params["p_test_id"] for item in self.items)
        bound = next((sitting for sitting in self.sittings
                      if sitting["id"] == params["p_sitting_id"]
                      and sitting["user_id"] == params["p_user_id"]
                      and sitting["mock_exam_id"] == self.exam["id"]
                      and sitting["status"] != "void"
                      and self.exam["status"] == "published"
                      and self.exam["active_section"] == "listening"
                      and self.exam["listening_test_id"] == params["p_test_id"]
                      and any(attempt["id"] == sitting["listening_attempt_id"]
                              and attempt["user_id"] == sitting["user_id"]
                              and attempt["test_id"] == params["p_test_id"]
                              and attempt["sitting_id"] == sitting["id"]
                              and attempt["attempt_purpose"] == "mock_delivery"
                              for attempt in self.attempts)), None)
        allowed = paper_matches and (assigned or bound is not None) and params["p_purpose"] == "delivery"
        receipt = {"allowed": bool(allowed),
                   "attempt_purpose": ("mock_delivery" if bound else "assigned_practice") if allowed else None,
                   "paper_revision": 1, "policy_revision": 1}
        if allowed and bound:
            receipt.update(mock_sitting_id=bound["id"], attempt_id=bound["listening_attempt_id"])
        return type("RPC", (), {"execute": lambda _self: _Resp(receipt)})()


def test_hidden_listening_canonical_flag_beats_legacy_public_practice(monkeypatch):
    """A preserved legacy public-practice flag cannot grant a hidden paper."""
    from routers import listening
    db = _PaperAccessDB()
    monkeypatch.setattr(listening, "supabase_admin", db)
    with pytest.raises(HTTPException) as exc:
        listening._assert_listening_exam_content_allowed(db.paper, "user-1")
    assert exc.value.status_code == 404
    assert db.calls[0]["p_sitting_id"] is None


@pytest.mark.parametrize("entitlement", ["class", "mock"])
def test_hidden_listening_still_allows_explicit_entitlements(monkeypatch, entitlement):
    """Only the canonical owned assignment or bound sitting grants delivery."""
    from routers import listening
    db = _PaperAccessDB(entitlement=entitlement)
    monkeypatch.setattr(listening, "supabase_admin", db)
    kwargs = {"sitting_id": "s1"} if entitlement == "mock" else {}
    decision = listening._assert_listening_exam_content_allowed(
        db.paper, "user-1", "class-item-1" if entitlement == "class" else None, **kwargs)
    assert decision["attempt_purpose"] == ("mock_delivery" if entitlement == "mock" else "assigned_practice")
    if entitlement == "mock":
        assert decision["attempt_id"] == "a1" and decision["mock_sitting_id"] == "s1"


@pytest.mark.parametrize("entitlement", ["class", "mock"])
@pytest.mark.parametrize("purpose,user", [("dictation", "user-1"), ("delivery", "other-owner")])
def test_delivery_entitlement_does_not_grant_transcript_or_another_owner(monkeypatch, entitlement, purpose, user):
    from routers import listening
    db = _PaperAccessDB(entitlement=entitlement)
    monkeypatch.setattr(listening, "supabase_admin", db)
    with pytest.raises(HTTPException) as exc:
        listening._assert_listening_exam_content_allowed(
            db.paper, user, "class-item-1" if entitlement == "class" else None,
            purpose=purpose, sitting_id="s1" if entitlement == "mock" else None)
    assert exc.value.status_code == 404


def test_the_attempt_start_query_actually_selects_the_flag():
    """A gate reading a column the query never fetched always sees None."""
    src = _src("routers/listening.py")
    seg = src[src.index("async def start_listening_test_attempt("):]
    assert "exam_only" in seg[:seg.index("_assert_listening_exam_content_allowed(")]


def test_admins_can_set_the_flag():
    assert "exam_only" in _src("routers/admin_writing_prompts.py")
    ls = _src("routers/listening.py")
    assert 'update["exam_only"] = bool(body.exam_only)' in ls


# ── The migration ─────────────────────────────────────────────────────


def _mig() -> str:
    return (BACKEND / "migrations" / "170_exam_only_content.sql").read_text(encoding="utf-8")


def test_all_three_tables_get_the_column():
    sql = _mig()
    for t in ("reading_tests", "listening_tests", "writing_prompts"):
        assert re.search(rf"ALTER TABLE {t}\s+ADD COLUMN IF NOT EXISTS exam_only", sql), t


def _backfill_statements() -> str:
    """The backfill SQL with comments stripped — the prose explains WHY there is
    no status filter, so matching on raw text would assert against itself."""
    sql = _mig()
    body = sql[sql.index("-- ── Backfill"):]
    return "\n".join(l for l in body.splitlines() if not l.lstrip().startswith("--"))


def test_the_backfill_ignores_exam_status():
    """The whole point of the chosen scope: a paper that was sat once stays out
    of the library after its exam is archived."""
    stmts = _backfill_statements()
    assert "archived" not in stmts, "the backfill must not filter on exam status"
    assert stmts.count("EXISTS (") >= 3


def test_the_backfill_does_not_touch_unrelated_practice_content():
    """Deliberately NOT `WHERE test_type = 'full'` — 6 reading + 7 listening full
    tests belong to no exam and are real practice material."""
    assert "test_type" not in _backfill_statements()


def test_public_visibility_migration_preserves_all_current_public_paths():
    sql = (BACKEND / "migrations" / "258_test_public_visibility.sql").read_text(
        encoding="utf-8",
    )
    for table in ("reading_tests", "listening_tests"):
        assert re.search(
            rf"ALTER TABLE {table}\s+ADD COLUMN IF NOT EXISTS is_public BOOLEAN", sql,
        )
        assert re.search(
            rf"UPDATE {table}\s+SET is_public = NOT COALESCE\(exam_only, false\)\s+"
            r"OR COALESCE\(public_practice_enabled, false\)\s+WHERE is_public IS NULL",
            sql,
        )
        assert re.search(
            rf"ALTER TABLE {table}\s+ALTER COLUMN is_public SET DEFAULT true,\s+"
            r"ALTER COLUMN is_public SET NOT NULL", sql,
        )


def test_the_reverse_is_written_down():
    """The backfill is the only part that changes what students see, so undoing
    it must not require re-deriving anything."""
    sql = _mig()
    assert "TO REVERSE" in sql
    assert "SET exam_only = false" in sql


# ── Assigning content to an exam reserves it, automatically ───────────
#
# The tick at upload time is the admin's intent; THIS is the moment that
# actually matters. Requiring someone to remember a checkbox for a paper to
# stop being practisable is how the leak comes back.


class _RecordingDB:
    def __init__(self):
        self.updates = []
        self._pending = None
        self._inserted_row = None
        self.rpc_calls = []

    def table(self, name):
        self._pending = name
        return self

    def update(self, payload):
        self._payload = payload
        return self

    def insert(self, payload):
        raise AssertionError("mock creation must be one atomic RPC, without a Python insert")

    def rpc(self, name, params):
        assert name == "fn_create_mock_exam_with_paper_policy"
        self.rpc_calls.append((name, params))
        self._rpc_params = params
        return self

    def eq(self, c, v):
        self._eq = (c, v)
        return self

    def execute(self):
        if hasattr(self, "_rpc_params"):
            params = self._rpc_params
            del self._rpc_params
            assert params["p_actor_id"] == "admin"
            self._inserted_row = dict(params["p_payload"], id="e1", created_by="admin")
            return _Resp(dict(self._inserted_row))
        self.updates.append((self._pending, self._payload, getattr(self, "_eq", None)))
        return _Resp([{"id": "e1"}])


def test_creating_an_exam_only_auto_reserves_writing_prompts(monkeypatch):
    db = _RecordingDB()
    monkeypatch.setattr(svc_mod, "supabase_admin", db)
    svc_mod.admin_create_exam({
        "code": "X", "title": "X",
        "reading_test_id": "rt1", "listening_test_id": "lt1",
        "writing_task1_prompt_id": "wp1", "writing_task2_prompt_id": "wp2",
    }, created_by="admin")
    reserved = {(t, e[1]) for t, p, e in db.updates if p == {"exam_only": True}}
    assert reserved == {
        ("writing_prompts", "wp1"), ("writing_prompts", "wp2"),
    }
    assert db.rpc_calls == [("fn_create_mock_exam_with_paper_policy", {
        "p_payload": {"code": "X", "title": "X", "reading_test_id": "rt1",
                      "listening_test_id": "lt1", "writing_task1_prompt_id": "wp1",
                      "writing_task2_prompt_id": "wp2"}, "p_actor_id": "admin",
    })]


def test_an_exam_with_no_content_reserves_nothing(monkeypatch):
    db = _RecordingDB()
    monkeypatch.setattr(svc_mod, "supabase_admin", db)
    svc_mod.admin_create_exam({"code": "X", "title": "X"}, created_by="admin")
    assert not [u for u in db.updates if u[1] == {"exam_only": True}]


def test_reserving_never_breaks_exam_creation(monkeypatch):
    """Bookkeeping must not be able to fail the operator's actual action — the
    dynamic reserved_test_ids() filter still hides live-exam content meanwhile."""
    class _Broken(_RecordingDB):
        def execute(self):
            if hasattr(self, "_rpc_params"):
                return super().execute()
            raise RuntimeError("postgrest down")

    monkeypatch.setattr(svc_mod, "supabase_admin", _Broken())
    out = svc_mod.admin_create_exam(
        {"code": "X", "title": "X", "reading_test_id": "rt1"}, created_by="admin")
    assert out["id"] == "e1"


# ── A gate reading a column the query never fetched is no gate ────────
#
# The reading gate shipped dead: _fetch_published_test() and _resolve_share()
# project explicit column lists that omitted exam_only, so `test.get("exam_only")`
# was always None and every reserved paper went straight through (Codex review,
# PR #862). The listening side already had this test; reading did not — which is
# precisely why only reading broke.


def test_every_reading_projection_feeding_the_gate_selects_the_flag():
    """Any query whose row reaches _assert_exam_content_allowed must fetch the
    column, or the guard silently passes."""
    src = _src("routers/reading_student.py")
    for fn in ("def _fetch_published_test(", "def _resolve_share("):
        seg = src[src.index(fn):]
        seg = seg[:seg.index("\ndef ", 1)]
        # Comments in this function EXPLAIN the requirement, so matching raw text
        # would assert against the explanation instead of the query. Strip them
        # and look only at what is actually inside .select(...).
        code = "\n".join(l for l in seg.splitlines() if not l.lstrip().startswith("#"))
        projected = "".join(re.findall(r'\.select\(([\s\S]*?)\)', code))
        assert "exam_only" in projected, f"{fn} does not project exam_only"


def test_prompt_creation_never_writes_a_null_into_the_not_null_column():
    """create_prompt() serialises the WHOLE model, so an Optional[...] = None here
    becomes an explicit NULL and every prompt creation fails — including from the
    current admin page, which does not send the field at all."""
    from routers.admin_writing_prompts import PromptCreate
    dumped = PromptCreate(
        task_type="task2", prompt_text="x" * 20, title="tiêu đề",
    ).model_dump()
    assert dumped["exam_only"] is False, dumped["exam_only"]


def test_the_update_model_still_allows_omitting_it():
    """PATCH uses exclude_unset + drops None, so Optional is right THERE — the
    two models differ on purpose."""
    from routers.admin_writing_prompts import PromptUpdate
    assert PromptUpdate().model_dump(exclude_unset=True) == {}


def test_reading_has_a_way_to_set_the_flag_before_assignment():
    """Listening and writing could stage a paper as exam-only; reading could not,
    so a future exam paper stayed public until an exam referenced it."""
    src = _src("routers/admin_reading.py")
    assert '@router.post("/tests/{test_id}/exam-only")' in src
    seg = src[src.index("async def admin_set_reading_exam_only("):]
    seg = seg[:seg.index("\n@")]
    assert "require_admin(authorization)" in seg
    assert 'mutate(supabase_admin, "reading", rows[0]["id"], {"exam_only": value}, actor["id"]' in seg
    assert 'expected_revision=body.get("expected_revision")' in seg
    assert "404" in seg


# ── Doors I did not think of ──────────────────────────────────────────
#
# Codex adversarial review, 2026-07-26. Gating the list + detail + boot routes
# left THREE writeable doors open, and each of them ends with the answer key:
#
#   · POST /api/reading/test/{id}/attempts — the attempt is then OWNED, and the
#     review endpoint trusts ownership, not exam entitlement. Blank-submit →
#     passages, expected answers, solutions.
#   · POST /api/reading/test/share/{token}/attempts — same, anonymously, for any
#     share token minted before the paper was reserved.
#   · POST /api/listening/tests/dictation/grade — dictation is built from the
#     TRANSCRIPT (the answer key read aloud) and returns the missed `expected`
#     words, so the paper can be reconstructed one sentence index at a time.
#
# Enumerating doors by reading the code paths I happened to think of is what
# missed them. These pin the doors themselves.


def test_starting_a_reading_attempt_is_gated():
    src = _src("routers/reading_student.py")
    seg = src[src.index("async def start_reading_test_attempt("):]
    seg = seg[:seg.index("\n@")]
    assert '_assert_exam_content_allowed(test, user["id"], class_item,' in seg
    assert "allow_admission=True" in seg
    # …and BEFORE anything is written, not after
    assert seg.index("_assert_exam_content_allowed") < seg.index(".insert(")


def test_starting_a_shared_reading_attempt_is_gated():
    """Anonymous by definition — there is no sitting that could entitle it."""
    src = _src("routers/reading_student.py")
    seg = src[src.index("async def start_shared_reading_test_attempt("):]
    seg = seg[:seg.index("\n@")]
    assert 'if not _test_is_public(test):' in seg
    assert seg.index('_test_is_public') < seg.index(".insert(")


def test_every_dictation_route_goes_through_the_one_gated_loader():
    """Structural, not per-route: dictation exposes the transcript, so a NEW
    dictation route must inherit the gate instead of needing someone to remember
    it. The shared loader is the only way in."""
    src = _src("routers/listening.py")
    loader = src[src.index("def _published_test_for_dictation("):]
    loader = loader[:loader.index("\ndef ", 1)]
    assert "exam_only" in loader, "the loader must project the column it gates on"
    assert "_assert_listening_exam_content_allowed(" in loader

    for fn in ("async def grade_listening_test_dictation(",
               "async def submit_listening_dictation_session(",
               "async def flag_listening_dictation("):
        seg = src[src.index(fn):]
        # Stop at the next top-level definition OR decorator, whichever comes
        # first: a plain helper can sit between two routes, and slicing only on
        # "\n@" swallows it — which made this assertion read the loader's own
        # body and fail against itself.
        ends = [x for x in (seg.find("\n@", 1), seg.find("\ndef ", 1),
                            seg.find("\nasync def ", 1)) if x > 0]
        seg = seg[:min(ends)] if ends else seg
        assert "_published_test_for_dictation(" in seg, f"{fn} bypasses the loader"
        assert 'table("listening_tests")' not in seg, \
            f"{fn} loads the test itself instead of using the gated loader"


def test_an_archived_exam_stops_handing_out_an_unsat_paper(patched_db):
    """mig 170 backfilled archived exams' content ON PURPOSE, and `status` is
    admin-writable — so an archived exam left sitting at active_section='reading'
    would go on granting its paper forever."""
    patched_db([{"id": "e1", "reading_test_id": "rt1",
                 "status": "archived", "active_section": "reading"}],
               [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                 "status": "lrw_in_progress"}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is False


def test_but_a_sat_paper_survives_archiving(patched_db):
    """The submitted branch is checked BEFORE the live-exam rule — reviewing your
    own finished paper must keep working after the exam is archived."""
    patched_db([{"id": "e1", "reading_test_id": "rt1",
                 "status": "archived", "active_section": "done"}],
               [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                 "status": "released",
                 "reading_submitted_at": "2026-07-26T00:00:00+00:00"}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is True


def test_a_draft_exam_grants_nothing_unsat(patched_db):
    patched_db([{"id": "e1", "reading_test_id": "rt1",
                 "status": "draft", "active_section": "reading"}],
               [{"id": "s1", "user_id": "u1", "mock_exam_id": "e1",
                 "status": "lrw_in_progress"}])
    assert svc_mod.user_may_open_exam_content("u1", "reading", "rt1") is False


# ── Trả đề về thư viện: chặn khi còn kỳ thi SỐNG dùng nó ──────────────
#
# The convert button works both ways, and the reverse direction is the dangerous
# one: un-reserving a paper a live exam still binds publishes that exam's paper
# to the very students about to sit it. Archived exams deliberately do NOT block
# (decided 2026-07-27) — that is an operator call, and the button says so.


LIVE_EXAMS = [
    {"id": "e1", "code": "MOCK-A", "status": "published",
     "reading_test_id": "rt1", "listening_test_id": "lt1",
     "writing_task1_prompt_id": "wp1", "writing_task2_prompt_id": None},
    {"id": "e2", "code": "OLD", "status": "archived",
     "reading_test_id": "rt-old", "listening_test_id": None,
     "writing_task1_prompt_id": None, "writing_task2_prompt_id": "wp-old"},
]


@pytest.fixture()
def exams_db(monkeypatch):
    def _install(rows, fail=False):
        monkeypatch.setattr(svc_mod, "supabase_admin", _DB(rows, [], fail))
    return _install


@pytest.mark.parametrize("kind,cid", [
    ("reading", "rt1"), ("listening", "lt1"), ("writing", "wp1"),
])
def test_a_live_exam_blocks_the_paper_going_back(exams_db, kind, cid):
    exams_db(LIVE_EXAMS)
    with pytest.raises(svc_mod.SittingConflictError) as ei:
        svc_mod.assert_can_unreserve(kind, cid)
    # …and NAMES the exam: "cannot un-reserve" with no reason makes the admin
    # guess which exam to archive first.
    assert "MOCK-A" in str(ei.value)


@pytest.mark.parametrize("kind,cid", [
    ("reading", "rt-old"), ("writing", "wp-old"),
])
def test_an_archived_exam_does_not_block(exams_db, kind, cid):
    exams_db(LIVE_EXAMS)
    svc_mod.assert_can_unreserve(kind, cid)      # no raise


def test_content_no_exam_uses_goes_back_freely(exams_db):
    exams_db(LIVE_EXAMS)
    svc_mod.assert_can_unreserve("reading", "rt-unused")


def test_both_writing_prompt_slots_are_checked(exams_db):
    """An exam binds Task 1 AND Task 2 — checking only one slot would let the
    other be pulled out from under a live exam."""
    exams_db([{"id": "e1", "code": "MOCK-A", "status": "published",
               "writing_task1_prompt_id": None, "writing_task2_prompt_id": "wp2"}])
    with pytest.raises(svc_mod.SittingConflictError):
        svc_mod.assert_can_unreserve("writing", "wp2")


def test_a_lookup_failure_refuses_rather_than_allows(exams_db):
    """Fail CLOSED: unable to prove nothing uses it is not proof nothing does."""
    exams_db(LIVE_EXAMS, fail=True)
    with pytest.raises(svc_mod.MockExamError):
        svc_mod.assert_can_unreserve("reading", "rt1")


def test_an_unknown_kind_is_a_programming_error_not_a_pass(exams_db):
    exams_db(LIVE_EXAMS)
    with pytest.raises(ValueError):
        svc_mod.assert_can_unreserve("speaking", "x1")


def test_all_three_endpoints_enforce_it_not_just_one():
    """Reading/Listening mutations use the atomic guard; Writing keeps its gate."""
    reading = _src("routers/admin_reading.py")
    assert 'mutate(supabase_admin, "reading"' in reading
    listening = _src("routers/listening.py")
    segment = listening[listening.index("async def admin_patch_listening_test("):]
    segment = segment[:segment.index("\n@")]
    assert 'mutate(supabase_admin, "listening"' in segment
    writing = _src("routers/admin_writing_prompts.py")
    assert 'assert_can_unreserve("writing"' in writing
    assert "HTTPException(409" in writing


def test_both_paper_flag_directions_use_the_atomic_policy_guard():
    """Even hiding can conflict with active/frozen attempts; never bypass CAS."""
    reading = _src("routers/admin_reading.py")
    segment = reading[reading.index("async def admin_set_reading_exam_only("):]
    segment = segment[:segment.index("\n@")]
    assert 'mutate(supabase_admin, "reading"' in segment
    assert 'if not value:' not in segment
    listening = _src("routers/listening.py")
    segment = listening[listening.index("async def admin_patch_listening_test("):]
    segment = segment[:segment.index("\n@")]
    assert 'mutate(supabase_admin, "listening"' in segment
    assert 'if not body.exam_only:' not in segment


def test_writing_reserve_still_checks_only_the_release_direction():
    """The unchanged Writing legacy gate must not prevent staging a prompt."""
    lines = _src("routers/admin_writing_prompts.py").splitlines()
    call = next(i for i, line in enumerate(lines) if "assert_can_unreserve(" in line)
    depth = len(lines[call]) - len(lines[call].lstrip())
    guard = None
    for i in range(call - 1, -1, -1):
        line = lines[i]
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        if indent < depth and line.lstrip().startswith("if "):
            guard = line.strip()
            break
        if indent < depth:
            depth = indent
    assert guard == 'if patch.get("exam_only") is False:'
