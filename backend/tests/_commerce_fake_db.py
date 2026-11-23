"""In-memory stand-in for the supabase-py client used by the G04-T04 tests
(enrollment orders, learner e-mail, sweep). Only the builder calls those
modules make are supported; an unknown call fails loudly."""

from __future__ import annotations

import copy
from datetime import datetime


def _cmp_value(value):
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value


class _Result:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Not:
    def __init__(self, query):
        self._query = query

    def is_(self, column, value):
        assert value == "null"
        self._query._filters.append(lambda r: r.get(column) is not None)
        return self._query


class _Query:
    def __init__(self, db, table):
        self._db, self._table = db, table
        self._filters, self._order, self._limit = [], [], None
        self._update = None
        self._count = None

    # ── builder ──
    def select(self, _columns, count=None):
        self._count = count
        return self

    def update(self, values):
        self._update = dict(values)
        return self

    def eq(self, column, value):
        self._filters.append(lambda r: r.get(column) == value)
        return self

    def neq(self, column, value):
        self._filters.append(lambda r: r.get(column) != value)
        return self

    def in_(self, column, values):
        values = list(values)
        self._filters.append(lambda r: r.get(column) in values)
        return self

    def lt(self, column, value):
        self._filters.append(lambda r: r.get(column) is not None and _cmp_value(r[column]) < _cmp_value(value))
        return self

    def lte(self, column, value):
        self._filters.append(lambda r: r.get(column) is not None and _cmp_value(r[column]) <= _cmp_value(value))
        return self

    def is_(self, column, value):
        assert value == "null"
        self._filters.append(lambda r: r.get(column) is None)
        return self

    def ilike(self, column, value):
        self._filters.append(lambda r: str(r.get(column) or "").lower() == str(value).lower())
        return self

    @property
    def not_(self):
        return _Not(self)

    def order(self, column, desc=False):
        self._order.append((column, desc))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        self._db.calls.append((self._table, "update" if self._update is not None else "select"))
        if self._table in self._db.broken:
            raise RuntimeError(f"{self._table} down")
        rows = [r for r in self._db.tables.setdefault(self._table, []) if all(f(r) for f in self._filters)]
        if self._update is not None:
            for r in rows:
                r.update(self._update)
            return _Result(copy.deepcopy(rows))
        for column, desc in reversed(self._order):
            rows.sort(key=lambda r: (_cmp_value(r.get(column)) is None, _cmp_value(r.get(column)) or 0),
                      reverse=desc)
        count = len(rows) if self._count else None
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Result(copy.deepcopy(rows), count)


class _Rpc:
    def __init__(self, db, name, params):
        self._db, self._name, self._params = db, name, dict(params)

    def execute(self):
        self._db.rpcs.append((self._name, self._params))
        handler = self._db.handlers.get(self._name)
        if handler is None:
            raise AssertionError(f"unexpected rpc {self._name}")
        result = handler(self._params)
        if isinstance(result, BaseException):
            raise result
        return _Result(result)


class FakeDB:
    def __init__(self, tables=None, handlers=None):
        self.tables = tables or {}
        self.handlers = handlers or {}
        self.broken: set[str] = set()
        self.calls: list = []
        self.rpcs: list = []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)
