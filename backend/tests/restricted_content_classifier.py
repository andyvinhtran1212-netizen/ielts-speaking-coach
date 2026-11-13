"""Mechanical disposition of the conservative namespace inventory.

Classification is not security acceptance: B1/B2/B4c remain OPEN and B4b
depends on its reader closure. Unknown values are never guessed safe. The SQL
set is a versioned extraction, not the current branch's (absent) migrations.
"""
from __future__ import annotations

import ast
import hashlib
import json
from collections import Counter
from functools import cache
from pathlib import Path

from restricted_content_inventory import (
    NAMESPACE_TABLES, PUBLIC_HELPERS, PUBLIC_OBJECTS, _own_nodes, _scopes,
    scan_sources,
)


SQL_REVISION = "fb18926811cfcc4e3bbc13903cc88e5515e8cd0f"
VIEWS = PUBLIC_OBJECTS - {"content_access_namespaces"}
WRITES = {"insert", "update", "upsert", "delete"}
RULES = {
    "B1": "direct namespace table, SQL-set RPC, or literal factory flow",
    "B2": "unresolved dynamic table/RPC/method value; fail closed",
    "B3": "only public helper/view content sites; no raw or unresolved site",
    "B4a": "callee closure has no B1/B2 reader",
    "B4b": "callee closure hits readers; no content collection operation",
    "B4c": "callee result flows to aggregation, iteration, count or page",
    "B5": "resolved RPCs disjoint from pinned SQL set; no content site",
    "B6": "non-flow string, ordinary literal table, or nonreturning write",
}


def row_key(row):
    return f"{row['file']}::{row['function']}"


def runtime_sources(root):
    # Include scripts/root modules in the read-only closure too. Their fixes
    # and disposition remain Leader-owned, outside the router/service patch.
    excluded = {"tests", "venv", ".venv", "__pycache__", "migrations"}
    paths = list(root.glob("*.py"))
    for directory in root.iterdir():
        if directory.is_dir() and directory.name not in excluded and not directory.name.startswith("."):
            paths.extend(directory.rglob("*.py"))
    return {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8")
            for p in sorted(paths)}


class SourceModel:
    def __init__(self, sources):
        self.sources = sources
        self.scopes = {}
        self.modules = {}
        self.aliases = {}
        for file, source in sources.items():
            tree = ast.parse(source, filename=file)
            module = file.removesuffix(".py").replace("/", ".").removesuffix(".__init__")
            self.modules[file] = module
            self.aliases[file] = {
                a.asname or a.name: f"{n.module}.{a.name}"
                for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                for a in n.names
            }
            self.aliases[file].update({
                a.asname or a.name.split(".")[0]: a.name if a.asname else a.name.split(".")[0]
                for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names
            })
            module_node = ast.Module(body=[n for n in tree.body if not isinstance(
                n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))], type_ignores=[])
            for name, node in [("<module>", module_node), *_scopes(tree.body)]:
                key = f"{file}::{name}"
                self.scopes[key] = (file, name, node)
        self.symbols = {f"{self.modules[f]}.{n}": k for k, (f, n, _) in self.scopes.items()}
        self.assignments = {}
        for key, (_, _, node) in self.scopes.items():
            assignments = {}
            for n in _own_nodes(node):
                pairs = []
                if isinstance(n, ast.Assign):
                    pairs = [(t, n.value) for t in n.targets]
                elif isinstance(n, ast.AnnAssign) and n.value is not None:
                    pairs = [(n.target, n.value)]
                elif isinstance(n, ast.AugAssign):
                    pairs = [(n.target, ast.Name(id="__unresolved_mutation__", ctx=ast.Load()))]
                elif isinstance(n, (ast.For, ast.AsyncFor, ast.comprehension)):
                    pairs = [(n.target, n.iter)]
                elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in {
                    "append", "extend", "insert", "update", "setdefault", "add", "__setitem__"
                }:
                    pairs = [(n.func.value, ast.Name(id="__unresolved_mutation__", ctx=ast.Load()))]
                expanded = []
                for target, value in pairs:
                    if isinstance(target, (ast.Tuple, ast.List)):
                        expanded.extend((part, value) for part in ast.walk(target) if isinstance(part, ast.Name))
                    else:
                        expanded.append((target, value))
                for target, value in expanded:
                    assignments.setdefault(ast.unparse(target), []).append(value)
                    if isinstance(target, ast.Subscript):
                        assignments.setdefault(ast.unparse(target.value), []).append(
                            ast.Name(id="__unresolved_mutation__", ctx=ast.Load()))
            self.assignments[key] = assignments

    def resolve(self, key, expr):
        file, name, _ = self.scopes[key]
        if not isinstance(expr, (ast.Name, ast.Attribute)):
            return None
        parts = ast.unparse(expr).split(".")
        if parts[0] in self.aliases[file]:
            symbol = ".".join([self.aliases[file][parts[0]], *parts[1:]])
            return self.symbols.get(symbol, symbol)
        if parts[0] in {"self", "cls"}:
            parts = parts[1:]
        for length in range(len(name.split(".")), -1, -1):
            symbol = ".".join([self.modules[file], *name.split(".")[:length], *parts])
            if symbol in self.symbols:
                return self.symbols[symbol]
        return None

    def bindings(self, key, expr):
        """Find lexical assignments without borrowing values from imports."""
        file, name, _ = self.scopes[key]
        for length in range(len(name.split(".")), -1, -1):
            scope = f"{file}::{'.'.join(name.split('.')[:length]) if length else '<module>'}"
            assigned = self.assignments.get(scope, {}).get(ast.unparse(expr))
            if assigned:
                return scope, assigned
        return key, []

    def values(self, key, expr, seen=frozenset()):
        """Finite module-local string values, or None for any unknown arm.

        Union all assignments/branches (no last-assignment optimism). Function
        parameters remain unknown. Dict unknown subscripts use all values.
        """
        if expr is None:
            return None
        marker = (key, ast.dump(expr))
        if marker in seen:
            return None
        seen = seen | {marker}
        file, name, node = self.scopes[key]
        def union(expressions):
            values = [self.values(key, e, seen) for e in expressions]
            return None if any(v is None for v in values) else set().union(*values)
        if isinstance(expr, ast.Constant):
            return {expr.value} if isinstance(expr.value, str) else None
        if isinstance(expr, (ast.List, ast.Tuple, ast.Set)):
            return union(expr.elts)
        if isinstance(expr, ast.Dict):
            return union(expr.keys)
        if isinstance(expr, ast.IfExp):
            return union([expr.body, expr.orelse])
        if isinstance(expr, ast.BoolOp):
            return union(expr.values)
        if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add):
            left, right = self.values(key, expr.left, seen), self.values(key, expr.right, seen)
            return None if left is None or right is None else {a + b for a in left for b in right}
        if isinstance(expr, ast.Subscript):
            scope, assigned = self.bindings(key, expr.value)
            dictionaries = [expr.value] if isinstance(expr.value, ast.Dict) else assigned
            if dictionaries and all(isinstance(d, ast.Dict) for d in dictionaries):
                vals = [self.values(scope, v, seen) for d in dictionaries for v in d.values]
                return None if any(v is None for v in vals) else set().union(*vals)
            return self.values(key, expr.value, seen)
        if isinstance(expr, ast.JoinedStr):
            out = {""}
            for part in expr.values:
                vals = self.values(key, part.value if isinstance(part, ast.FormattedValue) else part, seen)
                if vals is None:
                    return None
                out = {a + b for a in out for b in vals}
            return out
        if isinstance(expr, ast.Call):
            if isinstance(expr.func, ast.Attribute) and expr.func.attr in {"get", "values", "keys"}:
                scope, assigned = self.bindings(key, expr.func.value)
                dictionaries = [expr.func.value] if isinstance(expr.func.value, ast.Dict) else assigned
                if dictionaries and all(isinstance(d, ast.Dict) for d in dictionaries):
                    if expr.func.attr == "keys":
                        return self.values(key, expr.func.value, seen)
                    vals = [self.values(scope, v, seen) for d in dictionaries for v in d.values]
                    if expr.func.attr == "get":
                        # An absent key without a literal default is unknown.
                        if len(expr.args) < 2:
                            return None
                        vals.append(self.values(key, expr.args[1], seen))
                    return None if any(v is None for v in vals) else set().union(*vals)
                return None
            target = self.resolve(key, expr.func)
            if target in self.scopes:
                returns = [n.value for n in _own_nodes(self.scopes[target][2]) if isinstance(n, ast.Return)]
                vals = [self.values(target, n, seen) for n in returns]
                return None if not vals or any(v is None for v in vals) else set().union(*vals)
        if isinstance(expr, (ast.Name, ast.Attribute)):
            var = ast.unparse(expr)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and var in {
                a.arg for a in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
            }:
                return None
            scope, values = self.bindings(key, expr)
            if values:
                vals = [self.values(scope, v, seen) for v in values]
                return None if any(v is None for v in vals) else set().union(*vals)
        return None

    def sites(self, key):
        node = self.scopes[key][2]
        parents = {id(c): p for p in _own_nodes(node) for c in ast.iter_child_nodes(p)}
        sites = []
        called_attributes = {id(n.func) for n in _own_nodes(node) if isinstance(n, ast.Call)}

        def methods(expr, seen=frozenset()):
            marker = ast.dump(expr)
            if marker in seen:
                return None
            if isinstance(expr, ast.Attribute) and expr.attr in {"table", "from_", "rpc"}:
                return {expr.attr}
            if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and expr.func.id == "getattr" and len(expr.args) > 1:
                vals = self.values(key, expr.args[1])
                return None if vals is None else vals & {"table", "from_", "rpc"}
            if isinstance(expr, ast.Name):
                _, values = self.bindings(key, expr)
                resolved = [methods(v, seen | {marker}) for v in values]
                if resolved and all(v is not None for v in resolved):
                    return set().union(*resolved)
            return None

        def reference_is_invoked(expr):
            parent = parents.get(id(expr))
            if isinstance(parent, ast.Call) and parent.func is expr:
                return True
            if isinstance(parent, ast.Assign) and len(parent.targets) == 1 and isinstance(parent.targets[0], ast.Name):
                name = parent.targets[0].id
                uses = [v for v in _own_nodes(node) if isinstance(v, ast.Name) and isinstance(v.ctx, ast.Load) and v.id == name]
                return bool(uses) and all(isinstance(parents.get(id(v)), ast.Call) and parents[id(v)].func is v for v in uses)
            return False

        for n in _own_nodes(node):
            if isinstance(n, ast.Attribute) and n.attr in {"table", "from_", "rpc"} and id(n) not in called_attributes and not reference_is_invoked(n):
                sites.append({"kind": "unresolved", "target": ast.unparse(n), "line": n.lineno})
            if not isinstance(n, ast.Call):
                continue
            resolved = self.resolve(key, n.func)
            method = n.func.attr if isinstance(n.func, ast.Attribute) else n.func.id if isinstance(n.func, ast.Name) else ""
            if resolved in {f"services.content_visibility.{h}" for h in PUBLIC_HELPERS} or resolved in {
                f"services/content_visibility.py::{h}" for h in PUBLIC_HELPERS
            }:
                sites.append({"kind": "public", "target": resolved, "line": n.lineno})
                continue
            if resolved in self.scopes:
                continue  # local rpc/table-named functions are callees, not DB calls
            if resolved:
                method = resolved.rsplit(".", 1)[-1]
            if method == "getattr" and len(n.args) > 1:
                vals = self.values(key, n.args[1])
                if vals is None or vals & {"table", "from_", "rpc"} and not reference_is_invoked(n):
                    sites.append({"kind": "unresolved", "target": ast.unparse(n), "line": n.lineno})
            alias_methods = methods(n.func)
            if alias_methods:
                # A mixed table/RPC method set is still unknown unless all
                # targets can be proven safe under both interpretations.
                if len(alias_methods) != 1:
                    sites.append({"kind": "unresolved", "target": ast.unparse(n), "line": n.lineno})
                    continue
                method = next(iter(alias_methods))
            if method not in {"table", "from_", "rpc"}:
                continue
            if method == "from_" and isinstance(n.func, ast.Attribute) and any(
                isinstance(v, ast.Attribute) and v.attr == "storage" for v in ast.walk(n.func.value)
            ):
                continue
            vals = self.values(key, n.args[0] if n.args else None)
            chain = []
            chain_calls = []
            cursor = n
            while id(cursor) in parents:
                cursor = parents[id(cursor)]
                if isinstance(cursor, ast.Call) and isinstance(cursor.func, ast.Attribute):
                    chain.append(cursor.func.attr)
                    chain_calls.append(cursor)
                elif not isinstance(cursor, ast.Attribute):
                    break
            minimal = any(kw.arg == "returning" and isinstance(kw.value, ast.Constant)
                          and kw.value.value == "minimal" for c in chain_calls for kw in c.keywords)
            discarded = isinstance(cursor, ast.Expr)
            write_only = bool(set(chain) & WRITES) and "select" not in chain and (minimal or discarded)
            sites.append({"kind": "write" if write_only else "rpc" if method == "rpc" else "table",
                          "target": sorted(vals) if vals is not None else None,
                          "expression": ast.unparse(n.args[0]) if n.args else "<none>", "line": n.lineno})
        return sorted(sites, key=lambda s: (s["line"], s["kind"]))

    def aggregates(self, key, reader_symbols):
        """Track result taint through assignments and wrappers before counting.

        Iteration is conservatively collection processing. Pure pass-throughs
        (including threadpool/await wrappers) stay B4b.
        """
        node = self.scopes[key][2]
        tainted = set()
        def has(expr):
            if expr is None:
                return False
            return any((isinstance(n, ast.Name) and n.id in tainted) or
                       (isinstance(n, (ast.Name, ast.Attribute)) and self.resolve(key, n) in reader_symbols)
                       for n in ast.walk(expr))
        for _ in range(len(self.assignments[key]) + 1):
            previous = set(tainted)
            tainted.update(name for name, values in self.assignments[key].items() if any(has(v) for v in values))
            if previous == tainted:
                break
        evidence = []
        for n in _own_nodes(node):
            aggregate = (
                isinstance(n, (ast.For, ast.AsyncFor, ast.comprehension)) and has(n.iter)
                or isinstance(n, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)) and has(n)
                or isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Slice) and has(n.value)
                or isinstance(n, ast.Call) and (
                    isinstance(n.func, ast.Name) and n.func.id in {"len", "sum", "sorted", "min", "max", "list", "set", "tuple", "dict"}
                    or isinstance(n.func, ast.Attribute) and n.func.attr in {"count", "sort", "append", "extend", "update", "order", "range", "limit", "offset"}
                ) and any(has(a) for a in [*n.args, *(kw.value for kw in n.keywords),
                                           *([n.func.value] if isinstance(n.func, ast.Attribute) else [])])
            )
            if aggregate:
                evidence.append(getattr(n, "lineno", getattr(n.iter, "lineno", 0)) if hasattr(n, "iter") else n.lineno)
        return sorted(set(evidence))


def classify(sources, candidates, sql_names, inherited=()):
    model = SourceModel(sources)
    scanned = scan_sources(sources)
    scanned_by_key = {row_key(r): r for r in scanned}
    graph = {k: set() for k in model.scopes}
    for r in scanned:
        graph[row_key(r)].update(model.symbols[s["target"]] for s in r["sites"]
                                 if s["kind"] == "reader_call" and s["target"] in model.symbols)
    # Include non-inventory intermediates, so closure cannot stop at a lexical
    # false positive. References passed to executors are conservative call edges.
    for key, (_, _, node) in model.scopes.items():
        graph[key].update(target for n in _own_nodes(node)
                          if isinstance(n, (ast.Name, ast.Attribute))
                          and (target := model.resolve(key, n)) in model.scopes and target != key)
    direct = {}
    for key in model.scopes:
        sites = model.sites(key)
        raw = [s for s in sites if s["kind"] == "table" and s["target"] is not None and set(s["target"]) & NAMESPACE_TABLES
               or s["kind"] == "rpc" and s["target"] is not None and set(s["target"]) & sql_names]
        unresolved = [s for s in sites if s["kind"] == "unresolved" or s["kind"] in {"table", "rpc"} and s["target"] is None]
        public = [s for s in sites if s["kind"] == "public" or s["kind"] == "table" and s["target"] and set(s["target"]) <= VIEWS]
        rpc = [s for s in sites if s["kind"] == "rpc"]
        bucket = "B1" if raw else "B2" if unresolved else "B3" if public else "B5" if rpc else "B6"
        direct[key] = {"bucket": bucket, "sites": sites}
    real = {k for k, v in direct.items() if v["bucket"] in {"B1", "B2"}}
    @cache
    def closure(key):
        visited, todo = set(), list(graph[key])
        while todo:
            current = todo.pop()
            if current in visited:
                continue
            visited.add(current)
            todo.extend(graph[current] - visited)
        return visited & real
    rows = {}
    for row in candidates:
        key = row_key(row)
        entry = direct[key]
        hits = closure(key)
        bucket = entry["bucket"]
        aggregate_lines = []
        if bucket in {"B6", "B5", "B3"} and hits:
            aggregate_lines = model.aggregates(key, {k for k in graph[key] if k in real or closure(k)})
            # Any local collection processing of a reader result remains real,
            # even when a separate safe RPC/view/string is also present.
            if aggregate_lines:
                bucket = "B4c"
            elif bucket in {"B3", "B5", "B6"}:
                bucket = "B4b"
        if bucket == "B6" and all(s["kind"] == "reader_call" for s in row["sites"]):
            bucket = "B4b" if hits else "B4a"
        rows[key] = {
            "bucket": bucket, "rule_id": bucket + "-v1", "line": row["line"],
            "source_sha256": row["source_sha256"], "context_sha256": row["context_sha256"],
            "read_sites": entry["sites"], "reader_closure": sorted(hits),
            "callee_edges": sorted(graph[key]), "aggregation_lines": aggregate_lines,
            "state": "OPEN" if bucket in {"B1", "B2", "B4c"} else "DEPENDENT" if bucket == "B4b" else "BULK_PROVEN",
            "mechanism": "view" if bucket == "B3" else "write_only" if entry["sites"] and all(s["kind"] == "write" for s in entry["sites"]) else RULES[bucket],
        }
    dispositions = {}
    for row in inherited:
        key = row_key(row)
        if key not in model.scopes:
            dispositions[key] = {"disposition": "RETIRED", "reason": "Definition absent from current runtime AST; no same-name function call remains (local variables are not function references).", "references": sorted(k for k, (_, _, n) in model.scopes.items() if any(isinstance(v, ast.Call) and isinstance(v.func, (ast.Name, ast.Attribute)) and (v.func.id if isinstance(v.func, ast.Name) else v.func.attr) == row['function'] for v in _own_nodes(n)))}
        elif key in scanned_by_key:
            dispositions[key] = {"disposition": "mapped-to-current-row", "target": key, "reason": "Current AST independently identifies the same file/function."}
        else:
            hits = closure(key)
            dispositions[key] = {"disposition": "FALSE_POSITIVE", "reason": "Existing definition has no namespace site and its recomputed runtime callee closure contains no real reader.", "reader_closure": sorted(hits), "source_sha256": hashlib.sha256(ast.dump(model.scopes[key][2], include_attributes=False).encode()).hexdigest()}
    return {"sql_revision": SQL_REVISION, "rules": RULES,
            "runtime_source_sha256": {f: hashlib.sha256(s.encode()).hexdigest() for f, s in sorted(sources.items())},
            "counts": dict(sorted(Counter(v["bucket"] for v in rows.values()).items())),
            "real_reader_count": sum(v["bucket"] in {"B1", "B2", "B4c"} for v in rows.values()),
            "rows": rows, "inherited": dispositions}


def build(root):
    fixtures = root / "tests/fixtures"
    candidates = json.loads((fixtures / "restricted_content_open_inventory.json").read_text())["rows"]
    sql = json.loads((fixtures / "restricted_content_sql_reader_pin.json").read_text())
    assert sql["revision"] == SQL_REVISION
    inherited = json.loads((fixtures / "restricted_content_inherited_candidates.json").read_text())["rows"]
    return classify(runtime_sources(root), candidates, set(sql["rpc_names"]), inherited)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    result = build(root)
    (root / "tests/fixtures/restricted_content_classification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"counts": result["counts"], "real_reader_count": result["real_reader_count"]}))
