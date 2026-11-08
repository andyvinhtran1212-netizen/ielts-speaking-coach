"""Static PC-J408 guard; parses source without importing application modules.

Based on the coordinator's PC-J408-sync-in-async-scan.py. This is a bounded
heuristic, not a Python type checker: arbitrary third-party SDKs and dynamic
dispatch beyond module-level objects and scanned base classes (instance
attributes, objects passed as arguments) still need review. Recognized calls
include PostgREST execute, requests, sync httpx clients, urlopen, sleep,
Supabase Storage and explicit sync AI clients. Local/imported sync helpers and
methods reached through imported module-level service objects (PC-J672) are
followed to a fixed point, including recursion.

Deferred function/lambda bodies do not count as eager wrapper arguments;
named helpers are analyzed separately. Eager arguments ARE checked:
to_thread(save()) still runs save on the event loop. Awaited unknown execute
is treated as the async DB API; known supabase_admin/sync helpers stay flagged.
Class headers and bodies execute eagerly, with separate class-local bindings.
Comprehension bodies skip class bindings; only their first iterable uses them.
Deferred free variables use each consumer's lexical bindings; captured iterator
objects and map/filter callables keep their construction-time bindings. Every
visible consumer is checked conservatively, without proving iterator exhaustion.
The aexecute facade's flag-off blocking branch remains a G7 debt of its own.

Known gaps, accepted by the owner on 2026-11-01 (review is the backstop):
- A lambda invoked in place, e.g. ``(lambda: requests.get(url))()`` or
  ``to_thread((lambda: fetch())())``, is treated as deferred, so its body is
  not scanned.
- A nested helper resolves free aliases against the enclosing function's
  final bindings, not those live at each call, so rebinding an alias after
  the call (``fetch = requests.get``; ``save()``; ``fetch = cached``) can
  hide or invent a finding.
A grep on 2026-11-01 found no in-place lambda call in the backend.
"""

from __future__ import annotations

import ast
from bisect import bisect_right
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable


EXCLUDED_DIRS = {"tests", "migrations", "scripts", "venv", ".venv", "__pycache__"}
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "request", "head", "options", "stream", "send"}
STORAGE_METHODS = {"upload", "update", "remove", "download", "list", "move", "copy", "create_signed_url", "create_signed_urls", "create_signed_upload_url"}
STORAGE_SIGN_METHODS = {"create_signed_url", "create_signed_urls", "create_signed_upload_url"}
OFFLOAD_CALLS = {"to_thread", "asyncio.to_thread", "run_in_threadpool", "starlette.concurrency.run_in_threadpool", "fastapi.concurrency.run_in_threadpool", "aexecute", "services.db_async.aexecute", "fastapi.BackgroundTasks.add_task", "starlette.background.BackgroundTasks.add_task", "starlette.background.BackgroundTask"}
LAZY_CALLS = {"iter", "enumerate", "zip", "map", "filter", "builtins.iter", "builtins.enumerate", "builtins.zip", "builtins.map", "builtins.filter", "functools.partial"}


@dataclass
class Function:
    path: str
    name: str
    node: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef
    symbols: dict[str, str]
    initial_symbols: dict[str, str]
    timeline: list[tuple[tuple[int, int], dict[str, str]]]
    scoped_symbols: dict[int, dict[str, str]] = field(default_factory=dict)
    # Methods only: rebuilds this function with ``self`` bound to a receiver
    # class, so ``self.x()`` dispatches through that class's MRO (PC-J672).
    factory: Callable[[str], "Function"] | None = None

    def at(self, node: ast.AST) -> dict[str, str]:
        if id(node) in self.scoped_symbols:
            return self.scoped_symbols[id(node)]
        index = bisect_right(self.timeline, (node.lineno, node.col_offset), key=lambda item: item[0])
        return self.timeline[index - 1][1] if index else self.initial_symbols


@dataclass(frozen=True)
class Finding:
    path: str
    function: str
    callee: str
    line: int

    @property
    def key(self) -> str:
        return f"{self.path}::{self.function}::{self.callee}"


def _target_expressions(targets: Iterable[ast.AST]) -> Iterable[ast.AST]:
    """Expressions evaluated when assigning, excluding names being stored."""
    for target in targets:
        if isinstance(target, ast.Subscript):
            yield target.value
            yield target.slice
        elif isinstance(target, ast.Attribute):
            yield target.value
        elif isinstance(target, (ast.Tuple, ast.List)):
            yield from _target_expressions(target.elts)
        elif isinstance(target, ast.Starred):
            yield from _target_expressions([target.value])


def _nodes(body: Iterable[ast.AST], *, consume_generator: bool = False,
           consumed: set[int] | None = None,
           policy: Callable[[ast.Call, bool], bool] | None = None) -> Iterable[ast.AST]:
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
            yield from _nodes(eager, consumed=consumed, policy=policy)
        elif isinstance(node, ast.ClassDef):
            # Headers run in the enclosing scope. The executable body is
            # expanded separately in _execution_nodes with class-local names.
            yield from _nodes([*node.decorator_list, *node.bases, *node.keywords],
                              consumed=consumed, policy=policy)
        elif isinstance(node, ast.GeneratorExp):
            # Only the first iterable is evaluated at generator creation. The
            # element, filters and subsequent iterables are expanded separately
            # with their consumption-time bindings in _execution_nodes.
            yield from _nodes([node.generators[0].iter], consumed=consumed, policy=policy)
        elif isinstance(node, ast.Call):
            consumer = (policy(node, consume_generator) if policy is not None
                        else _consumes_arguments(node, consume_generator, {}, set()))
            for child in ast.iter_child_nodes(node):
                advances_receiver = (child is node.func and isinstance(child, ast.Attribute)
                                     and child.attr in {"send", "throw", "close", "__next__"})
                if advances_receiver:
                    yield from _nodes([child.value], consume_generator=True, consumed=consumed, policy=policy)
                else:
                    consume_child = consumer if child is not node.func else isinstance(child, ast.Call)
                    yield from _nodes([child], consume_generator=consume_child, consumed=consumed, policy=policy)
        elif isinstance(node, ast.IfExp):
            yield from _nodes([node.test], consumed=consumed, policy=policy)
            yield from _nodes([node.body, node.orelse], consume_generator=consume_generator, consumed=consumed, policy=policy)
        elif isinstance(node, ast.BoolOp):
            yield from _nodes(node.values, consume_generator=consume_generator, consumed=consumed, policy=policy)
        elif isinstance(node, ast.NamedExpr):
            yield from _nodes([node.value], consume_generator=consume_generator, consumed=consumed, policy=policy)
        elif isinstance(node, ast.keyword):
            yield from _nodes([node.value], consume_generator=consume_generator, consumed=consumed, policy=policy)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            unpacking = any(isinstance(target, (ast.Tuple, ast.List)) for target in targets)
            if node.value is not None:
                yield from _nodes([node.value], consume_generator=unpacking, consumed=consumed, policy=policy)
            yield from _nodes(_target_expressions(targets), consumed=consumed, policy=policy)
        elif isinstance(node, (ast.Dict, ast.Return)):
            # Conservatively retain effects that escape through containers or
            # returns; this scanner does not follow container values/callers.
            yield from _nodes(ast.iter_child_nodes(node), consume_generator=True, consumed=consumed, policy=policy)
        elif isinstance(node, (ast.For, ast.comprehension)):
            for child in ast.iter_child_nodes(node):
                yield from _nodes([child], consume_generator=child is node.iter, consumed=consumed, policy=policy)
        elif isinstance(node, ast.With):
            for item in node.items:
                yield from _nodes([item.context_expr], consume_generator=True, consumed=consumed, policy=policy)
            yield from _nodes(node.body, consumed=consumed, policy=policy)
        elif isinstance(node, (ast.Starred, ast.YieldFrom)):
            yield from _nodes([node.value], consume_generator=True, consumed=consumed, policy=policy)
        else:
            yield from _nodes(ast.iter_child_nodes(node), consumed=consumed, policy=policy)


def _name(node: ast.AST, symbols: dict[str, str]) -> str:
    if isinstance(node, ast.Name):
        return symbols.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        return f"{_name(node.value, symbols)}.{node.attr}"
    if isinstance(node, ast.Call):
        name = _name(node.func, symbols)
        # object.__new__(cls) and type(obj) name the class itself (PC-J672).
        if node.args and (name.endswith(".__new__")
                          or (name in {"type", "builtins.type"} and len(node.args) == 1)):
            return _name(node.args[0], symbols)
        return name
    return "?"


def _consumes_arguments(call: ast.Call, result_consumed: bool,
                       symbols: dict[str, str], generators: set[str]) -> bool:
    name = _name(call.func, symbols)
    if name in OFFLOAD_CALLS or name == "run_in_executor" or name.endswith(".run_in_executor"):
        return False
    if name in LAZY_CALLS or name in generators:
        return result_consumed
    # An ordinary call may consume its iterable argument synchronously. Only
    # explicit offload seams / known lazy constructors may defer that work.
    return True


def _symbols(body: list[ast.stmt], inherited: dict[str, str], module: str,
             prefix: str, package: str, *, timeline=None) -> dict[str, str]:
    symbols = dict(inherited)
    events = []
    for node in _nodes(body):
        position = (getattr(node, "end_lineno", 0), getattr(node, "end_col_offset", 0))
        if isinstance(node, ast.Import):
            for alias in node.names:
                events.append((position, alias.asname or alias.name.split(".")[0],
                               alias.name if alias.asname else alias.name.split(".")[0]))
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parent = package.split(".")[:len(package.split(".")) - node.level + 1]
                base = ".".join(part for part in [*parent, base] if part)
            for alias in node.names:
                events.append((position, alias.asname or alias.name, f"{base}.{alias.name}"))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            events.append((position, node.name, f"{module}.{prefix}{node.name}"))
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.NamedExpr)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    events.append((position, target.id, node.value))
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                if isinstance(item.optional_vars, ast.Name):
                    target = item.optional_vars
                    events.append(((target.end_lineno, target.end_col_offset), target.id, item.context_expr))
    for position, name, value in sorted(events, key=lambda event: event[0]):
        if isinstance(value, str):
            symbols[name] = value
        elif isinstance(value, (ast.Name, ast.Attribute, ast.Call)):
            symbols[name] = _name(value, symbols)
        else:
            symbols[name] = name  # A literal/unknown value shadows older client aliases.
        if timeline is not None:
            timeline.append((position, dict(symbols)))
    return symbols


def _build_function(path: str, module: str, package: str, qualified: str,
                    node: ast.FunctionDef | ast.AsyncFunctionDef, outer: dict[str, str],
                    self_binding: str | None) -> tuple[Function, dict[str, str]]:
    local = dict(outer)
    for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
        local.pop(arg.arg, None)  # Parameters shadow module aliases.
        if arg.annotation is not None:
            annotation = arg.annotation
            if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
                annotation = ast.parse(annotation.value, mode="eval").body
            local[arg.arg] = _name(annotation, outer)
    if self_binding is not None:
        local["self"] = self_binding
    initial = dict(local)
    timeline = []
    local = _symbols(node.body, local, module, qualified + ".", package, timeline=timeline)
    return Function(path, qualified, node, local, initial, timeline), local


def _method_factory(path: str, module: str, package: str, qualified: str,
                    node: ast.FunctionDef | ast.AsyncFunctionDef,
                    outer: dict[str, str]) -> Callable[[str], Function]:
    def specialize(receiver: str) -> Function:
        return _build_function(path, module, package, qualified, node, outer, receiver)[0]
    return specialize


def _functions(sources: dict[str, str], bindings: dict[str, str] | None = None,
               bases: dict[str, list[str]] | None = None) -> dict[str, Function]:
    """Index functions; optionally record module-level bindings and class bases."""
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
            if not prefix and bindings is not None:
                bindings.update({f"{module}.{name}": value for name, value in symbols.items()})
            for node in _nodes(body):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    qualified = prefix + node.name
                    is_method = bool(prefix) and bool(node.args.args) and node.args.args[0].arg == "self"
                    self_binding = f"{module}.{prefix.rstrip('.')}" if is_method else None
                    fn, local = _build_function(path, module, package, qualified, node, symbols, self_binding)
                    if is_method:
                        fn.factory = _method_factory(path, module, package, qualified, node, dict(symbols))
                    functions[f"{module}.{qualified}"] = fn
                    collect(node.body, local, qualified + ".")
                elif isinstance(node, ast.ClassDef):
                    if bases is not None:
                        bases[f"{module}.{prefix}{node.name}"] = [_name(base, symbols) for base in node.bases]
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


def _execution_nodes(fn: Function, consumed: set[int], generators: set[str],
                     inherited_bindings=None, class_enclosing=None) -> list[ast.AST]:
    """Recover deferred iterator/callback effects at an eager consumer.

    Bindings take effect after their RHS. Alias snapshots therefore keep the
    original iterator across later reassignment. This is lexical def-use within
    one function, not whole-program/control-flow or container-value analysis.
    Each syntactic consumer is considered even if an earlier one may exhaust
    the iterator. Callback defaults are possible bindings, not an arity proof.
    """
    bindings = {name: list(values) for name, values in (inherited_bindings or {}).items()}
    enclosing, class_bindings = class_enclosing or (fn, bindings)
    comprehension_bindings = {}
    lexical_scopes = {}
    execution_positions = {}
    captured_parameters = {}

    def scope_comprehensions(node, closure=None, lookup=None, captured=None):
        captured = captured or {}
        if closure is not None and hasattr(node, "lineno"):
            symbols = dict(closure.at(node))
            symbols.update({name: name for name in lookup[1]})
            symbols.update(captured)
            fn.scoped_symbols[id(node)] = symbols
            comprehension_bindings[id(node)] = lookup
            lexical_scopes[id(node)] = (closure, lookup[1])
            captured_parameters[id(node)] = captured
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            # Only the first iterable runs in the containing namespace. The
            # rest closes over the function, skipping any class namespace.
            scope_comprehensions(node.generators[0].iter, closure, lookup, captured)
            local_bindings, shadowed = lookup if lookup is not None else (class_bindings, set())
            targets = {child.id for gen in node.generators for child in ast.walk(gen.target)
                       if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store)}
            lookup = (local_bindings, shadowed | targets)
            captured = {name: value for name, value in captured.items() if name not in targets}
            values = [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
            for child in values:
                scope_comprehensions(child, closure or enclosing, lookup, captured)
            for index, gen in enumerate(node.generators):
                for child in [gen.target, *gen.ifs, *([gen.iter] if index else [])]:
                    scope_comprehensions(child, closure or enclosing, lookup, captured)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            eager = [*node.args.defaults, *(v for v in node.args.kw_defaults if v is not None)]
            if not isinstance(node, ast.Lambda):
                eager.extend(node.decorator_list)
            for child in eager:
                scope_comprehensions(child, closure, lookup, captured)
            if isinstance(node, ast.Lambda):
                local_bindings, shadowed = lookup if lookup is not None else (class_bindings, set())
                parameters = {arg.arg for arg in [*node.args.posonlyargs, *node.args.args,
                                                  *node.args.kwonlyargs]}
                parameters.update(arg.arg for arg in [node.args.vararg, node.args.kwarg] if arg)
                positional = [*node.args.posonlyargs, *node.args.args]
                defaults = [*zip(positional[len(positional) - len(node.args.defaults):], node.args.defaults),
                            *((arg, value) for arg, value in zip(node.args.kwonlyargs, node.args.kw_defaults)
                              if value is not None)]
                captured = {name: value for name, value in captured.items() if name not in parameters}
                captured.update({arg.arg: _name(value, fn.at(value)) for arg, value in defaults})
                scope_comprehensions(node.body, closure or enclosing,
                                     (local_bindings, shadowed | parameters), captured)
        elif isinstance(node, ast.ClassDef):
            for child in [*node.decorator_list, *node.bases, *node.keywords]:
                scope_comprehensions(child, closure, lookup, captured)
        else:
            for child in ast.iter_child_nodes(node):
                scope_comprehensions(child, closure, lookup, captured)

    # Annotate even deferred generator bodies before deciding whether a call
    # consumes them: offload aliases must use the same lexical scope as calls.
    for node in fn.node.body:
        scope_comprehensions(node)
    # Inherited generators can consume other enclosing-function iterators too.
    if class_enclosing is not None:
        for values in class_bindings.values():
            for _, value in values:
                if value is not None:
                    scope_comprehensions(value, enclosing, (class_bindings, set()))

    def policy(call: ast.Call, result_consumed: bool) -> bool:
        return _consumes_arguments(call, result_consumed, fn.at(call), generators)

    body = list(_nodes(fn.node.body, consumed=consumed, policy=policy))
    for node in body:
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.NamedExpr)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            end = (node.end_lineno, node.end_col_offset)
            for target in targets:
                if isinstance(target, ast.Name):
                    bindings.setdefault(target.id, []).append((end, node.value))

    def expressions(node: ast.AST, seen: set[int]) -> list[ast.AST]:
        if id(node) in seen:
            return []
        seen = seen | {id(node)}
        if isinstance(node, ast.GeneratorExp):
            return [node]
        if isinstance(node, ast.Call):
            name = _name(node.func, fn.at(node))
            if name in generators:
                return [node]
            if name in LAZY_CALLS:
                callback = name in {"map", "filter", "builtins.map", "builtins.filter"}
                return ([node] if callback else []) + [
                    expr for arg in node.args[int(callback):] for expr in expressions(arg, seen)
                ]
        if isinstance(node, ast.IfExp):
            return expressions(node.body, seen) + expressions(node.orelse, seen)
        if isinstance(node, ast.BoolOp):
            return [expr for value in node.values for expr in expressions(value, seen)]
        if isinstance(node, ast.Name):
            local_bindings, shadowed = comprehension_bindings.get(id(node), (bindings, set()))
            if node.id in shadowed:
                return []
            position = execution_positions.get(id(node), node)
            before = (position.lineno, position.col_offset)
            prior = [(end, value) for end, value in local_bindings.get(node.id, []) if end <= before]
            if prior:
                return expressions(max(prior, key=lambda binding: binding[0])[1], seen)
        return []

    def deferred_body(generator: ast.GeneratorExp | ast.Lambda, consumer: ast.AST) -> list[ast.AST]:
        """Copy one execution context; later consumers must not overwrite it."""
        clone = deepcopy(generator)
        parts = ([generator.elt, *generator.generators] if isinstance(generator, ast.GeneratorExp)
                 else [generator.body])
        deferred = {id(child) for part in parts
                    for child in ast.walk(part)}
        if isinstance(generator, ast.GeneratorExp):
            deferred -= {id(child) for child in ast.walk(generator.generators[0].iter)}
        # Assignment expressions inside the body execute after the external
        # rebindings, but still take effect at their own expression position.
        initial = enclosing.at(consumer)
        timeline = []
        _symbols(parts, initial, "", "", "", timeline=timeline)
        for original, copied in zip(ast.walk(generator), ast.walk(clone)):
            copied._guard_source = getattr(original, "_guard_source", id(original))
            if not hasattr(original, "lineno"):
                continue
            symbols = fn.at(original)
            if id(original) in deferred:
                closure, shadowed = lexical_scopes.get(id(original), (enclosing, set()))
                symbols = dict(closure.at(consumer))
                for position, snapshot in timeline:
                    if position <= (original.lineno, original.col_offset):
                        symbols.update({key: value for key, value in snapshot.items()
                                        if initial.get(key) != value})
                symbols.update({name: name for name in shadowed})
                symbols.update(captured_parameters.get(id(original), {}))
                execution_positions[id(copied)] = consumer
            elif id(original) in execution_positions:
                execution_positions[id(copied)] = execution_positions[id(original)]
            fn.scoped_symbols[id(copied)] = symbols
            if id(original) in comprehension_bindings:
                comprehension_bindings[id(copied)] = comprehension_bindings[id(original)]
            if id(original) in lexical_scopes:
                lexical_scopes[id(copied)] = lexical_scopes[id(original)]
            if id(original) in captured_parameters:
                captured_parameters[id(copied)] = captured_parameters[id(original)]
        return ([clone.elt, *clone.generators] if isinstance(clone, ast.GeneratorExp)
                else [clone.body])

    visited = {id(node) for node in body}
    expanded = set()
    # Newly exposed bodies may themselves consume another stored expression.
    while True:
        previous = len(expanded)
        for node in body:
            if id(node) not in consumed:
                continue
            consumer = execution_positions.get(id(node), node)
            for generator in expressions(node, set()):
                key = (getattr(generator, "_guard_source", id(generator)),
                       consumer.lineno, consumer.col_offset)
                if key in expanded:
                    continue
                expanded.add(key)
                if isinstance(generator, ast.GeneratorExp):
                    parts = deferred_body(generator, consumer)
                elif _name(generator.func, fn.at(generator)) in {"map", "filter", "builtins.map", "builtins.filter"}:
                    # map/filter capture a callable now and invoke it later.
                    # A synthetic call lets primitives and the existing helper
                    # graph share exactly the same blocking classification.
                    if not generator.args:
                        continue
                    callback = generator.args[0]
                    seen_callbacks = set()
                    while isinstance(callback, ast.Name) and id(callback) not in seen_callbacks:
                        seen_callbacks.add(id(callback))
                        local_bindings, shadowed = comprehension_bindings.get(id(callback), (bindings, set()))
                        position = execution_positions.get(id(callback), callback)
                        prior = [(end, value) for end, value in local_bindings.get(callback.id, [])
                                 if end <= (position.lineno, position.col_offset)]
                        if callback.id in shadowed or not prior:
                            break
                        value = max(prior, key=lambda binding: binding[0])[1]
                        if not isinstance(value, (ast.Name, ast.Attribute, ast.Lambda, ast.Call)):
                            break
                        callback = value
                    while (isinstance(callback, ast.Call) and callback.args
                           and _name(callback.func, fn.at(callback)) == "functools.partial"):
                        callback = callback.args[0]
                    if isinstance(callback, ast.Lambda):
                        parts = deferred_body(callback, consumer)
                    else:
                        call = ast.copy_location(ast.Call(
                            func=ast.Name(id=_name(callback, fn.at(callback)), ctx=ast.Load()),
                            args=[], keywords=[]), generator)
                        call._guard_source = (getattr(generator, "_guard_source", id(generator)), "callback")
                        fn.scoped_symbols[id(call)] = {}
                        parts = [call]
                else:
                    parts = [generator]
                for child in _nodes(parts, consume_generator=(isinstance(generator, ast.Call)
                                                             and _name(generator.func, fn.at(generator)) in generators),
                                    consumed=consumed, policy=policy):
                    if id(child) not in visited:
                        visited.add(id(child))
                        body.append(child)
        if len(expanded) == previous:
            break

    # A class body runs now, unlike its methods, but assignments/imports and
    # generator bindings belong to its own namespace. Keep collection and
    # def-use analysis scoped, then attribute its effects to the caller.
    for node in list(body):
        if not isinstance(node, ast.ClassDef):
            continue
        module = fn.path.removesuffix(".py").replace("/", ".")
        package = module.rpartition(".")[0]
        if module.endswith(".__init__"):
            module = package
        qualified = fn.name + "." + node.name
        # Nested class headers can see their containing class's names; their
        # bodies close over the enclosing function, not that class namespace.
        initial = dict(enclosing.at(node))
        timeline = []
        local = _symbols(node.body, initial, module, qualified + ".", package, timeline=timeline)
        scope = Function(fn.path, qualified, node, local, initial, timeline)
        # An inherited iterator still executes using its creation scope's
        # symbols, even if the class rebinds an imported client/module name.
        scope.scoped_symbols = {
            id(child): enclosing.at(child)
            for values in class_bindings.values() for _, value in values if value is not None
            for child in ast.walk(value) if hasattr(child, "lineno")
        }
        for child in _execution_nodes(scope, consumed, generators, class_bindings,
                                      (enclosing, class_bindings)):
            if id(child) not in visited:
                visited.add(id(child))
                body.append(child)
                if hasattr(child, "lineno"):
                    fn.scoped_symbols[id(child)] = scope.at(child)
    return body


def _dispatch_resolver(functions: dict[str, Function], bindings: dict[str, str],
                       bases: dict[str, list[str]]) -> Callable[[str], tuple[str, str | None]]:
    """Resolve calls through module-level objects and inherited methods (PC-J672).

    An imported module-level object, e.g. ``vocab_service = VocabService()``
    used elsewhere as ``vocab_service.reload()``, otherwise names
    ``services.x.vocab_service.reload`` instead of the indexed
    ``services.x.VocabService.reload``. Each step rewrites the longest dotted
    prefix bound at module top level (imports, re-exports, aliases and
    constructor calls, using the module's final binding) or looks a missing
    method up in the resolved class's C3 MRO. A rewrite is kept only when it
    reaches a scanned function or class, preserving existing function edges.
    Instance attributes (``self.client = ...``), objects passed as arguments
    and methods on third-party classes remain outside this static resolution.
    Returns ``(name, receiver)``: when an inherited method is reached through a
    receiver class, ``receiver`` is that class so the caller can bind ``self``
    to it; otherwise it is ``None``.
    """
    cache: dict[str, tuple[str, str | None]] = {}
    mro_cache: dict[str, tuple[str, ...]] = {}

    def class_mro(name: str, active: frozenset[str] = frozenset()) -> tuple[str, ...] | None:
        if name in mro_cache:
            return mro_cache[name]
        if name in active or len(active) >= 100:
            return None
        # Resolve imported/re-exported base aliases before merging. Unscanned
        # bases remain opaque; their own methods are outside this heuristic.
        parents = [resolve(base) for base in bases.get(name, [])]
        sequences = []
        for parent in parents:
            parent_order = class_mro(parent, active | {name})
            if parent_order is None:
                return None
            sequences.append(list(parent_order))
        sequences.append(parents[:])
        order = [name]
        while any(sequences):
            sequences = [sequence for sequence in sequences if sequence]
            candidate = next((sequence[0] for sequence in sequences
                              if all(sequence[0] not in other[1:] for other in sequences)), None)
            if candidate is None:
                return None  # Inconsistent hierarchy: do not invent a dispatch.
            order.append(candidate)
            for sequence in sequences:
                if sequence[0] == candidate:
                    sequence.pop(0)
        mro_cache[name] = tuple(order)
        return mro_cache[name]

    def resolve_call(target: str) -> tuple[str, str | None]:
        if target in functions:
            return target, None
        if target not in cache:
            cache[target] = (target, None)
            queue, seen = [(target, frozenset())], set()
            while queue:
                name, expanded = queue.pop(0)
                if name in functions:
                    cache[target] = (name, None)
                    break
                state = (name, expanded)
                if state in seen or len(expanded) >= 100:
                    continue
                seen.add(state)
                parts = name.split(".")
                for index in range(len(parts), 0, -1):
                    prefix = ".".join(parts[:index])
                    rest = name[len(prefix):]
                    # Reusing a binding with an equal/longer suffix can expand
                    # forever. A shorter suffix still makes progress (e.g. a
                    # package alias referring back to the package). Keep this
                    # history per path so sibling bases remain independent.
                    if any(prior == prefix and size <= len(rest) for prior, size in expanded):
                        break
                    if bindings.get(prefix, prefix) != prefix:
                        queue.append((bindings[prefix] + rest, expanded | {(prefix, len(rest))}))
                        break
                    if prefix in bases:
                        if not rest:
                            cache[target] = (prefix, None)
                        else:
                            for base in (class_mro(prefix) or ())[1:]:
                                if base + rest in functions:
                                    # The receiver is the class the object was bound to.
                                    cache[target] = (base + rest, prefix)
                                    break
                        break
        return cache[target]

    def resolve(target: str) -> str:
        return resolve_call(target)[0]

    return resolve_call


def scan_sources(sources: dict[str, str]) -> list[Finding]:
    bindings: dict[str, str] = {}
    bases: dict[str, list[str]] = {}
    functions = _functions(sources, bindings, bases)
    resolve_call = _dispatch_resolver(functions, bindings, bases)
    generators = {
        name for name, fn in functions.items()
        if isinstance(fn.node, ast.FunctionDef)
        and any(isinstance(node, (ast.Yield, ast.YieldFrom)) for node in _nodes(fn.node.body))
    }
    # A context is a function analysed for one receiver class: ``name`` keeps
    # the defining class binding, ``name@Receiver`` binds ``self`` to Receiver
    # so inherited methods dispatch through the receiver's MRO (PC-J672).
    contexts: dict[str, Function] = dict(functions)
    consumed: dict[str, set[int]] = {}
    nodes: dict[str, list[ast.AST]] = {}
    calls: dict[str, list[ast.Call]] = {}
    awaited: dict[str, set[int]] = {}
    pending = list(functions)

    def base_name(context: str) -> str:
        return context.partition("@")[0]

    def target_at_execution(context: str, node: ast.AST) -> str | None:
        fn = contexts[context]
        if isinstance(node, ast.Call):
            target, receiver = resolve_call(_name(node.func, fn.at(node)))
            key = target
            method = functions.get(target)
            if (receiver is not None and method is not None and method.factory is not None
                    and not isinstance(method.node, ast.AsyncFunctionDef)):
                key = f"{target}@{receiver}"
                if key not in contexts:
                    contexts[key] = method.factory(receiver)
                    pending.append(key)
            # Calling a generator function constructs an iterator. Its body
            # only runs when an eager consumer advances it in this scope.
            if base_name(key) not in generators or id(node) in consumed[context]:
                return key
        return None

    edges: dict[str, set[str | None]] = {}
    while pending:
        context = pending.pop()
        if context in edges:
            continue
        fn = contexts[context]
        consumed[context] = set()
        nodes[context] = _execution_nodes(fn, consumed[context], generators)
        calls[context] = [node for node in nodes[context] if isinstance(node, ast.Call)]
        awaited[context] = {id(node.value) for node in nodes[context] if isinstance(node, ast.Await)}
        # Receiver contexts discovered here are queued by target_at_execution.
        edges[context] = {target_at_execution(context, node) for node in nodes[context]}

    sync = {context for context, fn in contexts.items()
            if not isinstance(fn.node, ast.AsyncFunctionDef)}
    blocking = set()
    for context in sync:
        fn = contexts[context]
        if any(_primitive(call, fn.at(call), id(call) in awaited[context]) for call in calls[context]):
            blocking.add(context)
    while True:
        expanded = blocking | {context for context in sync if edges[context] & blocking}
        if expanded == blocking:
            break
        blocking = expanded

    findings = []
    reported = set()
    for name, fn in functions.items():
        if not isinstance(fn.node, ast.AsyncFunctionDef):
            continue
        for node in nodes[name]:
            callee = (_primitive(node, fn.at(node), id(node) in awaited[name])
                      if isinstance(node, ast.Call) else None)
            target = target_at_execution(name, node)
            if callee or target in blocking:
                # Findings name the resolved function, never the receiver context.
                callee_name = callee or base_name(target)
                key = (name, getattr(node, "_guard_source", id(node)), callee_name)
                if key not in reported:
                    reported.add(key)
                    findings.append(Finding(fn.path, fn.name, callee_name, node.lineno))
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
