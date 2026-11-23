"""In-memory stand-in for the supabase-py client used by the Library tests."""

from __future__ import annotations

import copy


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self._db = db
        self._table = table
        self._filters = []
        self._order = None
        self._range = None

    def select(self, _columns):
        return self

    def eq(self, column, value):
        self._filters.append(lambda r: r.get(column) == value)
        return self

    def in_(self, column, values):
        self._filters.append(lambda r: r.get(column) in values)
        return self

    def order(self, column, desc=False):
        self._order = (column, desc)
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        self._db.calls.append(self._table)
        if self._table in self._db.broken:
            raise RuntimeError("db down")
        rows = [r for r in self._db.tables.get(self._table, []) if all(f(r) for f in self._filters)]
        if self._order:
            column, desc = self._order
            rows.sort(key=lambda r: str(r.get(column) or ""), reverse=desc)
        if self._range:
            self._db.ranges.append((self._table, *self._range))
            rows = rows[self._range[0]:self._range[1] + 1]
        # PostgREST db-max-rows: a response never holds more than this many rows.
        if self._db.max_rows is not None:
            rows = rows[:self._db.max_rows]
        return _Result(copy.deepcopy(rows))


class _Bucket:
    def __init__(self, db, name):
        self._db = db
        self._name = name

    def download(self, path):
        self._db.downloads.append((self._name, path))
        if (self._name, path) not in self._db.objects:
            raise RuntimeError("object not found")
        return self._db.objects[(self._name, path)]


class _Storage:
    def __init__(self, db):
        self._db = db

    def from_(self, name):
        return _Bucket(self._db, name)


class FakeDB:
    def __init__(self, tables=None, objects=None):
        self.tables = tables or {}
        self.objects = objects or {}
        self.broken: set[str] = set()
        self.calls: list[str] = []
        self.ranges: list[tuple[str, int, int]] = []
        self.max_rows: int | None = None
        self.downloads: list[tuple[str, str]] = []
        self.storage = _Storage(self)

    def table(self, name):
        return _Query(self, name)
