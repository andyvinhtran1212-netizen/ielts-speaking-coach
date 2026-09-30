"""Dashboard attention and its linked instructor queue use the same scope."""
from types import SimpleNamespace

from services import admin_dashboard
from test_dashboard_overview import _Stub, _default_results


class ReviewQuery:
    def __init__(self, reviews, essays, unknown_count=False):
        self.reviews, self.essays = reviews, essays
        self.filters, self.inner_join = [], False
        self.unknown_count = unknown_count

    def select(self, projection, *, count, head):
        assert count == 'exact' and head is True
        self.inner_join = 'writing_essays!inner' in projection
        return self

    def in_(self, column, values):
        self.filters.append(lambda row: row.get(column) in values)
        return self

    def is_(self, column, value):
        assert column == 'writing_essays.deleted_at' and value == 'null'
        self.filters.append(lambda row: self.essays.get(row['essay_id'], {}).get('deleted_at') is None)
        return self

    def execute(self):
        rows = [row for row in self.reviews if all(f(row) for f in self.filters)]
        if self.inner_join:
            rows = [row for row in rows if row['essay_id'] in self.essays]
        return SimpleNamespace(count=None if self.unknown_count else len(rows))


class Store(_Stub):
    def __init__(self, unknown_count=False):
        super().__init__(_default_results())
        # There are seven undelivered essays, but only three active reviews.
        self.essays = {str(i): {'deleted_at': None} for i in range(7)}
        self.essays['deleted'] = {'deleted_at': '2026-09-29T00:00:00Z'}
        self.reviews = [{'essay_id': str(i), 'status': status} for i, status in enumerate([
            'queued', 'claimed', 'edited', 'delivered', 'released'])] + [
            {'essay_id': 'deleted', 'status': 'queued'},
            {'essay_id': 'missing', 'status': 'queued'}]
        self.unknown_count = unknown_count

    def table(self, name):
        if name == 'instructor_reviews':
            return ReviewQuery(self.reviews, self.essays, self.unknown_count)
        return super().table(name)


def test_attention_counts_only_visible_active_instructor_reviews(monkeypatch):
    monkeypatch.setattr(admin_dashboard, 'supabase_admin', Store())
    result = admin_dashboard.compute_dashboard_overview()
    assert result['attention']['writing_pending'] == 3


def test_missing_queue_count_remains_unknown(monkeypatch):
    monkeypatch.setattr(admin_dashboard, 'supabase_admin', Store(unknown_count=True))
    result = admin_dashboard.compute_dashboard_overview()
    assert result['attention']['writing_pending'] is None
