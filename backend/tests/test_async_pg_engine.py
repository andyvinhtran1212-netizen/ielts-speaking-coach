"""PC-J168: direct asyncpg engines stay safe behind a transaction pooler.

Proves the shared factory hands SQLAlchemy both cache switches and a unique
statement-name function, that only ``statement_cache_size`` reaches
``asyncpg.connect`` (SQLAlchemy consumes the rest), that no non-test module
calls ``create_async_engine`` outside the factory, and — on a LOCAL PostgreSQL
(TEST_PG_URL; REQUIRE_PG=1 forbids the skip) — that a real connection runs with
asyncpg's cache off and uniquely named statements.
"""

from __future__ import annotations

import ast
import asyncio
import os
import re
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import urlparse

import asyncpg
import pytest
from sqlalchemy import text

from services import async_pg_engine

BACKEND = Path(__file__).resolve().parents[1]
STATEMENT_NAME = re.compile(r"__asyncpg_[0-9a-f-]{36}__")


def test_factory_passes_both_cache_switches_and_a_unique_name_func(monkeypatch):
    created = MagicMock()
    monkeypatch.setattr(async_pg_engine, "create_async_engine", created)

    async_pg_engine.create_asyncpg_engine("postgresql+asyncpg://u@h/db", poolclass="pool")

    (url,), kwargs = created.call_args
    assert url == "postgresql+asyncpg://u@h/db" and kwargs["poolclass"] == "pool"
    args = kwargs["connect_args"]
    assert args["statement_cache_size"] == 0
    assert args["prepared_statement_cache_size"] == 0
    first, second = args["prepared_statement_name_func"](), args["prepared_statement_name_func"]()
    assert STATEMENT_NAME.fullmatch(first) and STATEMENT_NAME.fullmatch(second) and first != second


def test_caller_connect_args_are_kept_but_cannot_reenable_the_caches(monkeypatch):
    created = MagicMock()
    monkeypatch.setattr(async_pg_engine, "create_async_engine", created)

    async_pg_engine.create_asyncpg_engine(
        "postgresql+asyncpg://u@h/db",
        connect_args={"server_settings": {"search_path": "s"}, "statement_cache_size": 100,
                      "prepared_statement_cache_size": 100})

    args = created.call_args.kwargs["connect_args"]
    assert args["server_settings"] == {"search_path": "s"}
    assert args["statement_cache_size"] == 0 and args["prepared_statement_cache_size"] == 0


def test_only_the_asyncpg_switch_reaches_asyncpg_connect(monkeypatch):
    seen = {}

    async def fake_connect(*args, **kwargs):
        seen.update(kwargs)
        raise ConnectionRefusedError("stop before any network I/O")

    monkeypatch.setattr(asyncpg, "connect", fake_connect)
    engine = async_pg_engine.create_asyncpg_engine("postgresql+asyncpg://u:p@127.0.0.1:1/db")

    async def attempt():
        try:
            with pytest.raises(ConnectionRefusedError):
                async with engine.connect():
                    pass
        finally:
            await engine.dispose()

    asyncio.run(attempt())
    assert seen["statement_cache_size"] == 0
    assert "prepared_statement_cache_size" not in seen
    assert "prepared_statement_name_func" not in seen


def _engine_calls(path: Path) -> list[int]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [node.lineno for node in ast.walk(tree) if isinstance(node, ast.Call) and (
        getattr(node.func, "id", None) == "create_async_engine"
        or getattr(node.func, "attr", None) == "create_async_engine")]


def test_no_backend_module_builds_an_engine_outside_the_factory():
    factory = BACKEND / "services" / "async_pg_engine.py"
    skip = {"tests", "venv", ".venv", "node_modules", "__pycache__"}
    offenders = [
        f"{path.relative_to(BACKEND)}:{line}"
        for path in BACKEND.rglob("*.py")
        if path != factory and not skip.intersection(path.relative_to(BACKEND).parts)
        for line in _engine_calls(path)
    ]
    assert offenders == []
    assert _engine_calls(factory), "the factory itself must still build the engine"
    for router in ("admin.py", "admin_quiz.py"):
        assert "create_asyncpg_engine(" in (BACKEND / "routers" / router).read_text(encoding="utf-8")


def test_live_connection_has_cache_off_and_unique_statement_names():
    dsn = os.environ.get("TEST_PG_URL", "")
    parsed = urlparse(dsn)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {
            "localhost", "127.0.0.1", "::1"}:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("TEST_PG_URL must point at a LOCAL PostgreSQL")
        pytest.skip("Local PostgreSQL unavailable")
    url = "postgresql+asyncpg://" + dsn.split("://", 1)[1]

    async def run():
        engine = async_pg_engine.create_asyncpg_engine(url)
        try:
            async with engine.connect() as connection:
                raw = (await connection.get_raw_connection()).driver_connection
                assert raw._stmt_cache.get_max_size() == 0
                names = []
                for _ in range(2):
                    # The running statement is itself prepared, so it lists its own name.
                    rows = (await connection.execute(text(
                        "SELECT name FROM pg_prepared_statements WHERE name LIKE '\\_\\_asyncpg\\_%'"
                    ))).scalars().all()
                    names.append(set(rows))
                assert all(STATEMENT_NAME.fullmatch(name) for found in names for name in found)
                assert names[1] - names[0], "each execution prepares a new uniquely named statement"
        finally:
            await engine.dispose()

    asyncio.run(run())
