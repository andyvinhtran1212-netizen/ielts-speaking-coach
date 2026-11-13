"""Conservative SQL reader inventory and fail-closed allowlist enforcement.

Catalog input must come from a disposable local cluster. Direct table readers,
view readers and transitive routine callers are included. Unknown/dynamic SQL
is reported rather than silently certified. This helper does not connect to DBs.
"""
from __future__ import annotations

import json
from pathlib import Path
import re

TABLES = frozenset({"listening_tests", "listening_content", "listening_exercises",
                    "listening_test_attempts", "dictation_sessions", "dictation_attempts",
                    "listening_content_packages", "listening_lessons", "mock_paper_attempt_snapshots"})
CLASSES = frozenset({"view", "by_id_guarded", "bound_at_link", "write_only"})
ALLOWLIST = Path(__file__).with_name("fixtures") / "restricted_content_sql_allowlist.json"

CATALOG_SQL = r"""
SELECT '__NAMESPACE_CATALOG__' || COALESCE(pg_catalog.jsonb_agg(x ORDER BY x->>'object'),'[]'::jsonb)::text FROM (
    SELECT pg_catalog.jsonb_build_object(
        'object', n.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')',
        'kind','function','name',p.proname,'definition',p.prosrc,'options',p.proconfig,
        'security_definer',p.prosecdef) AS x
      FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'
    UNION ALL
    SELECT pg_catalog.jsonb_build_object('object',n.nspname||'.'||c.relname,'kind','view','name',c.relname,
        'definition',pg_catalog.pg_get_viewdef(c.oid),'options',c.reloptions)
      FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND c.relkind IN ('v','m')
) AS catalog;
"""


def from_output(output):
    return [json.loads(line.strip().removeprefix("__NAMESPACE_CATALOG__"))
            for line in output.splitlines() if line.strip().startswith("__NAMESPACE_CATALOG__")]


def readers(catalog):
    """Follow literal SQL table/view references and named SQL routine calls.

    Comments are excluded. Literal dynamic SQL (FROM public.<table>) is included.
    A dynamic relation identifier is an unresolved reader, requiring manual proof.
    Function overloads are intentionally conservative: all matching names count.
    """
    objects = {r["object"]: r for r in catalog}
    by_name = {}
    for identity, row in objects.items():
        by_name.setdefault(row["name"].lower(), set()).add(identity)
    direct, links, unknown = {}, {}, set()
    for identity, row in objects.items():
        sql = re.sub(r"/\*.*?\*/|--[^\n]*", " ", row["definition"], flags=re.S).lower()
        names = set(re.findall(r'\b(?:from|join|update|into)\s+(?:"?public"?\s*\.\s*)?"?([a-z_][a-z_0-9]*)', sql))
        direct[identity] = names & TABLES
        links[identity] = set().union(*(by_name.get(name, set()) for name in names)) if names else set()
        for name in re.findall(r'\b(?:"?public"?\s*\.\s*)?"?([a-z_][a-z_0-9]*)"?\s*\(', sql):
            links[identity].update(by_name.get(name, set()))
        executable = re.sub(r"'(?:[^']|'')*'", "''", sql)
        if re.search(r"\bexecute\b", executable):
            # Opaque SQL variables and split string construction must not turn
            # an undiscovered reader into an implicitly allowed function.
            unknown.add(identity)
    changed = True
    while changed:
        changed = False
        for identity, dependencies in links.items():
            combined = direct[identity] | set().union(*(direct[d] for d in dependencies)) if dependencies else direct[identity]
            if combined != direct[identity]:
                direct[identity] = combined
                changed = True
            if identity not in unknown and dependencies & unknown:
                unknown.add(identity)
                changed = True
    return {identity: {**objects[identity], "tables": sorted(tables), "unresolved_dynamic": identity in unknown}
            for identity, tables in direct.items() if tables or identity in unknown}


def load_allowlist():
    rows = json.loads(ALLOWLIST.read_text())
    assert len({r["object"] for r in rows}) == len(rows), "duplicate SQL allowlist object"
    for row in rows:
        assert row["class"] in CLASSES
        assert row["reason"].strip() and row["proving_test"].strip()
        file, test = row["proving_test"].split("::", 1)
        source = Path(__file__).with_name(file).read_text()
        assert re.search(r"\bdef " + re.escape(test) + r"\(", source), row["proving_test"]
    return {r["object"]: r for r in rows}


def audit_catalog(catalog, allowlist=None):
    """Raise with all unknown/unsafe readers together; OPEN never means allowed."""
    allowlist = load_allowlist() if allowlist is None else allowlist
    found = readers(catalog)
    errors = []
    for identity, row in sorted(found.items()):
        if identity not in allowlist:
            errors.append(f"unlisted SQL reader: {identity} ({','.join(row['tables']) or 'dynamic relation'})")
            continue
        if row["unresolved_dynamic"]:
            errors.append(f"unresolved dynamic SQL reader: {identity}")
        definition = row["definition"].lower()
        if row["kind"] == "view" and "security_barrier=true" not in (row["options"] or []):
            errors.append(f"view without security_barrier: {identity}")
        if row["kind"] == "view" and not re.search(r"\bnot\s+(?:[a-z_]+\.)?restricted\b", definition):
            errors.append(f"view without restricted predicate: {identity}")
        if (re.search(r"\bcount\s*\(|\blimit\b|\boffset\b", definition)
                or re.search(r"page|count|levels", row["name"])) and "restricted" not in definition:
            errors.append(f"paging/count reader without restricted predicate: {identity}")
    if errors:
        raise AssertionError("\n".join(errors))
    return found
