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

function timestamp(value) {
  if (value == null) return null;
  const normalized = text(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

export function normalizeFootTrafficPayload(value) {
  const payload = record(value);
  if (!payload) return null;
  const status = ['complete', 'partial', 'unavailable'].includes(payload.data_status)
    ? payload.data_status
    : null;
  if (!status) return null;
  const totalViews = count(payload.total_views, status === 'unavailable');
  const uniqueVisitors = count(payload.unique_visitors, status === 'unavailable');
  const anonymousHits = count(payload.anonymous_hits, status === 'unavailable');
  const snapshotTo = timestamp(payload.snapshot_to);
  const effectiveTo = timestamp(payload.effective_to);
  if (totalViews === undefined || uniqueVisitors === undefined || anonymousHits === undefined || snapshotTo === undefined || effectiveTo === undefined) return null;
  if (status !== 'unavailable' && (totalViews == null || uniqueVisitors == null || anonymousHits == null)) return null;
  if (status === 'unavailable' && (totalViews != null || uniqueVisitors != null || anonymousHits != null)) return null;

  let malformedCount = 0;
  const topPages = [];
  for (const raw of Array.isArray(payload.top_pages) ? payload.top_pages : []) {
    const row = record(raw);
    const path = text(row?.path);
    const views = count(row?.views);
    if (!path || views === undefined) { malformedCount += 1; continue; }
    topPages.push({ path, views });
  }
  const daily = [];
  for (const raw of Array.isArray(payload.daily) ? payload.daily : []) {
    const row = record(raw);
    const date = text(row?.date);
    const views = count(row?.views);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || views === undefined) { malformedCount += 1; continue; }
    daily.push({ date, views });
  }

  return {
    status,
    truncated: Boolean(payload.truncated) || status === 'partial',
    dateFrom: text(payload.date_from),
    dateTo: text(payload.date_to),
    route: text(payload.route),
    snapshotTo,
    effectiveTo,
    totalViews,
    uniqueVisitors,
    anonymousHits,
    topPages,
    daily: daily.sort((left, right) => left.date.localeCompare(right.date)),
    malformedCount,
  };
}

export function dateInputToIso(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const iso = `${value}${suffix}`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export function formatTrafficCount(value, partial = false) {
  if (!Number.isSafeInteger(value) || value < 0) return '—';
  return `${partial ? '≥ ' : ''}${value.toLocaleString('vi-VN')}`;
}

export function formatTrafficDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return `${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`;
}

export function defaultTrafficDates(now = new Date()) {
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
