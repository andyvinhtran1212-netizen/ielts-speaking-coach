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
