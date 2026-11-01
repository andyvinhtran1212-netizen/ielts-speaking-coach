"""Shared factory for the backend's direct SQLAlchemy/asyncpg engines (PC-J168).

Every ``create_async_engine`` against the Supabase database goes through
``create_asyncpg_engine`` so the engines stay safe behind a transaction pooler
(Supavisor/PgBouncer, port 6543), where consecutive transactions on one client
connection can land on different server backends:

* ``statement_cache_size=0`` turns off asyncpg's own prepared-statement cache;
* ``prepared_statement_cache_size=0`` turns off SQLAlchemy's asyncpg-adapter
  cache (popped by the dialect, never passed to ``asyncpg.connect``);
* ``prepared_statement_name_func`` gives each statement a unique name, so a
  statement prepared by one client connection can never collide with an
  ``__asyncpg_stmt_N__`` left on a shared backend by another (SQLAlchemy
  "Prepared Statement Name with PGBouncer"; asyncpg#837).

On the session pooler (port 5432) these only cost a re-prepare per statement.
``scripts/staff_security_sweep.py`` applies the same rule to its raw asyncpg
connection.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def _unique_statement_name() -> str:
    return f"__asyncpg_{uuid4()}__"


def pooler_safe_connect_args() -> dict[str, Any]:
    return {
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": _unique_statement_name,
    }


def create_asyncpg_engine(url: Any, **kwargs: Any) -> AsyncEngine:
    """``create_async_engine`` with the pooler-safe asyncpg ``connect_args``.

    Caller ``connect_args`` are merged on top (e.g. ``server_settings``) but
    cannot switch the statement caches back on."""
    connect_args = {**kwargs.pop("connect_args", {}), **pooler_safe_connect_args()}
    return create_async_engine(url, connect_args=connect_args, **kwargs)
