"""Fail-closed SQL catalog enforcement; full-history closure is still OPEN.

PG tests execute actual 306 alongside 381/382 on synthetic dependencies. The
legacy reader report is explicitly OPEN, never copied into the allowlist.
"""
import json
from pathlib import Path

import pytest

from namespace_pg17 import MA, MB, bootstrap, local_pg17, migration
from namespace_sql_inventory import CATALOG_SQL, audit_catalog, from_output, load_allowlist, readers


def test_unlisted_sql_reader_is_rejected():
    row = {"object":"public.new_reader()", "name":"new_reader", "kind":"function",
           "definition":"SELECT * FROM public.listening_tests", "options":[]}
    with pytest.raises(AssertionError, match="unlisted SQL reader: public.new_reader"):
        audit_catalog([row])


def test_transitive_and_dynamic_sql_readers_cannot_escape_inventory():
    catalog = [
        {"object":"public.leaf()", "name":"leaf", "kind":"function", "definition":"SELECT * FROM listening_tests", "options":[]},
        {"object":"public.caller()", "name":"caller", "kind":"function", "definition":"SELECT public.leaf()", "options":[]},
        {"object":"public.dynamic()", "name":"dynamic", "kind":"function", "definition":"EXECUTE format('SELECT * FROM public.%I', table_name)", "options":[]},
        {"object":"app_private.opaque()", "name":"opaque", "kind":"function", "definition":"BEGIN EXECUTE query; END", "options":[]},
    ]
    assert set(readers(catalog)) == {r["object"] for r in catalog}
    with pytest.raises(AssertionError, match="public.dynamic"):
        audit_catalog(catalog)


def test_allowlisted_view_and_pager_still_require_barrier_and_predicate():
    row = {"object":"public.listening_public_practice_catalog", "name":"listening_public_practice_catalog",
           "kind":"view", "definition":"SELECT * FROM public.listening_tests", "options":[]}
    with pytest.raises(AssertionError, match="view without security_barrier"):
        audit_catalog([row])
    row["options"] = ["security_barrier=true"]
    with pytest.raises(AssertionError, match="view without restricted predicate"):
        audit_catalog([row])
    allowlist = load_allowlist()
    key = next(k for k in allowlist if "fn_admin_exam_content_page_ids" in k)
    row = {"object":key,"name":"fn_admin_exam_content_page_ids","kind":"function",
           "definition":"SELECT count(*) FROM public.listening_tests LIMIT 5", "options":[]}
    with pytest.raises(AssertionError, match="paging/count reader without restricted predicate"):
        audit_catalog([row])


def test_pg_catalog_proven_subset_negative_addition_and_open_legacy_report():
    with local_pg17("sql-inventory") as pg:
        output = pg.psql(bootstrap() + migration(MA) + migration(MB) + CATALOG_SQL + """
CREATE FUNCTION public.namespace_negative_reader() RETURNS SETOF public.listening_tests
LANGUAGE sql SECURITY INVOKER AS 'SELECT * FROM public.listening_tests';
""" + CATALOG_SQL)
        before, after = from_output(output)
        allowlist = load_allowlist()
        # Prove only the new namespace objects; legacy readers stay OPEN.
        proven = [r for r in before if r["object"] in allowlist]
        assert set(audit_catalog(proven)) == set(allowlist)
        addition = [r for r in after if r["object"] in allowlist or r["name"] == "namespace_negative_reader"]
        with pytest.raises(AssertionError, match="unlisted SQL reader: public.namespace_negative_reader"):
            audit_catalog(addition)
        with pytest.raises(AssertionError, match="unlisted SQL reader"):
            audit_catalog(before)
        unresolved = sorted(set(readers(before)) - set(allowlist))
        (pg.log_dir / "sql-inventory-OPEN.json").write_text(json.dumps(unresolved, indent=2) + "\n")
        baseline = json.loads(Path(__file__).with_name("fixtures").joinpath("restricted_content_sql_OPEN.json").read_text())
        assert all(r["state"] == "OPEN" and r["owner"] and r["reason"] for r in baseline)
        assert unresolved == sorted(r["object"] for r in baseline), "New unlisted readers may not join the OPEN baseline silently"
        assert unresolved, "Full-history SQL inventory must not be represented as closed by this focused fixture"
