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

export function normalizeGrammarArticlesPayload(value) {
  const payload = record(value);
  const status = record(payload?.analytics_status);
  if (!payload || !status || !['complete', 'unavailable'].includes(status.views)
      || !['complete', 'unavailable'].includes(status.saves)) return null;

  const total = count(payload.total);
  const availableTotal = count(payload.available_total);
  if (total === undefined || availableTotal === undefined || total > availableTotal) return null;

  let malformedCount = 0;
  const items = [];
  for (const raw of Array.isArray(payload.items) ? payload.items : []) {
    const row = record(raw);
    const slug = text(row?.slug);
    const title = text(row?.title);
    const category = text(row?.category);
    const sourcePath = text(row?.source_path);
    const viewCount = count(row?.view_count, status.views === 'unavailable');
    const saveCount = count(row?.save_count, status.saves === 'unavailable');
    if (!slug || !title || !category || !sourcePath || viewCount === undefined || saveCount === undefined
        || (status.views === 'complete' && viewCount == null)
        || (status.saves === 'complete' && saveCount == null)) {
      malformedCount += 1;
      continue;
    }
    items.push({
      slug,
      title,
      category,
      sourcePath,
      summary: text(row.summary),
      band: typeof row.band === 'number' || typeof row.band === 'string' ? String(row.band) : null,
      viewCount,
      saveCount,
    });
  }
  if (items.length + malformedCount !== total) return null;

  const categories = Array.from(new Set((Array.isArray(payload.categories) ? payload.categories : [])
    .map(text).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  return {
    total,
    availableTotal,
    categories,
    items,
    malformedCount,
    analyticsStatus: { views: status.views, saves: status.saves },
  };
}

export function normalizeGrammarPreview(value, expectedSlug) {
  const payload = record(value);
  const slug = text(payload?.slug);
  const html = typeof payload?.html === 'string' ? payload.html : null;
  if (!slug || slug !== expectedSlug || html == null) return null;
  return { slug, html };
}

export function grammarStudentHref(category, slug) {
  return `/grammar/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`;
}

export function formatGrammarMetric(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('vi-VN') : '—';
}
