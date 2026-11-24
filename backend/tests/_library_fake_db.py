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
        self._write = None  # ("upsert", row, conflict_cols, ignore) | ("delete",)
        self._order: list[str] = []
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
        self._order.append(column)
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def upsert(self, row, on_conflict="", ignore_duplicates=False):
        self._write = ("upsert", dict(row), [c.strip() for c in on_conflict.split(",") if c.strip()], ignore_duplicates)
        return self

    def delete(self):
        self._write = ("delete",)
        return self

    def execute(self):
        self._db.calls.append(self._table)
        if self._table in self._db.broken:
            raise RuntimeError("db down")
        table = self._db.tables.setdefault(self._table, [])
        if self._write and self._write[0] == "upsert":
            _, row, cols, ignore = self._write
            self._db.writes.append((self._table, "upsert", dict(row)))
            same = [r for r in table if cols and all(r.get(c) == row.get(c) for c in cols)]
            if same:
                if not ignore:
                    same[0].update(row)
            else:
                table.append(row)
            return _Result([copy.deepcopy(row)])
        rows = [r for r in table if all(f(r) for f in self._filters)]
        if self._order:
            rows.sort(key=lambda r: tuple(str(r.get(c)) for c in self._order))
        if self._write is None:
            if self._range is not None:
                rows = rows[self._range[0]:self._range[1] + 1]
            if self._db.row_limit is not None:
                rows = rows[:self._db.row_limit]  # PostgREST max rows: silent cut
        if self._write and self._write[0] == "delete":
            self._db.writes.append((self._table, "delete", len(rows)))
            self._db.tables[self._table] = [r for r in table if r not in rows]
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

    def info(self, path):
        self._db.infos.append((self._name, path))
        if (self._name, path) not in self._db.objects:
            raise RuntimeError("object not found")
        import hashlib

        data = self._db.objects[(self._name, path)]
        return {"id": path, "etag": hashlib.md5(data).hexdigest(), "size": len(data)}


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
        self.downloads: list[tuple[str, str]] = []
        self.writes: list[tuple] = []
        self.row_limit: int | None = None
        self.infos: list[tuple[str, str]] = []
        self.storage = _Storage(self)

    def table(self, name):
        return _Query(self, name)
