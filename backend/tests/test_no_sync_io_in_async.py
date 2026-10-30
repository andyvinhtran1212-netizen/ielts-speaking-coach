"""PC-J408: no new blocking I/O in async code; remove debt as each G0–G7 lands.

Run: python -m pytest tests/test_no_sync_io_in_async.py -q
The regular backend suite (and therefore CI/pre-push) collects this guard.
"""

from pathlib import Path
from textwrap import dedent

import pytest

from sync_io_guard import Allowance, read_allowlist, scan_backend, scan_sources, violations


BACKEND = Path(__file__).resolve().parents[1]


def scan(source, **modules):
    return scan_sources({"routers/example.py": dedent(source), **{k: dedent(v) for k, v in modules.items()}})


def test_backend_has_no_unapproved_sync_io_or_stale_allowlist():
    errors = violations(scan_backend(BACKEND), read_allowlist(BACKEND / "tests/sync_in_async_allowlist.tsv"))
    assert not errors, "\n" + "\n".join(errors)


def test_direct_sync_db_fails_and_explicit_allowance_passes():
    findings = scan("""
        async def f():
            supabase_admin.table('x').select('*').execute()
    """)
    assert len(findings) == 1
    assert violations(findings, {})[0].startswith("New sync I/O:")
    assert findings[0].key == "routers/example.py::f::db.execute"
    assert not violations(findings, {findings[0].key: Allowance(1, "G0", "Existing debt")})


@pytest.mark.parametrize("wrapper", [
    "asyncio.to_thread(save)",
    "to_thread(save)",
    "run_in_threadpool(save)",
    "loop.run_in_executor(None, save)",
    "aexecute(lambda db: db.table('x').select('*'))",
    "asyncio.to_thread(lambda: db.table('x').select('*').execute())",
])
def test_deferred_thread_and_facade_calls_pass(wrapper):
    assert not scan(f"""
        def save():
            db.table('x').select('*').execute()
        async def f():
            await {wrapper}
    """)


@pytest.mark.parametrize("call", [
    "asyncio.to_thread(save())", "run_in_threadpool(save())",
    "loop.run_in_executor(None, save())", "aexecute(save())",
    "await save()", "await asyncio.to_thread(save, db.table('x').select('*').execute())",
])
def test_eager_arguments_and_awaited_sync_helpers_still_fail(call):
    findings = scan(f"""
        def save():
            db.table('x').select('*').execute()
        async def f():
            {call}
    """)
    assert len(findings) == 1


@pytest.mark.parametrize("declaration", [
    "await asyncio.to_thread(lambda result=requests.get('url'): result)",
    "await asyncio.to_thread(lambda *, result=requests.get('url'): result)",
    "def save(result=requests.get('url')):\n        return result\n    await asyncio.to_thread(save)",
    "async def save(*, result=requests.get('url')):\n        return result",
    "@decorate(requests.get('url'))\n    def save():\n        pass",
])
def test_callable_defaults_and_decorators_run_before_offload(declaration):
    findings = scan("import requests\nasync def f():\n    " + declaration)
    assert len(findings) == 1
    assert findings[0].function == "f"
    assert findings[0].callee == "requests.get"


def test_worker_consumes_generator_body_filters_and_inner_iterable():
    assert not scan("""
        import requests
        async def f(urls):
            await asyncio.to_thread(list, (
                requests.get(url) for url in urls
                if requests.head(url) for more in requests.get(url).json()
            ))
    """)


@pytest.mark.parametrize("expression", [
    "await asyncio.to_thread(list, (url for url in requests.get('url').json()))",
    "await asyncio.to_thread(list, [requests.get(url) for url in urls])",
    "list(requests.get(url) for url in urls)",
    "''.join(requests.get(url).text for url in urls)",
    "await asyncio.to_thread(list, *(requests.get(url) for url in urls))",
])
def test_generator_outer_iterable_and_inline_consumers_are_eager(expression):
    assert len(scan("import requests\nasync def f(urls):\n    " + expression)) == 1


def test_inline_for_consumes_generator_on_the_loop():
    assert len(scan("""
        import requests
        async def f(urls):
            for response in (requests.get(url) for url in urls):
                pass
    """)) == 1


@pytest.mark.parametrize("expression, count", [
    ("list(rows)", 1),
    ("await asyncio.to_thread(list, rows)", 0),
    ("alias = rows\n    list(alias)", 1),
    ("alias = rows\n    await asyncio.to_thread(list, alias)", 0),
    ("rows = []\n    list(rows)", 0),
    ("alias = rows\n    rows = []\n    list(alias)", 1),
    ("list(rows)\n    list(rows)", 1),
    ("await asyncio.to_thread(list, *rows)", 1),
    ("iterator = iter(rows)\n    list(iterator)", 1),
    ("iterator = iter(rows)\n    await asyncio.to_thread(list, iterator)", 0),
    ("rows.__next__()", 1),
    ("rows.send(None)", 1),
])
def test_stored_generator_expression_is_checked_where_consumed(expression, count):
    findings = scan("import requests\nasync def f(urls):\n"
                    "    rows = (requests.get(url) for url in urls)\n    " + expression)
    assert len(findings) == count


@pytest.mark.parametrize("consumer, count", [("list(rows)", 2), ("await asyncio.to_thread(list, rows)", 1)])
def test_stored_generator_outer_iterable_is_not_counted_twice(consumer, count):
    findings = scan("import requests\nasync def f():\n"
                    "    rows = (requests.get(url) for url in requests.get('index').json())\n    " + consumer)
    assert len(findings) == count


def test_stored_generator_expression_propagates_through_sync_helper():
    helper = """
import requests
def collect(urls):
    rows = (requests.get(url) for url in urls)
    return list(rows)
"""
    assert not scan(helper + "\nasync def f(urls):\n    await asyncio.to_thread(collect, urls)")
    findings = scan(helper + "\nasync def f(urls):\n    collect(urls)")
    assert len(findings) == 1
    assert findings[0].callee == "routers.example.collect"


@pytest.mark.parametrize("consumer, count", [("list(rows)", 1), ("await asyncio.to_thread(list, rows)", 0)])
def test_stored_generator_expressions_can_consume_each_other(consumer, count):
    source = ("import requests\nasync def f(urls):\n"
              "    inner = (requests.get(url) for url in urls)\n"
              "    rows = (response for response in inner)\n    " + consumer)
    assert len(scan(source)) == count


@pytest.mark.parametrize("consumer, count", [("list(rows)", 1), ("await asyncio.to_thread(list, rows)", 0)])
def test_annotated_generator_expression_binding(consumer, count):
    source = ("import requests\nasync def f(urls):\n"
              "    rows: object = (requests.get(url) for url in urls)\n    " + consumer)
    assert len(scan(source)) == count


GENERATOR_HELPERS = """
import requests
def responses(urls):
    for url in urls:
        yield requests.get(url)
def delegated(urls):
    yield from responses(urls)
def collect(urls):
    return list(delegated(urls))
"""


@pytest.mark.parametrize("value", ["(requests.get(url) for url in urls)", "responses(urls)"])
@pytest.mark.parametrize("assignment", [
    "first, second = {g}", "[first, second] = {g}", "first, *rest = {g}",
    "[first, *rest] = {g}", "*first, last = {g}",
])
def test_unpacking_assignments_consume_generators_on_loop(value, assignment):
    assert len(scan(GENERATOR_HELPERS + "\nasync def f(urls):\n    " + assignment.format(g=value))) == 1


@pytest.mark.parametrize("value", ["(requests.get(url) for url in urls)", "responses(urls)"])
def test_stored_generator_unpacking_and_worker_unpacking(value):
    prefix = GENERATOR_HELPERS + "\nasync def f(urls):\n    rows = " + value + "\n    "
    assert len(scan(prefix + "first, *rest = rows")) == 1
    assert not scan(prefix + "first, *rest = await asyncio.to_thread(tuple, rows)")


@pytest.mark.parametrize("value", ["(requests.get(url) for url in urls)", "responses(urls)"])
def test_assigned_generator_for_loop_is_eager(value):
    assert len(scan(GENERATOR_HELPERS + "\nasync def f(urls):\n    rows = " + value
                    + "\n    for response in rows:\n        pass")) == 1


@pytest.mark.parametrize("value", ["(requests.get(url) for url in urls)", "responses(urls)"])
@pytest.mark.parametrize("wrapper", [
    "asyncio.to_thread(list, VALUE)", "run_in_threadpool(list, VALUE)",
    "loop.run_in_executor(None, list, VALUE)", "aexecute(list, VALUE)",
])
def test_direct_offload_generator_arguments_stay_deferred(value, wrapper):
    assert not scan(GENERATOR_HELPERS + "\nasync def f(urls):\n    await "
                    + wrapper.replace("VALUE", value))


@pytest.mark.parametrize("assignment", [
    "cache[requests.get(url).text] = True",
    "cache[requests.get(url).text]: bool = True",
    "cache[requests.get(url).text]: bool",
    "requests.get(url).flag = True",
    "requests.get(url).flag: bool = True",
    "requests.get(url).json()[0] = True",
    "first, cache[requests.get(url).text] = (False, True)",
    "[first, cache[requests.get(url).text]] = (False, True)",
    "first, [cache[requests.get(url).text]] = (False, [True])",
    "first, *cache[requests.get(url).text] = (False, True)",
    "first, *requests.get(url).flags = (False, True)",
])
def test_assignment_target_expressions_are_evaluated_on_loop(assignment):
    findings = scan("import requests\nasync def f(cache, url):\n    " + assignment)
    assert len(findings) == 1
    assert findings[0].function == "f"
    assert findings[0].callee == "requests.get"


@pytest.mark.parametrize("assignment", [
    "cache[url] = True", "cache[url]: bool = True", "cache[url]: bool",
    "cache.flag = True", "cache.flag: bool = True",
    "first, [cache[url]] = (False, [True])",
    "first, *cache[url] = (False, True)",
])
def test_safe_assignment_target_expressions_pass(assignment):
    assert not scan("async def f(cache, url):\n    " + assignment)


@pytest.mark.parametrize("assignment", [
    "rows = ()", "rows: object = ()", "rows, last = ((), ())",
    "[rows, *rest] = ((), ())",
])
def test_assignment_store_names_do_not_consume_old_generators(assignment):
    assert not scan("import requests\nasync def f(urls):\n"
                    "    rows = (requests.get(url) for url in urls)\n    " + assignment)


@pytest.mark.parametrize("value", ["(requests.get(url) for url in urls)", "responses(urls)"])
@pytest.mark.parametrize("stored", [False, True])
@pytest.mark.parametrize("context", [
    "data = {'rows': VALUE}\n    list(data['rows'])", "return VALUE",
])
def test_generator_container_and_return_are_conservatively_eager(value, stored, context):
    prefix = GENERATOR_HELPERS + "\nasync def f(urls):\n    "
    if stored:
        prefix += "rows = " + value + "\n    "
        value = "rows"
    assert len(scan(prefix + context.replace("VALUE", value))) == 1


@pytest.mark.parametrize("first, second", [("Client", "AsyncClient"), ("AsyncClient", "Client")])
def test_client_alias_resolution_uses_the_call_position(first, second):
    def use(kind):
        return "await client.get('async')" if kind == "AsyncClient" else "client.get('sync')"
    source = ("import httpx\nasync def f():\n    client = httpx." + first + "()\n    " + use(first)
              + "\n    client = httpx." + second + "()\n    " + use(second))
    findings = scan(source)
    assert len(findings) == 1
    assert findings[0].callee == "httpx.Client.get"
    assert findings[0].line == next(i for i, line in enumerate(source.splitlines(), 1) if "get('sync')" in line)


def test_unused_later_client_does_not_reclassify_earlier_async_call():
    assert not scan("""
        import httpx
        async def f():
            client = httpx.AsyncClient()
            await client.get('url')
            client = httpx.Client()
    """)


def test_literal_reassignment_does_not_keep_old_http_client_type():
    findings = scan("""
        import httpx
        async def f():
            client = httpx.Client()
            client.get('url')
            client = {}
            client.get('cached')
    """)
    assert len(findings) == 1
    assert findings[0].callee == "httpx.Client.get"


def test_with_targets_bind_clients_before_the_body():
    findings = scan("""
        import httpx
        async def f():
            async with httpx.AsyncClient() as client:
                await client.get('async')
            with httpx.Client() as client:
                client.get('sync')
    """)
    assert len(findings) == 1
    assert findings[0].line == 7


def test_helper_alias_reassignment_does_not_hide_earlier_sync_call():
    findings = scan("""
        def save():
            db.table('x').select('*').execute()
        def pure():
            return []
        async def f():
            action = save
            action()
            action = pure
            action()
    """)
    assert len(findings) == 1
    assert findings[0].callee == "routers.example.save"


def test_offload_alias_reassignment_uses_each_call_position():
    findings = scan("""
        import asyncio
        import requests
        def inline(consumer, values):
            return consumer(values)
        async def f(urls):
            worker = asyncio.to_thread
            await worker(list, (requests.get(url) for url in urls))
            worker = inline
            worker(list, (requests.get(url) for url in urls))
    """)
    assert len(findings) == 1
    assert findings[0].line == 10


@pytest.mark.parametrize("value", ["(requests.get(url) for url in urls)", "responses(urls)"])
@pytest.mark.parametrize("consumer", [
    "process({g})", "frozenset({g})", "Counter({g})", "fh.writelines({g})",
    "reduce(lambda a, b: a + b, {g})", "list({g} if condition else ())",
    "list({g} or ())", "next(iter({g}))", "next(enumerate({g}))",
])
def test_ordinary_consumers_and_conditional_values_run_on_loop(value, consumer):
    source = (GENERATOR_HELPERS + "\nfrom collections import Counter\nfrom functools import reduce\n"
              "def process(values):\n    return list(values)\n"
              "async def f(urls, fh, condition):\n    " + consumer.format(g=value))
    assert len(scan(source)) == 1


@pytest.mark.parametrize("imports, call", [
    ("from asyncio import to_thread as worker", "worker"),
    ("from starlette.concurrency import run_in_threadpool as worker", "worker"),
])
def test_imported_offload_aliases_preserve_deferred_generators(imports, call):
    source = (GENERATOR_HELPERS + "\n" + imports + "\nasync def f(urls):\n    await "
              + call + "(list, (requests.get(url) for url in urls))")
    assert not scan(source)


@pytest.mark.parametrize("consumer, count", [
    ("process(values=rows)", 1),
    ("await asyncio.to_thread(process, values=rows)", 0),
])
def test_keyword_arguments_preserve_consumption_context(consumer, count):
    source = ("import requests\ndef process(values):\n    return list(values)\n"
              "async def f(urls):\n    rows = (requests.get(url) for url in urls)\n    " + consumer)
    assert len(scan(source)) == count


@pytest.mark.parametrize("callback, count", [
    ("list, (requests.get(url) for url in urls)", 0),
    ("lambda result=requests.get('url'): result", 1),
])
def test_background_tasks_defer_work_but_not_callable_defaults(callback, count):
    source = ("from fastapi import BackgroundTasks\nimport requests\n"
              "async def f(urls, background: BackgroundTasks):\n    background.add_task(" + callback + ")")
    assert len(scan(source)) == count


@pytest.mark.parametrize("consumer, count", [("list(rows)", 1), ("await asyncio.to_thread(list, rows)", 0)])
@pytest.mark.parametrize("constructor", ["iter", "enumerate"])
def test_stored_lazy_iterator_retains_named_generator_effects(constructor, consumer, count):
    source = (GENERATOR_HELPERS + "\nasync def f(urls):\n    rows = " + constructor
              + "(responses(urls))\n    " + consumer)
    assert len(scan(source)) == count


@pytest.mark.parametrize("consumer, count", [("list(rows)", 1), ("await asyncio.to_thread(list, rows)", 0)])
def test_generator_helper_arguments_wait_for_consumption(consumer, count):
    source = ("import requests\ndef passthrough(values):\n    yield from values\n"
              "async def f(urls):\n    rows = passthrough((requests.get(url) for url in urls))\n    " + consumer)
    assert len(scan(source)) == count


@pytest.mark.parametrize("expression", [
    "responses(urls)",
    "await asyncio.to_thread(list, responses(urls))",
    "await asyncio.to_thread(list, delegated(urls))",
    "await asyncio.to_thread(collect, urls)",
    "rows = responses(urls)\n    await asyncio.to_thread(list, rows)",
    "rows = responses(urls)\n    rows = []\n    list(rows)",
])
def test_named_generator_creation_and_worker_consumption_pass(expression):
    assert not scan(GENERATOR_HELPERS + "\nasync def f(urls):\n    " + expression)


@pytest.mark.parametrize("expression", [
    "list(responses(urls))",
    "list(delegated(urls))",
    "collect(urls)",
    "rows = responses(urls)\n    list(rows)",
    "rows = responses(urls)\n    alias = rows\n    rows = []\n    list(alias)",
    "rows = responses(urls)\n    list(rows)\n    list(rows)",
    "for response in responses(urls):\n        pass",
    "await asyncio.to_thread(list, *(responses(urls)))",
    "await asyncio.to_thread(list, responses(requests.get('url').json()))",
])
def test_named_generator_consumption_on_loop_or_eager_arguments_fail(expression):
    assert len(scan(GENERATOR_HELPERS + "\nasync def f(urls):\n    " + expression)) == 1


def test_cross_module_generator_creation_is_deferred_until_consumption():
    module = {"services/work.py": GENERATOR_HELPERS}
    assert not scan("""
        from services.work import responses
        async def f(urls):
            await asyncio.to_thread(list, responses(urls))
    """, **module)
    findings = scan("""
        from services.work import responses
        async def f(urls):
            list(responses(urls))
    """, **module)
    assert len(findings) == 1
    assert findings[0].callee == "services.work.responses"


@pytest.mark.parametrize("expression, count", [
    ("session()", 0),
    ("await asyncio.to_thread(work)", 0),
    ("with session():\n        pass", 1),
    ("work()", 1),
])
def test_generator_context_manager_runs_only_when_entered(expression, count):
    findings = scan(dedent("""
        from contextlib import contextmanager
        import requests
        @contextmanager
        def session():
            requests.get('url')
            yield None
        def work():
            with session():
                pass
    """) + "\nasync def f():\n    " + expression)
    assert len(findings) == count


@pytest.mark.parametrize("source", [
    "import requests as r\nasync def f():\n    r.get('url')",
    "from requests import post as send\nasync def f():\n    send('url')",
    "async def f():\n    import requests as r\n    r.post('url')",
    "import httpx\nasync def f():\n    httpx.get('url')",
    "from httpx import Client as C\nasync def f():\n    with C() as c:\n        c.get('url')",
    "import requests\nasync def f():\n    s = requests.Session()\n    s.get('url')",
    "from urllib.request import urlopen as fetch\nasync def f():\n    fetch('url')",
    "from time import sleep as delay\nasync def f():\n    delay(0.5)",
    "import requests\nasync def f():\n    await requests.get('url')",
    "async def f():\n    await supabase_admin.table('x').select('*').execute()",
    "import anthropic as a\nasync def f():\n    c = a.Anthropic()\n    c.messages.create(model='x')",
    "from openai import OpenAI as AI\nasync def f():\n    c = AI()\n    c.chat.completions.create(model='x')",
    "from google import genai\nasync def f():\n    c = genai.Client()\n    c.models.generate_content(model='x')",
    "async def f():\n    db.storage.from_('x').create_signed_url('p', 60)",
    "async def f():\n    bucket = db.storage.from_('x')\n    bucket.upload('p', b'x')",
    "async def f(bucket):\n    bucket.create_signed_url('p', 60)",
])
def test_recognized_sync_network_and_sleep_calls_fail(source):
    assert len(scan(source)) == 1


def test_async_clients_and_non_network_methods_pass():
    assert not scan("""
        import asyncio
        import httpx
        import anthropic
        import openai
        from google import genai
        async def f():
            await builder.execute()
            await async_db.storage.from_('x').upload('p', b'x')
            await async_bucket.create_signed_url('p', 60)
            await asyncio.sleep(0.1)
            async with httpx.AsyncClient() as c:
                await c.get('url')
            a = anthropic.AsyncAnthropic()
            await asyncio.wait_for(a.messages.create(model='x'), 1)
            o = openai.AsyncOpenAI()
            await o.chat.completions.create(model='x')
            g = genai.Client()
            await g.aio.models.generate_content(model='x')
            values = {}
            values.get('x')
            values.update({'x': 1})
            db.storage.from_('x').get_public_url('p')
    """)


@pytest.mark.parametrize("statement", [
    "from services.work import top as save\n    save()",
    "from services import work as w\n    w.top()",
    "import services.work\n    services.work.top()",
])
def test_cross_module_transitive_helpers_fail(statement):
    findings = scan("async def f():\n    " + statement, **{
        "services/work.py": """
            def top():
                middle()
            def middle():
                leaf()
            def leaf():
                db.table('x').select('*').execute()
        """,
    })
    assert len(findings) == 1
    assert findings[0].callee.endswith("services.work.top")


def test_package_relative_imports_are_followed():
    findings = scan_sources({
        "app/routers/example.py": "async def f():\n    from ..services.work import top\n    top()",
        "app/services/work.py": "from . import leaf\ndef top():\n    leaf.save()",
        "app/services/leaf.py": "def save():\n    db.table('x').select('*').execute()",
    })
    assert len(findings) == 1
    assert findings[0].callee == "app.services.work.top"


def test_storage_signing_helpers_with_bucket_parameters_are_followed():
    findings = scan("""
        def sign(bucket):
            return bucket.create_signed_urls(['p'], 60)
        def images(db):
            return sign(db.storage.from_('x'))
        async def f():
            images(supabase_admin)
    """)
    assert len(findings) == 1
    assert findings[0].callee == "routers.example.images"


def test_nested_helpers_methods_and_recursive_call_graph():
    findings = scan("""
        def first():
            second()
        def second():
            first()
            db.table('x').select('*').execute()
        class Service:
            def save(self):
                first()
            async def run(self):
                self.save()
        async def f():
            def save():
                first()
            save()
        async def unused_helper():
            def save():
                first()
            await asyncio.to_thread(save)
    """)
    assert {(f.function, f.callee) for f in findings} == {
        ("Service.run", "routers.example.Service.save"),
        ("f", "routers.example.f.save"),
    }


def test_line_movement_does_not_change_keys_but_extra_call_fails():
    source = "async def f():\n    db.table('x').select('*').execute()\n"
    findings = scan(source)
    allowances = {findings[0].key: Allowance(1, "G1", "Existing debt")}
    assert not violations(scan("\n\n" + source), allowances)
    assert "New sync I/O:" in violations(scan(source + "    db.table('y').select('*').execute()\n"), allowances)[0]
    assert "Stale allowlist:" in violations([], allowances)[0]


def test_partial_removal_requires_shrinking_count():
    findings = scan("async def f():\n    db.table('x').select('*').execute()")
    assert "Stale allowlist:" in violations(findings, {findings[0].key: Allowance(2, "G1", "Debt")})[0]


@pytest.mark.parametrize("line", [
    "routers/x.py::f::db.execute\t1\tG0\t",
    "routers/x.py::f::db.execute\t1\t\tDebt",
    "routers/x.py::f::db.execute\t0\tG0\tDebt",
    "routers/x.py::f::db.execute\t1\tG0",
    "bad-key\t1\tG0\tDebt",
    "routers/x.py::f::db.execute\t1\tG0\tDebt\nrouters/x.py::f::db.execute\t1\tG0\tDebt",
])
def test_malformed_or_unowned_allowances_fail(tmp_path, line):
    path = tmp_path / "allowlist.tsv"
    path.write_text(line)
    with pytest.raises(AssertionError):
        read_allowlist(path)


def test_scan_scope_and_syntax_errors(tmp_path):
    for directory in ["routers", "tests", "migrations", "scripts", "venv", ".venv"]:
        path = tmp_path / directory / "example.py"
        path.parent.mkdir()
        path.write_text("async def f():\n    db.table('x').select('*').execute()")
    assert len(scan_backend(tmp_path)) == 1
    (tmp_path / "routers/example.py").write_text("async def broken(:")
    with pytest.raises(SyntaxError):
        scan_backend(tmp_path)
