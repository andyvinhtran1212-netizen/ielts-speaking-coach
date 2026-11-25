"""A supabase-py stand-in that runs on the disposable PostgreSQL schema of
``tests/test_migration_384_credit_ledger_enrollment_rpcs.py`` (``pg``
fixture), so the G04-T04 routes can be driven end to end against the real
383/384 tables, triggers and RPCs.

Only the builder calls the enrollment / learner-mail / entitlement code makes
are supported. Rows come back as JSON (``to_jsonb``), the shape PostgREST
returns. Calls arrive on worker threads and run on the test's event loop,
which stays free because the test awaits ``asyncio.to_thread`` around them.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime

from postgrest.exceptions import APIError

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def _value(v):
    if isinstance(v, str):
        if _UUID.match(v):
            return uuid.UUID(v)
        if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", v):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except ValueError:
                return v
    if isinstance(v, (list, tuple)):
        return [_value(x) for x in v]
    return v


def _ident(name: str) -> str:
    assert _IDENT.match(name), name
    return name


class _Result:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class _Not:
    def __init__(self, query):
        self._q = query

    def is_(self, column, value):
        assert value == "null"
        self._q._where.append((f"{_ident(column)} IS NOT NULL", None))
        return self._q


class _Query:
    def __init__(self, client, table):
        self._c, self._table = client, _ident(table)
        self._cols, self._where, self._order, self._limit = "*", [], [], None
        self._update, self._count = None, None

    def select(self, columns, count=None):
        cols = [c.strip() for c in columns.split(",")]
        self._cols = ", ".join(_ident(c) for c in cols) if columns.strip() != "*" else "*"
        self._count = count
        return self

    def update(self, values):
        self._update = {_ident(k): v for k, v in values.items()}
        return self

    def _op(self, column, op, value):
        self._where.append((f"{_ident(column)} {op} {{}}", _value(value)))
        return self

    def eq(self, c, v):
        return self._op(c, "=", v)

    def neq(self, c, v):
        return self._op(c, "<>", v)

    def lt(self, c, v):
        return self._op(c, "<", v)

    def lte(self, c, v):
        return self._op(c, "<=", v)

    def ilike(self, c, v):
        return self._op(c, "ILIKE", v)

    def in_(self, c, values):
        self._where.append((f"{_ident(c)} = ANY({{}})", _value(list(values))))
        return self

    def is_(self, c, value):
        assert value == "null"
        self._where.append((f"{_ident(c)} IS NULL", None))
        return self

    @property
    def not_(self):
        return _Not(self)

    def order(self, column, desc=False):
        self._order.append(f"{_ident(column)} {'DESC' if desc else 'ASC'}")
        return self

    def limit(self, n):
        self._limit = int(n)
        return self

    def _sql_where(self, args):
        parts = []
        for template, value in self._where:
            if value is None and "{}" not in template:
                parts.append(template)
            else:
                args.append(value)
                parts.append(template.format(f"${len(args)}"))
        return (" WHERE " + " AND ".join(parts)) if parts else ""

    def execute(self):
        return self._c.run(self._execute())

    async def _execute(self):
        con, args = self._c.con, []
        try:
            if self._update is not None:
                sets = []
                for column, value in self._update.items():
                    args.append(_value(value))
                    sets.append(f"{column} = ${len(args)}")
                where = self._sql_where(args)
                rows = await con.fetch(f"UPDATE {self._table} t SET {', '.join(sets)}{where} "
                                       f"RETURNING to_jsonb(t)::text AS j", *args)
                return _Result([json.loads(r["j"]) for r in rows])
            where = self._sql_where(args)
            order = (" ORDER BY " + ", ".join(self._order)) if self._order else ""
            count = None
            if self._count:
                count = await con.fetchval(f"SELECT count(*) FROM {self._table}{where}", *args)
            limit = f" LIMIT {self._limit}" if self._limit is not None else ""
            rows = await con.fetch(f"SELECT to_jsonb(s)::text AS j FROM (SELECT {self._cols} FROM {self._table}"
                                   f"{where}{order}{limit}) s", *args)
            return _Result([json.loads(r["j"]) for r in rows], count)
        except APIError:
            raise
        except Exception as exc:
            raise APIError({"code": getattr(exc, "sqlstate", None) or "XX000", "message": str(exc)}) from exc


class _Rpc:
    def __init__(self, client, name, params):
        self._c, self._name, self._params = client, _ident(name), dict(params)

    def execute(self):
        return self._c.run(self._execute())

    async def _execute(self):
        self._c.rpcs.append(self._name)
        names = [_ident(k) for k in self._params]
        args = [_value(v) for v in self._params.values()]
        call = ", ".join(f"{n} => ${i}" for i, n in enumerate(names, start=1))
        try:
            raw = await self._c.con.fetchval(f"SELECT {self._name}({call})::text", *args)
        except Exception as exc:
            code = getattr(exc, "sqlstate", None) or "XX000"
            raise APIError({"code": code, "message": str(getattr(exc, "message", exc))}) from exc
        return _Result(json.loads(raw) if raw is not None else None)


class PgSupabase:
    def __init__(self, con, loop):
        self.con, self.loop = con, loop
        self.rpcs: list[str] = []

    def run(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout=30)

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)
