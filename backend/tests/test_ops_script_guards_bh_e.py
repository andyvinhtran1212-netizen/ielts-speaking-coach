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
        self._slice = self.rows[start:end + 1]
        return self

    def execute(self):
        return type("R", (), {"data": self._slice})()


class _SB:
    def __init__(self, rows):
        self.calls, self.rows = [], rows

    def table(self, name):
        return _Q(name, self.calls, self.rows)


def test_fetch_all_pages_with_a_stable_order():
    # #47: phân trang không order ⇒ trang có thể chồng/sót ⇒ path đang dùng
    # bị coi là mồ côi và --delete xoá nó.
    rows = [{"id": i} for i in range(2500)]
    sb = _SB(rows)
    got = reconcile._fetch_all(sb, "listening_content", "audio_storage_path")
    assert len(got) == 2500
    assert sb.calls and all(order == "id" for _t, order, _s, _e in sb.calls)
