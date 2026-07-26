"""Cấp khoá học + gán lớp cho nội dung kỳ thi (Đợt 3).

Choosing which paper goes to which class was done from memory: nothing on a
test or a prompt said what course level it targets or which classes it is for.
With three libraries that does not scale, and picking the wrong paper for a
class is a mistake nobody notices until the exam is under way.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import services.exam_content_service as svc

BACKEND = Path(__file__).resolve().parents[1]


# ── Fake DB ───────────────────────────────────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, table):
        self.db, self.table_name = db, table
        self.op = "select"
        self.payload = None
        self.eqs: list = []
        self.ins: list = []

    def select(self, *_a, **_k):
        return self

    def update(self, p):
        self.op, self.payload = "update", p
        return self

    def insert(self, p):
        self.op, self.payload = "insert", p
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, c, v):
        self.eqs.append((c, v))
        return self

    def in_(self, c, vs):
        self.ins.append((c, [str(x) for x in vs]))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def range(self, s, e):
        self._range = (s, e)
        return self

    def _match(self, r):
        for c, v in self.eqs:
            if str(r.get(c)) != str(v):
                return False
        for c, vs in self.ins:
            if str(r.get(c)) not in vs:
                return False
        return True

    def execute(self):
        rows = self.db.t.setdefault(self.table_name, [])
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            for it in items:
                it = dict(it)
                it.setdefault("id", f"row-{len(rows)+1}")
                rows.append(it)
            return _Resp(items)
        hit = [r for r in rows if self._match(r)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
            return _Resp(hit)
        if self.op == "delete":
            self.db.t[self.table_name] = [r for r in rows if not self._match(r)]
            return _Resp(hit)
        if getattr(self, "_range", None):
            s, e = self._range
            hit = hit[s:e + 1]
        return _Resp(hit)


class _Deferred:
    """postgrest-py defers until .execute(); the fake must too."""

    def __init__(self, data):
        self._d = data

    def execute(self):
        return _Resp(self._d)


class _DB:
    def __init__(self):
        self.t: dict = {}

    def table(self, name):
        return _Q(self, name)

    # fn_set_exam_content_cohorts (mig 172) — modelled with the SAME semantics
    # the SQL implements (one transaction, ON CONFLICT DO NOTHING, delete of the
    # complement), like the fakes for mig 163/168/169. A stub would make these
    # tests assert against a stub.
    def rpc(self, name, params):
        assert name == "fn_set_exam_content_cohorts", name
        kind, cid = params["p_kind"], str(params["p_content_id"])
        wanted = sorted({str(c) for c in (params.get("p_cohort_ids") or [])})
        rows = self.t.setdefault("exam_content_cohorts", [])
        mine = [r for r in rows
                if r["content_kind"] == kind and str(r["content_id"]) == cid]
        have = {r["cohort_id"] for r in mine}
        removed = len([r for r in mine if r["cohort_id"] not in wanted])
        self.t["exam_content_cohorts"] = [
            r for r in rows
            if not (r["content_kind"] == kind and str(r["content_id"]) == cid
                    and r["cohort_id"] not in wanted)
        ]
        added = [c for c in wanted if c not in have]
        for c in added:
            self.t["exam_content_cohorts"].append({
                "id": "row-%d" % (len(self.t["exam_content_cohorts"]) + 1),
                "content_kind": kind, "content_id": cid, "cohort_id": c,
                "created_by": params.get("p_created_by"),
            })
        return _Deferred({"added": added, "removed": removed, "cohort_ids": wanted})


@pytest.fixture()
def db(monkeypatch):
    d = _DB()
    monkeypatch.setattr(svc, "supabase_admin", d)
    return d


# ── Course level ──────────────────────────────────────────────────────


def test_setting_a_level(db):
    db.t["reading_tests"] = [{"id": "r1", "title": "T", "course_level": None}]
    out = svc.set_course_level("reading", "r1", "C2")
    assert out["course_level"] == "C2"


def test_clearing_a_level_stores_null_not_empty_string(db):
    """An empty string would be a level named "" — it would show up in the
    suggestion list and in filters as a real value."""
    db.t["writing_prompts"] = [{"id": "w1", "course_level": "C4"}]
    assert svc.set_course_level("writing", "w1", "   ")["course_level"] is None
    assert svc.set_course_level("writing", "w1", None)["course_level"] is None


def test_an_unknown_kind_is_refused(db):
    for fn, args in ((svc.set_course_level, ("speaking", "x", "C2")),
                     (svc.set_cohorts, ("speaking", "x", [])),
                     (svc.cohorts_for, ("speaking", []))):
        with pytest.raises(svc.UnknownKindError):
            fn(*args)


def test_a_missing_row_is_reported_not_silently_ignored(db):
    db.t["reading_tests"] = []
    with pytest.raises(LookupError):
        svc.set_course_level("reading", "nope", "C2")


def test_known_levels_are_derived_from_the_data(db):
    """The column is free text on purpose — a CHECK would need a migration per
    new course — so the suggestion list must never be hard-coded."""
    db.t["reading_tests"] = [{"id": "r1", "course_level": "C2"},
                             {"id": "r2", "course_level": "  "}]
    db.t["listening_tests"] = [{"id": "l1", "course_level": "C4"}]
    db.t["writing_prompts"] = [{"id": "w1", "course_level": "C2"}]
    assert svc.known_course_levels() == ["C2", "C4"]


# ── Cohort assignment ─────────────────────────────────────────────────


def test_assigning_a_paper_to_several_classes(db):
    """Many-to-many was the explicit decision: a paper is reused across classes."""
    db.t["reading_tests"] = [{"id": "r1"}]
    out = svc.set_cohorts("reading", "r1", ["c1", "c2"], created_by="admin")
    assert out["cohort_ids"] == ["c1", "c2"]
    assert svc.cohorts_for("reading", ["r1"]) == {"r1": ["c1", "c2"]}


def test_it_replaces_the_set_rather_than_appending(db):
    """The screen shows every tick, so what it sends IS the intended state."""
    db.t["reading_tests"] = [{"id": "r1"}]
    db.t["reading_tests"] = [{"id": "r1"}]
    svc.set_cohorts("reading", "r1", ["c1", "c2"])
    out = svc.set_cohorts("reading", "r1", ["c2", "c3"])
    assert out["cohort_ids"] == ["c2", "c3"]
    assert svc.cohorts_for("reading", ["r1"])["r1"] == ["c2", "c3"]


def test_re_sending_the_same_set_changes_nothing(db):
    """A double-click must not create a duplicate that then needs two clicks to
    undo — nor churn rows for no reason."""
    db.t["reading_tests"] = [{"id": "r1"}]
    svc.set_cohorts("reading", "r1", ["c1"])
    before = list(db.t["exam_content_cohorts"])
    out = svc.set_cohorts("reading", "r1", ["c1"])
    assert out == {"added": [], "removed": 0, "cohort_ids": ["c1"]}
    assert db.t["exam_content_cohorts"] == before


def test_the_replacement_is_one_statement_not_two_calls(db):
    """As insert-then-delete, a failing delete left {old ∪ new} persisted while
    the request reported an error — the endpoint had both FAILED and WIDENED the
    assignment. Reversing the order only swaps that for "assigned to nobody", so
    the fix is a transaction (mig 172, Codex review PR #864)."""
    import inspect
    src = inspect.getsource(svc.set_cohorts)
    assert 'rpc("fn_set_exam_content_cohorts"' in src
    assert ".insert(" not in src and ".delete(" not in src


def test_assigning_to_content_that_does_not_exist_is_refused(db):
    """The join table deliberately has no FK on content_id, so nothing else stops
    a stale UUID being "assigned" while the endpoint reports success."""
    db.t["reading_tests"] = []
    with pytest.raises(LookupError):
        svc.set_cohorts("reading", "ghost", ["c1"])
    assert not db.t.get("exam_content_cohorts")


def test_kinds_do_not_bleed_into_each_other(db):
    """content_id is polymorphic — the same UUID could exist in two libraries."""
    db.t["reading_tests"] = [{"id": "x1"}]
    db.t["listening_tests"] = [{"id": "x1"}]
    svc.set_cohorts("reading", "x1", ["c1"])
    svc.set_cohorts("listening", "x1", ["c2"])
    assert svc.cohorts_for("reading", ["x1"])["x1"] == ["c1"]
    assert svc.cohorts_for("listening", ["x1"])["x1"] == ["c2"]


def test_cohorts_for_answers_for_every_id_asked_about(db):
    """A list screen renders one row per id; a missing key would be a crash or a
    silently blank cell."""
    db.t["reading_tests"] = [{"id": "r1"}]
    svc.set_cohorts("reading", "r1", ["c1"])
    assert svc.cohorts_for("reading", ["r1", "r2"]) == {"r1": ["c1"], "r2": []}
    assert svc.cohorts_for("reading", []) == {}


# ── The combined screen ───────────────────────────────────────────────


def _seed_three(db):
    db.t["reading_tests"] = [
        {"id": "r1", "test_id": "R-01", "title": "R one", "status": "published",
         "exam_only": True, "course_level": "C2"},
    ]
    db.t["listening_tests"] = [
        {"id": "l1", "test_id": "L-01", "title": "L one", "status": "published",
         "exam_only": False, "course_level": "C4"},
    ]
    db.t["writing_prompts"] = [
        {"id": "w1", "title": "W one", "is_active": True,
         "exam_only": True, "course_level": "C2"},
    ]


def test_one_screen_covers_all_three_libraries(db):
    _seed_three(db)
    kinds = {r["kind"] for r in svc.list_exam_content()["items"]}
    assert kinds == {"reading", "listening", "writing"}


def test_writing_status_is_normalised_so_one_column_serves_three(db):
    """Prompts are soft-deleted with is_active, tests carry a status enum."""
    _seed_three(db)
    by_kind = {r["kind"]: r for r in svc.list_exam_content()["items"]}
    assert by_kind["writing"]["status"] == "published"
    db.t["writing_prompts"][0]["is_active"] = False
    by_kind = {r["kind"]: r for r in svc.list_exam_content()["items"]}
    assert by_kind["writing"]["status"] == "archived"


def test_filters(db):
    _seed_three(db)
    svc.set_cohorts("reading", "r1", ["c1"])
    assert {r["kind"] for r in svc.list_exam_content(course_level="C2")["items"]} == {"reading", "writing"}
    assert {r["kind"] for r in svc.list_exam_content(exam_only=False)["items"]} == {"listening"}
    assert [r["id"] for r in svc.list_exam_content(cohort_id="c1")["items"]] == ["r1"]
    assert svc.list_exam_content(cohort_id="nope")["items"] == []


def test_one_broken_library_does_not_blank_the_whole_screen(db, monkeypatch):
    """An admin looking at 3 libraries should still see 2 when one errors —
    returning nothing reads as "there are no papers", which is worse."""
    _seed_three(db)
    real = db.table

    def flaky(name):
        if name == "listening_tests":
            raise RuntimeError("postgrest down")
        return real(name)

    monkeypatch.setattr(svc, "supabase_admin", type("D", (), {"table": staticmethod(flaky)})())
    kinds = {r["kind"] for r in svc.list_exam_content()["items"]}
    assert kinds == {"reading", "writing"}


# ── Migration ─────────────────────────────────────────────────────────


def _mig() -> str:
    return (BACKEND / "migrations" / "171_exam_content_level_cohort.sql").read_text(encoding="utf-8")


def test_all_three_tables_get_the_level_column():
    sql = _mig()
    for t in ("reading_tests", "listening_tests", "writing_prompts"):
        assert re.search(rf"ALTER TABLE {t}\s+ADD COLUMN IF NOT EXISTS course_level", sql), t


def _mig_statements() -> str:
    """The migration with comments stripped — the prose explains WHY there is no
    CHECK on course_level, so matching raw text asserts against itself."""
    return "\n".join(l for l in _mig().splitlines() if not l.lstrip().startswith("--"))


def test_the_level_has_no_check_constraint():
    """A CHECK would mean a migration every time a course is added, which
    guarantees the column stops being maintained."""
    stmts = _mig_statements()
    assert "course_level" in stmts
    assert not re.search(r"course_level TEXT[^;]*CHECK", stmts)


def test_the_join_table_cannot_hold_duplicates():
    assert re.search(r"UNIQUE \(content_kind, content_id, cohort_id\)", _mig())


def test_deleting_a_class_cleans_up_after_itself():
    """The cohort side CAN have a real FK, so it must — otherwise rows outlive
    the class they point at."""
    assert "cohort_id     UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE" in _mig()


def test_the_content_kind_is_constrained():
    """Unlike course_level, this set only changes when the platform grows a new
    skill — which is a code change anyway."""
    assert "CHECK (content_kind IN ('reading', 'listening', 'writing'))" in _mig()


def test_the_join_table_is_backend_only():
    assert "ALTER TABLE exam_content_cohorts ENABLE ROW LEVEL SECURITY" in _mig()


def test_the_reverse_is_written_down():
    sql = _mig()
    assert "TO REVERSE" in sql
    assert "DROP TABLE IF EXISTS exam_content_cohorts" in sql


# ── Router ────────────────────────────────────────────────────────────


def test_every_route_is_admin_only():
    src = (BACKEND / "routers" / "admin_exam_content.py").read_text(encoding="utf-8")
    assert src.count("require_admin(authorization)") == 3


def test_the_router_is_registered():
    main = (BACKEND / "main.py").read_text(encoding="utf-8")
    assert "admin_exam_content_router" in main
    assert "app.include_router(admin_exam_content_router)" in main


def test_replacing_the_cohort_set_is_not_a_post():
    """POST reads as "add one", which is not what this does. PUT would say it
    best but is NOT in _CORS_METHODS — adding a verb for one endpoint means a
    preflight that fails for every client holding a cached one, the exact
    failure that swallowed a student's paper on 2026-07-26. PATCH it is, with
    the contract stated in the docstring."""
    src = (BACKEND / "routers" / "admin_exam_content.py").read_text(encoding="utf-8")
    assert '@router.patch("/{kind}/{content_id}/cohorts")' in src
    assert '@router.post("/{kind}/{content_id}/cohorts")' not in src
    seg = src[src.index("async def set_cohorts("):]
    assert "Thay TOÀN BỘ" in seg[:600]


def test_the_verb_used_by_the_page_is_in_the_cors_allowlist():
    """A method the allowlist does not carry is blocked in the browser BEFORE it
    is sent — and nothing server-side ever sees it."""
    import main as app_main
    js = (BACKEND.parent / "frontend" / "public" / "js" / "admin-exam-content.js").read_text(encoding="utf-8")
    for verb, fn in (("PATCH", "window.api.patch("), ("GET", "window.api.get(")):
        if fn in js:
            assert verb in app_main._CORS_METHODS, verb
    assert "window.api.put(" not in js, "api.js has no put(), and PUT is not allowed by CORS"


# ── A broken library is NAMED, not silently rendered as empty ─────────


def test_a_failed_library_is_reported_to_the_caller(db, monkeypatch):
    """Keeping the other two visible is right, but a silent partial reads exactly
    like "there is no content" — and an admin then chooses a paper from an
    incomplete list without knowing it (Codex review, PR #864)."""
    _seed_three(db)
    real = db.table

    def flaky(name):
        if name == "listening_tests":
            raise RuntimeError("postgrest down")
        return real(name)

    monkeypatch.setattr(svc, "supabase_admin",
                        type("D", (), {"table": staticmethod(flaky)})())
    out = svc.list_exam_content()
    assert {r["kind"] for r in out["items"]} == {"reading", "writing"}
    assert out["failed_kinds"] == ["listening"]


def test_a_healthy_run_reports_no_failures(db):
    _seed_three(db)
    assert svc.list_exam_content()["failed_kinds"] == []


def test_the_endpoint_passes_the_failure_through():
    """A field the API never returns cannot warn anybody."""
    src = (BACKEND / "routers" / "admin_exam_content.py").read_text(encoding="utf-8")
    assert '"failed_kinds": res["failed_kinds"]' in src


def test_assigning_to_missing_content_is_a_404_not_a_500():
    src = (BACKEND / "routers" / "admin_exam_content.py").read_text(encoding="utf-8")
    seg = src[src.index("async def set_cohorts("):]
    assert "except LookupError as e:" in seg
    assert "HTTPException(404" in seg


# ── Migration 172 ─────────────────────────────────────────────────────


def _mig172() -> str:
    return (BACKEND / "migrations" / "172_fn_set_exam_content_cohorts.sql").read_text(encoding="utf-8")


def test_the_replacement_happens_in_one_statement():
    """Both the delete and the insert must be inside the SAME statement — as two
    calls, a failing delete left {old ∪ new} persisted while the request
    reported an error."""
    sql = _mig172()
    body = sql[sql.index("WITH wanted AS"):sql.index("RETURN jsonb_build_object")]
    assert "DELETE FROM exam_content_cohorts" in body
    assert "INSERT INTO exam_content_cohorts" in body


def test_re_sending_the_same_set_is_a_no_op_at_the_database():
    """The admin screen sends the whole state on every save; a double-click must
    not rewrite rows that are already right."""
    assert "ON CONFLICT (content_kind, content_id, cohort_id) DO NOTHING" in _mig172()


def test_the_kind_is_validated():
    assert "p_kind NOT IN ('reading', 'listening', 'writing')" in _mig172()


def test_it_is_backend_only():
    sql = _mig172()
    assert "SECURITY DEFINER" in sql
    assert "SET search_path = public, pg_temp" in sql
    assert re.search(r"REVOKE\s+EXECUTE[\s\S]{0,120}FROM\s+PUBLIC,\s*anon,\s*authenticated", sql)
    assert re.search(r"GRANT\s+EXECUTE[\s\S]{0,120}TO\s+service_role", sql)


def test_the_reverse_is_written_down_172():
    assert "TO REVERSE" in _mig172()
