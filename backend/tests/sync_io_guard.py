"""Static PC-J408 guard; parses source without importing application modules.

Based on the coordinator's PC-J408-sync-in-async-scan.py. This is a bounded
heuristic, not a Python type checker: dynamic dispatch and arbitrary third-party
SDKs still need review. Recognized calls include PostgREST execute, requests,
sync httpx clients, urlopen, sleep, Supabase Storage and explicit sync AI clients.
Local/imported sync helpers are followed to a fixed point, including recursion.

Deferred definitions/lambda bodies do not count as eager wrapper arguments;
named helpers are analyzed separately. Eager arguments ARE checked:
to_thread(save()) still runs save on the event loop. Awaited unknown execute
is treated as the async DB API; known supabase_admin/sync helpers stay flagged.
The aexecute facade's flag-off blocking branch remains a G7 debt of its own.
"""

from __future__ import annotations

import ast
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


EXCLUDED_DIRS = {"tests", "migrations", "scripts", "venv", ".venv", "__pycache__"}
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "request", "head", "options", "stream", "send"}
STORAGE_METHODS = {"upload", "update", "remove", "download", "list", "move", "copy", "create_signed_url", "create_signed_urls", "create_signed_upload_url"}
STORAGE_SIGN_METHODS = {"create_signed_url", "create_signed_urls", "create_signed_upload_url"}
EAGER_CONSUMERS = {"list", "tuple", "set", "dict", "sum", "any", "all", "min", "max", "sorted", "next"}


@dataclass
class Function:
    path: str
    name: str
    node: ast.FunctionDef | ast.AsyncFunctionDef
    symbols: dict[str, str]


@dataclass(frozen=True)
class Finding:
    path: str
    function: str
    callee: str
    line: int

    @property
    def key(self) -> str:
        return f"{self.path}::{self.function}::{self.callee}"


def _nodes(body: Iterable[ast.AST], *, consume_generator: bool = False,
           consumed: set[int] | None = None) -> Iterable[ast.AST]:
    """Nodes executed in this scope, excluding deferred bodies."""
    for node in body:
        yield node
        if consume_generator and consumed is not None:
            consumed.add(id(node))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            # Defaults and decorators run when the callable is CREATED, even
            # when its body will later be handed to a worker thread.
            eager = [*node.args.defaults, *(v for v in node.args.kw_defaults if v is not None)]
            if not isinstance(node, ast.Lambda):
                eager.extend(node.decorator_list)
            yield from _nodes(eager, consumed=consumed)
        elif isinstance(node, ast.GeneratorExp) and not consume_generator:
            # Only the first iterable is evaluated at generator creation. The
            # element, filters and subsequent iterables wait for consumption.
            yield from _nodes([node.generators[0].iter], consumed=consumed)
        elif isinstance(node, ast.Call):
            consumer = (
                isinstance(node.func, ast.Name) and node.func.id in EAGER_CONSUMERS
                or isinstance(node.func, ast.Attribute) and node.func.attr in {"join", "extend", "update"}
            )
            for child in ast.iter_child_nodes(node):
                yield from _nodes([child], consume_generator=consumer, consumed=consumed)
        elif isinstance(node, (ast.For, ast.comprehension)):
            for child in ast.iter_child_nodes(node):
                yield from _nodes([child], consume_generator=child is node.iter, consumed=consumed)
        elif isinstance(node, ast.With):
            for item in node.items:
                yield from _nodes([item.context_expr], consume_generator=True, consumed=consumed)
            yield from _nodes(node.body, consumed=consumed)
        elif isinstance(node, (ast.Starred, ast.YieldFrom)):
            yield from _nodes([node.value], consume_generator=True, consumed=consumed)
        elif not isinstance(node, ast.ClassDef):
            yield from _nodes(ast.iter_child_nodes(node), consumed=consumed)


def _name(node: ast.AST, symbols: dict[str, str]) -> str:
    if isinstance(node, ast.Name):
        return symbols.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        return f"{_name(node.value, symbols)}.{node.attr}"
    if isinstance(node, ast.Call):
        return _name(node.func, symbols)
    return "?"


def _symbols(body: list[ast.stmt], inherited: dict[str, str], module: str,
             prefix: str, package: str) -> dict[str, str]:
    symbols = dict(inherited)
    for node in _nodes(body):
        if isinstance(node, ast.Import):
            for alias in node.names:
                symbols[alias.asname or alias.name.split(".")[0]] = (
                    alias.name if alias.asname else alias.name.split(".")[0]
                )
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parent = package.split(".")[:len(package.split(".")) - node.level + 1]
                base = ".".join(part for part in [*parent, base] if part)
            for alias in node.names:
                symbols[alias.asname or alias.name] = f"{base}.{alias.name}"
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbols[node.name] = f"{module}.{prefix}{node.name}"
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            value = node.value
            if isinstance(value, (ast.Name, ast.Attribute, ast.Call)):
                for target in targets:
                    if isinstance(target, ast.Name):
                        symbols[target.id] = _name(value, symbols)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                if isinstance(item.optional_vars, ast.Name):
                    symbols[item.optional_vars.id] = _name(item.context_expr, symbols)
    return symbols


def _functions(sources: dict[str, str]) -> dict[str, Function]:
    functions = {}
    for path, source in sorted(sources.items()):
        tree = ast.parse(source, filename=path)  # Syntax errors must fail the gate.
        module = path.removesuffix(".py").replace("/", ".")
        is_package = module.endswith(".__init__")
        if is_package:
            module = module.removesuffix(".__init__")
        package = module if is_package else module.rpartition(".")[0]

        def collect(body, inherited, prefix=""):
            symbols = _symbols(body, inherited, module, prefix, package)
            for node in _nodes(body):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    qualified = prefix + node.name
                    local = dict(symbols)
                    for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
                        local.pop(arg.arg, None)  # Parameters shadow module aliases.
                        if arg.annotation is not None:
                            annotation = arg.annotation
                            if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
                                annotation = ast.parse(annotation.value, mode="eval").body
                            local[arg.arg] = _name(annotation, symbols)
                    if prefix and node.args.args and node.args.args[0].arg == "self":
                        local["self"] = f"{module}.{prefix.rstrip('.')}"
                    local = _symbols(node.body, local, module, qualified + ".", package)
                    functions[f"{module}.{qualified}"] = Function(path, qualified, node, local)
                    collect(node.body, local, qualified + ".")
                elif isinstance(node, ast.ClassDef):
                    collect(node.body, symbols, prefix + node.name + ".")

        collect(tree.body, {})
    return functions


def _primitive(call: ast.Call, symbols: dict[str, str], awaited: bool) -> str | None:
    name = _name(call.func, symbols)
    method = name.rsplit(".", 1)[-1]
    if method == "execute" and (not awaited or "supabase_admin." in name):
        return "db.execute"
    if name == "time.sleep":
        return name
    if name in {"urllib.request.urlopen", "urlopen"}:
        return "urllib.request.urlopen"
    if method in HTTP_METHODS:
        if name.startswith("requests."):
            return name
        if name.startswith("httpx.") and (name.count(".") == 1 or name.startswith("httpx.Client.")):
            return name
    storage = method in STORAGE_SIGN_METHODS or (
        method in STORAGE_METHODS and (".storage." in name or ".from_." in name)
    )
    if storage and (not awaited or "supabase_admin." in name):
        return f"storage.{method}"
    if (name.startswith(("anthropic.Anthropic.", "openai.OpenAI."))
            and method in {"create", "stream", "generate", "parse"}):
        return name
    if (name.startswith(("google.genai.Client.", "google.generativeai.GenerativeModel."))
            and ".aio." not in name and method in {"generate_content", "generate_images", "embed_content"}):
        return name
    return None


def scan_sources(sources: dict[str, str]) -> list[Finding]:
    functions = _functions(sources)
    consumed = {name: set() for name in functions}
    nodes = {
        name: list(_nodes(fn.node.body, consumed=consumed[name]))
        for name, fn in functions.items()
    }
    generators = {
        name for name, fn in functions.items()
        if isinstance(fn.node, ast.FunctionDef)
        and any(isinstance(node, (ast.Yield, ast.YieldFrom)) for node in nodes[name])
    }
    calls = {
        name: [node for node in body if isinstance(node, ast.Call)]
        for name, body in nodes.items()
    }
    awaited = {
        name: {id(node.value) for node in body if isinstance(node, ast.Await)}
        for name, body in nodes.items()
    }

    def target_at_execution(name: str, node: ast.AST) -> str | None:
        fn = functions[name]
        if isinstance(node, ast.Call):
            target = _name(node.func, fn.symbols)
            # Calling a generator function constructs an iterator. Its body
            # only runs when an eager consumer advances it in this scope.
            if target not in generators or id(node) in consumed[name]:
                return target
        elif isinstance(node, (ast.Name, ast.Attribute)) and id(node) in consumed[name]:
            target = _name(node, fn.symbols)
            if target in generators:  # e.g. rows = responses(urls); list(rows)
                return target
        return None

    blocking = set()
    edges = {}
    for name, fn in functions.items():
        if isinstance(fn.node, ast.AsyncFunctionDef):
            continue
        edges[name] = {target_at_execution(name, node) for node in nodes[name]}
        if any(_primitive(call, fn.symbols, id(call) in awaited[name]) for call in calls[name]):
            blocking.add(name)
    while True:
        expanded = blocking | {name for name, targets in edges.items() if targets & blocking}
        if expanded == blocking:
            break
        blocking = expanded

    findings = []
    for name, fn in functions.items():
        if not isinstance(fn.node, ast.AsyncFunctionDef):
            continue
        for node in nodes[name]:
            callee = (_primitive(node, fn.symbols, id(node) in awaited[name])
                      if isinstance(node, ast.Call) else None)
            target = target_at_execution(name, node)
            if callee or target in blocking:
                findings.append(Finding(fn.path, fn.name, callee or target, node.lineno))
    return sorted(findings, key=lambda f: (f.path, f.function, f.line, f.callee))


def scan_backend(root: Path) -> list[Finding]:
    import os

    sources = {}
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS and not d.startswith("."))
        for file in sorted(files):
            if file.endswith(".py"):
                path = Path(directory) / file
                sources[path.relative_to(root).as_posix()] = path.read_text(encoding="utf-8")
    return scan_sources(sources)


@dataclass(frozen=True)
class Allowance:
    count: int
    group: str
    reason: str


def read_allowlist(path: Path) -> dict[str, Allowance]:
    allowances = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        assert len(fields) == 4, f"{path}:{line_number}: expected key, count, group, reason"
        key, count, group, reason = fields
        assert len(key.split("::")) == 3, f"Invalid key: {key}"
        assert key not in allowances, f"Duplicate allowlist key: {key}"
        assert count.isdigit() and int(count) > 0, f"Invalid count: {key}"
        assert group in {f"G{i}" for i in range(8)}, f"Missing remediation group: {key}"
        assert reason.strip(), f"Missing reason: {key}"
        allowances[key] = Allowance(int(count), group, reason)
    return allowances


def violations(findings: list[Finding], allowances: dict[str, Allowance]) -> list[str]:
    counts = Counter(f.key for f in findings)
    errors = []
    for key in sorted(counts.keys() | allowances.keys()):
        actual = counts[key]
        allowed = allowances[key].count if key in allowances else 0
        if actual > allowed:
            locations = ", ".join(str(f.line) for f in findings if f.key == key)
            errors.append(f"New sync I/O: {key} ({actual} calls, allowed {allowed}; lines {locations})")
        elif actual < allowed:
            errors.append(f"Stale allowlist: {key} ({actual} calls remain, allowed {allowed}); shrink/remove entry")
    return errors
