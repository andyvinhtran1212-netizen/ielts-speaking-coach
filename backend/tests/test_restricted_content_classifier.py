"""Bulk classification proofs and negative examples; no database access."""
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from restricted_content_classifier import (
    NAMESPACE_TABLES, RULES, SQL_REVISION, VIEWS, build, classify, row_key,
)
from restricted_content_inventory import scan_sources


BACKEND = Path(__file__).resolve().parents[1]
FIXTURES = BACKEND / "tests/fixtures"


@pytest.fixture(scope="module")
def current():
    return build(BACKEND)


def test_classification_recomputes_every_candidate_and_inherited_row(current):
    saved = json.loads((FIXTURES / "restricted_content_classification.json").read_text())
    assert current == saved
    candidates = json.loads((FIXTURES / "restricted_content_open_inventory.json").read_text())["rows"]
    assert len(current["rows"]) == len(candidates) == 868
    assert set(current["rows"]) == {row_key(r) for r in candidates}
    assert sum(current["counts"].values()) == 868
    assert current["real_reader_count"] == sum(
        r["bucket"] in {"B1", "B2", "B4c"} for r in current["rows"].values())
    assert all(r["bucket"] in RULES and r["rule_id"] == r["bucket"] + "-v1"
               for r in current["rows"].values())
    assert len(current["inherited"]) == 48
    for row in current["inherited"].values():
        assert row["reason"]
        if row["disposition"] == "RETIRED":
            assert row["references"] == []
        elif row["disposition"] == "FALSE_POSITIVE":
            assert row["reader_closure"] == []
        else:
            assert row["disposition"] == "mapped-to-current-row"
            assert row["target"] in current["rows"]


def test_transitive_noncontent_closure_is_empty_and_callers_stay_dependent(current):
    for row in current["rows"].values():
        if row["bucket"] == "B4a":
            assert row["reader_closure"] == []
            assert row["state"] == "BULK_PROVEN"
        if row["bucket"] in {"B4b", "B4c"}:
            assert row["reader_closure"]
            assert bool(row["aggregation_lines"]) == (row["bucket"] == "B4c")
        if row["bucket"] == "B4b":
            assert row["state"] == "DEPENDENT"


def test_public_view_rows_have_no_other_namespace_read_site(current):
    sql = set(json.loads((FIXTURES / "restricted_content_sql_reader_pin.json").read_text())["rpc_names"])
    for row in current["rows"].values():
        if row["bucket"] != "B3":
            continue
        assert row["mechanism"] == "view"
        assert row["reader_closure"] == []
        for site in row["read_sites"]:
            assert site["kind"] != "unresolved"
            if site["kind"] == "table":
                assert site["target"] is not None
                assert not set(site["target"]) & NAMESPACE_TABLES
            if site["kind"] == "rpc":
                assert site["target"] is not None and not set(site["target"]) & sql


def test_non_namespace_rpcs_are_disjoint_from_the_pinned_sql_set(current):
    pin = json.loads((FIXTURES / "restricted_content_sql_reader_pin.json").read_text())
    assert pin["revision"] == SQL_REVISION
    assert hashlib.sha256(json.dumps(pin, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == "7fa38f6e3f50b52f03aca6dce195435afd0f2ec36a8ae19099092bb9475aa5d2"
    assert set(pin["rpc_names"]) == {o.split("(")[0].split(".")[-1] for o in pin["objects"]}
    assert set(pin["replaced_functions"]) <= {o.split("(")[0] for o in pin["objects"]}
    assert len(pin["rpc_names"]) == 33
    for row in current["rows"].values():
        if row["bucket"] == "B5":
            assert row["reader_closure"] == []
            rpcs = [s for s in row["read_sites"] if s["kind"] == "rpc"]
            assert rpcs
            assert all(s["target"] is not None and not set(s["target"]) & set(pin["rpc_names"])
                       for s in rpcs)


def test_string_and_write_only_bucket_has_no_content_read_or_dependency(current):
    for row in current["rows"].values():
        if row["bucket"] != "B6":
            continue
        assert row["reader_closure"] == []
        for site in row["read_sites"]:
            assert site["kind"] in {"table", "write"}
            if site["kind"] == "table":
                assert site["target"] is not None
                assert not set(site["target"]) & (NAMESPACE_TABLES | VIEWS)
        if row["read_sites"] and all(s["kind"] == "write" for s in row["read_sites"]):
            assert row["mechanism"] == "write_only"


def classified(source, extra=None):
    sources = {"routers/example.py": source, **(extra or {})}
    candidates = [r for r in scan_sources(sources) if r["file"] == "routers/example.py"]
    return classify(sources, candidates, {"content_rpc"})["rows"]


@pytest.mark.parametrize("body,bucket", [
    ("return db.table('listening_tests').select('*').execute()", "B1"),
    ("return db.from_('listening_content').select('*').execute()", "B1"),
    ("return db.rpc('content_rpc').execute()", "B1"),
    ("return db.rpc('ordinary_rpc').execute()", "B5"),
    ("return db.table(table).select('*').execute()", "B2"),
    ("return db.rpc(table).execute()", "B2"),
    ("return getattr(db, table)(table)", "B2"),
    ("read = db.table\n    return read(table)", "B2"),
    ("return {'listening_tests': 'log label'}", "B6"),
    ("db.table('listening_tests').insert({}).execute()", "B6"),
    ("return db.table('listening_tests').insert({}).execute()", "B1"),
    ("return db.table('listening_tests').update({}).select('*').execute()", "B1"),
    ("return db.table('listening_tests').delete(returning='minimal').execute()", "B6"),
    ("table = 'ordinary'\n    return db.table(table).select('*').execute()", "B2"),
])
def test_direct_dynamic_write_and_nonflow_cases(body, bucket):
    # A parameter assignment is not a whole-function proof: preserve its unknown
    # input rather than assuming an assignment executes on every path.
    rows = classified("def example(db, table):\n    " + body + "\n")
    assert rows["routers/example.py::example"]["bucket"] == bucket


@pytest.mark.parametrize("prefix,expression,bucket", [
    ("TABLE = 'listening_' + 'tests'", "TABLE", "B1"),
    ("TABLE = {'listening': 'listening_tests', 'reading': 'reading_tests'}", "TABLE[skill]", "B1"),
    ("TABLE = 'ordinary'", "TABLE", "B6"),
    ("TABLE = 'ordinary' if condition else 'listening_tests'", "TABLE", "B1"),
    ("TABLE = 'ordinary' if condition else unknown", "TABLE", "B2"),
    ("def factory():\n    return 'listening_tests'", "factory()", "B1"),
    ("TABLE = 'ordinary'", "f'{skill}_test_attempts'", "B2"),
])
def test_constant_propagation_and_factory_returns(prefix, expression, bucket):
    rows = classified(prefix + "\ndef example(db, skill):\n    return db.table(" + expression + ").select('*').execute()\n")
    assert rows["routers/example.py::example"]["bucket"] == bucket


def test_module_local_getattr_literals_are_resolved():
    rows = classified("def example(obj):\n    for name in ('status_code', 'status'):\n        value = getattr(obj, name)\n")
    assert rows["routers/example.py::example"]["bucket"] == "B6"


def test_imported_rpc_alias_is_a_real_reader():
    rows = classified("from database import rpc as invoke\ndef example():\n    return invoke('content_rpc')\n")
    assert rows["routers/example.py::example"]["bucket"] == "B1"


@pytest.mark.parametrize("binding,call,bucket", [
    ("read = db.table", "read('listening_tests')", "B1"),
    ("read = db.rpc", "read('ordinary_rpc')", "B5"),
    ("read = db.table", "read('ordinary_table')", "B6"),
    ("", "getattr(db, 'table')('listening_tests')", "B1"),
    ("method = 'rpc'", "getattr(db, method)('ordinary_rpc')", "B5"),
    ("read = db.table\n    consume(read)", "read('ordinary_table')", "B2"),
])
def test_resolved_method_aliases_and_getattr_are_rebucketed(binding, call, bucket):
    source = "def example(db):\n    " + (binding + "\n    " if binding else "") + "return " + call + ".execute()\n"
    assert classified(source)["routers/example.py::example"]["bucket"] == bucket


def test_dictionary_iteration_uses_keys_and_get_includes_default():
    rows = classified("TABLES = {'listening_tests': 'ordinary'}\ndef example(db):\n    for table in TABLES:\n        db.table(table).select('*').execute()\n")
    assert rows["routers/example.py::example"]["bucket"] == "B1"
    rows = classified("TABLES = {'x': 'ordinary'}\ndef example(db, skill):\n    return db.table(TABLES.get(skill, 'listening_tests')).select('*').execute()\n")
    assert rows["routers/example.py::example"]["bucket"] == "B1"


@pytest.mark.parametrize("mutation", ["TABLES.append(value)", "TABLES += [value]", "TABLES[0] = value"])
def test_mutated_literal_collections_never_become_noncontent(mutation):
    rows = classified("def example(db, value):\n    TABLES = ['ordinary']\n    " + mutation + "\n    return db.table(TABLES[0]).select('*').execute()\n")
    assert rows["routers/example.py::example"]["bucket"] == "B2"


def test_storage_from_is_not_a_table_reader():
    assert scan_sources({"routers/example.py": "def example(db, name):\n    return db.storage.from_(name).download('audio')\n"}) == []


def test_transitive_closure_follows_root_modules_and_cycles():
    extra = {
        "bridge.py": "from services.reader import read\ndef fetch(db):\n    return read(db)\n",
        "services/reader.py": "def read(db):\n    return db.table('listening_tests').select('*').execute().data\n",
    }
    rows = classified("from bridge import fetch\ndef example(db):\n    return fetch(db)\n", extra)
    row = rows["routers/example.py::example"]
    assert row["bucket"] == "B4b"
    assert row["reader_closure"] == ["services/reader.py::read"]
    # Existing scanner and the classifier both retain the cycle without an
    # unbounded walk; no content dependency gets lost at an intermediate node.
    extra["services/reader.py"] = "from bridge import fetch\ndef read(db):\n    fetch(db)\n    return db.table('listening_tests').select('*').execute().data\n"
    assert classified("from bridge import fetch\ndef example(db):\n    return fetch(db)\n", extra)["routers/example.py::example"]["bucket"] == "B4b"


@pytest.mark.parametrize("operation", ["len(rows)", "sum(r['score'] for r in rows)", "rows[1:10]", "[r for r in rows]", "sorted(rows)"])
def test_content_caller_collection_operations_remain_real_readers(operation):
    extra = {"services/reader.py": "def read(db):\n    return db.table('listening_tests').select('*').execute().data\n"}
    rows = classified("from services.reader import read\ndef example(db):\n    rows = read(db)\n    return " + operation + "\n", extra)
    assert rows["routers/example.py::example"]["bucket"] == "B4c"


def test_public_helper_mixed_with_raw_read_cannot_be_bulk_closed():
    source = "from services.content_visibility import public_tests\ndef example(db):\n    public_tests(db).select('*').execute()\n    return db.table('listening_content').select('*').execute()\n"
    assert classified(source)["routers/example.py::example"]["bucket"] == "B1"


def test_tuple_unpacking_preserves_aggregation_flow():
    extra = {"services/reader.py": "def read(db):\n    return db.table('listening_tests').select('*').execute().data, True\n"}
    rows = classified("from services.reader import read\ndef example(db):\n    rows, ok = read(db)\n    return len(rows)\n", extra)
    assert rows["routers/example.py::example"]["bucket"] == "B4c"


def test_in_place_collection_operation_preserves_aggregation_flow():
    extra = {"services/reader.py": "def read(db):\n    return db.table('listening_tests').select('*').execute().data\n"}
    rows = classified("from services.reader import read\ndef example(db):\n    rows = read(db)\n    rows.sort()\n    return rows\n", extra)
    assert rows["routers/example.py::example"]["bucket"] == "B4c"


@pytest.mark.parametrize("helper,view", [
    ("public_tests", "v_listening_tests_public"),
    ("public_content", "v_listening_content_public"),
    ("public_attempts", "v_listening_attempts_public"),
    ("public_dictation", "v_dictation_sessions_public"),
])
def test_public_helper_uses_exact_view_with_explicit_false_contract(helper, view):
    from services import content_visibility
    calls = []
    source = [{"id": "allowed", "restricted": False}, {"id": "hidden", "restricted": True},
              {"id": "null", "restricted": None}, {"id": "missing"}]

    def table(name):
        calls.append(name)
        assert name == view and name in VIEWS
        # This models the frozen SQL contract, not a PostgreSQL acceptance
        # test. N2 owns the real view predicate/catalog proof at its SQL head.
        return [r for r in source if r.get("restricted") is False]

    assert getattr(content_visibility, helper)(SimpleNamespace(table=table)) == [source[0]]
    assert calls == [view]


def test_public_programmes_excludes_registry_before_query_and_propagates_errors(monkeypatch):
    from services import content_visibility
    calls = []
    query = SimpleNamespace(not_=SimpleNamespace(in_=lambda *args: calls.append(args) or "filtered"))
    monkeypatch.setattr(content_visibility, "restricted_programmes", lambda db: frozenset({"restricted"}))
    assert content_visibility.public_programmes(object(), query) == "filtered"
    assert calls == [("programme_id", ["restricted"])]

    def failed(db):
        raise RuntimeError("registry unavailable")
    monkeypatch.setattr(content_visibility, "restricted_programmes", failed)
    with pytest.raises(RuntimeError, match="registry unavailable"):
        content_visibility.public_programmes(object(), query)
