"""Báo cáo săn lỗi #46/#47: chốt an toàn của hai script vận hành."""
import pytest

from scripts import import_cambridge_web_explanations as importer
from scripts import reconcile_storage_orphans as reconcile


def test_production_label_from_settings_blocks_commit(monkeypatch):
    # #46: ENVIRONMENT=production chỉ có trong .env (settings), không có
    # trong os.environ ⇒ trước đây lọt chốt.
    from config import settings

    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    with pytest.raises(importer.ImportValidationError, match="allow-production-hidden"):
        importer.commit_rows([], confirmed_ref="anything")


class _Q:
    def __init__(self, table, calls, rows):
        self.table, self.calls, self.rows = table, calls, rows
        self.ordered = None

    def select(self, *_a):
        return self

    def filter(self, *_a):
        return self

    def order(self, col, *a, **k):
        self.ordered = col
        return self

    def range(self, start, end):
        self.calls.append((self.table, self.ordered, start, end))
        cap = getattr(self, "cap", None)
        stop = end + 1 if cap is None else min(end + 1, start + cap)
        self._slice = self.rows[start:stop]
        return self

    def execute(self):
        return type("R", (), {"data": self._slice})()


class _SB:
    def __init__(self, rows, cap=None):
        self.calls, self.rows, self.cap = [], rows, cap

    def table(self, name):
        q = _Q(name, self.calls, self.rows)
        q.cap = self.cap
        return q


def test_fetch_all_pages_with_a_stable_order():
    # #47: phân trang không order ⇒ trang có thể chồng/sót ⇒ path đang dùng
    # bị coi là mồ côi và --delete xoá nó.
    rows = [{"id": i} for i in range(2500)]
    sb = _SB(rows)
    got = reconcile._fetch_all(sb, "listening_content", "audio_storage_path")
    assert len(got) == 2500
    assert sb.calls and all(order == "id" for _t, order, _s, _e in sb.calls)


def test_fetch_all_keeps_going_when_the_server_caps_the_page():
    # HOLD #2699: PostgREST max-rows (vd 500) < trang 1000 ⇒ trước đây trang
    # ngắn bị coi là hết và phần tham chiếu phía sau bị bỏ.
    rows = [{"id": i} for i in range(1700)]
    sb = _SB(rows, cap=500)
    got = reconcile._fetch_all(sb, "listening_content", "audio_storage_path")
    assert [r["id"] for r in got] == list(range(1700))
    assert [s for _t, _o, s, _e in sb.calls] == [0, 500, 1000, 1500, 1700]


class _MidScanStorage:
    """Storage mà trong lúc liệt kê, nội dung mới vừa tham chiếu `new.svg`."""

    def __init__(self):
        self.removed = []

    def from_(self, bucket):
        owner = self

        class _B:
            def list(self, prefix, _opts):
                if prefix:
                    return []
                return [{"name": "new.svg", "id": "x", "metadata": {"size": 1}}]

            def remove(self, paths):
                owner.removed.append((bucket, list(paths)))

        return _B()


def test_delete_mode_is_refused_so_a_reference_added_mid_scan_is_never_removed(monkeypatch, capsys):
    # HOLD #2699: refs đọc trước, Storage liệt kê sau ⇒ `new.svg` (vừa được
    # tham chiếu) trông như mồ côi. --delete bị tắt nên không gì bị xoá.
    class _DB:
        storage = _MidScanStorage()

        def table(self, name):
            return _Q(name, [], [])

    db = _DB()
    monkeypatch.setattr("database.supabase_admin", db)
    monkeypatch.setattr(reconcile.sys, "argv", ["reconcile_storage_orphans.py", "--delete"])
    assert reconcile.main() == 2
    assert db.storage.removed == []
    assert "TẮT" in capsys.readouterr().out
