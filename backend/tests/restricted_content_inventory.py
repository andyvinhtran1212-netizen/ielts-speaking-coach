"""Conservative Python surface inventory, independent of the R3 lexical list.

This detects readers, aliases and transitive callers; it does not certify their
authorization. Only individually proven rows belong in the security allowlist.
The separately labelled OPEN snapshot is checkpoint debt, never an approval.
SQL/RPC body and catalog verification belongs to the N2 inventory.
"""
from __future__ import annotations

import ast
import hashlib
import re
from pathlib import Path


NAMESPACE_TABLES = frozenset({
    "listening_tests", "listening_content", "listening_exercises",
    "listening_test_attempts", "dictation_sessions", "dictation_attempts",
    "listening_content_packages", "listening_lessons", "mock_paper_attempt_snapshots",
})
PUBLIC_OBJECTS = frozenset({
    "v_listening_tests_public", "v_listening_content_public", "v_listening_attempts_public",
    "v_dictation_sessions_public", "listening_public_practice_catalog", "content_access_namespaces",
})
PUBLIC_HELPERS = frozenset({
    "public_tests", "public_content", "public_attempts", "public_dictation", "public_programmes",
})
_OBJECT_RE = re.compile(r"\b(?:" + "|".join(sorted(NAMESPACE_TABLES | PUBLIC_OBJECTS)) + r")\b")
_DEFINITIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def _digest(node):
    return hashlib.sha256(ast.dump(node, include_attributes=False).encode()).hexdigest()


def _scopes(body, prefix=""):
    for node in body:
        if isinstance(node, _DEFINITIONS):
            name = f"{prefix}.{node.name}" if prefix else node.name
            yield name, node
            yield from _scopes(node.body, name)


def _own_nodes(node):
    """Nested definitions get their own inventory rows and caller analysis."""
    pending = list(node.body)
    while pending:
        child = pending.pop()
        if isinstance(child, _DEFINITIONS):
            continue
        yield child
        pending.extend(ast.iter_child_nodes(child))


def scan_sources(sources: dict[str, str]) -> list[dict]:
    scopes = []
    for file, source in sorted(sources.items()):
        tree = ast.parse(source, filename=file)
        module = file.removesuffix(".py").replace("/", ".").removesuffix(".__init__")
        definitions = list(_scopes(tree.body))
        local_names = {name for name, _ in definitions}
        aliases = {alias.asname or alias.name: f"{node.module}.{alias.name}"
                   for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
                   for alias in node.names}
        aliases.update({alias.asname or alias.name.split(".")[0]:
                        alias.name if alias.asname else alias.name.split(".")[0]
                        for node in ast.walk(tree) if isinstance(node, ast.Import)
                        for alias in node.names})
        globals_tree = ast.Module(body=[n for n in tree.body if not isinstance(n, _DEFINITIONS)],
                                  type_ignores=[])
        for name, node in [("<module>", globals_tree), *definitions]:
            context = [globals_tree]
            for class_name, class_node in definitions:
                if isinstance(class_node, ast.ClassDef) and (name == class_name or name.startswith(class_name + ".")):
                    context.append(ast.Module(body=[n for n in class_node.body if not isinstance(n, _DEFINITIONS)],
                                              type_ignores=[]))
            def resolve(expression):
                if isinstance(expression, ast.Name):
                    if expression.id in aliases:
                        return aliases[expression.id]
                    parts = name.split(".")
                    for length in range(len(parts), -1, -1):
                        candidate = ".".join([*parts[:length], expression.id])
                        if candidate in local_names:
                            return f"{module}.{candidate}"
                if isinstance(expression, ast.Attribute):
                    parts = ast.unparse(expression).split(".")
                    if parts[0] in aliases:
                        return ".".join([aliases[parts[0]], *parts[1:]])
                    if parts[0] in {"self", "cls"}:
                        for length in range(len(name.split(".")) - 1, 0, -1):
                            candidate = ".".join([*name.split(".")[:length], *parts[1:]])
                            if candidate in local_names:
                                return f"{module}.{candidate}"
                return None

            nodes = list(_own_nodes(node))
            calls, events = [], set()
            called_attributes = {id(n.func) for n in nodes if isinstance(n, ast.Call)}
            for item in nodes:
                reference = resolve(item)
                if reference:
                    calls.append(reference)
                if isinstance(item, ast.Constant) and isinstance(item.value, str):
                    for target in _OBJECT_RE.findall(item.value):
                        events.add(("namespace_reference", target))
                if isinstance(item, ast.Attribute) and item.attr in {"table", "from_", "rpc"}:
                    if id(item) not in called_attributes:
                        events.add(("indirect_method_reference", item.attr))
                if not isinstance(item, ast.Call):
                    continue
                method = (item.func.attr if isinstance(item.func, ast.Attribute)
                          else item.func.id if isinstance(item.func, ast.Name) else "")
                resolved = resolve(item.func)
                if method in PUBLIC_HELPERS or resolved in {
                    f"services.content_visibility.{helper}" for helper in PUBLIC_HELPERS
                }:
                    events.add(("public_helper", resolved or method))
                db_method = resolved.rsplit(".", 1)[-1] if resolved else method
                # Supabase Storage uses the same spelling for bucket access;
                # it is not a PostgREST table argument.
                if db_method == "from_" and isinstance(item.func, ast.Attribute) and any(
                    isinstance(n, ast.Attribute) and n.attr == "storage"
                    for n in ast.walk(item.func.value)
                ):
                    continue
                if db_method in {"table", "from_", "rpc"} and isinstance(item.func, (ast.Attribute, ast.Name)):
                    method = "table" if db_method == "from_" else db_method
                    target = item.args[0] if item.args else None
                    if not isinstance(target, ast.Constant) or not isinstance(target.value, str):
                        events.add((f"dynamic_{method}", ast.unparse(target) if target is not None else "<none>"))
                    elif method == "rpc":
                        # New literal RPCs may hide a namespace reader. Do not
                        # guess SQL behavior from a function's name.
                        events.add(("rpc", target.value))
                    elif target.value in NAMESPACE_TABLES | PUBLIC_OBJECTS:
                        events.add(("table", target.value))
                if method == "getattr" and len(item.args) > 1:
                    attr = item.args[1]
                    if isinstance(attr, ast.Constant) and attr.value in {"table", "from_", "rpc"}:
                        events.add(("indirect_method_reference", attr.value))
                    elif not isinstance(attr, ast.Constant):
                        events.add(("dynamic_method_reference", ast.unparse(attr)))
            scopes.append({"file": file, "function": name, "line": getattr(node, "lineno", 1),
                           "symbol": f"{module}.{name}",
                           "source_sha256": _digest(node),
                           "context_sha256": _digest(ast.Module(body=context, type_ignores=[])),
                           "events": events, "calls": calls})
    # Resolve imports and local/nested functions before the fixed point, so an
    # unrelated object's .get() cannot be confused with a DB reader named get.
    reader_names = {scope["symbol"] for scope in scopes if scope["events"]}
    while True:
        before = len(reader_names)
        for scope in scopes:
            if set(scope["calls"]) & reader_names:
                reader_names.add(scope["symbol"])
        if len(reader_names) == before:
            break
    rows = []
    for scope in scopes:
        scope.pop("symbol")
        events = scope.pop("events")
        events.update(("reader_call", name) for name in scope.pop("calls") if name in reader_names)
        if events:
            rows.append({**scope, "sites": [{"kind": kind, "target": target}
                                          for kind, target in sorted(events)]})
    return sorted(rows, key=lambda row: (row["file"], row["function"]))


def scan_backend(root: Path) -> list[dict]:
    return scan_sources({path.relative_to(root).as_posix(): path.read_text(encoding="utf-8")
                         for directory in ("routers", "services")
                         for path in sorted((root / directory).rglob("*.py"))})


def inventory_errors(actual, allowlist, open_rows):
    """Fail new/changed surfaces, without presenting checkpoint debt as safe."""
    key = lambda row: (row["file"], row["function"])
    known = {}
    errors = []
    for label, rows in (("allowlist", allowlist), ("OPEN", open_rows)):
        for row in rows:
            identity = key(row)
            if identity in known:
                errors.append(f"Duplicate inventory identity: {identity}")
            known[identity] = (label, row)
    actual_by_key = {key(row): row for row in actual}
    for identity, row in actual_by_key.items():
        if identity not in known:
            errors.append(f"Unlisted namespace surface: {identity}")
            continue
        label, previous = known[identity]
        for field in ("source_sha256", "context_sha256", "sites"):
            if row[field] != previous.get(field):
                errors.append(f"Changed {label} namespace surface: {identity} ({field})")
    for identity in known.keys() - actual_by_key.keys():
        errors.append(f"Stale inventory identity: {identity}")
    return errors
