function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function count(value, nullable = false) {
  if (nullable && value == null) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function rows(value, nullable, limit) {
  if (nullable && value == null) return null;
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const normalized = [];
  for (const raw of value) {
    const row = record(raw);
    const slug = text(row?.slug);
    const title = text(row?.title);
    const category = text(row?.category) || '';
    const metric = count(row?.count);
    if (!slug || !title || metric === undefined) return undefined;
    normalized.push({ slug, title, category, count: metric });
  }
  return normalized;
}

export function normalizeGrammarAnalyticsDays(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return [7, 14, 30, 90].includes(parsed) ? parsed : 7;
}

export function normalizeGrammarAnalyticsPayload(value) {
  const payload = record(value);
  const status = record(payload?.analytics_status);
  if (!payload || !status) return null;
  for (const source of ['views', 'recent_activity', 'saves']) {
    if (!['complete', 'unavailable'].includes(status[source])) return null;
  }
  if (payload.recent_activity_basis !== 'user_article_records_with_last_viewed_at_in_window') return null;
  const days = count(payload.days);
  const articlesTotal = count(payload.articles_total);
  const viewsAvailable = status.views === 'complete';
  const recentAvailable = status.recent_activity === 'complete';
  const savesAvailable = status.saves === 'complete';
  const viewsTotal = count(payload.views_total, !viewsAvailable);
  const activeRecordsRecent = count(payload.active_view_records_recent, !recentAvailable);
  const savesTotal = count(payload.saves_total, !savesAvailable);
  const zeroViewTotal = count(payload.zero_view_total, !viewsAvailable);
  const topViewed = rows(payload.top_viewed, !viewsAvailable, 20);
  const topSaved = rows(payload.top_saved, !savesAvailable, 5);
  const zeroViewArticles = rows(payload.zero_view_slugs, !viewsAvailable, 30);
  if (!days || days > 90 || articlesTotal === undefined || viewsTotal === undefined
      || activeRecordsRecent === undefined || savesTotal === undefined || zeroViewTotal === undefined
      || topViewed === undefined || topSaved === undefined || zeroViewArticles === undefined) return null;
  if ((!viewsAvailable && (viewsTotal !== null || zeroViewTotal !== null || topViewed !== null || zeroViewArticles !== null))
      || (!recentAvailable && activeRecordsRecent !== null)
      || (!savesAvailable && (savesTotal !== null || topSaved !== null))) return null;
  return {
    days,
    articlesTotal,
    viewsTotal,
    activeRecordsRecent,
    savesTotal,
    zeroViewTotal,
    topViewed,
    topSaved,
    zeroViewArticles,
    status: {
      views: status.views,
      recentActivity: status.recent_activity,
      saves: status.saves,
    },
  };
}

export function formatGrammarAnalyticsMetric(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('vi-VN') : '—';
}

export function grammarAnalyticsArticleHref(row) {
  return `/grammar/${encodeURIComponent(row.category)}/${encodeURIComponent(row.slug)}`;
}
