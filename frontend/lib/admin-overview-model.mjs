const WINDOWS = new Set([7, 30, 90]);

export function normalizeWindowDays(value) {
  const parsed = Number(value);
  return WINDOWS.has(parsed) ? parsed : 30;
}

export function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSeries(value) {
  if (!Array.isArray(value)) return [];
  return value.map((point) => {
    const source = point && typeof point === 'object' ? point.value : point;
    return finiteNumber(source) ?? 0;
  });
}

export function chartPoints(values, width, height, pad) {
  const nums = normalizeSeries(values);
  if (nums.length < 2) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  return nums.map((value, index) => ({
    x: Math.round((pad + (index / (nums.length - 1)) * innerWidth) * 100) / 100,
    y: Math.round((pad + innerHeight - ((value - min) / span) * innerHeight) * 100) / 100,
  }));
}

export function periodDelta(values) {
  const nums = normalizeSeries(values);
  if (nums.length < 4) return null;
  const midpoint = Math.floor(nums.length / 2);
  const prior = nums.slice(0, midpoint).reduce((sum, value) => sum + value, 0);
  const recent = nums.slice(midpoint).reduce((sum, value) => sum + value, 0);
  if (prior === 0) {
    return recent > 0 ? { pct: null, dir: 'up' } : { pct: 0, dir: 'flat' };
  }
  const pct = Math.round(((recent - prior) / prior) * 100);
  return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

export function safeActivityLink(value) {
  if (typeof value !== 'string') return null;
  const link = value.trim();
  if (!link.startsWith('/') || link.startsWith('//') || link.includes('\\') || /[\u0000-\u001f\u007f]/.test(link)) {
    return null;
  }
  return link;
}

export function formatInteger(value, locale = 'vi-VN') {
  const number = finiteNumber(value);
  return number == null ? '—' : number.toLocaleString(locale);
}

export function formatTokens(value) {
  const number = finiteNumber(value);
  if (number == null) return '—';
  const unit = (divisor, suffix) => `${(number / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`;
  if (number >= 1e9) return unit(1e9, 'B');
  if (number >= 1e6) return unit(1e6, 'M');
  if (number >= 1e3) return unit(1e3, 'K');
  return String(number);
}

export function normalizeOverviewPayload(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const activity = Array.isArray(raw.recent_activity)
    ? raw.recent_activity.filter((row) => row && typeof row === 'object' && row.timestamp)
    : [];
  return {
    students: raw.students && typeof raw.students === 'object' ? raw.students : {},
    skills: raw.skills && typeof raw.skills === 'object' ? raw.skills : {},
    errors: raw.errors && typeof raw.errors === 'object' ? raw.errors : {},
    accessCodes: raw.access_codes && typeof raw.access_codes === 'object' ? raw.access_codes : {},
    recentActivity: activity,
    generatedAt: typeof raw.generated_at === 'string' ? raw.generated_at : null,
  };
}

export function normalizeOpsPayload(value, requestedWindow) {
  const raw = value && typeof value === 'object' ? value : {};
  const visitors = raw.distinct_visitors && typeof raw.distinct_visitors === 'object'
    ? raw.distinct_visitors : {};
  const tokens = raw.tokens_called && typeof raw.tokens_called === 'object'
    ? raw.tokens_called : {};
  const attention = raw.attention && typeof raw.attention === 'object' ? raw.attention : {};
  return {
    totalUsers: finiteNumber(raw.total_users),
    activeCodes: finiteNumber(raw.active_codes),
    totalPractices: finiteNumber(raw.total_practices),
    gradingMinutes: finiteNumber(raw.grading_minutes),
    visitors: {
      count: finiteNumber(visitors.count),
      authenticated: finiteNumber(visitors.authenticated),
      anonymous: finiteNumber(visitors.anonymous),
      windowDays: normalizeWindowDays(visitors.window_days ?? requestedWindow),
    },
    tokens: {
      count: finiteNumber(tokens.count),
      windowDays: normalizeWindowDays(tokens.window_days ?? requestedWindow),
    },
    attention: {
      errorsUndismissed: finiteNumber(attention.errors_undismissed),
      writingPending: finiteNumber(attention.writing_pending),
    },
    computedAt: typeof raw.computed_at === 'string' ? raw.computed_at : null,
  };
}

export function normalizeTrendsPayload(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const series = raw.series && typeof raw.series === 'object' ? raw.series : {};
  return {
    visitors: normalizeSeries(series.visitors),
    practices: normalizeSeries(series.practices),
    tokens: normalizeSeries(series.tokens),
  };
}
