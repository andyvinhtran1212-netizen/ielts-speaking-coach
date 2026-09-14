const CORE_METRIC_FIELDS = Object.freeze({
  CLS: 'cls',
  FCP: 'fcp',
  FID: 'fid',
  INP: 'inp',
  LCP: 'lcp',
  TTFB: 'ttfb',
});

function metricValue(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return name === 'CLS'
    ? Math.round(value * 1000) / 1000
    : Math.round(value);
}

/** Preserve the historical analytics envelope while using Next's native data. */
export function buildNextVitalsPayload(metric, context) {
  const name = typeof metric?.name === 'string' ? metric.name.toUpperCase() : '';
  const field = CORE_METRIC_FIELDS[name];
  const value = metricValue(name, metric?.value);
  if (!field || value === null) return null;
  const loadedAt = Number(context?.loadedAt);
  const now = Number(context?.now);
  const hasTiming = Number.isFinite(loadedAt) && Number.isFinite(now);

  return {
    event_name: 'web_vitals',
    event_data: {
      path: typeof context?.path === 'string' ? context.path : null,
      implementation: 'next',
      release: context?.release || null,
      doc_release: context?.release || null,
      loaded_at: Number.isFinite(loadedAt) ? loadedAt : null,
      age_ms: hasTiming ? Math.max(0, now - loadedAt) : 0,
      ua: typeof context?.userAgent === 'string'
        ? context.userAgent.slice(0, 300)
        : null,
      metric_id: typeof metric?.id === 'string' ? metric.id.slice(0, 128) : null,
      metric_name: name,
      [field]: value,
    },
  };
}
